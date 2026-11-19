/* Omzetter — pdf lezen met pdf.js (beeld en tekst) en knippen/samenvoegen met pdf-lib. */
(function () {
  "use strict";
  var OZ = window.OZ, D = OZ.doc;
  var IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  function setup() {
    if (window.pdfjsLib && !pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = "lib/pdf.worker.min.js";
  }
  async function open(file) {
    setup();
    try {
      return await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true }).promise;
    } catch (e) {
      if (e && e.name === "PasswordException") throw OZ.fail("Deze pdf is met een wachtwoord beveiligd. Sla hem eerst op zonder wachtwoord en kies hem daarna opnieuw.");
      throw OZ.fail("Deze pdf kan niet worden gelezen. Mogelijk is het bestand beschadigd.");
    }
  }
  OZ.pdfOpen = open;

  /* "1-3, 5, 8-" -> [1,2,3,5,8,...]. Leeg = alle pagina's. */
  OZ.parsePages = function (spec, total) {
    spec = String(spec || "").trim();
    var out = [], seen = {}, i;
    if (!spec) { for (i = 1; i <= total; i++) out.push(i); return out; }
    spec.split(/[,;\s]+/).forEach(function (part) {
      if (!part) return;
      var m = /^(\d*)\s*(?:-|–|t\/m|tot)\s*(\d*)$/i.exec(part), a, b;
      if (m) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : total; }
      else if (/^\d+$/.test(part)) a = b = +part;
      else throw OZ.fail('De paginakeuze "' + spec + '" is niet te lezen. Schrijf bijvoorbeeld 1-3, 5.');
      if (a > b) { var t = a; a = b; b = t; }
      for (var p = Math.max(1, a); p <= Math.min(total, b); p++) if (!seen[p]) { seen[p] = 1; out.push(p); }
    });
    if (!out.length) throw OZ.fail("De gekozen pagina's bestaan niet: deze pdf heeft " + total + (total === 1 ? " pagina." : " pagina's."));
    return out;
  };

  async function renderPage(page, scale, bg) {
    var vp = page.getViewport({ scale: scale }), maxArea = IS_IOS ? 16000000 : 60000000;
    if (vp.width * vp.height > maxArea) vp = page.getViewport({ scale: scale * Math.sqrt(maxArea / (vp.width * vp.height)) });
    var c = OZ.makeCanvas(vp.width, vp.height), g = c.getContext("2d");
    g.fillStyle = bg || "#ffffff"; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    return c;
  }
  OZ.pdfThumb = async function (file, size) {
    var doc = await open(file);
    try {
      var page = await doc.getPage(1), vp = page.getViewport({ scale: 1 });
      var c = await renderPage(page, Math.min(size / vp.width, size / vp.height) * 1.0);
      return { canvas: c, pages: doc.numPages };
    } finally { doc.destroy(); }
  };

  /* Tekstregels van één pagina, in leesvolgorde. */
  async function pageLines(page) {
    var tc = await page.getTextContent(), lines = [], cur = null;
    tc.items.forEach(function (it) {
      if (it.str === undefined) return;
      var x = it.transform[4], y = it.transform[5], h = it.height || Math.abs(it.transform[3]) || 10;
      if (!it.str && !it.hasEOL) return;
      if (cur && Math.abs(y - cur.y) <= Math.max(2, Math.min(h, cur.size) * 0.45)) cur.items.push({ x: x, w: it.width, s: it.str, h: h });
      else { if (cur) lines.push(cur); cur = { y: y, size: h, items: [{ x: x, w: it.width, s: it.str, h: h }] }; }
      if (h > cur.size && it.str.trim()) cur.size = h;
    });
    if (cur) lines.push(cur);
    return lines.map(function (ln) {
      ln.items.sort(function (a, b) { return a.x - b.x; });
      var text = "", end = null;
      ln.items.forEach(function (it) {
        if (end != null && it.s) {
          var gap = it.x - end;
          if (gap > it.h * 3) text += "\t";
          else if (gap > it.h * 0.18 && !/\s$/.test(text) && !/^\s/.test(it.s)) text += " ";
        }
        text += it.s;
        if (it.s) end = it.x + it.w;
      });
      return { text: text.replace(/[ \u00a0]+/g, " ").replace(/ ?\t ?/g, "\t").trim(), y: ln.y, size: ln.size, x: ln.items[0].x };
    }).filter(function (l) { return l.text; });
  }

  async function extract(doc, pages, ctx) {
    var out = [], any = false;
    for (var i = 0; i < pages.length; i++) {
      if (ctx && ctx.progress) ctx.progress(i / pages.length);
      var page = await doc.getPage(pages[i]), lines = await pageLines(page);
      if (lines.length) any = true;
      out.push({ n: pages[i], lines: lines });
      page.cleanup();
    }
    if (!any) throw OZ.fail("In deze pdf staat geen tekst. Waarschijnlijk is het een scan of foto; tekst herkennen (OCR) kan deze app niet. Omzetten naar PNG of JPG kan wel.");
    return out;
  }
  function toPlain(pagesData) {
    return pagesData.map(function (p) {
      var t = "", prev = null;
      p.lines.forEach(function (l) {
        if (prev) t += (prev.y - l.y > Math.max(prev.size, l.size) * 1.9 ? "\n\n" : "\n");
        t += l.text.replace(/\t/g, "    ");
        prev = l;
      });
      return t;
    }).join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }
  function toHtml(pagesData) {
    var sizes = {}, bodySize = 10, best = 0, E = OZ.escHtml;
    pagesData.forEach(function (p) { p.lines.forEach(function (l) { var k = Math.round(l.size * 2) / 2; sizes[k] = (sizes[k] || 0) + l.text.length; }); });
    Object.keys(sizes).forEach(function (k) { if (sizes[k] > best) { best = sizes[k]; bodySize = +k; } });
    var html = "";
    pagesData.forEach(function (p) {
      var para = null, prev = null;
      function flush() { if (para) html += "<" + para.tag + ">" + para.text + "</" + para.tag + ">\n"; para = null; }
      p.lines.forEach(function (l) {
        var tag = l.size >= bodySize * 1.6 ? "h1" : l.size >= bodySize * 1.28 ? "h2" : l.size >= bodySize * 1.12 && l.text.length < 90 ? "h3" : "p";
        var gap = prev ? prev.y - l.y : 0, t = E(l.text.replace(/\t/g, "  "));
        var joins = para && para.tag === tag && gap > 0 && gap <= Math.max(prev.size, l.size) * 1.75 && Math.abs(prev.size - l.size) < 0.6;
        if (joins) {
          if (tag === "p" && /[A-Za-zÀ-ſ]-$/.test(para.raw) && /^[a-zß-ÿ]/.test(l.text)) para.text = para.text.slice(0, -1) + t;
          else if (/\t/.test(l.text) || /\t/.test(para.raw)) para.text += "<br>" + t;
          else para.text += " " + t;
          para.raw = l.text;
        } else { flush(); para = { tag: tag, text: t, raw: l.text }; }
        prev = l;
      });
      flush();
    });
    return html;
  }

  OZ.conv.pdf = async function (file, ext, target, opts, ctx) {
    opts = opts || {};
    var base = OZ.base(file.name);
    if (target === "pdf") return splitPdf(file, base, opts);
    var doc = await open(file);
    try {
      var pages = OZ.parsePages(opts.pages, doc.numPages), outs = [];
      if (target === "png" || target === "jpg") {
        var scale = (+opts.dpi || 150) / 72, digits = String(doc.numPages).length;
        for (var i = 0; i < pages.length; i++) {
          if (ctx && ctx.progress) ctx.progress(i / pages.length);
          var page = await doc.getPage(pages[i]), c = await renderPage(page, scale);
          var blob = target === "png" ? await OZ.canvasBlob(c, "image/png") : await OZ.canvasBlob(c, "image/jpeg", (+opts.quality || 90) / 100);
          outs.push({ name: base + (doc.numPages > 1 ? " - pagina " + OZ.pad(pages[i], digits) : "") + "." + target, blob: blob });
          page.cleanup(); c.width = c.height = 0;
          await OZ.tick();
        }
        return outs;
      }
      var data = await extract(doc, pages, ctx);
      if (target === "txt") return [{ name: base + ".txt", blob: OZ.textBlob(toPlain(data), "text/plain") }];
      return [await D.write(D.parse(toHtml(data)), target, base, base, {})];
    } finally { doc.destroy(); }
  };

  async function loadLib(file) {
    try { return await PDFLib.PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: false }); }
    catch (e) {
      if (/encrypt/i.test(String(e && e.message))) throw OZ.fail("Deze pdf is beveiligd en kan niet worden geknipt of samengevoegd. Sla hem eerst op zonder beveiliging.");
      throw OZ.fail("Deze pdf kan niet worden gelezen. Mogelijk is het bestand beschadigd.");
    }
  }
  async function splitPdf(file, base, opts) {
    var src = await loadLib(file), total = src.getPageCount(), pages = OZ.parsePages(opts.pages, total), outs = [];
    if (opts.pdfMode === "split") {
      var digits = String(total).length;
      for (var i = 0; i < pages.length; i++) {
        var one = await PDFLib.PDFDocument.create();
        one.addPage((await one.copyPages(src, [pages[i] - 1]))[0]);
        outs.push({ name: base + " - pagina " + OZ.pad(pages[i], digits) + ".pdf", blob: new Blob([await one.save()], { type: "application/pdf" }) });
        if (i % 10 === 9) await OZ.tick();
      }
      return outs;
    }
    var out = await PDFLib.PDFDocument.create();
    (await out.copyPages(src, pages.map(function (p) { return p - 1; }))).forEach(function (p) { out.addPage(p); });
    var all = pages.length === total && !String(opts.pages || "").trim();
    return [{ name: base + (all ? "" : " - pagina " + String(opts.pages).trim().replace(/\s+/g, "")) + ".pdf", blob: new Blob([await out.save()], { type: "application/pdf" }) }];
  }

  /* Voegt pdf-blobs samen tot één pdf, in de gegeven volgorde. */
  OZ.conv.mergePdfs = async function (blobs) {
    var out = await PDFLib.PDFDocument.create();
    for (var i = 0; i < blobs.length; i++) {
      var src;
      try { src = await PDFLib.PDFDocument.load(await blobs[i].arrayBuffer()); }
      catch (e) { throw OZ.fail("Een van de pdf's is beveiligd of beschadigd en kan niet worden samengevoegd."); }
      (await out.copyPages(src, src.getPageIndices())).forEach(function (p) { out.addPage(p); });
      await OZ.tick();
    }
    return new Blob([await out.save()], { type: "application/pdf" });
  };
})();
