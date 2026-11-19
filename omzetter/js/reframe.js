/* Omzetter — een afbeelding in een andere verhouding zetten (bijvoorbeeld 16:9 naar 9:16).
   Twee manieren: aanvullen (alles blijft in beeld, de nieuwe ruimte wordt gevuld vanuit de foto zelf)
   of bijsnijden (het kader is vol, de randen vallen weg). Alles gebeurt op canvas; er wordt niets verzonnen. */
(function () {
  "use strict";
  var OZ = window.OZ, R = (OZ.reframe = {});

  R.RATIOS = [
    { id: "16:9", label: "Liggend 16:9", w: 16, h: 9, std: [1920, 1080] },
    { id: "9:16", label: "Staand 9:16", w: 9, h: 16, std: [1080, 1920] },
    { id: "1:1", label: "Vierkant 1:1", w: 1, h: 1, std: [1080, 1080] },
    { id: "4:5", label: "4:5", w: 4, h: 5, std: [1080, 1350] },
    { id: "5:4", label: "5:4", w: 5, h: 4, std: [1350, 1080] },
    { id: "4:3", label: "4:3", w: 4, h: 3, std: [1600, 1200] },
    { id: "3:4", label: "3:4", w: 3, h: 4, std: [1200, 1600] },
    { id: "3:2", label: "3:2", w: 3, h: 2, std: [1800, 1200] },
    { id: "2:3", label: "2:3", w: 2, h: 3, std: [1200, 1800] }
  ];
  R.ratio = function (id) { for (var i = 0; i < R.RATIOS.length; i++) if (R.RATIOS[i].id === id) return R.RATIOS[i]; return null; };
  R.defaults = function () { return { ratio: "orig", method: "fill", fill: "blur", color: "auto", size: "std", cw: 1080, ch: 1080, zoom: 1 }; };
  R.active = function (s) { return !!s && s.ratio && s.ratio !== "orig"; };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function canvas(w, h) { return OZ.makeCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); }

  /* Maat van het resultaat in pixels voor een bron van sw bij sh. */
  R.outputSize = function (s, sw, sh) {
    var W, H;
    if (s.ratio === "custom") {
      W = clamp(Math.round(+s.cw) || 1080, 16, 12000); H = clamp(Math.round(+s.ch) || 1080, 16, 12000);
      return { w: W, h: H };
    }
    var r = R.ratio(s.ratio);
    if (!r) return { w: Math.round(sw), h: Math.round(sh) };
    if (s.size !== "orig") return { w: r.std[0], h: r.std[1] };
    var target = r.w / r.h, src = sw / sh;
    if (s.method === "crop") { if (target < src) { H = sh; W = sh * target; } else { W = sw; H = sw / target; } }
    else { if (target < src) { W = sw; H = sw / target; } else { H = sh; W = sh * target; } }
    return { w: Math.max(1, Math.round(W)), h: Math.max(1, Math.round(H)) };
  };

  /* ---------- vervagen ---------- */
  R.forceManualBlur = false;
  var filterOk = null;
  function hasFilter() {
    if (R.forceManualBlur) return false;
    if (filterOk == null) {
      try {
        var c = canvas(8, 8), g = c.getContext("2d");
        g.filter = "blur(2px)";
        filterOk = g.filter === "blur(2px)";
      } catch (e) { filterOk = false; }
    }
    return filterOk;
  }
  /* Geeft een vervaagde kopie, even groot als de bron. De randen lopen niet donker weg. */
  function blur(src, radius) {
    var w = src.width, h = src.height, out = canvas(w, h), g = out.getContext("2d");
    radius = Math.max(0.5, radius);
    if (hasFilter()) {
      var pad = Math.ceil(radius * 2.5);
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
      g.drawImage(src, 0, 0, w, h);                         /* ondergrond, zodat de rand gedekt blijft */
      g.filter = "blur(" + radius + "px)";
      g.drawImage(src, -pad, -pad, w + 2 * pad, h + 2 * pad);
      g.filter = "none";
      return out;
    }
    /* Zonder ctx.filter (oudere Safari): sterk verkleinen en in stappen weer vergroten. */
    var k = clamp(radius * 0.9, 1.5, 96), tw = Math.max(2, Math.round(w / k)), th = Math.max(2, Math.round(h / k));
    var cur = src, cw = w, ch = h, t, tg;
    while (cw / 2 > tw || ch / 2 > th) {                    /* in stappen van 2 naar beneden: geen blokken */
      var nw = Math.max(tw, Math.round(cw / 2)), nh = Math.max(th, Math.round(ch / 2));
      t = canvas(nw, nh); tg = t.getContext("2d"); tg.imageSmoothingEnabled = true; tg.imageSmoothingQuality = "high";
      tg.drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh); cur = t; cw = nw; ch = nh;
    }
    t = canvas(tw, th); tg = t.getContext("2d"); tg.imageSmoothingEnabled = true; tg.imageSmoothingQuality = "high";
    tg.drawImage(cur, 0, 0, cw, ch, 0, 0, tw, th); cur = t; cw = tw; ch = th;
    while (cw < w || ch < h) {
      var uw = Math.min(w, cw * 2), uh = Math.min(h, ch * 2);
      t = canvas(uw, uh); tg = t.getContext("2d"); tg.imageSmoothingEnabled = true; tg.imageSmoothingQuality = "high";
      tg.drawImage(cur, 0, 0, cw, ch, 0, 0, uw, uh); cur = t; cw = uw; ch = uh;
    }
    g.drawImage(cur, 0, 0, w, h);
    return out;
  }
  R._blur = blur;

  /* Gemiddelde kleur van de rand van de afbeelding, als #rrggbb. */
  R.edgeColor = function (src, sw, sh) {
    var n = 40, c = canvas(n, n), g = c.getContext("2d");
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.drawImage(src, 0, 0, sw, sh, 0, 0, n, n);
    var d = g.getImageData(0, 0, n, n).data, r = 0, gr = 0, b = 0, cnt = 0;
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
      if (x > 1 && x < n - 2 && y > 1 && y < n - 2) continue;
      var i = (y * n + x) * 4, a = d[i + 3] / 255;
      if (a < 0.05) continue;
      r += d[i] * a; gr += d[i + 1] * a; b += d[i + 2] * a; cnt += a;
    }
    if (!cnt) return "#ffffff";
    function hx(v) { return OZ.pad(Math.round(v / cnt).toString(16), 2); }
    return "#" + hx(r) + hx(gr) + hx(b);
  };

  /* Een masker: doorzichtigheid loopt van a0 (bij y0) naar a1 (bij y1), verticaal. */
  function fadeMask(c, y0, a0, y1, a1) {
    var g = c.getContext("2d"), gr = g.createLinearGradient(0, y0, 0, y1);
    gr.addColorStop(0, "rgba(0,0,0," + a0 + ")"); gr.addColorStop(1, "rgba(0,0,0," + a1 + ")");
    g.globalCompositeOperation = "destination-in";
    g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = "source-over";
  }
  var noiseTile = null, noiseAlpha = 1;
  function noisePattern(g) {
    g.globalAlpha = noiseAlpha;
    if (!noiseTile) {
      noiseTile = canvas(128, 128);
      var ng = noiseTile.getContext("2d"), id = ng.createImageData(128, 128), d = id.data;
      for (var i = 0; i < d.length; i += 4) { var v = Math.random() < 0.5 ? 0 : 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 5 + Math.random() * 7; }
      ng.putImageData(id, 0, 0);
    }
    return g.createPattern(noiseTile, "repeat");
  }

  /* Doortrekken naar boven en beneden. img = de afbeelding op uitvoermaat (iw bij ih), geplaatst op (0, iy) in een vlak van W bij H (W == iw).
     Dicht bij de naad: gespiegeld beeld, zodat de overgang onzichtbaar is. Verder weg: steeds vager, tot alleen de
     uitgerekte randkleuren over zijn. Een vleug ruis voorkomt een uitgesmeerd uiterlijk. */
  function extendVertical(img, W, H, iy) {
    var iw = img.width, ih = img.height, out = canvas(W, H), g = out.getContext("2d");
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    function side(top) {
      var E = top ? iy : H - (iy + ih);
      if (E < 1) return;
      var seamY = top ? iy : iy + ih;
      /* 1. ondergrond: de buitenste strook, verticaal uitgerekt. Dicht bij de naad volgt hij de rand nog vrij precies,
            verder weg wordt hij steeds rustiger, zodat details aan de rand geen strepen trekken. */
      var t = Math.max(2, Math.round(ih * 0.03)), edge = calmEdge(cropRows(img, top ? 0 : ih - t, t));
      function level(samples) {
        var c = canvas(samples, 1), cg = c.getContext("2d");
        cg.imageSmoothingEnabled = true; cg.imageSmoothingQuality = "high";
        var cur = edge, cw = iw;                                        /* in stappen verkleinen = eerlijk gemiddelde */
        while (cw / 2 > samples) { var nw = Math.max(samples, Math.round(cw / 2)), n2 = canvas(nw, 1), ng = n2.getContext("2d"); ng.imageSmoothingEnabled = true; ng.imageSmoothingQuality = "high"; ng.drawImage(cur, 0, 0, cw, cur.height, 0, 0, nw, 1); cur = n2; cw = nw; }
        cg.drawImage(cur, 0, 0, cw, cur.height, 0, 0, samples, 1);
        var band = canvas(W, E), bg2 = band.getContext("2d");
        bg2.imageSmoothingEnabled = true; bg2.imageSmoothingQuality = "high";
        /* een halve stap buiten beeld beginnen, anders blijven de buitenste kleuren als blokken staan */
        var step = W / samples;
        bg2.drawImage(c, 0, 0, samples, 1, -step / 2, 0, W + step, E);
        bg2.drawImage(c, 0, 0, 1, 1, 0, 0, step / 2, E); bg2.drawImage(c, samples - 1, 0, 1, 1, W - step / 2, 0, step / 2, E);
        return blur(band, step * 0.6);
      }
      var far = level(Math.max(6, Math.round(iw / 110))), mid = level(Math.max(10, Math.round(iw / 45))), near = level(Math.max(16, Math.round(iw / 12)));
      /* banden hebben de naad bovenaan (y = 0) */
      var base = canvas(W, E), bgx = base.getContext("2d");
      bgx.drawImage(far, 0, 0);
      fadeMask(mid, 0, 1, Math.max(6, Math.min(E, ih * 0.55)), 0); bgx.drawImage(mid, 0, 0);
      fadeMask(near, 0, 1, Math.max(4, Math.min(E, ih * 0.16)), 0); bgx.drawImage(near, 0, 0);
      if (top) { g.save(); g.translate(0, seamY); g.scale(1, -1); g.drawImage(base, 0, 0); g.restore(); }
      else g.drawImage(base, 0, seamY);
      /* 2. gespiegeld beeld vlak bij de naad: zo sluit het precies aan. Het lost snel op in de ondergrond,
            zodat er geen spiegelbeeld van het onderwerp verschijnt. */
      var Em = Math.max(2, Math.min(E, Math.round(ih * 0.09))), m = canvas(iw, Em), mg = m.getContext("2d");
      mg.imageSmoothingEnabled = true; mg.imageSmoothingQuality = "high";
      if (top) mg.drawImage(img, 0, 0, iw, Em, 0, 0, iw, Em);
      else { mg.translate(0, Em); mg.scale(1, -1); mg.drawImage(img, 0, ih - Em, iw, Em, 0, 0, iw, Em); mg.setTransform(1, 0, 0, 1, 0, 0); }
      var soft = blur(m, Math.max(1.5, Em * 0.12));
      var ov = canvas(iw, Em), og = ov.getContext("2d");
      og.drawImage(soft, 0, 0);
      var l0 = canvas(iw, Em); l0.getContext("2d").drawImage(m, 0, 0); fadeMask(l0, 0, 1, Math.max(2, Em * 0.4), 0); og.drawImage(l0, 0, 0);
      fadeMask(ov, 0, 0.9, Em, 0);
      if (top) { g.save(); g.translate(0, seamY); g.scale(1, -1); g.drawImage(ov, 0, 0, iw, Em, 0, 0, W, Em); g.restore(); }
      else g.drawImage(ov, 0, 0, iw, Em, 0, seamY, W, Em);
      /* 3. ruis over het aangevulde deel */
      g.save(); g.fillStyle = noisePattern(g); g.fillRect(0, top ? 0 : seamY, W, E); g.restore();
    }
    side(true); side(false);
    g.drawImage(img, 0, iy);
    return out;
  }
  /* De randstrook als \u00e9\u00e9n rij kleuren, waarbij smalle dingen (een paal, een torenspits, een tak) worden weggelaten.
     Zonder dit trekt elk smal voorwerp aan de rand een lange streep door de aanvulling. */
  function calmEdge(strip) {
    var w = strip.width, row = canvas(w, 1), rg = row.getContext("2d");
    rg.imageSmoothingEnabled = true; rg.imageSmoothingQuality = "high";
    rg.drawImage(strip, 0, 0, w, strip.height, 0, 0, w, 1);
    var id, d;
    try { id = rg.getImageData(0, 0, w, 1); } catch (e) { return row; }
    d = id.data;
    /* op een grover raster werken houdt het snel bij grote foto's */
    var n = Math.min(w, 720), k = w / n, px = new Array(n), i, j;
    for (i = 0; i < n; i++) { j = Math.min(w - 1, Math.round((i + 0.5) * k - 0.5)) * 4; px[i] = [d[j], d[j + 1], d[j + 2], d[j] * 0.3 + d[j + 1] * 0.59 + d[j + 2] * 0.11]; }
    var half = Math.max(2, Math.round(n * 0.045)), out = canvas(n, 1), og = out.getContext("2d"), od = og.createImageData(n, 1), o = od.data, win = [];
    for (i = 0; i < n; i++) {
      win.length = 0;
      for (j = i - half; j <= i + half; j++) win.push(px[j < 0 ? -j : j >= n ? 2 * n - 2 - j : j]);
      win.sort(function (a, b) { return a[3] - b[3]; });
      var m = win[win.length >> 1], q = i * 4;
      /* alleen ingrijpen waar de pixel echt afwijkt van zijn omgeving; rustige randen blijven zoals ze zijn */
      var diff = Math.abs(px[i][3] - m[3]), mix = diff > 26 ? 1 : diff < 8 ? 0 : (diff - 8) / 18, src = px[i];
      o[q] = src[0] + (m[0] - src[0]) * mix; o[q + 1] = src[1] + (m[1] - src[1]) * mix; o[q + 2] = src[2] + (m[2] - src[2]) * mix; o[q + 3] = 255;
    }
    og.putImageData(od, 0, 0);
    var res = canvas(w, 1), sg = res.getContext("2d");
    sg.imageSmoothingEnabled = true; sg.imageSmoothingQuality = "high";
    sg.drawImage(out, 0, 0, n, 1, 0, 0, w, 1);
    return blur2(res, Math.max(1.5, w / 90));
  }
  function blur2(rowCanvas, radius) {          /* een rij van 1 pixel hoog vervagen: eerst iets hoger maken */
    var w = rowCanvas.width, c = canvas(w, 8); c.getContext("2d").drawImage(rowCanvas, 0, 0, w, 1, 0, 0, w, 8);
    return blur(c, radius);
  }
  function cropRows(img, y, h) {
    var c = canvas(img.width, h); c.getContext("2d").drawImage(img, 0, y, img.width, h, 0, 0, img.width, h); return c;
  }
  function transpose(c) {                      /* spiegelen over de diagonaal: x en y wisselen */
    var o = canvas(c.height, c.width), g = o.getContext("2d");
    g.setTransform(0, 1, 1, 0, 0, 0); g.drawImage(c, 0, 0);
    return o;
  }

  /* Waar de hele afbeelding komt te staan bij aanvullen. place: 0..1 langs de vrije as. */
  R.fitRect = function (sw, sh, W, H, place) {
    var k = Math.min(W / sw, H / sh), iw = Math.round(sw * k), ih = Math.round(sh * k);
    if (Math.abs(iw - W) <= 1) iw = W;
    if (Math.abs(ih - H) <= 1) ih = H;
    var p = place == null ? 0.5 : clamp(place, 0, 1);
    return { x: Math.round((W - iw) * (iw === W ? 0 : p)), y: Math.round((H - ih) * (ih === H ? 0 : p)), w: iw, h: ih, vertical: iw === W };
  };
  /* Welk deel van de bron in beeld blijft bij bijsnijden. focus: 0..1, zoom >= 1. */
  R.cropRect = function (sw, sh, W, H, fx, fy, zoom) {
    var k = Math.max(W / sw, H / sh) * clamp(+zoom || 1, 1, 4), cw = W / k, ch = H / k;
    var cx = clamp((fx == null ? 0.5 : fx) * sw, cw / 2, sw - cw / 2), cy = clamp((fy == null ? 0.5 : fy) * sh, ch / 2, sh - ch / 2);
    return { x: cx - cw / 2, y: cy - ch / 2, w: cw, h: ch };
  };

  /* Tekent het resultaat. src: tekenbaar, sw/sh: bronmaat, s: instellingen, per: {fx, fy, place} voor deze afbeelding,
     scale: verkleinfactor voor het voorbeeld (1 = echte maat). Geeft een canvas. */
  R.render = function (src, sw, sh, s, per, scale) {
    per = per || {};
    var size = R.outputSize(s, sw, sh), k = scale || 1;
    noiseAlpha = Math.max(0.15, Math.min(1, k));          /* in het kleine voorbeeld minder korrel */
    var W = Math.max(1, Math.round(size.w * k)), H = Math.max(1, Math.round(size.h * k));
    var out = canvas(W, H), g = out.getContext("2d");
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    if (s.method === "crop") {
      var c = R.cropRect(sw, sh, W, H, per.fx, per.fy, s.zoom);
      g.drawImage(src, c.x, c.y, c.w, c.h, 0, 0, W, H);
      return out;
    }
    var r = R.fitRect(sw, sh, W, H, per.place);
    if (r.w === W && r.h === H) { g.drawImage(src, 0, 0, sw, sh, 0, 0, W, H); return out; }
    if (s.fill === "color") {
      g.fillStyle = s.color && s.color !== "auto" ? s.color : R.edgeColor(src, sw, sh);
      g.fillRect(0, 0, W, H);
      g.drawImage(src, 0, 0, sw, sh, r.x, r.y, r.w, r.h);
      return out;
    }
    if (s.fill === "extend") {
      var img = canvas(r.w, r.h), ig = img.getContext("2d");
      ig.imageSmoothingEnabled = true; ig.imageSmoothingQuality = "high";
      ig.drawImage(src, 0, 0, sw, sh, 0, 0, r.w, r.h);
      var res = r.vertical ? extendVertical(img, W, H, r.y) : transpose(extendVertical(transpose(img), H, W, r.x));
      g.drawImage(res, 0, 0);
      return out;
    }
    /* zachte achtergrond: de foto zelf, beeldvullend, sterk vervaagd en iets gedimd */
    var bk = Math.max(W / sw, H / sh) * 1.12, bw = sw * bk, bh = sh * bk;
    var small = Math.min(1, 480 / Math.max(W, H)), bg = canvas(W * small, H * small), bgc = bg.getContext("2d");
    bgc.imageSmoothingEnabled = true; bgc.imageSmoothingQuality = "high";
    bgc.drawImage(src, 0, 0, sw, sh, (W - bw) / 2 * small, (H - bh) / 2 * small, bw * small, bh * small);
    var soft = blur(bg, Math.max(bg.width, bg.height) * 0.055);
    g.drawImage(soft, 0, 0, soft.width, soft.height, 0, 0, W, H);
    g.fillStyle = "rgba(10,14,20,0.16)"; g.fillRect(0, 0, W, H);
    g.save(); g.fillStyle = noisePattern(g); g.fillRect(0, 0, W, H); g.restore();
    g.save();
    g.shadowColor = "rgba(0,0,0,0.28)"; g.shadowBlur = Math.max(W, H) * 0.02;
    g.fillStyle = "#000"; g.fillRect(r.x, r.y, r.w, r.h);
    g.restore();
    g.clearRect(r.x, r.y, r.w, r.h);
    g.drawImage(soft, r.x * small, r.y * small, r.w * small, r.h * small, r.x, r.y, r.w, r.h);   /* onder doorzichtige delen blijft de achtergrond */
    g.drawImage(src, 0, 0, sw, sh, r.x, r.y, r.w, r.h);
    return out;
  };

  /* ---------- Claude zoekt het onderwerp (alleen als de app dat mag) ---------- */
  var samplePromise = null;
  R.sample = function () {
    if (!(window.claude && window.claude.use)) return Promise.resolve(null);
    if (!samplePromise) samplePromise = Promise.resolve().then(function () { return window.claude.use("sample"); }).catch(function () { return null; });
    return samplePromise;
  };
  function num(v) { v = typeof v === "string" ? parseFloat(v) : v; return typeof v === "number" && isFinite(v) ? v : null; }
  /* Maakt van het antwoord iets betrouwbaars, of null als er niets mee te beginnen valt. */
  R.cleanAnswer = function (a) {
    if (typeof a === "string") { try { a = JSON.parse(a.replace(/^[^{]*/, "").replace(/[^}]*$/, "")); } catch (e) { return null; } }
    if (!a || typeof a !== "object") return null;
    var box = a.box && typeof a.box === "object" ? a.box : a.onderwerp && typeof a.onderwerp === "object" ? a.onderwerp : a;
    var x = num(box.x), y = num(box.y), w = num(box.w), h = num(box.h);
    if (x == null || y == null || w == null || h == null) return null;
    if (x > 1 || y > 1 || w > 1 || h > 1) return null;                 /* geen breuken: onbruikbaar */
    x = clamp(x, 0, 1); y = clamp(y, 0, 1); w = clamp(w, 0, 1 - x); h = clamp(h, 0, 1 - y);
    if (w < 0.02 || h < 0.02) return null;
    var fill = { zacht: "blur", doortrekken: "extend", kleur: "color" }[String(a.fill || a.vulling || "").toLowerCase().trim()] || null;
    var reason = typeof (a.reden || a.reason) === "string" ? String(a.reden || a.reason).replace(/\s+/g, " ").trim().slice(0, 220) : "";
    return { x: x, y: y, w: w, h: h, cx: x + w / 2, cy: y + h / 2, fill: fill, reason: reason };
  };
  R.PROMPT = "Je krijgt één foto. Bepaal waar het hoofdonderwerp staat en welke opvulling past als de foto in een andere beeldverhouding wordt gezet. " +
    "Antwoord met ALLEEN een JSON-object, zonder tekst eromheen, in precies deze vorm: " +
    '{"x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0, "fill": "zacht", "reden": "..."}. ' +
    "x, y, w en h zijn breuken tussen 0 en 1 van de breedte en hoogte van de foto: de linkerbovenhoek en de maat van het kader om het hoofdonderwerp. " +
    'fill is "doortrekken" als de randen van de foto rustig en egaal zijn (lucht, muur, tafelblad, verloop) zodat ze onzichtbaar verlengd kunnen worden, ' +
    '"kleur" als de achtergrond één effen kleur is (logo, productfoto, scan), en anders "zacht". ' +
    "reden is één korte Nederlandse zin waarom.";
  /* Geeft {ok, answer} of {ok:false, code, message}. Roep dit alleen aan na een tik van de gebruiker. */
  R.askClaude = async function (src, sw, sh) {
    var sample = await R.sample();
    if (!sample || typeof sample.json !== "function") return { ok: false, code: "unavailable", message: "Claude is hier niet beschikbaar." };
    try {
      if (typeof sample.limits === "function") {
        var lim = await sample.limits();
        if (lim && lim.images !== undefined && !(lim.images > 0 || lim.images === true)) return { ok: false, code: "no_images", message: "Claude kan in deze app geen afbeeldingen bekijken." };
      }
      var k = Math.min(1, 1024 / Math.max(sw, sh)), c = canvas(sw * k, sh * k), g = c.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
      g.imageSmoothingQuality = "high"; g.drawImage(src, 0, 0, sw, sh, 0, 0, c.width, c.height);
      var blob = await OZ.canvasBlob(c, "image/jpeg", 0.82);
      var raw = await sample.json(R.PROMPT, { images: [blob] });
      var ans = R.cleanAnswer(raw);
      if (!ans) return { ok: false, code: "bad_answer", message: "Claude gaf geen bruikbaar antwoord. Kies het onderwerp zelf door in het voorbeeld te slepen." };
      return { ok: true, answer: ans };
    } catch (e) {
      var code = (e && e.code) || "error";
      if (code === "not_granted" || code === "declined") return { ok: false, code: "not_granted", message: "" };
      if (code === "rate_limited") return { ok: false, code: code, message: "Claude heeft het nu te druk. Probeer het over een minuut opnieuw, of kies het onderwerp zelf." };
      return { ok: false, code: code, message: "Het lukte Claude nu niet om de foto te bekijken. Kies het onderwerp zelf door in het voorbeeld te slepen." };
    }
  };
})();
