/* Omzetter — de app zelf: bestanden aannemen, per soort een doel kiezen, omzetten, bekijken en opslaan. */
(function () {
  "use strict";
  var OZ = window.OZ, $ = function (id) { return document.getElementById(id); };
  var TOUCH = window.matchMedia && window.matchMedia("(hover: none) and (pointer: coarse)").matches;

  /* ---------- kleine hulpjes ---------- */
  function el(tag, attrs, kids) {
    var n = document.createElement(tag), k;
    if (attrs) for (k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    (kids || []).forEach(function (c) { if (c != null && c !== false) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function toast(msg, isError) {
    var t = el("div", { class: "toast" + (isError ? " is-error" : ""), text: msg });
    $("toasts").appendChild(t);
    setTimeout(function () { t.remove(); }, isError ? 7000 : 3200);
  }
  var prefs = {};
  try { prefs = JSON.parse(localStorage.getItem("omzetter.v1") || "{}") || {}; } catch (e) { prefs = {}; }
  if (!prefs.targets) prefs.targets = {};
  function savePrefs() { try { localStorage.setItem("omzetter.v1", JSON.stringify(prefs)); } catch (e) { /* mag mislukken */ } }

  /* ---------- opties per soort ---------- */
  var QUALITY = { id: "quality", label: "Kwaliteit", type: "range", min: 30, max: 100, step: 1, def: 90, unit: "%" };
  var DELIM = { id: "delimiter", label: "Scheidingsteken in CSV", type: "select", def: ";", options: [[";", "Puntkomma (Nederlandse Excel)"], [",", "Komma (internationaal)"]], when: function (t) { return t === "csv" || t === "listcsv"; } };
  var TRIM = [
    { id: "trimStart", label: "Knippen: begin bij", type: "text", placeholder: "0:00", mode: "decimal" },
    { id: "trimEnd", label: "Knippen: stop bij", type: "text", placeholder: "tot het eind", mode: "decimal" }
  ];
  var BITRATE = { id: "bitrate", label: "Kwaliteit van de mp3", type: "select", def: "192", options: [["96", "96 kbps, klein"], ["128", "128 kbps"], ["192", "192 kbps, goed"], ["256", "256 kbps"], ["320", "320 kbps, best"]], when: function (t) { return t === "mp3"; } };
  var MONO = { id: "mono", label: "Mono (halveert de grootte bij spraak)", type: "check", def: false };
  function isIn(list) { return function (t) { return list.indexOf(t) >= 0; }; }
  var OPTS = {
    image: [
      Object.assign({}, QUALITY, { when: isIn(["jpg", "webp", "pdf"]) }),
      { id: "maxKb", label: "Maximale grootte in kB", type: "number", placeholder: "geen grens", when: isIn(["jpg", "webp"]) },
      { id: "maxW", label: "Maximale breedte in pixels", type: "number", placeholder: "origineel" },
      { id: "maxH", label: "Maximale hoogte in pixels", type: "number", placeholder: "origineel" },
      { id: "rotate", label: "Draaien", type: "select", def: "0", options: [["0", "Niet draaien"], ["90", "Kwartslag rechtsom"], ["180", "Halve slag"], ["270", "Kwartslag linksom"]] },
      { id: "pdfPage", label: "Pagina in de pdf", type: "select", def: "a4", options: [["a4", "A4, afbeelding passend"], ["fit", "Zo groot als de afbeelding"]], when: isIn(["pdf"]) },
      { id: "bg", label: "Achtergrond waar het doorzichtig is", type: "color", def: "#ffffff" },
      { id: "keepAlpha", label: "Doorzichtigheid behouden", type: "check", def: true, when: isIn(["png", "webp", "gif", "ico", "tiff", "svg", "pdf"]) },
      { type: "note", text: "Bij het omzetten verdwijnen locatie, cameragegevens en andere verborgen informatie (EXIF) uit de foto." }
    ],
    pdf: [
      { id: "pages", label: "Pagina's", type: "text", placeholder: "alle, of bijvoorbeeld 1-3, 5", when: function (t) { return t !== "klein"; } },
      { id: "kleinNiveau", label: "Hoe sterk verkleinen", type: "select", def: "normaal", options: [["licht", "Licht, bijna niet te zien"], ["normaal", "Normaal, goed voor scherm en print"], ["sterk", "Sterk, voor mailen en uploaden"]], when: isIn(["klein"]) },
      { id: "kleinMax", label: "Of: moet onder … MB blijven", type: "text", placeholder: "geen grens", mode: "decimal", when: isIn(["klein"]) },
      { id: "dpi", label: "Scherpte", type: "select", def: "150", options: [["72", "Scherm (72 dpi)"], ["150", "Normaal (150 dpi)"], ["220", "Scherp (220 dpi)"], ["300", "Drukwerk (300 dpi)"]], when: isIn(["png", "jpg"]) },
      Object.assign({}, QUALITY, { when: isIn(["jpg"]) }),
      { id: "pdfMode", label: "Wat moet er gebeuren", type: "select", def: "range", options: [["range", "Gekozen pagina's in één pdf"], ["split", "Elke pagina een eigen pdf"]], when: function (t, g) { return t === "pdf" && !g.mergeOn; } }
    ],
    doc: [
      { id: "kleinNiveau", label: "Hoe sterk verkleinen", type: "select", def: "normaal", options: [["licht", "Licht, bijna niet te zien"], ["normaal", "Normaal, goed voor scherm en print"], ["sterk", "Sterk, voor mailen en uploaden"]], when: isIn(["klein"]) },
      { id: "fontSize", label: "Lettergrootte in de pdf", type: "select", def: "11", options: [["10", "10 punten"], ["11", "11 punten"], ["12", "12 punten"], ["14", "14 punten"]], when: isIn(["pdf"]) }
    ],
    data: [
      DELIM,
      { id: "header", label: "De eerste rij bevat kolomnamen", type: "check", def: true, when: isIn(["json", "yaml", "xml", "html", "md", "pdf"]) },
      { id: "numbers", label: "Getallen in CSV herkennen (1.234,50 wordt een getal)", type: "check", def: true }
    ],
    audio: [BITRATE, MONO].concat(TRIM),
    video: [
      BITRATE,
      Object.assign({}, MONO, { when: isIn(["mp3", "wav"]) }),
      Object.assign({}, TRIM[0], { when: isIn(["mp3", "wav"]) }), Object.assign({}, TRIM[1], { when: isIn(["mp3", "wav"]) }),
      { id: "frameTime", label: "Beeld op tijdstip", type: "text", placeholder: "bijvoorbeeld 0:12", mode: "decimal", when: isIn(["png", "jpg"]) },
      Object.assign({}, QUALITY, { when: isIn(["jpg"]) })
    ],
    agenda: [DELIM], contacts: [DELIM], archive: [DELIM]
  };
  var PRESETS = [
    { id: "orig", label: "Origineel", set: { maxW: "", maxH: "" } },
    { id: "mail", label: "Kleiner voor e-mail", set: { maxW: "1600", maxH: "1600", quality: 80 }, lossy: true },
    { id: "small", label: "Klein (800 px)", set: { maxW: "800", maxH: "800", quality: 80 }, lossy: true }
  ];
  function defaults(kind) {
    var o = {};
    (OPTS[kind] || []).forEach(function (s) { if (s.id) o[s.id] = s.def !== undefined ? s.def : s.type === "check" ? false : ""; });
    if (prefs.delimiter && o.delimiter !== undefined) o.delimiter = prefs.delimiter;
    return o;
  }

  /* ---------- toestand ---------- */
  var S = { files: [], groups: {}, running: false, cancel: false, seq: 1, objectUrls: [] };
  function group(kind) {
    if (!S.groups[kind]) S.groups[kind] = { target: null, opts: defaults(kind), open: false, merge: null, preset: "orig", result: null, rf: OZ.reframe.defaults(), rfOpen: false, sizeOpen: false, rfIndex: 0, rfToken: 0, rfNote: "" };
    return S.groups[kind];
  }
  function filesOf(kind) { return S.files.filter(function (f) { return f.kind === kind; }); }
  function activeKinds() { return OZ.KIND_ORDER.filter(function (k) { return filesOf(k).length; }); }
  function mergeable(kind) { return kind === "image" || kind === "pdf" || kind === "doc" || kind === "data"; }
  function mergeOn(kind) {
    var g = group(kind);
    if (!mergeable(kind) || g.target !== "pdf" || filesOf(kind).length < 2) return false;
    return g.merge == null ? (kind === "image" || kind === "pdf") : g.merge;
  }
  function allOutputs() {
    var outs = [];
    activeKinds().forEach(function (k) {
      if (group(k).result) outs.push(group(k).result);
      filesOf(k).forEach(function (f) { (f.results || []).forEach(function (r) { outs.push(r); }); });
    });
    return outs;
  }
  function invalidate(kind) {
    group(kind).result = null;
    filesOf(kind).forEach(function (f) { if (f.status !== "busy") { f.status = "idle"; f.results = null; f.error = null; f.merged = false; } });
  }

  /* ---------- bestanden toevoegen ---------- */
  function addFiles(list) {
    var added = 0, dup = 0;
    Array.prototype.forEach.call(list, function (file) {
      if (!file || typeof file.name !== "string") return;
      if (S.files.some(function (f) { return f.file.name === file.name && f.file.size === file.size && f.file.lastModified === file.lastModified; })) { dup++; return; }
      var d = OZ.detect(file), f = { id: "f" + S.seq++, file: file, kind: d.kind, ext: d.ext, blocked: d.blocked || null, status: "idle", results: null, error: null, thumb: null, meta: "", isNew: true, n: added, rf: { fx: 0.5, fy: 0.5, place: 0.5 } };
      if (!file.size) { f.blocked = "Dit bestand is leeg (0 bytes). Kies het opnieuw vanaf de plek waar het echt staat."; f.kind = "blocked"; }
      S.files.push(f); added++;
      if (f.kind !== "blocked") {
        var g = group(f.kind);
        if (!g.target) {
          var want = prefs.targets[f.kind], avail = OZ.targetsFor(f.kind);
          g.target = want && avail.indexOf(want) >= 0 ? want : OZ.KINDS[f.kind].def(f.ext);
          g.auto = !(want && avail.indexOf(want) >= 0);
        }
        g.result = null;
        if (mergeOn(f.kind) || g.target === "zip") invalidate(f.kind);
        queueThumb(f);
      }
    });
    /* Foto's: JPG is bijna altijd het handigste doel. Alleen als alles al JPG is, stellen we PNG voor. */
    var ig = S.groups.image;
    if (added && ig && ig.auto) {
      var nt = filesOf("image").every(function (f) { return /^(jpe?g|jfif)$/.test(f.ext); }) ? "png" : "jpg";
      if (nt !== ig.target) { ig.target = nt; invalidate("image"); }
    }
    if (dup && !added) toast(dup === 1 ? "Dit bestand staat er al." : "Deze bestanden staan er al.");
    if (added) { render(); var first = document.querySelector(".file.is-new"); if (first && first.scrollIntoView) first.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
  }
  function applyRecipe(r, files) {
    var g = group(r.kind);
    if (r.ratio && !filesOf("image").length) {
      /* foto's in een nieuw kader: JPG houdt het bestand klein; tekeningen en logo's blijven PNG */
      var photos = Array.prototype.every.call(files, function (f) { var d = OZ.detect(f); return d.kind !== "image" || /^(jpe?g|jfif|heic|heif|avif|webp|tiff?)$/.test(d.ext); });
      g.target = photos ? "jpg" : "png"; g.auto = false;
    }
    if (r.target) { g.target = r.target; g.auto = false; prefs.targets[r.kind] = r.target; savePrefs(); }
    if (r.merge) g.merge = true;
    if (r.ratio) { g.rf.ratio = r.ratio; g.rfOpen = true; if (g.target === "pdf" || g.target === "zip" || g.target === "ico") g.target = "jpg"; }
    if (r.preset) PRESETS.forEach(function (p) { if (p.id === r.preset) { g.preset = p.id; Object.keys(p.set).forEach(function (k) { g.opts[k] = p.set[k]; }); } });
    invalidate(r.kind);
  }
  /* ---------- scannen: foto van een bon of brief naar een nette pdf ----------
     De Rechtzetter (js/rechtzetter.js) trekt elke foto recht en maakt het papier wit. De pagina's komen als JPG in
     de lijst te staan en de pdf staat er meteen bij als resultaat, net als na Zet om. Wie daarna iets verandert
     (volgorde, een foto erbij, een ander doel) zet gewoon opnieuw om, met de rechtgezette pagina's als bron. */
  async function scanPdf(shots) {
    var pdf = await PDFLib.PDFDocument.create();
    for (var i = 0; i < shots.length; i++) {
      var s = shots[i], emb = await pdf.embedJpg(await s.blob.arrayBuffer());
      var A = s.w > s.h ? [841.89, 595.28] : [595.28, 841.89];
      /* Een pagina in A4-verhouding vult het hele vel; een bon of ander formaat krijgt een smalle marge. */
      var m = Math.abs((s.w / s.h) / (A[0] / A[1]) - 1) < 0.02 ? 0 : 20;
      var k = Math.min((A[0] - 2 * m) / s.w, (A[1] - 2 * m) / s.h);
      pdf.addPage(A).drawImage(emb, { x: (A[0] - s.w * k) / 2, y: (A[1] - s.h * k) / 2, width: s.w * k, height: s.h * k });
      await OZ.tick();
    }
    return new Blob([await pdf.save()], { type: "application/pdf" });
  }
  async function startScan(list) {
    var photos = list.filter(function (f) { return OZ.detect(f).kind === "image"; });
    if (!photos.length) { toast("Kies een foto van de bon of brief, bijvoorbeeld een jpg, png of heic.", true); return; }
    if (!window.Rechtzetter) { toast("De scanner is nog niet geladen. Probeer het zo nog eens.", true); return; }
    var pages = await window.Rechtzetter.open(photos, {
      /* HEIC en TIFF leest de browser niet zelf; de eigen lezer van de Omzetter wel. */
      decode: async function (file) {
        var d = await OZ.conv._decodeImage(file, OZ.detect(file).ext), c = OZ.makeCanvas(d.w, d.h);
        try { c.getContext("2d").drawImage(d.src, 0, 0, d.w, d.h); } finally { d.release(); }
        return c;
      }
    });
    if (!pages) return;
    var busy = el("div", { class: "busy", role: "status" }, [el("div", { class: "busy-card", text: "De pdf wordt gemaakt" })]);
    document.body.appendChild(busy);
    try {
      var shots = [], stamp = Date.now();
      for (var i = 0; i < pages.length; i++) {
        var c = pages[i].canvas;
        shots.push({ name: OZ.safeName(OZ.base(pages[i].name) + " (scan).jpg"), blob: await OZ.canvasBlob(c, "image/jpeg", 0.85), w: c.width, h: c.height });
        c.width = c.height = 0;
        await OZ.tick();
      }
      OZ.uniqueNames(shots);
      var out = { name: OZ.safeName(OZ.base(pages[0].name) + " (scan).pdf"), blob: await scanPdf(shots) };
      var before = S.files.length;
      addFiles(shots.map(function (s, n) { return new File([s.blob], s.name, { type: "image/jpeg", lastModified: stamp + n }); }));
      var mine = S.files.slice(before), g = group("image");
      if (mine.length === shots.length && filesOf("image").length === mine.length) {
        g.target = "pdf"; g.auto = false; g.merge = true;
        if (mine.length === 1) { mine[0].status = "done"; mine[0].results = [out]; resultThumb(out, mine[0]); }
        else { mine.forEach(function (f) { f.status = "done"; f.merged = true; }); g.result = out; resultThumb(out, "image"); }
        render();
        var first = document.querySelector(".out, .group-out");
        if (OZ.confetti) OZ.confetti(document.querySelector(".out .thumb, .group-out .thumb") || $("go"));
        if (first && first.scrollIntoView) first.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } else {
        /* Er stonden al andere afbeeldingen in de lijst: dan niet raden, maar de pdf direct bewaren. */
        var res = await OZ.saveFile(out.name, out.blob);
        if (res.ok) toast("Opgeslagen als " + res.name + ".");
        else if (res.code !== "declined") toast(res.message, true);
      }
    } catch (e) {
      toast(errorText(e), true);
    } finally { busy.remove(); }
  }

  function removeFile(f) {
    S.files = S.files.filter(function (x) { return x !== f; });
    if (f.kind !== "blocked") { var g = group(f.kind); if (g.result) invalidate(f.kind); if (!filesOf(f.kind).length) delete S.groups[f.kind]; }
    render();
  }

  /* ---------- miniaturen ---------- */
  var NATIVE_IMG = { png: 1, jpg: 1, jpeg: 1, jfif: 1, webp: 1, gif: 1, bmp: 1, svg: 1, ico: 1, avif: 1 };
  var thumbQueue = Promise.resolve();
  function coverThumb(src, w, h, contain) {
    var W = 96, H = 112, c = OZ.makeCanvas(W, H), g = c.getContext("2d");
    var k = contain ? Math.min(W / w, H / h) : Math.max(W / w, H / h), dw = w * k, dh = h * k;
    if (contain) { g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H); }
    g.imageSmoothingQuality = "high";
    g.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
    return c.toDataURL("image/png");
  }
  /* Geeft {url, meta} of null. */
  async function makeThumb(blob, kind, ext) {
    if (kind === "image") {
      if (blob.size > 60 * 1000 * 1000) return null;
      if (NATIVE_IMG[ext] || ext === "heic" || ext === "heif") {
        var mime = { ico: "image/x-icon", bmp: "image/bmp", avif: "image/avif", svg: "image/svg+xml", jfif: "image/jpeg" }[ext];
        var L = await OZ.loadImg(mime && blob.type !== mime ? new Blob([blob], { type: mime }) : blob);
        try {
          var w = L.img.naturalWidth, h = L.img.naturalHeight;
          if (!w || !h) { if (ext !== "svg") return null; w = h = 300; }
          return { url: coverThumb(L.img, w, h, ext === "svg" || ext === "ico"), meta: ext === "svg" ? "" : w + " × " + h };
        } finally { L.release(); }
      }
      if ((ext === "tif" || ext === "tiff") && blob.size < 40 * 1000 * 1000) {
        var d = await OZ.conv._decodeImage(blob, ext);
        return { url: coverThumb(d.src, d.w, d.h), meta: d.w + " × " + d.h };
      }
      return null;
    }
    if (kind === "pdf") {
      if (blob.size > 80 * 1000 * 1000) return null;
      var t = await OZ.pdfThumb(blob, 220);
      return { url: coverThumb(t.canvas, t.canvas.width, t.canvas.height, true), meta: plural(t.pages, "pagina", "pagina's"), contain: true };
    }
    if (kind === "video") {
      if (blob.size > 400 * 1000 * 1000) return null;
      var v = await OZ.videoFrame(blob, null);
      return { url: coverThumb(v.canvas, v.canvas.width, v.canvas.height), meta: (isFinite(v.duration) ? OZ.fmtDur(v.duration) + " min, " : "") + v.canvas.width + " × " + v.canvas.height };
    }
    return null;
  }
  function queueThumb(f) {
    if (f.kind !== "image" && f.kind !== "pdf" && f.kind !== "video") return;
    thumbQueue = thumbQueue.then(function () {
      if (S.files.indexOf(f) < 0) return;
      return makeThumb(f.file, f.kind, f.ext).then(function (t) {
        if (!t) return;
        f.thumb = t.url; f.thumbContain = !!t.contain || f.ext === "svg" || f.ext === "ico"; f.meta = t.meta || "";
        refreshRow(f);
      }).catch(function () { /* geen miniatuur, niet erg */ });
    });
  }
  var IMG_OUT = { png: 1, jpg: 1, webp: 1, gif: 1, bmp: 1, svg: 1, ico: 1 };
  function resultThumb(r, owner) {
    var e = OZ.ext(r.name), kind = IMG_OUT[e] ? "image" : e === "pdf" ? "pdf" : null;
    if (!kind) return;
    thumbQueue = thumbQueue.then(function () {
      return makeThumb(r.blob, kind, e).then(function (t) {
        if (!t) return;
        r.thumb = t.url; r.thumbContain = kind === "pdf" || e === "svg" || e === "ico";
        if (kind === "pdf" && !r.dims) r.dims = t.meta;
        if (owner && owner.id) refreshRow(owner); else renderGroupResult(owner);
      }).catch(function () {});
    });
  }

  /* ---------- tekenen ---------- */
  var rowEls = {};
  function thumbEl(item, small, extLabel) {
    var t = el("div", { class: "thumb" + (small ? " is-small" : "") + (item.thumbContain ? " is-contain" : "") });
    if (item.thumb) t.appendChild(el("img", { src: item.thumb, alt: "" }));
    else t.appendChild(el("span", { class: "ext", text: extLabel || "?" }));
    return t;
  }
  function saveLabel(name) { return OZ.needsZip(name) ? "Sla op (zip)" : "Sla op"; }
  function canPreview(name) {
    return /^(png|jpg|jpeg|webp|gif|bmp|svg|ico|pdf|txt|md|json|xml|yaml|yml|csv|tsv|html|srt|vtt|mp3|wav|docx|xlsx|xls|ods|rtf)$/.test(OZ.ext(name));
  }
  function outActions(r, compact) {
    var acts = el("div", { class: "out-actions" });
    if (canPreview(r.name)) acts.appendChild(el("button", { class: "btn" + (compact ? " btn-quiet" : ""), type: "button", "aria-label": "Bekijk " + r.name, onclick: function () { openPreview(r); } }, compact ? [el("span", { html: OZ.icon("eye") })] : [el("span", { html: OZ.icon("eye") }), "Bekijk"]));
    acts.appendChild(el("button", { class: "btn" + (compact ? "" : " btn-primary"), type: "button", "data-save": r.name, onclick: function (ev) { saveOne(r, ev.currentTarget); } }, compact ? [saveLabel(r.name)] : [el("span", { html: OZ.icon("save") }), saveLabel(r.name)]));
    return acts;
  }
  function sizeLine(r, inputSize) {
    var meta = el("div", { class: "out-meta" }), parts = [OZ.fmtSize(r.blob.size)];
    var sizeNode = el("span", { class: "out-size", text: parts[0] });
    meta.appendChild(sizeNode);
    if (inputSize) {
      var ratio = r.blob.size / inputSize;
      if (ratio <= 0.95) {
        meta.appendChild(document.createTextNode(", "));
        var first = !r.counted; r.counted = true;
        meta.appendChild(el("b", { class: first ? "pop" : "is-popped", text: Math.round((1 - ratio) * 100) + "% kleiner" }));
        if (first && OZ.countDown) OZ.countDown(sizeNode, inputSize, r.blob.size);
      }
      else if (ratio >= 1.5) meta.appendChild(document.createTextNode(", " + (ratio >= 10 ? Math.round(ratio) : (Math.round(ratio * 10) / 10).toString().replace(".", ",")) + " keer zo groot"));
    }
    if (r.dims) meta.appendChild(document.createTextNode(", " + r.dims));
    return meta;
  }
  function outBlock(f) {
    var rs = f.results, frag = document.createDocumentFragment();
    if (!rs || !rs.length) return frag;
    if (rs.length === 1) {
      var r = rs[0], fresh = !r.stamped;
      r.stamped = true;
      frag.appendChild(el("div", { class: "out" + (fresh ? " is-fresh" : "") }, [
        el("span", { class: "out-arrow" }, [el("span", { html: OZ.icon("into") }), thumbEl(r, true, OZ.ext(r.name))]),
        el("div", { class: "out-main" }, [el("div", { class: "out-name", text: r.name, title: r.name }), sizeLine(r, f.file.size)]),
        outActions(r)
      ]));
      if (r.note) frag.appendChild(el("p", { class: "out-note", text: r.note }));
      if (OZ.needsZip(r.name)) frag.appendChild(el("p", { class: "out-note", text: "Wordt als " + OZ.savedName(r.name) + " opgeslagen: dit bestandstype kan hier alleen in een zip worden bewaard." }));
      return frag;
    }
    var total = rs.reduce(function (a, x) { return a + x.blob.size; }, 0), bundle = rs.bundle, freshM = !rs.stamped;
    rs.stamped = true;
    frag.appendChild(el("div", { class: "out" + (freshM ? " is-fresh" : "") }, [
      el("span", { class: "out-arrow" }, [el("span", { html: OZ.icon("into") }), thumbEl(rs[0], true, "zip")]),
      el("div", { class: "out-main" }, [el("div", { class: "out-name", text: plural(rs.length, "bestand", "bestanden") }), el("div", { class: "out-meta", text: "samen " + OZ.fmtSize(total) })]),
      el("div", { class: "out-actions" }, [el("button", { class: "btn btn-primary", type: "button", "data-save": bundle.name, onclick: function (ev) { saveBundle(f, ev.currentTarget); } }, [el("span", { html: OZ.icon("save") }), "Sla op als zip"])])
    ]));
    var det = el("details", { class: "out-more" }, [el("summary", { text: "Toon de " + rs.length + " bestanden" })]);
    det.open = !!f.listOpen;
    det.addEventListener("toggle", function () { f.listOpen = det.open; });
    var ul = el("ul", { class: "out-list" });
    rs.slice(0, 200).forEach(function (r2) { ul.appendChild(el("li", null, [el("span", { text: r2.name, title: r2.name }), el("small", { text: OZ.fmtSize(r2.blob.size) }), outActions(r2, true)])); });
    if (rs.length > 200) ul.appendChild(el("li", null, [el("span", { text: "En nog " + (rs.length - 200) + " bestanden. Ze zitten allemaal in de zip." })]));
    det.appendChild(ul); frag.appendChild(det);
    return frag;
  }
  function fileMeta(f) {
    if (f.status === "busy") return f.busyText || "Wordt omgezet";
    return [OZ.fmtSize(f.file.size), f.meta].filter(Boolean).join(", ");
  }
  function rowEl(f, index, count) {
    var kindInfo = OZ.KINDS[f.kind], merging = f.kind !== "blocked" && mergeOn(f.kind);
    var li = el("li", { class: "file" + (f.isNew ? " is-new" : "") + (f.status === "busy" ? " is-busy" : "") + (f.kind === "blocked" ? " is-blocked" : ""), "data-id": f.id, style: "--i:" + Math.min(f.n || 0, 12) + ";--p:" + (f.progress || 0) });
    li.appendChild(thumbEl(f, false, f.ext || "?"));
    li.appendChild(el("div", { class: "file-main" }, [el("div", { class: "file-name", text: f.file.name, title: f.file.name }), el("div", { class: "file-meta", text: fileMeta(f) })]));
    var side = el("div", { class: "file-side" });
    if (f.status === "done") side.appendChild(el("span", { class: "state is-ok", html: OZ.icon("check") + "<span>Klaar</span>" }));
    if (merging && !S.running) {
      side.appendChild(el("button", { class: "icon-btn is-sm", type: "button", "aria-label": "Zet " + f.file.name + " eerder", disabled: index === 0, html: OZ.icon("up"), onclick: function () { move(f, -1); } }));
      side.appendChild(el("button", { class: "icon-btn is-sm", type: "button", "aria-label": "Zet " + f.file.name + " later", disabled: index === count - 1, html: OZ.icon("down"), onclick: function () { move(f, 1); } }));
    }
    if (!S.running) side.appendChild(el("button", { class: "icon-btn", type: "button", "aria-label": "Haal " + f.file.name + " weg", html: OZ.icon("x"), onclick: function () { removeFile(f); } }));
    li.appendChild(side);
    if (f.blocked) li.appendChild(el("p", { class: "file-error", html: OZ.icon("alert") }, [el("span", { text: f.blocked })]));
    if (f.error) li.appendChild(el("p", { class: "file-error", role: "alert", html: OZ.icon("alert") }, [el("span", { text: f.error })]));
    if (f.merged && f.status === "done") li.querySelector(".file-meta").textContent = fileMeta(f) + ", zit in het samengevoegde bestand";
    li.appendChild(outBlock(f));
    if (merging && !S.running && !TOUCH) {
      li.draggable = true;
      li.addEventListener("dragstart", function (ev) { dragId = f.id; li.classList.add("is-dragging"); try { ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", f.id); } catch (e) { /* niets */ } });
      li.addEventListener("dragend", function () { dragId = null; li.classList.remove("is-dragging"); document.querySelectorAll(".file.is-target").forEach(function (n) { n.classList.remove("is-target"); }); });
      li.addEventListener("dragover", function (ev) { if (dragId && dragId !== f.id) { ev.preventDefault(); li.classList.add("is-target"); } });
      li.addEventListener("dragleave", function () { li.classList.remove("is-target"); });
      li.addEventListener("drop", function (ev) {
        if (!dragId) return;
        ev.preventDefault(); ev.stopPropagation();
        var from = S.files.filter(function (x) { return x.id === dragId; })[0];
        dragId = null;
        if (!from || from === f || from.kind !== f.kind) return;
        S.files.splice(S.files.indexOf(from), 1);
        S.files.splice(S.files.indexOf(f), 0, from);
        invalidate(f.kind); render();
      });
    }
    f.isNew = false;
    rowEls[f.id] = li;
    return li;
  }
  var dragId = null;
  function move(f, dir) {
    var list = filesOf(f.kind), i = list.indexOf(f), other = list[i + dir];
    if (!other) return;
    var a = S.files.indexOf(f), b = S.files.indexOf(other);
    S.files[a] = other; S.files[b] = f;
    invalidate(f.kind); render();
    var btn = rowEls[f.id] && rowEls[f.id].querySelectorAll(".icon-btn.is-sm")[dir < 0 ? 0 : 1];
    if (btn && !btn.disabled) btn.focus();
  }
  function refreshRow(f) {
    var old = rowEls[f.id];
    if (!old || !old.parentNode) return;
    var list = f.kind === "blocked" ? S.files.filter(function (x) { return x.kind === "blocked"; }) : filesOf(f.kind);
    old.parentNode.replaceChild(rowEl(f, list.indexOf(f), list.length), old);
  }

  function optField(kind, spec, g) {
    var id = "opt-" + kind + "-" + spec.id, val = g.opts[spec.id], input, wrap;
    function changed(v, structural) {
      g.opts[spec.id] = v;
      if (spec.id === "delimiter") { prefs.delimiter = v; savePrefs(); }
      if (kind === "image" && (spec.id === "maxW" || spec.id === "maxH")) { g.preset = !g.opts.maxW && !g.opts.maxH ? "orig" : "custom"; syncPresets(kind); }
      invalidate(kind);
      if (structural) render(); else { renderRows(kind); renderGroupResult(kind); renderDock(); }
    }
    if (spec.type === "note") return el("p", { class: "hint wide", text: spec.text });
    if (spec.type === "check") {
      input = el("input", { type: "checkbox", id: id });
      input.checked = !!val;
      input.addEventListener("change", function () { changed(input.checked); });
      return el("label", { class: "check wide", for: id }, [input, el("span", { text: spec.label })]);
    }
    if (spec.type === "select") {
      input = el("select", { class: "input", id: id }, spec.options.map(function (o) { return el("option", { value: o[0], text: o[1] }); }));
      input.value = String(val);
      input.addEventListener("change", function () { changed(input.value, spec.id === "pdfMode"); });
    } else if (spec.type === "range") {
      var out = el("output", { for: id, text: val + (spec.unit || "") });
      input = el("input", { type: "range", id: id, min: spec.min, max: spec.max, step: spec.step, value: val });
      input.addEventListener("input", function () { out.textContent = input.value + (spec.unit || ""); });
      input.addEventListener("change", function () { changed(+input.value); });
      wrap = el("div", { class: "field" }, [el("label", { for: id }, [spec.label + " ", out]), input]);
      return wrap;
    } else if (spec.type === "color") {
      input = el("input", { type: "color", id: id, value: val || "#ffffff" });
      input.addEventListener("change", function () { changed(input.value); });
    } else {
      input = el("input", { class: "input", id: id, type: spec.type === "number" ? "number" : "text", inputmode: spec.type === "number" ? "numeric" : spec.mode || null, min: spec.type === "number" ? 1 : null, placeholder: spec.placeholder || "", value: val == null ? "" : val, autocomplete: "off" });
      input.addEventListener("change", function () { changed(input.value.trim()); });
    }
    return el("div", { class: "field" }, [el("label", { for: id, text: spec.label }), input]);
  }
  function syncPresets(kind) {
    var g = group(kind);
    document.querySelectorAll('[data-preset-kind="' + kind + '"]').forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-preset") === g.preset ? "true" : "false"); });
    var sum = document.querySelector('[data-size-sum="' + kind + '"]'), cur = PRESETS.filter(function (p) { return p.id === g.preset; })[0];
    if (sum) sum.textContent = cur ? cur.label.toLowerCase() : "eigen maat";
  }
  function chooseTarget(kind, t) {
    var g = group(kind);
    if (S.running || g.target === t) return;
    g.target = t; g.auto = false; prefs.targets[kind] = t; savePrefs();
    invalidate(kind); render();
    var b = document.querySelector('[data-kind="' + kind + '"] [data-target="' + t + '"]');
    if (b) b.focus();
  }
  function targetHint(kind, t, n) {
    var T = OZ.TARGETS[t];
    if (t === "zip") return n > 1 ? "Pakt de " + n + " bestanden samen in één zip, zonder ze om te zetten." : "Pakt het bestand in een zip, zonder het om te zetten.";
    if (t === "unzip" || t === "gunzip" || t === "decode") return "";
    if (t === "klein") return kind === "pdf" ? "Alleen de foto's en plaatjes in de pdf worden kleiner. Tekst blijft scherp, selecteerbaar en doorzoekbaar." : "De foto's in het document worden verkleind. Tekst en opmaak blijven precies zoals ze zijn. Werkt voor Word, PowerPoint, ODT en EPUB.";
    if (T.ext && OZ.needsZip(T.ext)) return T.label + " kan hier niet los worden bewaard. Je krijgt het bestand daarom verpakt in een zip.";
    if (kind === "pdf" && t === "pdf") return n > 1 ? "Voeg pdf's samen, of haal er pagina's uit via Opties." : "Haal pagina's uit de pdf of knip hem in losse pagina's. Stel het in bij Opties.";
    if (kind === "image" && t === "svg") return "De afbeelding blijft uit pixels bestaan; het SVG-bestand is een verpakking eromheen.";
    if (kind === "pdf" && (t === "docx" || t === "html" || t === "md" || t === "txt")) return "Alleen de tekst gaat mee. Opmaak, kolommen en afbeeldingen uit de pdf niet.";
    if (kind === "doc" && t === "pdf") return "Tekst, koppen, lijsten, tabellen en afbeeldingen gaan mee. De precieze opmaak van het origineel niet.";
    return "";
  }
  /* ---------- andere verhouding ---------- */
  var RF = OZ.reframe, hasClaude = false;
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function rfFile(kind) { var g = group(kind), files = filesOf(kind); g.rfIndex = Math.max(0, Math.min(g.rfIndex, files.length - 1)); return files[g.rfIndex]; }
  async function rfSource(f, rotate) {
    var key = String(+rotate || 0);
    if (f.prev && f.prevKey === key) return f.prev;
    if (!f.prevLoading || f.prevLoadingKey !== key) {
      f.prevLoadingKey = key;
      f.prevLoading = (async function () {
        var d = await OZ.conv._decodeImage(f.file, f.ext), full, c;
        try {
          full = OZ.conv._renderImage(d, d.vector ? { rotate: rotate, maxW: 2400, maxH: 2400 } : { rotate: rotate, maxW: 0 }, false);
          var k = Math.min(1, 900 / Math.max(full.width, full.height));
          c = OZ.makeCanvas(full.width * k, full.height * k);
          var cg = c.getContext("2d"); cg.imageSmoothingQuality = "high"; cg.drawImage(full, 0, 0, c.width, c.height);
        } finally { d.release(); }
        f.natW = full.width; f.natH = full.height; f.prev = c; f.prevKey = key; f.prevLoading = null;
        return c;
      })();
    }
    return f.prevLoading;
  }
  var rfRaf = 0;
  function drawRf(kind) {
    if (rfRaf) cancelAnimationFrame(rfRaf);
    rfRaf = requestAnimationFrame(function () { rfRaf = 0; drawRfNow(kind); });
  }
  function drawRfNow(kind) {
    var g = group(kind), f = rfFile(kind), view = $("rfView-" + kind);
    if (!view || !f || !RF.active(g.rf)) return Promise.resolve();
    var token = ++g.rfToken, cap = $("rfCap-" + kind), before = $("rfBefore-" + kind);
    return rfSource(f, g.opts.rotate).then(function (src) {
      if (token !== g.rfToken || !view.isConnected) return;
      var size = RF.outputSize(g.rf, f.natW, f.natH);
      var maxPx = 440 * Math.min(2, window.devicePixelRatio || 1), scale = Math.min(1, maxPx / Math.max(size.w, size.h));
      var out = RF.render(src, src.width, src.height, Object.assign({}, g.rf, { ratio: "custom", cw: size.w, ch: size.h }), f.rf, scale);
      view.width = out.width; view.height = out.height; view.getContext("2d").drawImage(out, 0, 0);
      view.style.aspectRatio = size.w + " / " + size.h;
      g.rfSize = size;
      if (before) {
        var bk = Math.min(1, 220 / Math.max(src.width, src.height));
        before.width = Math.round(src.width * bk); before.height = Math.round(src.height * bk);
        before.getContext("2d").drawImage(src, 0, 0, before.width, before.height);
        before.style.aspectRatio = src.width + " / " + src.height;
      }
      if (cap) cap.textContent = f.natW + " \u00d7 " + f.natH + " wordt " + size.w + " \u00d7 " + size.h + " pixels";
      view.setAttribute("data-ready", "1");
    }).catch(function (e) {
      if (cap) cap.textContent = "Van deze afbeelding kan geen voorbeeld worden gemaakt.";
    });
  }
  function rfNudge(kind, dx, dy) {            /* verschuiving in schermpixels van het voorbeeld */
    var g = group(kind), f = rfFile(kind), view = $("rfView-" + kind), size = g.rfSize;
    if (!f || !view || !size || !f.natW) return;
    var rect = view.getBoundingClientRect();
    if (!rect.width) return;
    var sx = size.w / rect.width, sy = size.h / rect.height;
    if (g.rf.method === "crop") {
      var c = RF.cropRect(f.natW, f.natH, size.w, size.h, f.rf.fx, f.rf.fy, g.rf.zoom), k = c.w / size.w;
      f.rf.fx = clamp01((c.x + c.w / 2 - dx * sx * k) / f.natW);
      f.rf.fy = clamp01((c.y + c.h / 2 - dy * sy * k) / f.natH);
    } else {
      var r = RF.fitRect(f.natW, f.natH, size.w, size.h, f.rf.place), free = r.vertical ? size.h - r.h : size.w - r.w;
      if (free <= 0) return;
      f.rf.place = clamp01(((r.vertical ? r.y : r.x) + (r.vertical ? dy * sy : dx * sx)) / free);
    }
    drawRf(kind);
  }
  function rfChanged(kind, structural) {
    invalidate(kind);
    if (structural) render(); else { renderRows(kind); renderGroupResult(kind); renderDock(); drawRf(kind); }
  }
  function chipSet(label, items, current, name, onPick) {
    var id = "cs-" + name, chips = el("div", { class: "chips", role: "group", "aria-labelledby": id });
    items.forEach(function (it) {
      chips.appendChild(el("button", { class: "chip", type: "button", "aria-pressed": current === it[0] ? "true" : "false", disabled: S.running, text: it[1], onclick: function () { if (!S.running && current !== it[0]) onPick(it[0]); } }, null)).setAttribute("data-" + name, it[0]);
    });
    return el("div", { class: "pick is-inner" }, [el("span", { class: "pick-label", id: id, text: label }), chips]);
  }
  function refocus(sel) { var b = document.querySelector(sel); if (b) b.focus(); }
  function reframeSection(kind, g, files) {
    var rf = g.rf, on = RF.active(rf), r = RF.ratio(rf.ratio);
    var sumText = !on ? "origineel" : rf.ratio === "custom" ? "eigen maat" : r.label.toLowerCase();
    var det = el("details", { class: "opts", "data-sect": "rf" }, [el("summary", { html: OZ.icon("frame") + "<span>Andere verhouding</span>" }, [el("span", { class: "opts-sum", text: sumText })])]);
    det.open = !!g.rfOpen || on;
    det.addEventListener("toggle", function () { g.rfOpen = det.open; if (det.open) drawRf(kind); });
    var body = el("div", { class: "sect-body" });
    var ratios = [["orig", "Origineel"]].concat(RF.RATIOS.map(function (x) { return [x.id, x.label]; }), [["custom", "Eigen maat"]]);
    body.appendChild(chipSet("Verhouding", ratios, rf.ratio, "ratio", function (id) {
      rf.ratio = id; g.rfOpen = true; g.rfNote = "";
      if (id !== "orig" && (g.target === "ico")) g.target = "jpg";
      rfChanged(kind, true); refocus('[data-ratio="' + id + '"]');
    }));
    if (!on) { body.appendChild(el("p", { class: "pick-hint", text: "Bijvoorbeeld een liggende foto staand maken voor een story, of andersom. Je kiest zelf of de foto wordt aangevuld of bijgesneden." })); det.appendChild(body); return det; }

    var f = rfFile(kind), n = files.length;
    var view = el("canvas", { class: "rf-view", id: "rfView-" + kind, width: 16, height: 16, tabindex: "0", role: "img", "aria-label": rf.method === "crop" ? "Voorbeeld van het resultaat. Sleep, of gebruik de pijltjestoetsen, om te kiezen wat in beeld blijft." : "Voorbeeld van het resultaat. Sleep, of gebruik de pijltjestoetsen, om de foto te verplaatsen." });
    var drag = null;
    view.addEventListener("pointerdown", function (ev) { if (S.running) return; drag = { x: ev.clientX, y: ev.clientY, moved: false }; try { view.setPointerCapture(ev.pointerId); } catch (e) { /* niets */ } ev.preventDefault(); });
    view.addEventListener("pointermove", function (ev) { if (!drag) return; var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y; if (!dx && !dy) return; drag.x = ev.clientX; drag.y = ev.clientY; drag.moved = true; rfNudge(kind, dx, dy); });
    function endDrag() { if (drag && drag.moved) { g.rfNote = ""; invalidate(kind); renderRows(kind); renderGroupResult(kind); renderDock(); } drag = null; }
    view.addEventListener("pointerup", endDrag); view.addEventListener("pointercancel", endDrag);
    view.addEventListener("keydown", function (ev) {
      var d = { ArrowLeft: [-14, 0], ArrowRight: [14, 0], ArrowUp: [0, -14], ArrowDown: [0, 14] }[ev.key];
      if (!d || S.running) return;
      ev.preventDefault(); rfNudge(kind, d[0], d[1]); invalidate(kind); renderRows(kind); renderGroupResult(kind); renderDock();
    });
    var nav = null;
    if (n > 1) {
      nav = el("div", { class: "rf-nav" }, [
        el("button", { class: "btn", type: "button", "data-rfnav": "prev", disabled: g.rfIndex === 0, text: "Vorige", onclick: function () { g.rfIndex--; g.rfNote = ""; render(); refocus('[data-rfnav="prev"]:not(:disabled), [data-rfnav="next"]'); } }),
        el("span", { class: "hint", text: "Foto " + (g.rfIndex + 1) + " van " + n }),
        el("button", { class: "btn", type: "button", "data-rfnav": "next", disabled: g.rfIndex === n - 1, text: "Volgende", onclick: function () { g.rfIndex++; g.rfNote = ""; render(); refocus('[data-rfnav="next"]:not(:disabled), [data-rfnav="prev"]'); } })
      ]);
    }
    var stage = el("div", { class: "rf-stage" }, [
      el("figure", { class: "rf-fig is-before" }, [el("canvas", { class: "rf-before", id: "rfBefore-" + kind, width: 16, height: 9 }), el("figcaption", { text: "Nu" })]),
      el("figure", { class: "rf-fig is-after" }, [view, el("figcaption", { text: "Straks" })])
    ]);
    var viewCol = el("div", { class: "rf-viewcol" }, [stage, el("p", { class: "rf-cap" }, [el("strong", { text: f ? f.file.name : "" }), el("span", { id: "rfCap-" + kind, text: "Voorbeeld wordt gemaakt" })]), nav]);

    var ctl = el("div", { class: "rf-ctl" });
    ctl.appendChild(chipSet("Manier", [["fill", "Aanvullen"], ["crop", "Bijsnijden"]], rf.method, "method", function (id) { rf.method = id; g.rfNote = ""; rfChanged(kind, true); refocus('[data-method="' + id + '"]'); }));
    if (rf.method === "fill") {
      ctl.appendChild(chipSet("Nieuwe ruimte vullen met", [["blur", "Zachte achtergrond"], ["extend", "Doortrekken"], ["color", "Effen kleur"]], rf.fill, "fill", function (id) { rf.fill = id; rfChanged(kind, true); refocus('[data-fill="' + id + '"]'); }));
      if (rf.fill === "color") {
        var custom = rf.color !== "auto" && rf.color !== "#ffffff" && rf.color !== "#000000";
        var cs = chipSet("Kleur", [["auto", "Kleur van de rand"], ["#ffffff", "Wit"], ["#000000", "Zwart"], ["pick", "Eigen kleur"]], custom ? "pick" : rf.color, "rfcolor", function (id) {
          rf.color = id === "pick" ? ($("rfColor-" + kind) ? $("rfColor-" + kind).value : "#1f4fd1") : id;
          if (id === "pick") rf.color = rf.color === "#ffffff" || rf.color === "#000000" || rf.color === "auto" ? "#1f4fd1" : rf.color;
          rfChanged(kind, true); refocus('[data-rfcolor="' + id + '"]');
        });
        ctl.appendChild(cs);
        if (custom) {
          var ci = el("input", { type: "color", id: "rfColor-" + kind, value: rf.color });
          ci.addEventListener("input", function () { rf.color = ci.value; drawRf(kind); });
          ci.addEventListener("change", function () { rf.color = ci.value; rfChanged(kind, false); });
          ctl.appendChild(el("div", { class: "field rf-field" }, [el("label", { for: "rfColor-" + kind, text: "Eigen kleur" }), ci]));
        }
      }
      ctl.appendChild(el("p", { class: "pick-hint rf-honest", text: "De nieuwe ruimte wordt gevuld vanuit de foto zelf: vervaagd, doorgetrokken of in een kleur. Nieuwe beeldinhoud erbij verzinnen kan deze app niet." }));
      ctl.appendChild(el("p", { class: "pick-hint", text: TOUCH ? "Sleep in het voorbeeld om de foto te verplaatsen." : "Sleep in het voorbeeld om de foto binnen het kader te verplaatsen." }));
    } else {
      var zid = "rfZoom-" + kind, zo = el("output", { for: zid, text: Math.round(rf.zoom * 100) + "%" });
      var zi = el("input", { type: "range", id: zid, min: 100, max: 300, step: 5, value: Math.round(rf.zoom * 100) });
      zi.addEventListener("input", function () { rf.zoom = +zi.value / 100; zo.textContent = zi.value + "%"; drawRf(kind); });
      zi.addEventListener("change", function () { rf.zoom = +zi.value / 100; rfChanged(kind, false); });
      ctl.appendChild(el("div", { class: "field rf-field" }, [el("label", { for: zid }, ["Inzoomen ", zo]), zi]));
      ctl.appendChild(el("p", { class: "pick-hint", text: "Sleep in het voorbeeld om te kiezen wat in beeld blijft. De randen buiten het kader vallen weg." + (n > 1 ? " Dat stel je per foto in; verhouding en inzoomen gelden voor alle " + n + "." : "") }));
    }
    if (rf.ratio === "custom") {
      var wi = el("input", { class: "input", type: "number", inputmode: "numeric", min: 16, max: 12000, id: "rfW-" + kind, value: rf.cw });
      var hi = el("input", { class: "input", type: "number", inputmode: "numeric", min: 16, max: 12000, id: "rfH-" + kind, value: rf.ch });
      wi.addEventListener("change", function () { rf.cw = Math.max(16, Math.min(12000, Math.round(+wi.value) || 1080)); wi.value = rf.cw; rfChanged(kind, false); });
      hi.addEventListener("change", function () { rf.ch = Math.max(16, Math.min(12000, Math.round(+hi.value) || 1080)); hi.value = rf.ch; rfChanged(kind, false); });
      ctl.appendChild(el("div", { class: "rf-size" }, [el("div", { class: "field" }, [el("label", { for: "rfW-" + kind, text: "Breedte in pixels" }), wi]), el("div", { class: "field" }, [el("label", { for: "rfH-" + kind, text: "Hoogte in pixels" }), hi])]));
    } else {
      var sid = "rfSize-" + kind, sel = el("select", { class: "input", id: sid }, [el("option", { value: "std", text: r.std[0] + " \u00d7 " + r.std[1] + " pixels" }), el("option", { value: "orig", text: "Zo scherp als het origineel" })]);
      sel.value = rf.size;
      sel.addEventListener("change", function () { rf.size = sel.value; rfChanged(kind, false); });
      ctl.appendChild(el("div", { class: "field rf-field" }, [el("label", { for: sid, text: "Maat van het resultaat" }), sel]));
    }
    if (hasClaude) {
      var cb = el("button", { class: "btn", type: "button", id: "rfClaude-" + kind, disabled: S.running }, [el("span", { html: OZ.icon("eye") }), "Laat Claude het onderwerp zoeken"]);
      cb.addEventListener("click", function () { askClaude(kind, cb); });
      ctl.appendChild(el("div", { class: "rf-claude" }, [cb, el("p", { class: "pick-hint", text: "Claude bekijkt een verkleinde kopie van deze foto en zet het kader om het onderwerp. Daarvoor gaat die kopie naar Claude; de rest van de app werkt zonder." })]));
    }
    if (g.rfNote) ctl.appendChild(el("p", { class: "rf-note", role: "status", text: g.rfNote }));
    body.appendChild(el("div", { class: "rf" }, [viewCol, ctl]));
    det.appendChild(body);
    setTimeout(function () { drawRf(kind); }, 0);
    return det;
  }
  var claudeBusy = false;
  async function askClaude(kind, btn) {
    var g = group(kind), f = rfFile(kind);
    if (!f || claudeBusy || S.running) return;
    claudeBusy = true; btn.disabled = true;
    var label = btn.lastChild; label.textContent = "Claude kijkt naar de foto";
    try {
      var src = await rfSource(f, g.opts.rotate);
      var res = await RF.askClaude(src, src.width, src.height);
      if (!res.ok) {
        if (res.code === "not_granted") { hasClaude = false; render(); }
        else toast(res.message, true);
        return;
      }
      var a = res.answer;
      f.rf.fx = a.cx; f.rf.fy = a.cy;
      if (f.natW && g.rfSize) {
        var r = RF.fitRect(f.natW, f.natH, g.rfSize.w, g.rfSize.h, 0.5), free = r.vertical ? g.rfSize.h - r.h : g.rfSize.w - r.w;
        if (free > 0) f.rf.place = clamp01(((r.vertical ? g.rfSize.h : g.rfSize.w) / 2 - (r.vertical ? a.cy * r.h : a.cx * r.w)) / free);
      }
      if (a.fill && g.rf.method === "fill") g.rf.fill = a.fill;
      g.rfNote = "Claude: " + (a.reason || "het onderwerp is gevonden en het kader is erop gezet.");
      invalidate(kind); render();
    } finally { claudeBusy = false; if (btn.isConnected) { btn.disabled = false; label.textContent = "Laat Claude het onderwerp zoeken"; } }
  }

  function groupEl(kind) {
    var K = OZ.KINDS[kind], g = group(kind), files = filesOf(kind), n = files.length;
    g.mergeOn = mergeOn(kind);
    var card = el("section", { class: "group", "data-kind": kind, "aria-labelledby": "gh-" + kind });
    card.appendChild(el("div", { class: "group-head" }, [el("span", { html: OZ.icon(K.icon) }), el("h2", { id: "gh-" + kind, text: K.label }), el("span", { class: "count", text: plural(n, "bestand", "bestanden") })]));
    if (K.note) card.appendChild(el("p", { class: "group-note", text: K.note }));
    /* doel kiezen */
    var chips = el("div", { class: "chips", role: "group", "aria-labelledby": "pl-" + kind });
    OZ.targetsFor(kind).forEach(function (t) {
      var T = OZ.TARGETS[t];
      chips.appendChild(el("button", { class: "chip" + (t === "zip" && !K.noZip ? " is-sep" : ""), type: "button", "aria-pressed": g.target === t ? "true" : "false", "data-target": t, title: T.hint || null, disabled: S.running, text: T.label, onclick: function () { chooseTarget(kind, t); } }));
    });
    var pick = el("div", { class: "pick" }, [el("span", { class: "pick-label", id: "pl-" + kind, text: n > 1 ? "Zet alle " + n + " om naar" : "Zet om naar" }), chips]);
    var hint = targetHint(kind, g.target, n);
    if (hint) pick.appendChild(el("p", { class: "pick-hint", text: hint }));
    card.appendChild(pick);
    /* foto's: andere verhouding en maat, elk achter een eigen uitklapper */
    if (kind === "image" && g.target !== "zip") {
      card.appendChild(reframeSection(kind, g, files));
      var pchips = el("div", { class: "chips", role: "group", "aria-label": "Maat" });
      PRESETS.forEach(function (p) {
        pchips.appendChild(el("button", { class: "chip", type: "button", "aria-pressed": g.preset === p.id ? "true" : "false", "data-preset": p.id, "data-preset-kind": kind, disabled: S.running, text: p.label, onclick: function () {
          if (S.running) return;
          g.preset = p.id; g.sizeOpen = true;
          Object.keys(p.set).forEach(function (k) { g.opts[k] = p.set[k]; });
          if (p.lossy && g.target === "png" && files.every(function (f) { return /^(jpe?g|jfif|heic|heif)$/.test(f.ext); })) { g.target = "jpg"; prefs.targets[kind] = "jpg"; savePrefs(); }
          invalidate(kind); render();
          var b = document.querySelector('[data-preset="' + p.id + '"]'); if (b) b.focus();
        } }));
      });
      var cur = PRESETS.filter(function (p) { return p.id === g.preset; })[0];
      var sdet = el("details", { class: "opts", "data-sect": "size" }, [el("summary", { html: OZ.icon("resize") + "<span>Maat</span>" }, [el("span", { class: "opts-sum", "data-size-sum": kind, text: cur ? cur.label.toLowerCase() : "eigen maat" })])]);
      sdet.open = !!g.sizeOpen;
      sdet.addEventListener("toggle", function () { g.sizeOpen = sdet.open; });
      sdet.appendChild(el("div", { class: "sect-body" }, [pchips, el("p", { class: "pick-hint", text: "Een eigen maximale breedte, hoogte of bestandsgrootte stel je in bij Opties." })]));
      card.appendChild(sdet);
    }
    /* samenvoegen */
    if (mergeable(kind) && g.target === "pdf" && n > 1) {
      var mid = "merge-" + kind, cb = el("input", { type: "checkbox", id: mid, disabled: S.running });
      cb.checked = g.mergeOn;
      cb.addEventListener("change", function () { g.merge = cb.checked; invalidate(kind); render(); var x = $(mid); if (x) x.focus(); });
      card.appendChild(el("label", { class: "check merge", for: mid }, [cb, el("span", { text: "Voeg samen tot één pdf" + (g.mergeOn ? (TOUCH ? ". Bepaal de volgorde met de pijlen." : ". Versleep de rijen of gebruik de pijlen voor de volgorde.") : "") })]));
    }
    /* opties */
    var specs = (OPTS[kind] || []).filter(function (s) { return g.target !== "zip" && (!s.when || s.when(g.target, g)); });
    if (specs.length && specs.some(function (s) { return s.id; })) {
      var det = el("details", { class: "opts", "data-sect": "opts" }, [el("summary", { html: OZ.icon("sliders") + "<span>Opties</span>" })]);
      det.open = !!g.open;
      det.addEventListener("toggle", function () { g.open = det.open; });
      var grid = el("div", { class: "opts-grid" });
      specs.forEach(function (s) { grid.appendChild(optField(kind, s, g)); });
      det.appendChild(grid); card.appendChild(det);
    }
    card.appendChild(el("ul", { class: "rows", id: "rows-" + kind }, files.map(function (f, i) { return rowEl(f, i, n); })));
    card.appendChild(el("div", { id: "gres-" + kind }));
    return card;
  }
  function renderRows(kind) {
    var ul = $("rows-" + kind);
    if (!ul) return;
    var files = filesOf(kind);
    ul.textContent = "";
    files.forEach(function (f, i) { ul.appendChild(rowEl(f, i, files.length)); });
  }
  function renderGroupResult(kind) {
    var host = $("gres-" + kind);
    if (!host) return;
    host.textContent = "";
    var r = group(kind).result;
    if (!r) return;
    var inputTotal = filesOf(kind).reduce(function (a, f) { return a + f.file.size; }, 0);
    var box = el("div", { class: "group-out" }, [
      el("span", { class: "out-arrow" }, [el("span", { html: OZ.icon("stack") }), thumbEl(r, true, OZ.ext(r.name))]),
      el("div", { class: "out-main" }, [el("div", { class: "out-name", text: r.name, title: r.name }), sizeLine(r, r.isZip ? 0 : inputTotal)]),
      outActions(r)
    ]);
    host.appendChild(box);
  }
  function render() {
    var host = $("groups"), kinds = activeKinds(), blocked = S.files.filter(function (f) { return f.kind === "blocked"; });
    rowEls = {};
    host.textContent = "";
    kinds.forEach(function (k) { host.appendChild(groupEl(k)); });
    kinds.forEach(renderGroupResult);
    if (blocked.length) {
      var card = el("section", { class: "group is-blocked", "data-kind": "blocked", "aria-labelledby": "gh-blocked" }, [
        el("div", { class: "group-head" }, [el("span", { html: OZ.icon("alert") }), el("h2", { id: "gh-blocked", text: "Dit lukt niet in een browser" }), el("span", { class: "count", text: plural(blocked.length, "bestand", "bestanden") })]),
        el("ul", { class: "rows" }, blocked.map(function (f, i) { return rowEl(f, i, blocked.length); }))
      ]);
      host.appendChild(card);
    }
    var has = S.files.length > 0;
    $("drop").classList.toggle("is-compact", has);
    $("dropLead").textContent = has ? (TOUCH ? "Nog meer bestanden omzetten?" : "Sleep er meer bij, plak met Ctrl+V of kies bestanden.") : (TOUCH ? "Kies foto's of bestanden van je telefoon." : "Sleep bestanden hierheen, plak ze met Ctrl+V of kies ze zelf.");
    $("pick").lastChild.textContent = has ? " Voeg bestanden toe" : " Kies bestanden";
    $("pageTitle").hidden = has; $("recipes").hidden = has; $("ratios").hidden = has;
    renderDock();
  }
  function todo() {
    return S.files.filter(function (f) {
      if (f.kind === "blocked" || f.status === "done") return false;
      return true;
    });
  }
  function renderDock() {
    var dock = $("dock"), convertible = S.files.filter(function (f) { return f.kind !== "blocked"; });
    dock.hidden = !S.files.length;
    if (!S.files.length) return;
    var outs = allOutputs(), pending = todo(), failed = convertible.filter(function (f) { return f.status === "error"; }).length;
    var st = $("dockStatus"), go = $("go");
    st.textContent = "";
    if (S.running) {
      st.appendChild(el("span", { id: "runText", text: S.runText || "Bezig" }));
      st.appendChild(el("div", { class: "bar" }, [el("i", { id: "runBar", style: "width:" + Math.round((S.runFrac || 0) * 100) + "%" })]));
      go.textContent = "Stop"; go.disabled = false; go.classList.remove("btn-primary");
    } else {
      var done = convertible.filter(function (f) { return f.status === "done"; }).length, msg;
      if (!convertible.length) msg = "Geen van deze bestanden kan worden omgezet.";
      else if (done && !pending.length) msg = done === 1 ? "1 bestand omgezet." : done + " bestanden omgezet.";
      else if (done || failed) msg = [done ? done + " omgezet" : "", failed ? failed + " mislukt" : "", pending.length - failed > 0 ? (pending.length - failed) + " nog te doen" : ""].filter(Boolean).join(", ") + ".";
      else msg = pending.length === 1 ? "1 bestand staat klaar." : pending.length + " bestanden staan klaar.";
      st.appendChild(el("span", { text: msg }));
      go.textContent = pending.length && (done || failed) ? "Zet de rest om" : "Zet om";
      go.disabled = !pending.length; go.classList.add("btn-primary");
    }
    /* Als alles klaar is, wordt opslaan de hoofdactie onderaan. */
    var finished = !S.running && !pending.length && outs.length > 0, sa = $("saveAll");
    go.hidden = finished;
    sa.hidden = S.running || !(outs.length >= 2 || (finished && outs.length === 1));
    sa.classList.toggle("btn-primary", finished); sa.classList.toggle("btn-big", finished);
    sa.lastElementChild.textContent = outs.length === 1 ? saveLabel(outs[0].name) : "Alles opslaan (zip)";
    $("clearAll").hidden = S.running;
  }

  /* ---------- omzetten ---------- */
  var CONV = { image: "image", pdf: "pdf", doc: "doc", data: "data", audio: "audio", video: "video", subs: "subs", agenda: "agenda", contacts: "contacts", archive: "archive", gzip: "gzip", base64: "base64", other: "other" };
  function errorText(e) {
    if (e && e.friendly) return e.message;
    if (window.console) console.warn("Omzetten mislukt:", e);
    var raw = String((e && e.message) || e || "");
    if (/memory|allocation|too large|Invalid (array|typed array) length/i.test(raw)) return "Dit bestand is te groot voor het geheugen van dit apparaat. Probeer een kleiner bestand of een lagere kwaliteit.";
    return "Het omzetten is mislukt. Mogelijk is het bestand beschadigd of anders opgebouwd dan de extensie doet vermoeden.";
  }
  function setProgress(f, p, text) {
    f.progress = p;
    var li = rowEls[f.id];
    if (!li) return;
    li.style.setProperty("--p", p);
    var rb = $("runBar");
    if (rb && S.runTotal) rb.style.width = Math.round(Math.min(1, ((S.runDone || 0) + Math.min(1, p)) / S.runTotal) * 100) + "%";
    if (text && f.busyText !== text) { f.busyText = text; var m = li.querySelector(".file-meta"); if (m) m.textContent = text; }
  }
  async function convertFile(f, target, opts) {
    f.status = "busy"; f.error = null; f.results = null; f.progress = 0.04; f.busyText = "Wordt omgezet";
    refreshRow(f);
    var real = 0, started = Date.now();
    var creep = setInterval(function () { if (!real) setProgress(f, f.progress + (0.9 - f.progress) * 0.07); }, 180);
    var ctx = { progress: function (p) { real = Math.max(real, p); setProgress(f, 0.04 + 0.94 * real); }, cancelled: function () { return S.cancel; } };
    try {
      await OZ.tick();
      if (typeof OZ.conv[CONV[f.kind]] !== "function") throw OZ.fail("Dit onderdeel van de app is niet geladen. Laad de pagina opnieuw.");
      var outs = await OZ.conv[CONV[f.kind]](f.file, f.ext, target, opts, ctx);
      if (!outs || !outs.length) throw OZ.fail("Er kwam niets uit dit bestand.");
      var bundleName = outs.bundleName || OZ.base(f.file.name) + " (" + outs.length + " bestanden).zip";
      outs = OZ.uniqueNames(outs.map(function (o) { o.name = OZ.safeName(o.name); return o; }));
      outs.bundle = { name: bundleName };
      setProgress(f, 1);
      var wait = 260 - (Date.now() - started);
      if (wait > 0 && S.runTotal <= 8) await new Promise(function (r) { setTimeout(r, wait); });
      return outs;
    } finally { clearInterval(creep); }
  }
  function setRun(text, frac) {
    S.runText = text; S.runFrac = frac;
    var t = $("runText"), b = $("runBar");
    if (t) t.textContent = text;
    if (b) b.style.width = Math.round(frac * 100) + "%";
  }
  async function run() {
    if (S.running) { S.cancel = true; setRun("Stopt na dit bestand", S.runFrac || 0); return; }
    var jobs = todo();
    if (!jobs.length) return;
    S.running = true; S.cancel = false; S.runTotal = jobs.length; S.runDone = 0; S.runFrac = 0; S.runText = "Bezig";
    render();
    var doneN = 0, okN = 0, errN = 0;
    function step(f) { S.runDone = doneN; setRun("Bezig met " + f.file.name + " (" + (doneN + 1) + " van " + jobs.length + ")", doneN / jobs.length); }
    try {
      var kinds = activeKinds();
      for (var ki = 0; ki < kinds.length && !S.cancel; ki++) {
        var kind = kinds[ki], g = group(kind), files = filesOf(kind).filter(function (f) { return f.status !== "done"; });
        if (!files.length) continue;
        var opts = Object.assign({}, g.opts), merging = mergeOn(kind);
        if (g.target === "zip") {
          var all = filesOf(kind);
          all.forEach(function (f) { f.status = "busy"; f.busyText = "Wordt ingepakt"; f.progress = 0.5; refreshRow(f); });
          setRun("Bezig met inpakken", doneN / jobs.length);
          try {
            var zblob = await OZ.zip(all.map(function (f) { return { name: f.file.name, blob: f.file }; }));
            g.result = { name: (all.length === 1 ? OZ.base(all[0].file.name) : K_LABEL(kind)) + ".zip", blob: zblob, isZip: true };
            all.forEach(function (f) { f.status = "done"; f.merged = true; f.progress = 0; });
            okN += files.length;
          } catch (e) { all.forEach(function (f) { f.status = "error"; f.error = errorText(e); }); errN += files.length; }
          doneN += files.length;
          renderRows(kind); renderGroupResult(kind);
          continue;
        }
        if (merging) {
          var allM = filesOf(kind), blobs = [], bad = false;
          for (var mi = 0; mi < allM.length; mi++) {
            var fm = allM[mi];
            if (S.cancel) { bad = true; break; }
            step(fm);
            try {
              var mo = Object.assign({}, opts, { pdfMode: "range" }, kind === "image" ? { rf: g.rf, rfPer: fm.rf } : null);
              var res = await convertFile(fm, "pdf", mo);
              blobs.push(res[0].blob);
              fm.status = "done"; fm.merged = true; fm.results = null; okN++;
            } catch (e2) { fm.status = "error"; fm.error = errorText(e2); bad = true; errN++; }
            fm.progress = 0;
            if (files.indexOf(fm) >= 0) doneN++;
            refreshRow(fm);
          }
          if (!bad && blobs.length) {
            setRun("Pdf's worden samengevoegd", doneN / jobs.length);
            try {
              var merged = await OZ.conv.mergePdfs(blobs);
              g.result = { name: OZ.base(allM[0].file.name) + " en " + (allM.length - 1) + " meer.pdf", blob: merged, dims: "" };
              resultThumb(g.result, kind);
            } catch (e3) { allM.forEach(function (f) { f.status = "error"; f.error = errorText(e3); f.merged = false; }); }
          } else if (bad) {
            allM.forEach(function (f) { if (f.status === "done") { f.status = "idle"; f.merged = false; } });
            if (!S.cancel) toast("Samenvoegen is niet gelukt omdat een van de bestanden niet kon worden omgezet. Haal dat bestand weg en probeer het opnieuw.", true);
          }
          renderRows(kind); renderGroupResult(kind);
          continue;
        }
        for (var fi = 0; fi < files.length && !S.cancel; fi++) {
          var f = files[fi];
          step(f);
          try {
            f.results = await convertFile(f, g.target, kind === "image" ? Object.assign({}, opts, { rf: g.rf, rfPer: f.rf }) : opts);
            f.status = "done"; okN++;
            f.results.slice(0, 1).forEach(function (r) { resultThumb(r, f); });
          } catch (e4) { f.status = "error"; f.error = errorText(e4); errN++; }
          f.progress = 0; doneN++;
          refreshRow(f);
        }
      }
    } finally {
      S.files.forEach(function (f) { if (f.status === "busy") { f.status = "idle"; f.progress = 0; } });
      S.running = false;
      render();
      if (S.cancel) toast("Gestopt. Wat al klaar was, blijft staan.");
      else if (errN && !okN) toast(errN === 1 ? "Het omzetten is niet gelukt. Bij het bestand staat waarom." : "Het omzetten is niet gelukt. Bij elk bestand staat waarom.", true);
      else if (errN) toast(okN + " omgezet, " + errN + " mislukt. Bij die bestanden staat waarom.", true);
      S.cancel = false;
      if (okN && !errN && !S.cancel && OZ.confetti) OZ.confetti(document.querySelector(".out .thumb, .group-out .thumb") || $("go"));
      var firstOut = document.querySelector(".out, .group-out");
      if (firstOut && okN && firstOut.scrollIntoView) firstOut.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }
  function K_LABEL(kind) { return OZ.KINDS[kind].label.toLowerCase(); }

  /* ---------- opslaan ---------- */
  async function doSave(name, blobPromise, btn) {
    var label = btn ? btn.innerHTML : "";
    if (btn) { btn.disabled = true; }
    try {
      var blob = await blobPromise;
      var res = await OZ.saveFile(name, blob);
      if (res.ok) toast("Opgeslagen als " + res.name + ".");
      else if (res.code === "declined") toast("Niet opgeslagen.");
      else toast(res.message, true);
      return res;
    } catch (e) {
      toast("Opslaan is mislukt. Probeer het nog eens.", true);
      if (window.console) console.warn(e);
    } finally { if (btn) { btn.disabled = false; btn.innerHTML = label; } }
  }
  function saveOne(r, btn) { return doSave(r.name, Promise.resolve(r.blob), btn); }
  function saveBundle(f, btn) {
    return doSave(f.results.bundle.name, OZ.zip(f.results.map(function (r) { return { name: r.path || r.name, blob: r.blob }; })), btn);
  }
  function saveAll() {
    var outs = allOutputs();
    if (!outs.length) return;
    if (outs.length === 1) return saveOne(outs[0], $("saveAll"));
    var now = new Date(), stamp = now.getFullYear() + "-" + OZ.pad(now.getMonth() + 1, 2) + "-" + OZ.pad(now.getDate(), 2);
    return doSave("Omzetter " + stamp + " (" + outs.length + " bestanden).zip", OZ.zip(outs.map(function (r) { return { name: r.name, blob: r.blob }; })), $("saveAll"));
  }

  /* ---------- voorbeeld ---------- */
  var previewUrls = [], lastFocus = null;
  function closePreview() {
    $("scrim").hidden = true;
    $("sheetBody").textContent = ""; $("sheetFoot").textContent = "";
    previewUrls.forEach(function (u) { URL.revokeObjectURL(u); }); previewUrls = [];
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function tablePreview(rows, more) {
    var t = el("table", { class: "preview-table" });
    rows.forEach(function (r) { t.appendChild(el("tr", null, r.map(function (c) { return el("td", { text: c == null ? "" : typeof c === "object" && c.y ? OZ.table.fmtDate(c, "nl") : String(c) }); }))); });
    var wrap = el("div", null, [el("div", { class: "preview-table-wrap" }, [t])]);
    if (more) wrap.appendChild(el("p", { class: "hint", text: more }));
    return wrap;
  }
  async function previewContent(r) {
    var e = OZ.ext(r.name), url;
    if (/^(png|jpg|jpeg|webp|gif|bmp|svg|ico)$/.test(e)) {
      url = URL.createObjectURL(e === "svg" ? new Blob([r.blob], { type: "image/svg+xml" }) : r.blob); previewUrls.push(url);
      return el("img", { class: "preview-img", src: url, alt: "Voorbeeld van " + r.name });
    }
    if (e === "mp3" || e === "wav") {
      url = URL.createObjectURL(r.blob); previewUrls.push(url);
      return el("audio", { class: "preview-audio", controls: true, src: url });
    }
    if (e === "pdf") {
      var doc = await OZ.pdfOpen(r.blob);
      try {
        var page = await doc.getPage(1), vp = page.getViewport({ scale: 1 }), scale = Math.min(2, 1100 / vp.width);
        var v2 = page.getViewport({ scale: scale }), c = OZ.makeCanvas(v2.width, v2.height), g = c.getContext("2d");
        g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: g, viewport: v2 }).promise;
        c.className = "preview-img"; c.style.height = "auto"; c.style.width = "min(100%, " + Math.round(v2.width / 1.4) + "px)";
        return el("div", null, [c, el("p", { class: "hint", text: "Pagina 1 van " + doc.numPages + "." })]);
      } finally { doc.destroy(); }
    }
    if (e === "csv" || e === "tsv") {
      var text = await OZ.readText(r.blob.slice(0, 400000)), delim = e === "tsv" ? "\t" : OZ.table.detectDelimiter(text);
      var rows = OZ.table.parseCsv(text, delim).map(function (row) { return row.map(function (c) { return c && typeof c === "object" ? c.q : c; }); });
      return tablePreview(rows.slice(0, 60), rows.length > 60 ? "De eerste 60 rijen. Het bestand heeft er meer." : "");
    }
    if (e === "xlsx" || e === "xls" || e === "ods") {
      var src = await OZ.table.read(r.blob, e, {}), t0 = src.tables[0];
      return tablePreview(t0.rows.slice(0, 60), (src.tables.length > 1 ? "Blad 1 van " + src.tables.length + " (" + t0.name + "). " : "") + (t0.rows.length > 60 ? "De eerste 60 rijen." : ""));
    }
    if (e === "docx") {
      var d = await OZ.doc.read(r.blob, "docx"), body = OZ.doc.parse(d.html), box = el("div", { class: "preview-doc" });
      Array.prototype.slice.call(body.childNodes).forEach(function (n) { box.appendChild(document.importNode(n, true)); });
      return box;
    }
    var txt = await OZ.readText(r.blob.slice(0, 200000));
    return el("div", null, [el("pre", { class: "preview-text", text: txt }), r.blob.size > 200000 ? el("p", { class: "hint", text: "Dit is het begin. Het hele bestand is " + OZ.fmtSize(r.blob.size) + "." }) : null]);
  }
  async function openPreview(r) {
    lastFocus = document.activeElement;
    $("sheetTitle").textContent = r.name;
    var body = $("sheetBody"), foot = $("sheetFoot");
    body.textContent = ""; foot.textContent = "";
    body.appendChild(el("p", { class: "hint", text: "Voorbeeld wordt gemaakt" }));
    foot.appendChild(el("span", { class: "hint grow", text: OZ.fmtSize(r.blob.size) + (r.dims ? ", " + r.dims : "") }));
    foot.appendChild(el("button", { class: "btn btn-primary", type: "button", onclick: function (ev) { saveOne(r, ev.currentTarget); } }, [el("span", { html: OZ.icon("save") }), saveLabel(r.name)]));
    $("scrim").hidden = false;
    $("sheetClose").focus();
    try {
      var node = await previewContent(r);
      if ($("sheetTitle").textContent !== r.name) return;
      body.textContent = ""; body.appendChild(node);
    } catch (e) {
      body.textContent = "";
      body.appendChild(el("p", { text: "Van dit bestand kan hier geen voorbeeld worden getoond. Opslaan kan wel." }));
    }
  }

  /* ---------- gebeurtenissen ---------- */
  function hasFiles(ev) {
    var t = ev.dataTransfer && ev.dataTransfer.types;
    if (!t) return false;
    for (var i = 0; i < t.length; i++) if (t[i] === "Files") return true;
    return false;
  }
  function init() {
    var input = $("fileInput"), veil = $("dragveil"), depth = 0;
    var recipe = null;
    $("pick").addEventListener("click", function () { recipe = null; input.removeAttribute("accept"); input.click(); });
    $("recipeList").addEventListener("click", function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-recipe]");
      if (!b) return;
      recipe = OZ.RECIPES[+b.getAttribute("data-recipe")];
      input.setAttribute("accept", recipe.accept);
      input.click();
    });
    $("ratioList").addEventListener("click", function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-start-ratio]");
      if (!b) return;
      recipe = { kind: "image", ratio: b.getAttribute("data-start-ratio"), target: null, accept: "image/*,.heic,.heif" };
      input.setAttribute("accept", recipe.accept);
      input.click();
    });
    RF.sample().then(function (sm) { if (sm && typeof sm.json === "function") { hasClaude = true; if (S.files.length && !S.running) render(); } });
    input.addEventListener("cancel", function () { recipe = null; });
    input.addEventListener("change", function () {
      var r = recipe; recipe = null;
      if (r && r.scan && input.files && input.files.length) startScan(Array.prototype.slice.call(input.files));
      else if (input.files && input.files.length) {
        if (r && Array.prototype.some.call(input.files, function (f) { return OZ.detect(f).kind === r.kind; })) applyRecipe(r, input.files);
        addFiles(input.files);
      }
      input.value = ""; input.removeAttribute("accept");
    });
    $("go").addEventListener("click", run);
    $("saveAll").addEventListener("click", saveAll);
    $("clearAll").addEventListener("click", function () { if (S.running) return; S.files = []; S.groups = {}; render(); $("scroll").scrollTop = 0; $("pick").focus(); });
    $("sheetClose").addEventListener("click", closePreview);
    $("scrim").addEventListener("mousedown", function (ev) { if (ev.target === $("scrim")) closePreview(); });
    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !$("scrim").hidden) closePreview(); });
    window.addEventListener("dragenter", function (ev) { if (!hasFiles(ev) || S.running) return; ev.preventDefault(); depth++; veil.hidden = false; });
    window.addEventListener("dragover", function (ev) { if (hasFiles(ev)) { ev.preventDefault(); if (ev.dataTransfer) ev.dataTransfer.dropEffect = S.running ? "none" : "copy"; } });
    window.addEventListener("dragleave", function (ev) { if (!hasFiles(ev)) return; depth = Math.max(0, depth - 1); if (!depth) veil.hidden = true; });
    window.addEventListener("drop", function (ev) {
      if (!hasFiles(ev)) return;
      ev.preventDefault(); depth = 0; veil.hidden = true;
      if (S.running) { toast("Wacht tot het omzetten klaar is en voeg dan bestanden toe."); return; }
      if (ev.dataTransfer.files && ev.dataTransfer.files.length) addFiles(ev.dataTransfer.files);
    });
    document.addEventListener("paste", function (ev) {
      var cd = ev.clipboardData, tag = (ev.target && ev.target.tagName) || "";
      if (!cd || S.running) return;
      var files = [];
      if (cd.files && cd.files.length) files = Array.prototype.slice.call(cd.files);
      else if (cd.items) for (var i = 0; i < cd.items.length; i++) if (cd.items[i].kind === "file") { var fl = cd.items[i].getAsFile(); if (fl) files.push(fl); }
      var now = new Date(), stamp = OZ.pad(now.getHours(), 2) + "." + OZ.pad(now.getMinutes(), 2) + "." + OZ.pad(now.getSeconds(), 2);
      if (files.length) {
        ev.preventDefault();
        addFiles(files.map(function (f, i) {
          if (!/^image\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name) && f.name) return f;
          var e = OZ.ext(f.name) || (f.type.split("/")[1] || "png").replace("jpeg", "jpg");
          return new File([f], "Geplakt " + stamp + (files.length > 1 ? " (" + (i + 1) + ")" : "") + "." + e, { type: f.type, lastModified: Date.now() });
        }));
        toast(files.length === 1 ? "Geplakt bestand toegevoegd." : files.length + " geplakte bestanden toegevoegd.");
        return;
      }
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
      var text = cd.getData && cd.getData("text/plain");
      if (text && text.trim().length > 1) {
        ev.preventDefault();
        addFiles([new File([text], "Geplakte tekst " + stamp + ".txt", { type: "text/plain", lastModified: Date.now() })]);
        toast("Geplakte tekst toegevoegd als tekstbestand.");
      }
    });
    render();
    setTimeout(OZ.warmDownloads, 800);
  }
  OZ.ui = { addFiles: addFiles, state: S, run: run };
  init();
  window.__gestart = true;
  if (window.PWA) {
    window.PWA.takeShared().then(function (files) { if (files.length) addFiles(files); });
    window.PWA.onLaunch(function (files) { addFiles(files); });
    var sib = document.querySelector(".sibling a"); if (sib) sib.setAttribute("href", "../papierwerk/");
  }
})();
