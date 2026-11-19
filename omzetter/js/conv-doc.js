/* Omzetter — documenten lezen (DOCX, ODT, RTF, TXT, MD, HTML, EPUB, PPTX) en wegschrijven. */
(function () {
  "use strict";
  var OZ = window.OZ, D = OZ.doc, E = OZ.escHtml;

  function xml(text) {
    var d = new DOMParser().parseFromString(text, "application/xml");
    if (d.getElementsByTagName("parsererror").length) throw OZ.fail("Het bestand is beschadigd: een onderdeel kan niet worden gelezen.");
    return d;
  }
  async function openZip(file, what) {
    try { return await JSZip.loadAsync(await file.arrayBuffer()); }
    catch (e) { throw OZ.fail("Dit is geen geldig " + what + "-bestand. Mogelijk is het beschadigd of heeft het een verkeerde extensie."); }
  }
  function kids(el, local) {
    var out = [];
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 && (!local || n.localName === local)) out.push(n);
    return out;
  }
  function mimeOf(name) {
    return { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", bmp: "image/bmp" }[OZ.ext(name)] || "";
  }
  async function zipDataUri(zip, path) {
    var f = zip.file(path), m = mimeOf(path);
    if (!f || !m) return "";
    return "data:" + m + ";base64," + (await f.async("base64"));
  }

  /* ---------- TXT ---------- */
  function textToHtml(text) {
    text = text.replace(/\r\n?/g, "\n").replace(/\u0000/g, "");
    return text.split(/\n[ \t]*\n+/).map(function (p) {
      p = p.replace(/^\n+|\n+$/g, "");
      return p ? "<p>" + E(p).replace(/\n/g, "<br>") + "</p>" : "";
    }).join("\n");
  }

  /* ---------- ODT ---------- */
  async function readOdt(file) {
    var zip = await openZip(file, "ODT"), cf = zip.file("content.xml");
    if (!cf) throw OZ.fail("In dit ODT-bestand ontbreekt de inhoud (content.xml).");
    var doc = xml(await cf.async("string"));
    var NS_STYLE = "urn:oasis:names:tc:opendocument:xmlns:style:1.0", NS_FO = "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0", NS_TEXT = "urn:oasis:names:tc:opendocument:xmlns:text:1.0", NS_XL = "http://www.w3.org/1999/xlink";
    var styles = {}, ordered = {};
    function scanStyles(d) {
      var ss = d.getElementsByTagNameNS(NS_STYLE, "style");
      for (var i = 0; i < ss.length; i++) {
        var tp = ss[i].getElementsByTagNameNS(NS_STYLE, "text-properties")[0];
        styles[ss[i].getAttributeNS(NS_STYLE, "name")] = {
          b: !!tp && /bold|[6-9]00/.test(tp.getAttributeNS(NS_FO, "font-weight") || ""),
          i: !!tp && (tp.getAttributeNS(NS_FO, "font-style") || "") === "italic",
          u: !!tp && !!(tp.getAttributeNS(NS_STYLE, "text-underline-style") || "").replace("none", ""),
          parent: ss[i].getAttributeNS(NS_STYLE, "parent-style-name") || ""
        };
      }
      var ls = d.getElementsByTagNameNS(NS_TEXT, "list-style");
      for (var j = 0; j < ls.length; j++) {
        var first = kids(ls[j])[0];
        ordered[ls[j].getAttributeNS(NS_STYLE, "name")] = !!first && first.localName === "list-level-style-number";
      }
    }
    scanStyles(doc);
    var sf = zip.file("styles.xml");
    if (sf) { try { scanStyles(xml(await sf.async("string"))); } catch (e) { /* stijlen zijn niet nodig */ } }
    var pics = [];
    function inline(el) {
      var out = "";
      for (var n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) { out += E(n.nodeValue); continue; }
        if (n.nodeType !== 1) continue;
        switch (n.localName) {
          case "span": {
            var st = styles[n.getAttributeNS(NS_TEXT, "style-name")] || {}, t = inline(n);
            if (st.b) t = "<strong>" + t + "</strong>";
            if (st.i) t = "<em>" + t + "</em>";
            if (st.u) t = "<u>" + t + "</u>";
            out += t; break;
          }
          case "a": out += '<a href="' + E(n.getAttributeNS(NS_XL, "href") || "") + '">' + inline(n) + "</a>"; break;
          case "line-break": out += "<br>"; break;
          case "tab": out += "\t"; break;
          case "s": out += new Array((parseInt(n.getAttributeNS(NS_TEXT, "c"), 10) || 1) + 1).join("\u00a0"); break;
          case "frame": case "image": {
            var im = n.localName === "image" ? n : n.getElementsByTagNameNS("*", "image")[0];
            var href = im && im.getAttributeNS(NS_XL, "href");
            if (href) { pics.push(href); out += "\u0000IMG" + (pics.length - 1) + "\u0000"; }
            break;
          }
          case "note": case "annotation": case "soft-page-break": case "bookmark": case "bookmark-start": case "bookmark-end": break;
          default: out += inline(n);
        }
      }
      return out;
    }
    function block(el, listOrdered) {
      var out = "";
      kids(el).forEach(function (n) {
        switch (n.localName) {
          case "h": { var lv = Math.min(6, parseInt(n.getAttributeNS(NS_TEXT, "outline-level"), 10) || 1); out += "<h" + lv + ">" + inline(n) + "</h" + lv + ">"; break; }
          case "p": {
            var sn = n.getAttributeNS(NS_TEXT, "style-name") || "", st = styles[sn] || {}, chain = sn + " " + (st.parent || "");
            var t = inline(n);
            if (/^Title/.test(sn) || /\bTitle\b/.test(chain)) out += "<h1>" + t + "</h1>";
            else if (/Preformatted/.test(chain)) out += "<pre>" + t.replace(/<br>/g, "\n") + "</pre>";
            else if (/Quotations/.test(chain)) out += "<blockquote><p>" + t + "</p></blockquote>";
            else { if (st.b) t = "<strong>" + t + "</strong>"; if (st.i) t = "<em>" + t + "</em>"; out += "<p>" + t + "</p>"; }
            break;
          }
          case "list": {
            var sn2 = n.getAttributeNS(NS_TEXT, "style-name"), ord = sn2 ? !!ordered[sn2] : !!listOrdered, tag = ord ? "ol" : "ul";
            out += "<" + tag + ">";
            kids(n).forEach(function (li) { if (li.localName === "list-item" || li.localName === "list-header") out += "<li>" + block(li, ord) + "</li>"; });
            out += "</" + tag + ">"; break;
          }
          case "table": {
            out += "<table>";
            var rows = [];
            (function collect(t) { kids(t).forEach(function (c) { if (c.localName === "table-row") rows.push(c); else if (/table-header-rows|table-rows|table-row-group/.test(c.localName)) collect(c); }); })(n);
            rows.forEach(function (r) {
              out += "<tr>";
              kids(r).forEach(function (c) { if (c.localName === "table-cell") out += "<td>" + block(c) + "</td>"; });
              out += "</tr>";
            });
            out += "</table>"; break;
          }
          case "section": case "text": case "body": case "index-body": case "table-of-content": out += block(n, listOrdered); break;
        }
      });
      return out;
    }
    var textEl = doc.getElementsByTagNameNS("urn:oasis:names:tc:opendocument:xmlns:office:1.0", "text")[0];
    if (!textEl) throw OZ.fail("In dit ODT-bestand staat geen tekst.");
    var html = block(textEl);
    for (var i = 0; i < pics.length; i++) {
      var uri = await zipDataUri(zip, pics[i].replace(/^\.\//, ""));
      html = html.replace("\u0000IMG" + i + "\u0000", uri ? '<img src="' + uri + '" alt="">' : "");
    }
    return { html: html };
  }

  /* ---------- RTF ---------- */
  var RTF_SKIP = {};
  "fonttbl colortbl stylesheet info pict header footer headerl headerr headerf footerl footerr footerf footnote object themedata colorschememapping datastore latentstyles generator listtable listoverridetable rsidtbl xmlnstbl fldinst pgdsctbl revtbl filetbl bkmkstart bkmkend nonshppict operator author title subject keywords doccomm company manager category comment template".split(" ").forEach(function (w) { RTF_SKIP[w] = 1; });
  var RTF_CHARS = { emdash: "—", endash: "–", bullet: "•", lquote: "‘", rquote: "’", ldblquote: "“", rdblquote: "”", tab: "\t", emspace: " ", enspace: " ", qmspace: " " };
  function rtfToHtml(src) {
    if (!/^\s*\{\\rtf/.test(src)) throw OZ.fail("Dit is geen geldig RTF-bestand.");
    var cp = new TextDecoder("windows-1252");
    var i = 0, n = src.length, stack = [], st = { b: false, i: false, u: false, skip: false, uc: 1, fs: 24 };
    var html = "", runs = [], cells = [], rows = [], intbl = false, skipChars = 0, maxFs = 0;
    function put(t) {
      if (st.skip) return;
      if (skipChars > 0) { skipChars--; return; }
      var last = runs[runs.length - 1];
      if (st.fs > maxFs) maxFs = st.fs;
      if (last && !last.br && last.b === st.b && last.i === st.i && last.u === st.u) last.text += t;
      else runs.push({ text: t, b: st.b, i: st.i, u: st.u });
    }
    function inlineHtml(rs) {
      return rs.map(function (r) {
        if (r.br) return "<br>";
        var t = E(r.text);
        if (r.b) t = "<strong>" + t + "</strong>";
        if (r.i) t = "<em>" + t + "</em>";
        if (r.u) t = "<u>" + t + "</u>";
        return t;
      }).join("");
    }
    function flushTable() {
      if (!rows.length) return;
      html += "<table>" + rows.map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + c + "</td>"; }).join("") + "</tr>"; }).join("") + "</table>\n";
      rows = [];
    }
    function endPara() {
      if (intbl) { if (runs.length) runs.push({ br: true }); return; }
      flushTable();
      var text = runs.map(function (r) { return r.text || ""; }).join("");
      if (text.trim()) {
        var allBold = runs.every(function (r) { return r.br || r.b || !r.text.trim(); });
        var m = /^\s*(•|·|-)\s+/.exec(text), tag = "p";
        if (allBold && maxFs >= 36) tag = "h1"; else if (allBold && maxFs >= 30) tag = "h2"; else if (allBold && maxFs >= 26) tag = "h3";
        if (tag !== "p") runs.forEach(function (r) { r.b = false; });
        if (m) { runs[0].text = runs[0].text.replace(/^\s*(•|·|-)\s+/, ""); html += "<ul><li>" + inlineHtml(runs) + "</li></ul>\n"; }
        else html += "<" + tag + ">" + inlineHtml(runs) + "</" + tag + ">\n";
      }
      runs = []; maxFs = 0;
    }
    while (i < n) {
      var ch = src[i];
      if (ch === "{") { stack.push({ b: st.b, i: st.i, u: st.u, skip: st.skip, uc: st.uc, fs: st.fs }); i++; }
      else if (ch === "}") { if (stack.length) st = stack.pop(); i++; }
      else if (ch === "\\") {
        var c2 = src[i + 1];
        if (c2 === "'") { var byte = parseInt(src.substr(i + 2, 2), 16); i += 4; if (!isNaN(byte)) put(cp.decode(new Uint8Array([byte]))); }
        else if (c2 === "*") { st.skip = true; i += 2; }
        else if (c2 === "\\" || c2 === "{" || c2 === "}") { put(c2); i += 2; }
        else if (c2 === "~") { put("\u00a0"); i += 2; }
        else if (c2 === "_") { put("-"); i += 2; }
        else if (c2 === "\n" || c2 === "\r") { endPara(); i += 2; }
        else if (/[a-zA-Z]/.test(c2 || "")) {
          var m2 = /^([a-zA-Z]+)(-?\d+)?( ?)/.exec(src.substr(i + 1, 40)), w = m2[1], p = m2[2] === undefined ? null : parseInt(m2[2], 10);
          i += 1 + m2[0].length;
          if (RTF_SKIP[w]) { st.skip = true; continue; }
          if (st.skip) continue;
          switch (w) {
            case "par": case "sect": case "page": endPara(); break;
            case "line": if (runs.length) runs.push({ br: true }); break;
            case "cell": cells.push(inlineHtml(runs.filter(function (r, k) { return !(r.br && k === runs.length - 1); }))); runs = []; maxFs = 0; break;
            case "row": rows.push(cells); cells = []; break;
            case "intbl": intbl = true; break;
            case "pard": intbl = false; break;
            case "b": st.b = p !== 0; break;
            case "i": st.i = p !== 0; break;
            case "ul": st.u = p !== 0; break;
            case "ulnone": st.u = false; break;
            case "plain": st.b = st.i = st.u = false; break;
            case "fs": if (p) st.fs = p; break;
            case "uc": st.uc = p == null ? 1 : p; break;
            case "u": if (p != null) { put(String.fromCharCode(p < 0 ? p + 65536 : p)); skipChars = st.uc; } break;
            default: if (RTF_CHARS[w]) put(RTF_CHARS[w]);
          }
        } else i += 2;
      }
      else if (ch === "\n" || ch === "\r") i++;
      else { put(ch); i++; }
    }
    intbl = false; endPara(); flushTable();
    return html.replace(/<\/ul>\n<ul>/g, "");
  }

  /* ---------- EPUB ---------- */
  function resolve(basePath, rel) {
    rel = decodeURIComponent(String(rel).split("#")[0]);
    if (/^[a-z]+:/i.test(rel)) return "";
    var parts = (rel[0] === "/" ? [] : basePath.split("/").slice(0, -1)).concat(rel.split("/")), out = [];
    parts.forEach(function (p) { if (p === "..") out.pop(); else if (p && p !== ".") out.push(p); });
    return out.join("/");
  }
  async function readEpub(file) {
    var zip = await openZip(file, "EPUB"), cf = zip.file("META-INF/container.xml");
    if (!cf) throw OZ.fail("Dit is geen geldig EPUB-bestand: de inhoudsopgave (container.xml) ontbreekt.");
    var rootEl = xml(await cf.async("string")).getElementsByTagNameNS("*", "rootfile")[0];
    var opfPath = rootEl && rootEl.getAttribute("full-path"), of = opfPath && zip.file(opfPath);
    if (!of) throw OZ.fail("Dit EPUB-bestand is onvolledig: het pakketbestand ontbreekt.");
    if (zip.file("META-INF/encryption.xml") && zip.file("META-INF/rights.xml")) throw OZ.fail("Dit e-boek is beveiligd (DRM) en kan niet worden omgezet.");
    var opf = xml(await of.async("string")), items = {};
    Array.prototype.forEach.call(opf.getElementsByTagNameNS("*", "item"), function (it) { items[it.getAttribute("id")] = { href: it.getAttribute("href"), type: it.getAttribute("media-type") || "", props: it.getAttribute("properties") || "" }; });
    var titleEl = opf.getElementsByTagNameNS("http://purl.org/dc/elements/1.1/", "title")[0];
    var html = "", refs = opf.getElementsByTagNameNS("*", "itemref");
    for (var i = 0; i < refs.length; i++) {
      var it = items[refs[i].getAttribute("idref")];
      if (!it || /\bnav\b/.test(it.props)) continue;
      var path = resolve(opfPath, it.href), f = zip.file(path);
      if (!f) continue;
      var text = await f.async("string"), d = new DOMParser().parseFromString(text, "application/xhtml+xml");
      if (d.getElementsByTagName("parsererror").length || !d.body) d = new DOMParser().parseFromString(text, "text/html");
      var body = d.body || d.documentElement, imgs = body.querySelectorAll("img");
      for (var k = 0; k < imgs.length; k++) {
        var uri = await zipDataUri(zip, resolve(path, imgs[k].getAttribute("src") || ""));
        if (uri) imgs[k].setAttribute("src", uri); else imgs[k].remove();
      }
      var svgImgs = body.querySelectorAll("svg image");
      for (var s = 0; s < svgImgs.length; s++) {
        var href = svgImgs[s].getAttribute("xlink:href") || svgImgs[s].getAttribute("href") || "";
        var uri2 = await zipDataUri(zip, resolve(path, href));
        if (uri2) { var im = d.createElementNS("http://www.w3.org/1999/xhtml", "img"); im.setAttribute("src", uri2); im.setAttribute("alt", ""); var sv = svgImgs[s].closest("svg"); sv.parentNode.insertBefore(im, sv); }
      }
      var holder = document.implementation.createHTMLDocument("").createElement("div");
      holder.innerHTML = new XMLSerializer().serializeToString(body).replace(/^<body[^>]*>|<\/body>$/g, "");
      html += holder.innerHTML + "\n";
      if (i % 10 === 9) await OZ.tick();
    }
    if (!html.trim()) throw OZ.fail("In dit EPUB-bestand is geen leesbare tekst gevonden.");
    return { html: html, title: titleEl ? titleEl.textContent.trim() : "" };
  }

  /* ---------- PPTX (tekst per dia) ---------- */
  async function readPptx(file) {
    var zip = await openZip(file, "PPTX"), order = [];
    var pres = zip.file("ppt/presentation.xml"), rels = zip.file("ppt/_rels/presentation.xml.rels");
    if (pres && rels) {
      var rmap = {};
      Array.prototype.forEach.call(xml(await rels.async("string")).getElementsByTagName("Relationship"), function (r) { rmap[r.getAttribute("Id")] = r.getAttribute("Target"); });
      Array.prototype.forEach.call(xml(await pres.async("string")).getElementsByTagNameNS("*", "sldId"), function (s) {
        var t = rmap[s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id")];
        if (t) order.push(resolve("ppt/presentation.xml", t));
      });
    }
    if (!order.length) {
      order = Object.keys(zip.files).filter(function (k) { return /^ppt\/slides\/slide\d+\.xml$/.test(k); })
        .sort(function (a, b) { return parseInt(a.replace(/\D/g, ""), 10) - parseInt(b.replace(/\D/g, ""), 10); });
    }
    if (!order.length) throw OZ.fail("In deze presentatie zijn geen dia's gevonden.");
    function paraText(p) {
      var out = "";
      (function walk(el) {
        for (var n = el.firstChild; n; n = n.nextSibling) {
          if (n.nodeType !== 1) continue;
          if (n.localName === "t") out += E(n.textContent); else if (n.localName === "br") out += "<br>"; else if (n.localName !== "pPr" && n.localName !== "rPr") walk(n);
        }
      })(p);
      return out;
    }
    var html = "";
    for (var i = 0; i < order.length; i++) {
      var f = zip.file(order[i]);
      if (!f) continue;
      var d = xml(await f.async("string")), title = "", bodyHtml = "";
      var tree = d.getElementsByTagNameNS("*", "spTree")[0];
      if (!tree) continue;
      (function shapes(parent) {
        kids(parent).forEach(function (sp) {
          if (sp.localName === "grpSp") { shapes(sp); return; }
          if (sp.localName === "graphicFrame") {
            var tbl = sp.getElementsByTagNameNS("*", "tbl")[0];
            if (tbl) {
              bodyHtml += "<table>";
              Array.prototype.forEach.call(tbl.getElementsByTagNameNS("*", "tr"), function (tr) {
                bodyHtml += "<tr>";
                Array.prototype.forEach.call(tr.getElementsByTagNameNS("*", "tc"), function (tc) {
                  bodyHtml += "<td>" + Array.prototype.map.call(tc.getElementsByTagNameNS("*", "p"), paraText).filter(Boolean).join("<br>") + "</td>";
                });
                bodyHtml += "</tr>";
              });
              bodyHtml += "</table>";
            }
            return;
          }
          if (sp.localName !== "sp") return;
          var ph = sp.getElementsByTagNameNS("*", "ph")[0], type = ph ? ph.getAttribute("type") || "body" : "";
          if (type === "sldNum" || type === "dt" || type === "ftr") return;
          var paras = Array.prototype.map.call(sp.getElementsByTagNameNS("*", "p"), function (p) {
            var pr = kids(p, "pPr")[0];
            return { t: paraText(p), lvl: pr ? parseInt(pr.getAttribute("lvl"), 10) || 0 : 0 };
          }).filter(function (p) { return p.t.replace(/<br>/g, "").trim(); });
          if (!paras.length) return;
          if ((type === "title" || type === "ctrTitle") && !title) { title = paras.map(function (p) { return p.t; }).join(" "); return; }
          if (type === "body" || type === "obj" || paras.length > 1 && ph) {
            var cur = -1;
            paras.forEach(function (p) {
              while (cur < p.lvl) { bodyHtml += "<ul>"; cur++; }
              while (cur > p.lvl) { bodyHtml += "</ul>"; cur--; }
              bodyHtml += "<li>" + p.t + "</li>";
            });
            while (cur >= 0) { bodyHtml += "</ul>"; cur--; }
          } else paras.forEach(function (p) { bodyHtml += "<p>" + p.t + "</p>"; });
        });
      })(tree);
      html += "<h2>Dia " + (i + 1) + (title ? ": " + title : "") + "</h2>\n" + bodyHtml + "\n";
    }
    return { html: html };
  }

  /* ---------- lezen ---------- */
  D.read = async function (file, ext) {
    switch (ext) {
      case "docx": case "docm": {
        var res;
        try { res = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() }); }
        catch (e) { throw OZ.fail("Dit Word-bestand kan niet worden gelezen. Mogelijk is het beschadigd of met een wachtwoord beveiligd."); }
        return { html: res.value };
      }
      case "odt": return readOdt(file);
      case "rtf": return { html: rtfToHtml(new TextDecoder("windows-1252").decode(await file.arrayBuffer())) };
      case "md": case "markdown": return { html: marked.parse(await OZ.readText(file), { gfm: true, headerIds: false, mangle: false }) };
      case "html": case "htm": {
        var full = D.parseFull(await OZ.readText(file));
        return { body: full.body, title: full.title };
      }
      case "epub": return readEpub(file);
      case "pptx": return readPptx(file);
      default: return { html: textToHtml(await OZ.readText(file)) };
    }
  };

  OZ.conv.doc = async function (file, ext, target, opts) {
    var src = await D.read(file, ext), base = OZ.base(file.name);
    var body = src.body || D.parse(src.html), title = src.title || base;
    return [await D.write(body, target, base, title, opts || {})];
  };

  /* Schrijft een body-element naar het gevraagde documentformaat. */
  D.write = async function (body, target, base, title, opts) {
    var name = base + "." + OZ.TARGETS[target].ext, blocks;
    if (!body.textContent.trim() && !body.querySelector("img")) throw OZ.fail("In dit bestand is geen tekst gevonden om om te zetten.");
    switch (target) {
      case "html": return { name: name, blob: OZ.textBlob(D.toHtmlPage(body.innerHTML.trim(), title), "text/html") };
      case "md": return { name: name, blob: OZ.textBlob(D.toMarkdown(body), "text/markdown") };
      case "txt": return { name: name, blob: OZ.textBlob(D.toText(D.blocks(body)), "text/plain") };
      case "epub": return { name: name, blob: await D.toEpub(body, { title: title }) };
      case "rtf": return { name: name, blob: D.toRtf(D.blocks(body), opts) };
    }
    blocks = await D.loadImages(D.blocks(body));
    if (target === "pdf") return { name: name, blob: await D.toPdf(blocks, { fontSize: +opts.fontSize || 11, title: title, landscape: !!opts.landscape, margin: opts.margin }) };
    if (target === "docx") return { name: name, blob: await D.toDocx(blocks, { title: title, landscape: !!opts.landscape }) };
    if (target === "odt") return { name: name, blob: await D.toOdt(blocks, { title: title, landscape: !!opts.landscape }) };
    throw OZ.fail("Dit doelformaat wordt voor documenten niet ondersteund.");
  };
})();
