/* Omzetter — tussenvorm voor documenten.
   Elk document wordt eerst nette HTML. Daaruit maken we "blokken" (alinea's, koppen, lijsten,
   tabellen, afbeeldingen) waar de schrijvers voor PDF, DOCX, ODT, RTF en TXT mee werken. */
(function () {
  "use strict";
  var OZ = window.OZ;
  var D = (OZ.doc = {});

  var DROP = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, LINK: 1, META: 1, NOSCRIPT: 1, TEMPLATE: 1, HEAD: 1, TITLE: 1, BASE: 1, FORM: 0, INPUT: 1, BUTTON: 1, SELECT: 1, TEXTAREA: 1, VIDEO: 1, AUDIO: 1, CANVAS: 1, SVG: 1, NAV: 0 };

  /* Maakt van (mogelijk rommelige) HTML een veilig body-element in een los document. */
  D.parse = function (html) {
    var doc = new DOMParser().parseFromString("<!doctype html><html><head><meta charset='utf-8'></head><body>" + html + "</body></html>", "text/html");
    D.clean(doc.body);
    return doc.body;
  };
  D.parseFull = function (html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var title = (doc.querySelector("title") || {}).textContent || "";
    D.clean(doc.body);
    return { body: doc.body, title: title.trim() };
  };
  D.clean = function (root) {
    var all = root.querySelectorAll("*"), i, el;
    for (i = all.length - 1; i >= 0; i--) {
      el = all[i];
      if (DROP[el.tagName.toUpperCase()]) { el.remove(); continue; }
      for (var j = el.attributes.length - 1; j >= 0; j--) {
        var a = el.attributes[j], n = a.name.toLowerCase();
        if (n.indexOf("on") === 0 || n === "style" || n === "class" || n === "id" || n === "srcset" || n === "loading") el.removeAttribute(a.name);
        else if ((n === "href" || n === "src") && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
      }
    }
    return root;
  };

  var BLOCK = { P: 1, DIV: 1, SECTION: 1, ARTICLE: 1, MAIN: 1, HEADER: 1, FOOTER: 1, ASIDE: 1, NAV: 1, FIGURE: 1, FIGCAPTION: 1, ADDRESS: 1, DL: 1, DT: 1, DD: 1, FORM: 1, FIELDSET: 1, DETAILS: 1, SUMMARY: 1, CENTER: 1, TR: 1, TBODY: 1, THEAD: 1, CAPTION: 1 };

  /* body-element -> lijst blokken */
  D.blocks = function (body) {
    var out = [], cur = null;
    function start(ctx) {
      cur = { type: "para", runs: [], level: ctx.level || 0, list: ctx.list ? { ordered: ctx.list.ordered, depth: ctx.list.depth, index: ctx.list.index, first: !ctx.list.used } : null, quote: !!ctx.quote, pre: !!ctx.pre };
    }
    function flush() {
      if (cur) {
        trimRuns(cur.runs, cur.pre);
        if (cur.runs.length) { out.push(cur); if (cur.list && cur.list.first && cur._ctxList) cur._ctxList.used = true; }
        delete cur._ctxList;
      }
      cur = null;
    }
    function addText(text, ctx) {
      if (!ctx.pre) text = text.replace(/[ \t\r\n\f]+/g, " ");
      if (!text) return;
      if (!cur) { if (!text.trim()) return; start(ctx); cur._ctxList = ctx.list; }
      var runs = cur.runs, last = runs[runs.length - 1];
      if (!ctx.pre && text[0] === " " && (!last || last.br || / $/.test(last.text))) text = text.slice(1);
      if (!text) return;
      if (last && !last.br && last.b === !!ctx.b && last.i === !!ctx.i && last.u === !!ctx.u && last.code === !!ctx.code && last.link === (ctx.link || "") && last.s === !!ctx.s) last.text += text;
      else runs.push({ text: text, b: !!ctx.b, i: !!ctx.i, u: !!ctx.u, s: !!ctx.s, code: !!ctx.code, link: ctx.link || "" });
    }
    function inlineRuns(el, ctx) {           /* voor tabelcellen: alles plat in runs */
      var saveOut = out, saveCur = cur; out = []; cur = null;
      walkKids(el, ctx); flush();
      var runs = [];
      out.forEach(function (b, i) {
        if (b.type !== "para") return;
        if (runs.length) runs.push({ br: true, text: "" });
        if (b.list) runs.push({ text: (b.list.ordered ? b.list.index + ". " : "• "), b: false, i: false, u: false, s: false, code: false, link: "" });
        b.runs.forEach(function (r) { runs.push(r); });
      });
      out = saveOut; cur = saveCur;
      return runs;
    }
    function walkKids(el, ctx) { for (var n = el.firstChild; n; n = n.nextSibling) walk(n, ctx); }
    function ext(ctx, more) { var o = {}, k; for (k in ctx) o[k] = ctx[k]; for (k in more) o[k] = more[k]; return o; }
    function walk(node, ctx) {
      if (node.nodeType === 3) { addText(node.nodeValue, ctx); return; }
      if (node.nodeType !== 1) return;
      var tag = node.tagName.toUpperCase(), m;
      if ((m = /^H([1-6])$/.exec(tag))) { flush(); walkKids(node, ext(ctx, { level: +m[1], b: false })); flush(); return; }
      switch (tag) {
        case "BR":
          if (cur) cur.runs.push(ctx.pre ? { text: "\n", b: false, i: false, u: false, s: false, code: !!ctx.code, link: "" } : { br: true, text: "" });
          return;
        case "HR": flush(); out.push({ type: "hr" }); return;
        case "IMG": {
          var src = node.getAttribute("src") || "";
          if (/^data:image\//i.test(src)) { flush(); out.push({ type: "img", src: src, alt: node.getAttribute("alt") || "" }); }
          else if (node.getAttribute("alt")) addText("[" + node.getAttribute("alt") + "]", ctx);
          return;
        }
        case "B": case "STRONG": walkKids(node, ext(ctx, { b: true })); return;
        case "I": case "EM": case "CITE": case "VAR": walkKids(node, ext(ctx, { i: true })); return;
        case "U": case "INS": walkKids(node, ext(ctx, { u: true })); return;
        case "S": case "DEL": case "STRIKE": walkKids(node, ext(ctx, { s: true })); return;
        case "CODE": case "KBD": case "SAMP": case "TT": walkKids(node, ext(ctx, { code: true })); return;
        case "A": {
          var href = node.getAttribute("href") || "";
          walkKids(node, /^(https?:|mailto:)/i.test(href) ? ext(ctx, { link: href }) : ctx); return;
        }
        case "PRE": flush(); walkKids(node, ext(ctx, { pre: true, code: true })); flush(); return;
        case "BLOCKQUOTE": flush(); walkKids(node, ext(ctx, { quote: true })); flush(); return;
        case "UL": case "OL": {
          flush();
          var depth = ctx.list ? ctx.list.depth + 1 : 0, idx = parseInt(node.getAttribute("start"), 10) || 1;
          for (var li = node.firstChild; li; li = li.nextSibling) {
            if (li.nodeType !== 1) continue;
            if (li.tagName.toUpperCase() === "LI") {
              flush();
              walkKids(li, ext(ctx, { list: { ordered: tag === "OL", depth: depth, index: idx++, used: false } }));
              flush();
            } else walk(li, ctx);
          }
          return;
        }
        case "TABLE": {
          flush();
          var rows = [], trs = node.querySelectorAll("tr");
          for (var r = 0; r < trs.length; r++) {
            if (trs[r].closest("table") !== node) continue;
            var cells = [], tds = trs[r].children;
            for (var c = 0; c < tds.length; c++) {
              var t = tds[c].tagName.toUpperCase();
              if (t !== "TD" && t !== "TH") continue;
              var head = t === "TH" || !!trs[r].closest("thead");
              cells.push({ runs: inlineRuns(tds[c], { b: head }), header: head });
              var span = parseInt(tds[c].getAttribute("colspan"), 10) || 1;
              while (--span > 0) cells.push({ runs: [], header: head });
            }
            if (cells.length) rows.push({ cells: cells });
          }
          if (rows.length) out.push({ type: "table", rows: rows });
          return;
        }
        default:
          if (BLOCK[tag] || tag === "LI") { flush(); walkKids(node, ctx); flush(); }
          else walkKids(node, ctx);
      }
    }
    function trimRuns(runs, pre) {
      if (pre) {
        while (runs.length && !runs[runs.length - 1].text.replace(/\n+$/, "")) runs.pop();
        if (runs.length) runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\n+$/, "");
        if (runs.length) runs[0].text = runs[0].text.replace(/^\n/, "");
        return;
      }
      while (runs.length && (runs[runs.length - 1].br || !runs[runs.length - 1].text.trim())) runs.pop();
      while (runs.length && (runs[0].br || !runs[0].text.trim())) runs.shift();
      if (runs.length) {
        runs[0].text = runs[0].text.replace(/^ +/, "");
        runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/ +$/, "");
      }
    }
    walkKids(body, {});
    flush();
    return out;
  };

  D.runsText = function (runs) {
    return runs.map(function (r) { return r.br ? "\n" : r.text; }).join("");
  };

  /* Laadt afbeeldingsblokken: bytes, mime (png of jpeg) en maat in pixels. Onleesbare beelden vervallen. */
  D.loadImages = async function (blocks) {
    var keep = [];
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b.type !== "img") { keep.push(b); continue; }
      var p = OZ.dataUriParts(b.src);
      if (!p) continue;
      try {
        var L = await OZ.loadImg(new Blob([p.bytes], { type: p.mime }));
        var w = L.img.naturalWidth || 300, h = L.img.naturalHeight || 150;
        if (p.mime === "image/png" || p.mime === "image/jpeg") { b.bytes = p.bytes; b.mime = p.mime; }
        else {
          var c = OZ.makeCanvas(w, h); c.getContext("2d").drawImage(L.img, 0, 0, w, h);
          b.bytes = new Uint8Array(await (await OZ.canvasBlob(c, "image/png")).arrayBuffer()); b.mime = "image/png";
        }
        L.release();
        b.w = w; b.h = h;
        keep.push(b);
      } catch (e) { /* overslaan */ }
    }
    return keep;
  };

  /* ---------- platte tekst ---------- */
  D.toText = function (blocks) {
    var lines = [];
    blocks.forEach(function (b, i) {
      if (b.type === "hr") { lines.push("----------", ""); return; }
      if (b.type === "img") { if (b.alt) lines.push("[" + b.alt + "]", ""); return; }
      if (b.type === "table") {
        b.rows.forEach(function (r) {
          lines.push(r.cells.map(function (c) { return D.runsText(c.runs).replace(/\s*\n\s*/g, " "); }).join("\t"));
        });
        lines.push(""); return;
      }
      var t = D.runsText(b.runs);
      if (b.list) {
        var pre = new Array(b.list.depth + 1).join("  ") + (b.list.first === false ? "  " : (b.list.ordered ? b.list.index + ". " : "- "));
        lines.push(pre + t.replace(/\n/g, "\n" + new Array(pre.length + 1).join(" ")));
        var nx = blocks[i + 1];
        if (!nx || !nx.list) lines.push("");
        return;
      }
      if (b.level) { if (lines.length && lines[lines.length - 1] !== "") lines.push(""); lines.push(t, ""); return; }
      if (b.quote) t = t.split("\n").map(function (l) { return "> " + l; }).join("\n");
      lines.push(t, "");
    });
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  };

  /* ---------- losse HTML-pagina ---------- */
  D.PAGE_CSS = "body{font:17px/1.6 Georgia,'Times New Roman',serif;color:#1b1f24;background:#fff;max-width:44em;margin:0 auto;padding:2em 1.2em 4em}" +
    "h1,h2,h3,h4{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.2;margin:1.6em 0 .5em}h1{font-size:1.9em}h2{font-size:1.45em}h3{font-size:1.2em}" +
    "img{max-width:100%;height:auto}table{border-collapse:collapse;margin:1em 0;font:15px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif}" +
    "th,td{border:1px solid #c5cbd3;padding:.35em .6em;text-align:left;vertical-align:top}th{background:#eef1f4}" +
    "pre{background:#f3f5f7;padding:.8em 1em;overflow:auto;font-size:.85em}code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.9em}" +
    "blockquote{margin:1em 0;padding-left:1em;border-left:3px solid #c5cbd3;color:#444}a{color:#1f4fd1}";
  D.toHtmlPage = function (bodyHtml, title, extraCss) {
    return "<!DOCTYPE html>\n<html lang=\"nl\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>" + OZ.escHtml(title || "Document") + "</title>\n<style>" + D.PAGE_CSS + (extraCss || "") + "</style>\n</head>\n<body>\n" + bodyHtml + "\n</body>\n</html>\n";
  };

  /* ---------- Markdown ---------- */
  D.toMarkdown = function (body) {
    var clone = body.cloneNode(true);
    clone.querySelectorAll("img").forEach(function (img) {
      if (/^data:/i.test(img.getAttribute("src") || "")) {
        var alt = img.getAttribute("alt");
        if (alt) img.replaceWith(clone.ownerDocument.createTextNode("[" + alt + "]")); else img.remove();
      }
    });
    var td = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced", emDelimiter: "*", hr: "---" });
    td.addRule("strike", { filter: ["del", "s", "strike"], replacement: function (c) { return "~~" + c + "~~"; } });
    td.addRule("table", {
      filter: "table",
      replacement: function (content, node) {
        var rows = [];
        node.querySelectorAll("tr").forEach(function (tr) {
          if (tr.closest("table") !== node) return;
          var cells = [];
          for (var i = 0; i < tr.children.length; i++) cells.push(tr.children[i].textContent.replace(/\s+/g, " ").trim().replace(/\|/g, "\\|"));
          if (cells.length) rows.push(cells);
        });
        return "\n\n" + D.mdTable(rows) + "\n\n";
      }
    });
    return td.turndown(clone).replace(/\n{3,}/g, "\n\n").trim() + "\n";
  };
  D.mdTable = function (rows) {
    if (!rows.length) return "";
    var n = 0; rows.forEach(function (r) { n = Math.max(n, r.length); });
    function line(r) { var c = []; for (var i = 0; i < n; i++) c.push(r[i] == null ? "" : r[i]); return "| " + c.join(" | ") + " |"; }
    var sep = []; for (var i = 0; i < n; i++) sep.push("---");
    return [line(rows[0]), "| " + sep.join(" | ") + " |"].concat(rows.slice(1).map(line)).join("\n");
  };
})();
