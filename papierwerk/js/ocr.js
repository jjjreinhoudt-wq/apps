/* Leesmachine: tekstherkenning (OCR) op gescande pagina's.
 *
 * Klein laadscript rond tesseract.js. Alles komt van de eigen site
 * (lib/ocr/), er gaat niets naar een andere host en de pagina zelf
 * verlaat het apparaat niet.
 *
 *   Leesmachine.available()            -> boolean
 *   Leesmachine.recognize(canvas, opts) -> Promise<{ width, height, words }>
 *       words: [{ text, x0, y0, x1, y1, conf, line }]
 *       opts:  { langs?: "nld+eng", progress?: (fractie 0..1, tekst) => void }
 *   Leesmachine.stop()                 -> ruimt de herkenner op
 *
 * De herkenner (worker + wasm + taalbestanden, enkele MB) wordt pas
 * geladen bij de eerste aanroep van recognize() en daarna hergebruikt.
 */
(function () {
  'use strict';

  var STANDAARD_TALEN = 'nld+eng';
  var MAX_ZIJDE = 3200;          // grotere pagina's worden voor het lezen verkleind
  var MAX_PIXELS = 9000000;      // idem, op oppervlak (geheugen op telefoons)

  /* Basismap van de bibliotheek. Afgeleid van de plek van dit script
   * (…/js/ocr.js -> …/lib/ocr/), zodat het ook in een submap werkt. */
  var scriptSrc = '';
  try {
    if (document.currentScript && document.currentScript.src) scriptSrc = document.currentScript.src;
  } catch (e) { /* geen currentScript */ }

  function basis() {
    try {
      if (/^https?:/i.test(scriptSrc)) return new URL('../lib/ocr/', scriptSrc).href;
      return new URL('lib/ocr/', document.baseURI).href;
    } catch (e) {
      return 'lib/ocr/';
    }
  }

  /* Zelfde proefmodule als wasm-feature-detect gebruikt: een piepklein
   * wasm-programma met één SIMD-instructie. */
  var SIMD_PROEF = [0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11];

  function heeftSimd() {
    try {
      return WebAssembly.validate(new Uint8Array(SIMD_PROEF));
    } catch (e) {
      return false;
    }
  }

  function available() {
    try {
      if (window.claude && window.claude.use) return false;
      if (typeof Worker !== 'function') return false;
      if (typeof WebAssembly !== 'object' || typeof WebAssembly.instantiate !== 'function') return false;
      if (typeof Promise !== 'function' || typeof URL !== 'function') return false;
      if (!/^https?:$/i.test(location.protocol)) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------- toestand ---------- */
  var bibliotheekBelofte = null;   // laden van tesseract.min.js
  var werker = null;               // tesseract.js-worker
  var werkerBelofte = null;        // belofte van de worker in opbouw
  var werkerTalen = '';            // talen waarmee de worker is opgestart
  var zonderSimd = false;          // true na terugval op de gewone wasm
  var generatie = 0;               // verhoogt bij stop(); oude klussen vervallen
  var rij = Promise.resolve();     // klussen na elkaar, nooit tegelijk
  var actief = null;               // { meld, afwijzen } van de lopende klus

  function fout(tekst, oorzaak) {
    var e = new Error(tekst);
    if (oorzaak !== undefined) {
      try { e.cause = oorzaak; } catch (x) { /* alleen ter informatie */ }
    }
    return e;
  }

  function oorzaakTekst(o) {
    if (!o) return '';
    if (typeof o === 'string') return o;
    if (o.message) return String(o.message);
    try { return String(o); } catch (e) { return ''; }
  }

  function laadBibliotheek() {
    if (window.Tesseract && window.Tesseract.createWorker) return Promise.resolve(window.Tesseract);
    if (bibliotheekBelofte) return bibliotheekBelofte;
    bibliotheekBelofte = new Promise(function (ok, mis) {
      var s = document.createElement('script');
      s.src = basis() + 'tesseract.min.js';
      s.async = true;
      s.onload = function () {
        if (window.Tesseract && window.Tesseract.createWorker) ok(window.Tesseract);
        else mis(fout('De tekstherkenning kon niet starten (bibliotheek onvolledig).'));
      };
      s.onerror = function () {
        if (s.parentNode) s.parentNode.removeChild(s);
        mis(fout('De tekstherkenning kon niet geladen worden. Controleer de verbinding en probeer het opnieuw.'));
      };
      document.head.appendChild(s);
    });
    bibliotheekBelofte.catch(function () { bibliotheekBelofte = null; });
    return bibliotheekBelofte;
  }

  /* Voortgangsmeldingen van tesseract.js vertalen naar één doorlopende balk. */
  function meldVoortgang(m) {
    if (!actief || !m) return;
    var p = typeof m.progress === 'number' ? Math.max(0, Math.min(1, m.progress)) : 0;
    var st = String(m.status || '');
    if (st === 'recognizing text') {
      actief.meld(actief.laadDeel + (1 - actief.laadDeel) * p, 'Tekst herkennen…');
    } else if (actief.laadDeel > 0) {
      var stap = 0;
      if (st === 'loading tesseract core') stap = 0;
      else if (st === 'initializing tesseract') stap = 1;
      else if (st === 'loading language traineddata') stap = 2;
      else if (st === 'initializing api') stap = 3;
      var tekst = stap === 2 ? 'Taalbestanden laden…' : 'Tekstherkenning laden…';
      actief.meld(actief.laadDeel * (stap + p) / 4, tekst);
    }
  }

  function maakWerker(T, talen, kern) {
    var b = basis();
    return new Promise(function (ok, mis) {
      var klaar = false;
      var tijd = setTimeout(function () {
        if (klaar) return;
        klaar = true;
        mis(fout('De tekstherkenning reageert niet (laden duurde te lang).'));
      }, 120000);
      function afwijzen(o) {
        if (klaar) return;
        klaar = true;
        clearTimeout(tijd);
        mis(o);
      }
      var p;
      try {
        p = T.createWorker(talen.split('+'), 1, {
          workerPath: b + 'worker.min.js',
          corePath: b + kern,
          langPath: b.replace(/\/$/, ''),
          workerBlobURL: false,     // de worker moet zijn .wasm naast zichzelf vinden
          cacheMethod: 'none',      // de app (service worker) bewaart de bestanden al
          gzip: true,
          logger: meldVoortgang,
          errorHandler: function (o) {
            if (!klaar) afwijzen(o);
            else if (actief) actief.afwijzen(o);
          }
        });
      } catch (e) {
        afwijzen(e);
        return;
      }
      p.then(function (w) {
        if (klaar) {            // te laat (time-out of fout): meteen opruimen
          try { w.terminate(); } catch (e) { /* al weg */ }
          return;
        }
        klaar = true;
        clearTimeout(tijd);
        ok(w);
      }, afwijzen);
    });
  }

  function laadFout(o, talen) {
    var t = oorzaakTekst(o);
    if (/traineddata|Network error while fetching/i.test(t)) {
      return fout('De taalbestanden voor de tekstherkenning (' + talen + ') konden niet geladen worden.', o);
    }
    if (/memory|allocat/i.test(t)) {
      return fout('Er is te weinig geheugen vrij voor de tekstherkenning. Sluit andere tabbladen of apps en probeer het opnieuw.', o);
    }
    return fout('De tekstherkenning kon niet geladen worden. Controleer de verbinding en probeer het opnieuw.', o);
  }

  function zorgVoorWerker(talen) {
    if (werker && werkerTalen === talen) return Promise.resolve(werker);
    if (werker) {
      // andere talen gevraagd: bestaande worker opnieuw instellen
      var w0 = werker;
      return w0.reinitialize(talen.split('+'), 1).then(function () {
        werkerTalen = talen;
        return w0;
      }, function (o) {
        ruimWerkerOp();
        throw laadFout(o, talen);
      });
    }
    if (werkerBelofte) return werkerBelofte;
    var mijn = generatie;
    werkerBelofte = laadBibliotheek().then(function (T) {
      var simd = !zonderSimd && heeftSimd();
      var eerste = simd ? 'tesseract-core-simd-lstm.js' : 'tesseract-core-lstm.js';
      return maakWerker(T, talen, eerste).catch(function (o) {
        if (!simd || /traineddata|Network error while fetching/i.test(oorzaakTekst(o))) throw o;
        // terugval: gewone wasm zonder SIMD
        zonderSimd = true;
        return maakWerker(T, talen, 'tesseract-core-lstm.js');
      });
    }).then(function (w) {
      werkerBelofte = null;
      if (mijn !== generatie) {
        try { w.terminate(); } catch (e) { /* al weg */ }
        throw fout('De tekstherkenning is gestopt.');
      }
      werker = w;
      werkerTalen = talen;
      return w;
    }, function (o) {
      werkerBelofte = null;
      if (o instanceof Error && /^De /.test(o.message)) throw o;
      throw laadFout(o, talen);
    });
    return werkerBelofte;
  }

  function ruimWerkerOp() {
    var w = werker;
    werker = null;
    werkerTalen = '';
    if (w) {
      try { w.terminate(); } catch (e) { /* al weg */ }
    }
  }

  /* Canvas -> PNG-blob, zo nodig verkleind. Geeft ook de schaal terug. */
  function canvasNaarBlob(canvas) {
    var w = canvas.width | 0, h = canvas.height | 0;
    var s = 1;
    if (Math.max(w, h) > MAX_ZIJDE) s = MAX_ZIJDE / Math.max(w, h);
    if (w * h * s * s > MAX_PIXELS) s = Math.sqrt(MAX_PIXELS / (w * h));
    var bron = canvas;
    if (s < 1) {
      bron = document.createElement('canvas');
      bron.width = Math.max(1, Math.round(w * s));
      bron.height = Math.max(1, Math.round(h * s));
      var cx = bron.getContext('2d');
      cx.imageSmoothingEnabled = true;
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(canvas, 0, 0, bron.width, bron.height);
    }
    return new Promise(function (ok, mis) {
      try {
        bron.toBlob(function (blob) {
          if (bron !== canvas) { bron.width = 1; bron.height = 1; }
          if (!blob) mis(fout('De pagina kon niet als afbeelding gelezen worden.'));
          else ok({ blob: blob, sx: w / (s < 1 ? Math.round(w * s) : w), sy: h / (s < 1 ? Math.round(h * s) : h) });
        }, 'image/png');
      } catch (e) {
        mis(fout('De pagina kon niet als afbeelding gelezen worden.', e));
      }
    });
  }

  /* Uitvoer van tesseract.js (blokken > alinea's > regels > woorden)
   * platslaan tot één woordenlijst met oplopend regelnummer. */
  function woordenUit(data, sx, sy, breedte, hoogte) {
    var uit = [];
    var regel = 0;
    var blokken = (data && data.blocks) || [];
    for (var b = 0; b < blokken.length; b++) {
      var alineas = blokken[b].paragraphs || [];
      for (var a = 0; a < alineas.length; a++) {
        var regels = alineas[a].lines || [];
        for (var r = 0; r < regels.length; r++) {
          var ws = regels[r].words || [];
          var erbij = 0;
          for (var i = 0; i < ws.length; i++) {
            var wd = ws[i];
            var tekst = String(wd.text == null ? '' : wd.text).replace(/\s+/g, ' ').trim();
            var k = wd.bbox;
            if (!tekst || !k) continue;
            var x0 = Math.max(0, Math.min(breedte, k.x0 * sx));
            var y0 = Math.max(0, Math.min(hoogte, k.y0 * sy));
            var x1 = Math.max(0, Math.min(breedte, k.x1 * sx));
            var y1 = Math.max(0, Math.min(hoogte, k.y1 * sy));
            if (x1 <= x0 || y1 <= y0) continue;
            uit.push({
              text: tekst,
              x0: Math.round(x0 * 10) / 10,
              y0: Math.round(y0 * 10) / 10,
              x1: Math.round(x1 * 10) / 10,
              y1: Math.round(y1 * 10) / 10,
              conf: Math.round((typeof wd.confidence === 'number' ? wd.confidence : 0) * 10) / 10,
              line: regel
            });
            erbij++;
          }
          if (erbij) regel++;
        }
      }
    }
    return uit;
  }

  function herken(canvas, opts) {
    var talen = String((opts && opts.langs) || STANDAARD_TALEN).trim();
    var cb = opts && typeof opts.progress === 'function' ? opts.progress : null;
    var mijn = generatie;
    var laatste = -1;

    function meld(f, tekst) {
      if (!cb || mijn !== generatie) return;
      f = Math.max(0, Math.min(1, f));
      if (f < laatste) f = laatste;      // de balk loopt nooit terug
      laatste = f;
      try { cb(f, tekst); } catch (e) { /* fout in de aanroeper negeren */ }
    }

    if (!available()) {
      return Promise.reject(fout('Tekstherkenning is in deze omgeving niet beschikbaar.'));
    }
    if (!canvas || typeof canvas.getContext !== 'function' || !(canvas.width > 0) || !(canvas.height > 0)) {
      return Promise.reject(fout('Er is geen pagina om te lezen (lege of ongeldige afbeelding).'));
    }
    if (!/^[a-z]{3}(_[a-z]+)?(\+[a-z]{3}(_[a-z]+)?)*$/i.test(talen)) {
      return Promise.reject(fout('Ongeldige taalkeuze voor de tekstherkenning: ' + talen));
    }

    var breedte = canvas.width, hoogte = canvas.height;

    return new Promise(function (ok, mis) {
      var klus = {
        laadDeel: (werker && werkerTalen === talen) ? 0 : 0.35,
        meld: meld,
        afwijzen: function (o) { mis(o); }
      };
      actief = klus;
      meld(0, klus.laadDeel ? 'Tekstherkenning laden…' : 'Tekst herkennen…');

      Promise.all([canvasNaarBlob(canvas), zorgVoorWerker(talen)]).then(function (r) {
        if (mijn !== generatie) throw fout('De tekstherkenning is gestopt.');
        var beeld = r[0], w = r[1];
        meld(klus.laadDeel, 'Tekst herkennen…');
        return w.recognize(beeld.blob, {}, { text: false, blocks: true }).then(function (res) {
          if (mijn !== generatie) throw fout('De tekstherkenning is gestopt.');
          var woorden = woordenUit(res && res.data, beeld.sx, beeld.sy, breedte, hoogte);
          meld(1, 'Klaar');
          ok({ width: breedte, height: hoogte, words: woorden });
        });
      }).catch(function (o) {
        if (o instanceof Error && /^(De |Er |Tekstherkenning |Ongeldige )/.test(o.message)) { mis(o); return; }
        var t = oorzaakTekst(o);
        // na een fout in de worker is zijn toestand onbetrouwbaar: opnieuw beginnen
        ruimWerkerOp();
        if (/memory|allocat/i.test(t)) {
          mis(fout('Er is te weinig geheugen vrij om deze pagina te lezen. Sluit andere tabbladen of apps en probeer het opnieuw.', o));
        } else {
          mis(fout('De tekst op deze pagina kon niet gelezen worden.', o));
        }
      });
    }).then(function (v) {
      actief = null;
      return v;
    }, function (e) {
      actief = null;
      throw e;
    });
  }

  function recognize(canvas, opts) {
    // klussen netjes na elkaar; een mislukte klus houdt de volgende niet tegen
    var volgende = rij.then(function () { return herken(canvas, opts); });
    rij = volgende.catch(function () { /* al gemeld aan de aanroeper */ });
    return volgende;
  }

  function stop() {
    generatie++;
    var a = actief;
    actief = null;
    ruimWerkerOp();
    if (a) {
      try { a.afwijzen(fout('De tekstherkenning is gestopt.')); } catch (e) { /* niets */ }
    }
  }

  window.Leesmachine = {
    available: available,
    recognize: recognize,
    stop: stop
  };
})();
