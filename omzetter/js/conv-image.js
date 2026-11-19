/* Omzetter — afbeeldingen. Lezen via de browser (plus UTIF voor TIFF en heic2any voor HEIC),
   schrijven via canvas of een eigen schrijver (BMP, ICO, GIF, TIFF, SVG, PDF). */
(function () {
  "use strict";
  var OZ = window.OZ;

  var IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var MAX_AREA = IS_IOS ? 16000000 : 120000000;
  var MAX_SIDE = IS_IOS ? 4096 * 2 : 16000;

  function svgSize(text) {
    var doc = new DOMParser().parseFromString(text, "image/svg+xml");
    var el = doc.documentElement;
    if (!el || el.nodeName.toLowerCase() !== "svg") throw OZ.fail("Dit is geen geldig SVG-bestand.");
    function len(v) {
      var m = /^\s*([\d.]+)\s*(px|pt|mm|cm|in)?\s*$/.exec(v || "");
      if (!m) return 0;
      var f = { px: 1, pt: 96 / 72, mm: 96 / 25.4, cm: 96 / 2.54, "in": 96 }[m[2] || "px"];
      return parseFloat(m[1]) * f;
    }
    var w = len(el.getAttribute("width")), h = len(el.getAttribute("height"));
    var vb = (el.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
    if ((!w || !h) && vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
      if (w && !h) h = w * vb[3] / vb[2];
      else if (h && !w) w = h * vb[2] / vb[3];
      else { w = vb[2]; h = vb[3]; }
    }
    if (!w || !h) { w = 512; h = 512; }
    /* Zonder vaste maat tekent een browser een SVG soms op 0 bij 0. Zet de maat er dus altijd op. */
    el.setAttribute("width", w); el.setAttribute("height", h);
    if (!el.getAttribute("xmlns")) el.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    return { w: w, h: h, text: new XMLSerializer().serializeToString(doc) };
  }

  /* Geeft {src (tekenbaar), w, h, release()}. */
  async function decode(file, ext) {
    if (ext === "tif" || ext === "tiff") {
      var buf = await file.arrayBuffer(), ifds;
      try { ifds = UTIF.decode(buf); } catch (e) { throw OZ.fail("Dit TIFF-bestand kan niet worden gelezen."); }
      var best = null;
      ifds.forEach(function (d) {
        var w = d.t256 && d.t256[0], h = d.t257 && d.t257[0];
        if (w && h && (!best || w * h > best.a)) best = { d: d, a: w * h };
      });
      if (!best) throw OZ.fail("In dit TIFF-bestand zit geen afbeelding.");
      try { UTIF.decodeImage(buf, best.d, ifds); } catch (e2) { throw OZ.fail("Deze TIFF gebruikt een compressie die hier niet wordt ondersteund."); }
      var rgba = UTIF.toRGBA8(best.d);
      var c = OZ.makeCanvas(best.d.width, best.d.height);
      var id = new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), best.d.width, best.d.height);
      c.getContext("2d").putImageData(id, 0, 0);
      return { src: c, w: c.width, h: c.height, release: function () {} };
    }
    var blob = file;
    if (ext === "svg") {
      var s = svgSize(await OZ.readText(file));
      var L = await OZ.loadImg(new Blob([s.text], { type: "image/svg+xml" }));
      return { src: L.img, w: s.w, h: s.h, vector: true, release: L.release };
    }
    if (ext === "heic" || ext === "heif") {
      try {
        var nat = await OZ.loadImg(file);     /* Safari leest HEIC zelf */
        if (nat.img.naturalWidth) return { src: nat.img, w: nat.img.naturalWidth, h: nat.img.naturalHeight, release: nat.release };
      } catch (e3) { /* dan via heic2any */ }
      try {
        var out = await heic2any({ blob: file, toType: "image/png" });
        blob = Array.isArray(out) ? out[0] : out;
      } catch (e4) {
        throw OZ.fail("Deze HEIC-foto kan niet worden gelezen. Mogelijk is het bestand beschadigd of gebruikt het een nieuwere variant.");
      }
    }
    var mime = { ico: "image/x-icon", bmp: "image/bmp", avif: "image/avif", jfif: "image/jpeg" }[ext];
    if (mime && blob === file && file.type !== mime) blob = new Blob([file], { type: mime });
    var R;
    try { R = await OZ.loadImg(blob); }
    catch (e5) {
      if (ext === "avif") throw OZ.fail("Deze browser kan geen AVIF lezen. Werk de browser bij of gebruik een ander apparaat.");
      throw e5;
    }
    if (!R.img.naturalWidth) { R.release(); throw OZ.fail("De afbeelding heeft geen afmetingen en kan niet worden omgezet."); }
    return { src: R.img, w: R.img.naturalWidth, h: R.img.naturalHeight, release: R.release };
  }

  /* Tekent de bron op een canvas: vierkant uitsnijden, draaien, maximale maat, achtergrondkleur. */
  function render(d, opts, fillBg) {
    var sx = 0, sy = 0, sw = d.w, sh = d.h, mw = +opts.maxW || 0, mh = +opts.maxH || 0, s = 1;
    if (opts.square && sw !== sh) { var side = Math.min(sw, sh); sx = (sw - side) / 2; sy = (sh - side) / 2; sw = sh = side; }
    var rot = ((+opts.rotate || 0) % 360 + 360) % 360, quarter = rot === 90 || rot === 270;
    var w = quarter ? sh : sw, h = quarter ? sw : sh;          /* maat na draaien */
    if (mw || mh) {
      s = Math.min(mw ? mw / w : Infinity, mh ? mh / h : Infinity);
      if (!d.vector) s = Math.min(1, s);            /* rasters alleen verkleinen */
    }
    if (w * s > MAX_SIDE || h * s > MAX_SIDE) s = Math.min(MAX_SIDE / w, MAX_SIDE / h);
    if (w * s * h * s > MAX_AREA) s = Math.sqrt(MAX_AREA / (w * h));
    var c = OZ.makeCanvas(w * s, h * s), g = c.getContext("2d");
    if (fillBg) { g.fillStyle = opts.bg || "#ffffff"; g.fillRect(0, 0, c.width, c.height); }
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.translate(c.width / 2, c.height / 2);
    if (rot) g.rotate(rot * Math.PI / 180);
    var dw = quarter ? c.height : c.width, dh = quarter ? c.width : c.height;
    if (d.vector && !opts.square) g.drawImage(d.src, -dw / 2, -dh / 2, dw, dh);
    else g.drawImage(d.src, sx * (d.natScale || 1), sy * (d.natScale || 1), sw * (d.natScale || 1), sh * (d.natScale || 1), -dw / 2, -dh / 2, dw, dh);
    g.setTransform(1, 0, 0, 1, 0, 0);
    c._scaled = s < 1 && !(mw || mh);
    return c;
  }

  /* JPG of WEBP onder een maximale bestandsgrootte krijgen: eerst kwaliteit zoeken, dan zo nodig verkleinen. */
  async function encodeLimited(canvas, mime, quality, maxBytes) {
    var blob = await OZ.canvasBlob(canvas, mime, quality), used = quality, c = canvas;
    if (!maxBytes || blob.size <= maxBytes) return { blob: blob, quality: used, canvas: c };
    for (var round = 0; round < 6; round++) {
      var lo = 0.3, hi = Math.min(quality, 0.95), best = null;
      for (var i = 0; i < 6; i++) {
        var q = (lo + hi) / 2, b = await OZ.canvasBlob(c, mime, q);
        if (b.size <= maxBytes) { best = { blob: b, quality: q, canvas: c }; lo = q; } else hi = q;
      }
      if (best) return best;
      var low = await OZ.canvasBlob(c, mime, 0.3);
      if (low.size <= maxBytes) return { blob: low, quality: 0.3, canvas: c };
      var k = Math.max(0.4, Math.min(0.85, Math.sqrt(maxBytes / low.size) * 0.95));
      var c2 = OZ.makeCanvas(c.width * k, c.height * k), g = c2.getContext("2d");
      g.imageSmoothingQuality = "high"; g.drawImage(c, 0, 0, c2.width, c2.height);
      c = c2;
      if (c.width < 32 || c.height < 32) break;
    }
    throw OZ.fail("De afbeelding past niet binnen de gevraagde bestandsgrootte. Kies een hogere grens of een kleinere maximale maat.");
  }

  function bmpBlob(canvas) {
    var w = canvas.width, h = canvas.height, px = canvas.getContext("2d").getImageData(0, 0, w, h).data;
    var rowLen = (w * 3 + 3) & ~3, size = 54 + rowLen * h;
    var buf = new ArrayBuffer(size), v = new DataView(buf), o = new Uint8Array(buf);
    o[0] = 0x42; o[1] = 0x4d; v.setUint32(2, size, true); v.setUint32(10, 54, true);
    v.setUint32(14, 40, true); v.setInt32(18, w, true); v.setInt32(22, h, true);
    v.setUint16(26, 1, true); v.setUint16(28, 24, true); v.setUint32(34, rowLen * h, true);
    v.setInt32(38, 2835, true); v.setInt32(42, 2835, true);
    for (var y = 0; y < h; y++) {
      var p = 54 + (h - 1 - y) * rowLen, q = y * w * 4;
      for (var x = 0; x < w; x++, q += 4) { o[p++] = px[q + 2]; o[p++] = px[q + 1]; o[p++] = px[q]; }
    }
    return new Blob([buf], { type: "image/bmp" });
  }

  async function icoBlob(d, opts) {
    var sizes = [16, 32, 48, 64, 128, 256].filter(function (s) { return s <= Math.max(48, Math.max(d.w, d.h)) || d.vector; });
    var pngs = [];
    for (var i = 0; i < sizes.length; i++) {
      var s = sizes[i], c = OZ.makeCanvas(s, s), g = c.getContext("2d");
      if (!opts.keepAlpha) { g.fillStyle = opts.bg || "#ffffff"; g.fillRect(0, 0, s, s); }
      var k = Math.min(s / d.w, s / d.h), w = d.w * k, h = d.h * k;
      g.imageSmoothingQuality = "high";
      g.drawImage(d.src, (s - w) / 2, (s - h) / 2, w, h);
      pngs.push(new Uint8Array(await (await OZ.canvasBlob(c, "image/png")).arrayBuffer()));
    }
    var head = new ArrayBuffer(6 + 16 * pngs.length), v = new DataView(head), off = head.byteLength;
    v.setUint16(2, 1, true); v.setUint16(4, pngs.length, true);
    pngs.forEach(function (p, j) {
      var b = 6 + 16 * j, s2 = sizes[j];
      v.setUint8(b, s2 === 256 ? 0 : s2); v.setUint8(b + 1, s2 === 256 ? 0 : s2);
      v.setUint16(b + 4, 1, true); v.setUint16(b + 6, 32, true);
      v.setUint32(b + 8, p.length, true); v.setUint32(b + 12, off, true);
      off += p.length;
    });
    return new Blob([head].concat(pngs), { type: "image/x-icon" });
  }

  function gifBlob(canvas, alpha) {
    var w = canvas.width, h = canvas.height, data = canvas.getContext("2d").getImageData(0, 0, w, h).data;
    var fmt = alpha ? "rgba4444" : "rgb565";
    var palette = gifenc.quantize(data, 256, { format: fmt, oneBitAlpha: alpha });
    var index = gifenc.applyPalette(data, palette, fmt);
    var ti = -1;
    if (alpha) for (var i = 0; i < palette.length; i++) if (palette[i].length > 3 && palette[i][3] === 0) { ti = i; break; }
    var enc = gifenc.GIFEncoder();
    enc.writeFrame(index, w, h, { palette: palette, transparent: ti >= 0, transparentIndex: ti >= 0 ? ti : 0 });
    enc.finish();
    return new Blob([enc.bytes()], { type: "image/gif" });
  }

  function hasAlpha(canvas) {
    var w = canvas.width, h = canvas.height, step = Math.max(1, Math.floor(Math.sqrt(w * h / 400000)));
    var data = canvas.getContext("2d").getImageData(0, 0, w, h).data;
    for (var y = 0; y < h; y += step) for (var x = 0; x < w; x += step) if (data[(y * w + x) * 4 + 3] < 250) return true;
    return false;
  }

  var LOSSLESS_SRC = { png: 1, gif: 1, svg: 1, ico: 1, bmp: 1 };

  /* Andere verhouding: eerst draaien, dan het nieuwe kader maken. Geeft een nieuwe tekenbare bron terug,
     plus de opties die daarna nog gelden (draaien en vierkant zijn dan al gedaan). */
  function staged(d, opts) {
    var R = OZ.reframe;
    if (!R || !R.active(opts.rf)) return { d: d, opts: opts };
    var c0 = render(d, d.vector ? { rotate: opts.rotate, maxW: 2400, maxH: 2400 } : { rotate: opts.rotate }, false);
    var size = R.outputSize(opts.rf, c0.width, c0.height), k = 1;
    if (size.w * size.h > MAX_AREA) k = Math.sqrt(MAX_AREA / (size.w * size.h));
    if (size.w * k > MAX_SIDE || size.h * k > MAX_SIDE) k = Math.min(MAX_SIDE / size.w, MAX_SIDE / size.h);
    var rc = R.render(c0, c0.width, c0.height, opts.rf, opts.rfPer || {}, k);
    var o = {}; for (var key in opts) o[key] = opts[key];
    o.rotate = 0; o.square = false;
    return { d: { src: rc, w: rc.width, h: rc.height, release: function () {} }, opts: o, reframed: true };
  }
  OZ.conv._renderImage = render;

  /* Zet één afbeelding op een nieuwe pagina van een pdf-lib document. */
  async function addPdfPage(pdf, file, ext, opts) {
    var page, emb, w, h;
    /* Altijd via het canvas: dan staat een telefoonfoto rechtop en zijn de verborgen gegevens (EXIF) weg. */
    {
      var d = await decode(file, ext);
      try {
        var st = staged(d, opts); opts = st.opts;
        if (st.reframed) d = { src: st.d.src, w: st.d.w, h: st.d.h, release: d.release };
        if (LOSSLESS_SRC[ext]) {
          var c = render(d, opts, !opts.keepAlpha);
          emb = await pdf.embedPng(await (await OZ.canvasBlob(c, "image/png")).arrayBuffer());
        } else {
          var c2 = render(d, opts, true);
          var lim = await encodeLimited(c2, "image/jpeg", (+opts.quality || 90) / 100, (+opts.maxKb || 0) * 1000);
          emb = await pdf.embedJpg(await lim.blob.arrayBuffer());
        }
      } finally { d.release(); }
    }
    w = emb.width; h = emb.height;
    if (opts.pdfPage === "fit") {
      var k0 = 72 / 96;                       /* schermpixels naar punten */
      page = pdf.addPage([w * k0, h * k0]);
      page.drawImage(emb, { x: 0, y: 0, width: w * k0, height: h * k0 });
    } else {
      var A = w > h ? [841.89, 595.28] : [595.28, 841.89], m = 28;
      page = pdf.addPage(A);
      var k = Math.min((A[0] - 2 * m) / w, (A[1] - 2 * m) / h);
      page.drawImage(emb, { x: (A[0] - w * k) / 2, y: (A[1] - h * k) / 2, width: w * k, height: h * k });
    }
  }

  OZ.conv.imagesToPdf = async function (items, opts, ctx) {
    var pdf = await PDFLib.PDFDocument.create();
    for (var i = 0; i < items.length; i++) {
      if (ctx && ctx.step) ctx.step(i, items.length, items[i].file.name);
      await addPdfPage(pdf, items[i].file, items[i].ext, opts);
      await OZ.tick();
    }
    return new Blob([await pdf.save()], { type: "application/pdf" });
  };

  OZ.conv.image = async function (file, ext, target, opts) {
    var base = OZ.base(file.name);
    if (target === "pdf") {
      return [{ name: base + ".pdf", blob: await OZ.conv.imagesToPdf([{ file: file, ext: ext }], opts) }];
    }
    var d = await decode(file, ext), blob, note = "", dims = "";
    try {
      var st = staged(d, opts); opts = st.opts;
      if (st.reframed) d = { src: st.d.src, w: st.d.w, h: st.d.h, release: d.release };
      if (target === "ico") {
        var c0 = render(d, { rotate: opts.rotate, square: opts.square }, false);
        blob = await icoBlob({ src: c0, w: c0.width, h: c0.height, vector: d.vector }, opts);
      } else {
        var opaque = target === "jpg" || target === "bmp" || !opts.keepAlpha;
        var c = render(d, opts, opaque);
        if (c._scaled) note = "Verkleind naar " + c.width + " bij " + c.height + " pixels, de grootste maat die dit apparaat aankan.";
        if (target === "png") blob = await OZ.canvasBlob(c, "image/png");
        else if (target === "jpg" || target === "webp") {
          var mime = target === "jpg" ? "image/jpeg" : "image/webp", q0 = (+opts.quality || 90) / 100;
          var probe = target === "webp" ? await OZ.canvasBlob(c, mime, q0) : null;
          if (probe && probe.type !== "image/webp") throw OZ.fail("Deze browser kan geen WEBP maken. Kies PNG of JPG, of gebruik Chrome, Edge of Firefox.");
          var lim = await encodeLimited(c, mime, q0, (+opts.maxKb || 0) * 1000);
          blob = lim.blob;
          if (+opts.maxKb && (lim.quality < q0 - 0.005 || lim.canvas !== c)) note = "Onder " + opts.maxKb + " kB gebracht met kwaliteit " + Math.round(lim.quality * 100) + "%" + (lim.canvas !== c ? " en verkleind naar " + lim.canvas.width + " bij " + lim.canvas.height + " pixels" : "") + ".";
          c = lim.canvas;
        }
        else if (target === "bmp") blob = bmpBlob(c);
        else if (target === "gif") blob = gifBlob(c, !opaque && hasAlpha(c));
        else if (target === "tiff") {
          var px = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
          blob = new Blob([UTIF.encodeImage(px.buffer, c.width, c.height)], { type: "image/tiff" });
        }
        else if (target === "svg") {
          var png = await OZ.canvasBlob(c, "image/png");
          var b64 = OZ.bytesToB64(new Uint8Array(await png.arrayBuffer()));
          var svg = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + c.width + '" height="' + c.height + '" viewBox="0 0 ' + c.width + " " + c.height + '">\n<image width="' + c.width + '" height="' + c.height + '" xlink:href="data:image/png;base64,' + b64 + '"/>\n</svg>\n';
          blob = new Blob([svg], { type: "image/svg+xml" });
          note = "Dit SVG-bestand bevat de afbeelding als pixels; het wordt er niet scherper van bij vergroten.";
        }
        else throw OZ.fail("Dit doelformaat wordt voor afbeeldingen niet ondersteund.");
        dims = c.width + " \u00d7 " + c.height;
      }
    } finally { d.release(); }
    return [{ name: base + "." + OZ.TARGETS[target].ext, blob: blob, note: note, dims: dims }];
  };

  OZ.conv._decodeImage = decode;
})();
