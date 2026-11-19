/* Omzetter — blokken naar PDF met pdf-lib. Eigen opmaak: regelafbreking, koppen, lijsten, tabellen, afbeeldingen. */
(function () {
  "use strict";
  var OZ = window.OZ, D = OZ.doc;

  var SUBST = { "\u00a0": " ", "\u2009": " ", "\u200a": " ", "\u2002": " ", "\u2003": " ", "\u202f": " ", "‑": "-", "‐": "-", "−": "-", "→": "->", "←": "<-", "⇒": "=>", "✓": "v", "✔": "v", "✗": "x", "☐": "[ ]", "☑": "[x]", "ı": "i", "ł": "l", "Ł": "L", "đ": "d", "Đ": "D", "≤": "<=", "≥": ">=", "≠": "!=", "×": "x", "′": "'", "″": "\"", "\t": "    ", "●": "•", "◦": "o", "▪": "•", "⁃": "-" };

  function makeCleaner(font) {
    var ok = {}, cache = Object.create(null);
    font.getCharacterSet().forEach(function (cp) { ok[cp] = true; });
    function one(ch) {
      var cp = ch.codePointAt(0);
      if (ok[cp] && cp >= 32) return ch;
      if (ch === "\n") return ch;
      if (cp < 32 || (cp >= 0x200b && cp <= 0x200f) || cp === 0xfeff || cp === 0xfe0f || cp === 0x00ad || (cp >= 0x7f && cp < 0xa0)) return "";
      if (SUBST[ch] != null) return SUBST[ch];
      var base = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (base && base !== ch) {
        var all = true;
        for (var i = 0; i < base.length; i++) if (!ok[base.charCodeAt(i)]) { all = false; break; }
        if (all) return base;
      }
      return "?";
    }
    return function (s) {
      var out = "";
      for (var ch of s) { var r = cache[ch]; if (r === undefined) r = cache[ch] = one(ch); out += r; }
      return out;
    };
  }

  /* opts: {landscape, fontSize, margin, pageNumbers} */
  D.toPdf = async function (blocks, opts) {
    opts = opts || {};
    var L = PDFLib, pdf = await L.PDFDocument.create();
    var F = {
      r: await pdf.embedFont(L.StandardFonts.Helvetica), b: await pdf.embedFont(L.StandardFonts.HelveticaBold),
      i: await pdf.embedFont(L.StandardFonts.HelveticaOblique), bi: await pdf.embedFont(L.StandardFonts.HelveticaBoldOblique),
      m: await pdf.embedFont(L.StandardFonts.Courier), mb: await pdf.embedFont(L.StandardFonts.CourierBold)
    };
    var clean = makeCleaner(F.r);
    var PW = opts.landscape ? 841.89 : 595.28, PH = opts.landscape ? 595.28 : 841.89;
    var M = opts.margin || 56, CW = PW - 2 * M, base = opts.fontSize || 11;
    var INK = L.rgb(0.09, 0.11, 0.14), GREY = L.rgb(0.45, 0.48, 0.52), LINE = L.rgb(0.72, 0.75, 0.79), LINK = L.rgb(0.12, 0.31, 0.82), SHADE = L.rgb(0.94, 0.95, 0.96);
    var page = null, y = 0;
    function newPage() { page = pdf.addPage([PW, PH]); y = PH - M; }
    function ensure(h) { if (!page || y - h < M) newPage(); }
    newPage();

    function fontOf(r) { return r.code ? (r.b ? F.mb : F.m) : r.b && r.i ? F.bi : r.b ? F.b : r.i ? F.i : F.r; }
    var wcache = new Map();
    function width(font, text, size) {
      var k = font.name + "|" + text, w = wcache.get(k);
      if (w === undefined) { w = font.widthOfTextAtSize(text, 1); wcache.set(k, w); }
      return w * size;
    }

    /* runs -> regels van segmenten {text, font, size, color, u, s, w} */
    function wrap(runs, size, maxW, pre) {
      var lines = [], line = [], lw = 0;
      function push() { while (line.length && line[line.length - 1].sp) lw -= line.pop().w; lines.push({ segs: line, w: lw }); line = []; lw = 0; }
      runs.forEach(function (r) {
        if (r.br) { push(); return; }
        var font = fontOf(r), sz = r.code && !pre ? size * 0.92 : size, color = r.link ? LINK : INK;
        var text = clean(r.text), parts = pre ? text.split(/(\n)/) : text.split(/( +|\n)/);
        parts.forEach(function (t) {
          if (!t) return;
          if (t === "\n") { push(); return; }
          var sp = !pre && /^ +$/.test(t);
          if (sp) { if (!line.length) return; t = " "; }
          var w = width(font, t, sz);
          if (!sp && lw + w > maxW && line.length) push();
          if (w > maxW) {                       /* te lang woord: per teken afbreken */
            var chunk = "", cw = 0;
            for (var ch of t) {
              var c1 = width(font, ch, sz);
              if (lw + cw + c1 > maxW && (chunk || line.length)) {
                if (chunk) { line.push({ text: chunk, font: font, size: sz, color: color, u: r.u || !!r.link, s: r.s, w: cw }); lw += cw; }
                push(); chunk = ""; cw = 0;
              }
              chunk += ch; cw += c1;
            }
            if (chunk) { line.push({ text: chunk, font: font, size: sz, color: color, u: r.u || !!r.link, s: r.s, w: cw }); lw += cw; }
            return;
          }
          line.push({ text: t, font: font, size: sz, color: color, u: r.u || !!r.link, s: r.s, w: w, sp: sp });
          lw += w;
        });
      });
      if (line.length || !lines.length) push();
      return lines;
    }
    function drawLine(ln, x, yBase) {
      var cx = x, i = 0, segs = ln.segs;
      while (i < segs.length) {
        var s = segs[i], text = s.text, w = s.w, j = i + 1;
        while (j < segs.length && segs[j].font === s.font && segs[j].size === s.size && segs[j].color === s.color && !!segs[j].u === !!s.u && !!segs[j].s === !!s.s) { text += segs[j].text; w += segs[j].w; j++; }
        if (text.trim()) page.drawText(text, { x: cx, y: yBase, size: s.size, font: s.font, color: s.color });
        if (s.u) page.drawLine({ start: { x: cx, y: yBase - 1.2 }, end: { x: cx + w, y: yBase - 1.2 }, thickness: 0.5, color: s.color });
        if (s.s) page.drawLine({ start: { x: cx, y: yBase + s.size * 0.28 }, end: { x: cx + w, y: yBase + s.size * 0.28 }, thickness: 0.5, color: s.color });
        cx += w; i = j;
      }
    }

    var H = [0, 2.0, 1.55, 1.27, 1.1, 1, 1];
    function para(b, next) {
      var size = b.level ? base * H[b.level] : b.pre ? base * 0.86 : base;
      var lh = size * (b.level ? 1.22 : b.pre ? 1.3 : 1.42);
      var indent = (b.list ? 16 * (b.list.depth + 1) : 0) + (b.quote ? 14 : 0) + (b.pre ? 8 : 0);
      var runs = b.level ? b.runs.map(function (r) { var o = {}; for (var k in r) o[k] = r[k]; o.b = true; return o; }) : b.runs;
      var lines = wrap(runs, size, CW - indent - (b.pre ? 8 : 0), b.pre);
      var before = b.level ? size * 0.75 : 0, after = b.level ? size * 0.35 : b.list ? base * 0.25 : base * 0.6;
      if (y === PH - M) before = 0;
      /* een kop niet alleen onderaan de pagina laten staan */
      ensure(before + lh * Math.min(lines.length, b.level ? 2 : 1) + (b.level ? base * 2.5 : 0));
      y -= before;
      lines.forEach(function (ln, idx) {
        ensure(lh);
        var yb = y - size * 0.82 - (lh - size) / 2;
        if (b.pre) page.drawRectangle({ x: M + indent - 8, y: y - lh, width: CW - indent + 8, height: lh, color: SHADE });
        if (b.quote) page.drawRectangle({ x: M + (b.list ? 16 * (b.list.depth + 1) : 0) + 2, y: y - lh, width: 2, height: lh, color: LINE });
        if (idx === 0 && b.list && b.list.first !== false) {
          var mark = b.list.ordered ? b.list.index + "." : "•";
          var mw = width(F.r, mark, size);
          page.drawText(mark, { x: M + indent - (b.list.ordered ? mw + 4 : 11), y: yb, size: size, font: F.r, color: INK });
        }
        drawLine(ln, M + indent, yb);
        y -= lh;
      });
      y -= after;
    }

    function table(b) {
      var n = 0; b.rows.forEach(function (r) { n = Math.max(n, r.cells.length); });
      if (!n) return;
      if (y < PH - M) y -= base * 0.35;
      var size = opts.tableSize || Math.min(base, n > 6 ? base - 1.5 : base - 0.5), lh = size * 1.32, pad = 4;
      /* kolombreedtes: naar inhoud, binnen de paginabreedte */
      var nat = [], minw = [], c, i;
      for (c = 0; c < n; c++) { nat.push(20); minw.push(18); }
      b.rows.slice(0, 400).forEach(function (r) {
        r.cells.forEach(function (cell, ci) {
          var t = clean(D.runsText(cell.runs)), font = cell.header ? F.b : F.r;
          t.split("\n").forEach(function (l) { nat[ci] = Math.max(nat[ci], Math.min(width(font, l, size), 260) + 2 * pad + 1); });
          t.split(/\s+/).forEach(function (w) { if (w) minw[ci] = Math.max(minw[ci], Math.min(width(font, w, size), 90) + 2 * pad + 1); });
        });
      });
      var sumNat = nat.reduce(function (a, v) { return a + v; }, 0), cols;
      if (sumNat <= CW) cols = nat;
      else {
        var sumMin = minw.reduce(function (a, v) { return a + v; }, 0);
        if (sumMin >= CW) cols = minw.map(function (v) { return v * CW / sumMin; });
        else { var k = (CW - sumMin) / (sumNat - sumMin); cols = nat.map(function (v, ci) { return minw[ci] + (v - minw[ci]) * k; }); }
      }
      var totalW = cols.reduce(function (a, v) { return a + v; }, 0);
      function layoutRow(r) {
        var cells = [], h = lh;
        for (var ci = 0; ci < n; ci++) {
          var cell = r.cells[ci] || { runs: [], header: false };
          var runs = cell.header ? cell.runs.map(function (x) { var o = {}; for (var k2 in x) o[k2] = x[k2]; o.b = true; return o; }) : cell.runs;
          var lines = wrap(runs, size, cols[ci] - 2 * pad, false);
          if (lines.length === 1 && !lines[0].segs.length) lines = [];
          cells.push({ lines: lines, header: cell.header });
          h = Math.max(h, lines.length * lh);
        }
        return { cells: cells, h: h + 2 * pad, header: r.cells.length > 0 && r.cells.every(function (x) { return x.header; }) };
      }
      function drawRow(R) {
        var x = M, maxLines = Math.floor((PH - 2 * M - 2 * pad) / lh);
        if (R.h > PH - 2 * M) R.h = PH - 2 * M;
        if (R.header) page.drawRectangle({ x: M, y: y - R.h, width: totalW, height: R.h, color: SHADE });
        R.cells.forEach(function (cell, ci) {
          cell.lines.slice(0, maxLines).forEach(function (ln, li) { drawLine(ln, x + pad, y - pad - li * lh - size * 0.82 - (lh - size) / 2); });
          x += cols[ci];
        });
        page.drawLine({ start: { x: M, y: y - R.h }, end: { x: M + totalW, y: y - R.h }, thickness: 0.5, color: LINE });
        var vx = M;
        for (var ci2 = 0; ci2 <= n; ci2++) {
          page.drawLine({ start: { x: vx, y: y }, end: { x: vx, y: y - R.h }, thickness: 0.5, color: LINE });
          vx += cols[ci2] || 0;
        }
        y -= R.h;
      }
      var head = b.rows.length > 1 ? layoutRow(b.rows[0]) : null;
      if (head && !head.header) head = null;
      var started = false;
      function topLine() { page.drawLine({ start: { x: M, y: y }, end: { x: M + totalW, y: y }, thickness: 0.5, color: LINE }); }
      b.rows.forEach(function (r, ri) {
        var R = ri === 0 && head ? head : layoutRow(r);
        if (!started) { ensure(Math.min(R.h + (head ? lh + 2 * pad : 0), PH - 2 * M)); topLine(); started = true; }
        else if (y - R.h < M) { newPage(); topLine(); if (head) drawRow(head); }
        drawRow(R);
      });
      y -= base * 0.9;
    }

    async function image(b) {
      var emb;
      try { emb = b.mime === "image/jpeg" ? await pdf.embedJpg(b.bytes) : await pdf.embedPng(b.bytes); } catch (e) { return; }
      var w = b.w * 0.75, h = b.h * 0.75, maxH = PH - 2 * M;
      var k = Math.min(1, CW / w, maxH / h); w *= k; h *= k;
      ensure(h + 4);
      page.drawImage(emb, { x: M, y: y - h, width: w, height: h });
      y -= h + base * 0.8;
    }

    for (var bi = 0; bi < blocks.length; bi++) {
      var b = blocks[bi];
      if (b.type === "para") para(b, blocks[bi + 1]);
      else if (b.type === "table") table(b);
      else if (b.type === "img") await image(b);
      else if (b.type === "hr") { ensure(14); page.drawLine({ start: { x: M, y: y - 6 }, end: { x: PW - M, y: y - 6 }, thickness: 0.6, color: LINE }); y -= 16; }
      if (bi % 200 === 199) await OZ.tick();
    }
    var pages = pdf.getPages();
    if (pages.length > 1 && opts.pageNumbers !== false) {
      pages.forEach(function (p, i) {
        var t = (i + 1) + " van " + pages.length;
        p.drawText(t, { x: PW - M - width(F.r, t, 8.5), y: M * 0.5, size: 8.5, font: F.r, color: GREY });
      });
    }
    if (opts.title) pdf.setTitle(String(opts.title));
    pdf.setCreator("Omzetter");
    return new Blob([await pdf.save()], { type: "application/pdf" });
  };
})();
