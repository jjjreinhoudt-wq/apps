/* Omzetter — kleiner maken zonder om te zetten: de plaatjes in een pdf, Word-, PowerPoint-, ODT- of EPUB-bestand
   worden verkleind; tekst en opmaak blijven zoals ze zijn. */
(function () {
  "use strict";
  var OZ = window.OZ;
  var LEVELS = { licht: [2200, 0.85], normaal: [1600, 0.75], sterk: [1100, 0.6] };
  var STEPS = [[2200, 0.85], [1700, 0.76], [1300, 0.66], [1000, 0.56], [800, 0.46], [620, 0.36]];

  async function inflate(bytes) {
    if (window.pako) return window.pako.inflate(bytes);
    var ds = new DecompressionStream("deflate");
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
  }
  /* Eenvoudige Flate-plaatjes (8 bits, RGB of grijs, met of zonder PNG-voorspeller). Al het andere: null. */
  async function flateToBitmap(stream, dict, W, H) {
    var L = PDFLib, N = function (n) { return L.PDFName.of(n); }, ctx = dict.context;
    var look = function (v) { return v instanceof L.PDFRef ? ctx.lookup(v) : v; };
    var num = function (v, d) { v = look(v); return v instanceof L.PDFNumber ? v.asNumber() : d; };
    if (num(dict.get(N("BitsPerComponent")), 8) !== 8 || W * H > 36e6) return null;
    var cs = look(dict.get(N("ColorSpace"))), comps = 0;
    if (cs === N("DeviceRGB") || cs === N("CalRGB")) comps = 3;
    else if (cs === N("DeviceGray") || cs === N("CalGray")) comps = 1;
    else if (cs instanceof L.PDFArray && look(cs.get(0)) === N("ICCBased")) { var icc = look(cs.get(1)); comps = icc && icc.dict ? num(icc.dict.get(N("N")), 0) : 0; }
    if (comps !== 3 && comps !== 1) return null;
    var parms = look(dict.get(N("DecodeParms")));
    if (parms instanceof L.PDFArray) parms = look(parms.get(0));
    var pred = parms instanceof L.PDFDict ? num(parms.get(N("Predictor")), 1) : 1;
    if (pred !== 1 && pred < 10) return null;
    var raw = await inflate(stream.contents), rowLen = W * comps, px, x, y, i;
    if (pred >= 10) {
      if (raw.length < (rowLen + 1) * H) return null;
      px = new Uint8Array(rowLen * H);
      for (y = 0; y < H; y++) {
        var ft = raw[y * (rowLen + 1)], si = y * (rowLen + 1) + 1, di = y * rowLen, up = di - rowLen;
        for (i = 0; i < rowLen; i++) {
          var a = i >= comps ? px[di + i - comps] : 0, b = y ? px[up + i] : 0, c = (y && i >= comps) ? px[up + i - comps] : 0, v = raw[si + i], o;
          if (ft === 0) o = v; else if (ft === 1) o = v + a; else if (ft === 2) o = v + b; else if (ft === 3) o = v + ((a + b) >> 1);
          else { var p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); o = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
          px[di + i] = o & 255;
        }
      }
    } else { if (raw.length < rowLen * H) return null; px = raw; }
    var img = new ImageData(W, H), d = img.data, j;
    if (comps === 3) for (i = 0, j = 0; i < W * H; i++, j += 3) { d[i * 4] = px[j]; d[i * 4 + 1] = px[j + 1]; d[i * 4 + 2] = px[j + 2]; d[i * 4 + 3] = 255; }
    else for (i = 0; i < W * H; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = px[i]; d[i * 4 + 3] = 255; }
    return await createImageBitmap(img);
  }
  async function shrinkPdf(bytes, maxDim, q, progress) {
    var L = PDFLib, N = function (n) { return L.PDFName.of(n); }, doc;
    try { doc = await L.PDFDocument.load(bytes, { updateMetadata: false }); }
    catch (e) {
      if (/encrypt/i.test(String(e && e.message))) throw OZ.fail("Deze pdf is beveiligd en kan zo niet kleiner worden gemaakt. Sla hem eerst op zonder beveiliging.");
      throw OZ.fail("Deze pdf kan niet worden gelezen. Mogelijk is het bestand beschadigd.");
    }
    var objs = doc.context.enumerateIndirectObjects(), changed = 0, images = 0;
    for (var i = 0; i < objs.length; i++) {
      var ref = objs[i][0], obj = objs[i][1];
      if (!(obj instanceof L.PDFRawStream)) continue;
      var d = obj.dict;
      if (d.get(N("Subtype")) !== N("Image") || d.get(N("ImageMask")) === L.PDFBool.True || d.has(N("Mask"))) continue;
      var wv = d.get(N("Width")), hv = d.get(N("Height"));
      var W = wv instanceof L.PDFNumber ? wv.asNumber() : 0, H = hv instanceof L.PDFNumber ? hv.asNumber() : 0;
      if (!W || !H) continue;
      images++;
      var filter = d.get(N("Filter"));
      if (filter instanceof L.PDFArray) { if (filter.size() !== 1) continue; filter = filter.get(0); }
      if (Math.max(W, H) <= maxDim * 1.12 && obj.contents.length < 70000) continue;
      var bm = null;
      try {
        if (filter === N("DCTDecode")) bm = await createImageBitmap(new Blob([obj.contents], { type: "image/jpeg" }));
        else if (filter === N("FlateDecode")) bm = await flateToBitmap(obj, d, W, H);
      } catch (e2) { bm = null; }
      if (!bm) continue;
      var k = Math.min(1, maxDim / Math.max(W, H)), w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
      var c = document.createElement("canvas");
      c.width = w; c.height = h;
      var x = c.getContext("2d");
      x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.imageSmoothingQuality = "high"; x.drawImage(bm, 0, 0, w, h);
      if (bm.close) bm.close();
      var blob = await OZ.canvasBlob(c, "image/jpeg", q);
      c.width = c.height = 0;
      if (!blob || blob.size > obj.contents.length * 0.9) continue;
      var nd = d.clone(doc.context);
      nd.set(N("Width"), L.PDFNumber.of(w)); nd.set(N("Height"), L.PDFNumber.of(h));
      nd.set(N("Filter"), N("DCTDecode")); nd.set(N("ColorSpace"), N("DeviceRGB")); nd.set(N("BitsPerComponent"), L.PDFNumber.of(8));
      nd.delete(N("DecodeParms")); nd.delete(N("Decode")); nd.delete(N("Length"));
      doc.context.assign(ref, L.PDFRawStream.of(nd, new Uint8Array(await blob.arrayBuffer())));
      changed++;
      if (progress) progress(i / objs.length);
      if (changed % 3 === 0) await OZ.tick();
    }
    return { bytes: await doc.save({ useObjectStreams: true }), changed: changed, images: images };
  }
  function goalBytes(v) { var n = parseFloat(String(v || "").replace(",", ".")); return n > 0 ? n * 1048576 : 0; }

  var pdfOrig = OZ.conv.pdf;
  OZ.conv.pdf = async function (file, ext, target, opts, ctx) {
    if (target !== "klein") return pdfOrig.apply(this, arguments);
    opts = opts || {};
    var bytes = new Uint8Array(await file.arrayBuffer()), goal = goalBytes(opts.kleinMax);
    var steps = goal ? STEPS : [LEVELS[opts.kleinNiveau] || LEVELS.normaal], best = null, images = 0;
    for (var i = 0; i < steps.length; i++) {
      var r = await shrinkPdf(bytes, steps[i][0], steps[i][1], function (p) { if (ctx && ctx.progress) ctx.progress((i + p) / steps.length); });
      images = r.images;
      if (!best || r.bytes.length < best.length) best = r.bytes;
      if (!images || (goal && best.length <= goal)) break;
      if (ctx && ctx.cancelled && ctx.cancelled()) break;
    }
    if (!images) throw OZ.fail("In deze pdf zitten geen foto's of plaatjes om kleiner te maken; de tekst zelf is al compact.");
    if (best.length >= bytes.length * 0.97) throw OZ.fail("Deze pdf is al zo compact als het kan. Kleiner maken levert niets op.");
    var out = { name: OZ.base(file.name) + " (klein).pdf", blob: new Blob([best], { type: "application/pdf" }) };
    if (goal && best.length > goal) out.note = "Onder de " + OZ.fmtSize(goal) + " lukt niet zonder de tekst plat te slaan. Dit is het kleinste resultaat waarbij de tekst tekst blijft.";
    return [out];
  };

  var docOrig = OZ.conv.doc;
  OZ.conv.doc = async function (file, ext, target, opts, ctx) {
    if (target !== "klein") return docOrig.apply(this, arguments);
    opts = opts || {};
    if (!/^(docx|docm|pptx|odt|epub)$/.test(ext)) throw OZ.fail("Kleiner maken werkt voor Word (.docx), PowerPoint (.pptx), ODT en EPUB. In een ." + ext + "-bestand zitten geen foto's om te verkleinen.");
    var zip;
    try { zip = await JSZip.loadAsync(await file.arrayBuffer()); }
    catch (e) { throw OZ.fail("Dit bestand kan niet worden gelezen. Mogelijk is het beschadigd of met een wachtwoord beveiligd."); }
    var lvl = LEVELS[opts.kleinNiveau] || LEVELS.normaal, changed = 0;
    var names = Object.keys(zip.files).filter(function (n) { return !zip.files[n].dir && /\.(jpe?g|png)$/i.test(n); });
    for (var i = 0; i < names.length; i++) {
      if (ctx && ctx.progress) ctx.progress(i / names.length);
      var n = names[i], u8 = await zip.file(n).async("uint8array");
      if (u8.length < 40000) continue;
      var isPng = /\.png$/i.test(n), bm = null;
      try { bm = await createImageBitmap(new Blob([u8], { type: isPng ? "image/png" : "image/jpeg" })); } catch (e2) { bm = null; }
      if (!bm) continue;
      var k = Math.min(1, lvl[0] / Math.max(bm.width, bm.height)), w = Math.max(1, Math.round(bm.width * k)), h = Math.max(1, Math.round(bm.height * k));
      var c = document.createElement("canvas");
      c.width = w; c.height = h;
      var x = c.getContext("2d");
      if (!isPng) { x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); }
      x.imageSmoothingQuality = "high"; x.drawImage(bm, 0, 0, w, h);
      if (bm.close) bm.close();
      var blob = await OZ.canvasBlob(c, isPng ? "image/png" : "image/jpeg", lvl[1]);
      c.width = c.height = 0;
      if (blob && blob.size < u8.length * 0.9) { zip.file(n, await blob.arrayBuffer(), { binary: true, createFolders: false }); changed++; }
      await OZ.tick();
    }
    if (!changed) throw OZ.fail("In dit bestand zitten geen grote foto's om kleiner te maken. Het is al compact.");
    if (zip.file("mimetype")) zip.file("mimetype", await zip.file("mimetype").async("string"), { compression: "STORE", createFolders: false });   // odt/epub: eerst en onverpakt
    var outBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 }, mimeType: file.type || "application/octet-stream" });
    if (outBlob.size >= file.size * 0.97) throw OZ.fail("Dit bestand is al zo compact als het kan. Kleiner maken levert niets op.");
    return [{ name: OZ.base(file.name) + " (klein)." + ext, blob: outBlob, note: changed + (changed === 1 ? " foto verkleind" : " foto's verkleind") + ". Tekst en opmaak zijn niet aangeraakt." }];
  };

  /* ---------- papiersnippers als een ronde klaar is ---------- */
  OZ.confetti = function (originEl) {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var c = document.createElement("canvas"), W = window.innerWidth, H = window.innerHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = W * dpr; c.height = H * dpr;
    c.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:150";
    c.setAttribute("aria-hidden", "true");
    document.body.appendChild(c);
    var x = c.getContext("2d"), r0 = originEl && originEl.getBoundingClientRect ? originEl.getBoundingClientRect() : null;
    var ox = r0 ? clamp(r0.left + r0.width / 2, 40, W - 40) : W / 2, oy = r0 ? clamp(r0.top + r0.height / 2, 60, H - 60) : H * 0.6;
    function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
    var cols = ["#FFDD3C", "#1F4FD1", "#FFFFFF", "#17202B", "#FFDD3C", "#CBD1D9"], ps = [];
    for (var i = 0; i < 70; i++) {
      var a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = 5 + Math.random() * 9;
      ps.push({ x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3, w: 5 + Math.random() * 7, h: 7 + Math.random() * 9, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.5, c: cols[i % cols.length] });
    }
    var t0 = performance.now();
    (function frame(t) {
      var k = (t - t0) / 1700;
      x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
      if (k >= 1) { c.remove(); return; }
      x.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
      for (var j = 0; j < ps.length; j++) {
        var p = ps[j];
        p.vy += 0.32; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.scale(1, Math.cos(p.r * 2.3));
        x.fillStyle = p.c; x.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        x.strokeStyle = "rgba(23,32,43,.25)"; x.lineWidth = 0.6; x.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h);
        x.restore();
      }
      requestAnimationFrame(frame);
    })(t0);
  };
  /* Teller die terugloopt van de oude naar de nieuwe grootte. */
  OZ.countDown = function (node, from, to) {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) { node.textContent = OZ.fmtSize(to); return; }
    var t0 = performance.now();
    (function step(t) {
      var k = Math.min(1, (t - t0) / 950), e = 1 - Math.pow(1 - k, 3);
      node.textContent = OZ.fmtSize(Math.round(from - (from - to) * e));
      if (k < 1 && node.isConnected !== false) requestAnimationFrame(step); else node.textContent = OZ.fmtSize(to);
    })(t0);
  };
})();
