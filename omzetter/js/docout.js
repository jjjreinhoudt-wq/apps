/* Omzetter — blokken naar DOCX, ODT en RTF, en HTML naar EPUB. Allemaal eigen, kleine schrijvers bovenop JSZip. */
(function () {
  "use strict";
  var OZ = window.OZ, D = OZ.doc, X = OZ.escXml;

  /* ================= DOCX ================= */
  var W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

  D.toDocx = async function (blocks, opts) {
    opts = opts || {};
    var rels = [], media = [], rid = 10;
    function rel(type, target, external) { var id = "rId" + (rid++); rels.push('<Relationship Id="' + id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/' + type + '" Target="' + X(target) + '"' + (external ? ' TargetMode="External"' : "") + "/>"); return id; }
    function textRun(r, forceB) {
      var p = "";
      if (r.code) p += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>';
      if (r.b || forceB) p += "<w:b/>";
      if (r.i) p += "<w:i/>";
      if (r.s) p += "<w:strike/>";
      if (r.link) p += '<w:color w:val="1F4FD1"/>';
      if (r.u || r.link) p += '<w:u w:val="single"/>';
      if (r.code) p += '<w:sz w:val="20"/>';
      var rp = p ? "<w:rPr>" + p + "</w:rPr>" : "", out = "";
      r.text.split(/(\n|\t)/).forEach(function (t) {
        if (t === "\n") out += "<w:r>" + rp + "<w:br/></w:r>";
        else if (t === "\t") out += "<w:r>" + rp + "<w:tab/></w:r>";
        else if (t) out += "<w:r>" + rp + '<w:t xml:space="preserve">' + X(t) + "</w:t></w:r>";
      });
      return out;
    }
    function runsXml(runs, forceB) {
      var out = "", i = 0;
      while (i < runs.length) {
        var r = runs[i];
        if (r.br) { out += "<w:r><w:br/></w:r>"; i++; continue; }
        if (r.link) {
          var id = rel("hyperlink", r.link, true), inner = "";
          while (i < runs.length && !runs[i].br && runs[i].link === r.link) inner += textRun(runs[i++], forceB);
          out += '<w:hyperlink r:id="' + id + '">' + inner + "</w:hyperlink>";
          continue;
        }
        out += textRun(r, forceB); i++;
      }
      return out;
    }
    function paraXml(b) {
      var pp = "";
      if (b.level) pp += '<w:pStyle w:val="Heading' + b.level + '"/>';
      else if (b.pre) pp += '<w:pStyle w:val="Code"/>';
      else if (b.quote && !b.list) pp += '<w:pStyle w:val="Quote"/>';
      if (b.list) {
        var left = 720 + 360 * b.list.depth;
        if (!b.list.ordered && b.list.first !== false) pp += '<w:numPr><w:ilvl w:val="' + Math.min(8, b.list.depth) + '"/><w:numId w:val="1"/></w:numPr>';
        else if (b.list.ordered && b.list.first !== false) pp += '<w:tabs><w:tab w:val="left" w:pos="' + left + '"/></w:tabs><w:ind w:left="' + left + '" w:hanging="360"/>';
        else pp += '<w:ind w:left="' + left + '"/>';
        pp += '<w:contextualSpacing/>';
      }
      var lead = b.list && b.list.ordered && b.list.first !== false ? '<w:r><w:t xml:space="preserve">' + b.list.index + ".</w:t></w:r><w:r><w:tab/></w:r>" : "";
      return "<w:p>" + (pp ? "<w:pPr>" + pp + "</w:pPr>" : "") + lead + runsXml(b.runs) + "</w:p>";
    }
    function tableXml(b) {
      var n = 0; b.rows.forEach(function (r) { n = Math.max(n, r.cells.length); });
      var total = opts.landscape ? 13958 : 9026, cw = Math.floor(total / n), bd = "";
      ["top", "left", "bottom", "right", "insideH", "insideV"].forEach(function (s) { bd += "<w:" + s + ' w:val="single" w:sz="4" w:space="0" w:color="A6ADB7"/>'; });
      var out = '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>' + bd + '</w:tblBorders><w:tblLayout w:type="autofit"/><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>';
      for (var i = 0; i < n; i++) out += '<w:gridCol w:w="' + cw + '"/>';
      out += "</w:tblGrid>";
      b.rows.forEach(function (r, ri) {
        var allHead = r.cells.length && r.cells.every(function (c) { return c.header; });
        out += "<w:tr>" + (allHead && ri === 0 ? "<w:trPr><w:tblHeader/></w:trPr>" : "");
        for (var c = 0; c < n; c++) {
          var cell = r.cells[c] || { runs: [], header: false };
          out += '<w:tc><w:tcPr><w:tcW w:w="' + cw + '" w:type="dxa"/>' + (cell.header ? '<w:shd w:val="clear" w:color="auto" w:fill="EEF1F4"/>' : "") + '</w:tcPr><w:p><w:pPr><w:spacing w:after="0"/></w:pPr>' + runsXml(cell.runs, cell.header) + "</w:p></w:tc>";
        }
        out += "</w:tr>";
      });
      return out + "</w:tbl><w:p/>";
    }
    function imgXml(b, n) {
      var e = b.mime === "image/jpeg" ? "jpeg" : "png", name = "image" + n + "." + e;
      media.push({ name: "word/media/" + name, data: b.bytes });
      var id = rel("image", "media/" + name), maxW = opts.landscape ? 8860000 : 5730000;
      var cx = b.w * 9525, cy = b.h * 9525;
      if (cx > maxW) { cy = cy * maxW / cx; cx = maxW; }
      if (cy > 8200000) { cx = cx * 8200000 / cy; cy = 8200000; }
      cx = Math.round(cx); cy = Math.round(cy);
      return '<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + n + '" name="Afbeelding ' + n + '" descr="' + X(b.alt || "") + '"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="' + n + '" name="' + name + '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + id + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
    }
    var body = "", imgN = 0;
    blocks.forEach(function (b) {
      if (b.type === "para") body += paraXml(b);
      else if (b.type === "table") body += tableXml(b);
      else if (b.type === "img") body += imgXml(b, ++imgN);
      else if (b.type === "hr") body += '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="A6ADB7"/></w:pBdr></w:pPr></w:p>';
    });
    if (!body) body = "<w:p/>";
    var pg = opts.landscape ? '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>' : '<w:pgSz w:w="11906" w:h="16838"/>';
    var documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ' + W_NS + "><w:body>" + body + "<w:sectPr>" + pg + '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';

    function hs(n, sz, before) { return '<w:style w:type="paragraph" w:styleId="Heading' + n + '"><w:name w:val="heading ' + n + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="' + before + '" w:after="100"/><w:outlineLvl w:val="' + (n - 1) + '"/></w:pPr><w:rPr><w:b/><w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/></w:rPr></w:style>'; }
    var stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="nl-NL"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      hs(1, 40, 360) + hs(2, 32, 300) + hs(3, 26, 240) + hs(4, 24, 200) + hs(5, 22, 200) + hs(6, 22, 200) +
      '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="A6ADB7"/></w:pBdr><w:ind w:left="360"/></w:pPr><w:rPr><w:color w:val="444444"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F3F5F7"/><w:spacing w:after="160" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/></w:rPr></w:style>' +
      "</w:styles>";
    var lv = "";
    for (var l = 0; l < 9; l++) lv += '<w:lvl w:ilvl="' + l + '"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="' + (l % 2 ? "\u2013" : "\u2022") + '"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="' + (720 + 360 * l) + '" w:hanging="360"/></w:pPr></w:lvl>';
    var numberingXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' + lv + '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';
    var z = new JSZip();
    z.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>');
    z.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>');
    z.file("docProps/core.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' + X(opts.title || "") + "</dc:title><dc:creator>Omzetter</dc:creator></cp:coreProperties>");
    z.file("word/document.xml", documentXml);
    z.file("word/styles.xml", stylesXml);
    z.file("word/numbering.xml", numberingXml);
    z.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' + rels.join("") + "</Relationships>");
    media.forEach(function (m) { z.file(m.name, m.data); });
    return z.generateAsync({ type: "blob", compression: "DEFLATE", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  };

  /* ================= ODT ================= */
  var O_NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" office:version="1.2"';
  D.toOdt = async function (blocks, opts) {
    opts = opts || {};
    var pics = [];
    function odText(t) {
      return X(t).replace(/\n/g, "<text:line-break/>").replace(/\t/g, "<text:tab/>").replace(/ {2,}/g, function (m) { return ' <text:s text:c="' + (m.length - 1) + '"/>'; });
    }
    function runs(rs, forceB) {
      return rs.map(function (r) {
        if (r.br) return "<text:line-break/>";
        var n = (r.b || forceB ? 1 : 0) + (r.i ? 2 : 0) + (r.u ? 4 : 0) + (r.code ? 8 : 0) + (r.s ? 16 : 0);
        var t = odText(r.text);
        if (n) t = '<text:span text:style-name="T' + n + '">' + t + "</text:span>";
        if (r.link) t = '<text:a xlink:type="simple" xlink:href="' + X(r.link) + '">' + t + "</text:a>";
        return t;
      }).join("");
    }
    var auto = "";
    for (var n = 1; n < 32; n++) auto += '<style:style style:name="T' + n + '" style:family="text"><style:text-properties' + (n & 1 ? ' fo:font-weight="bold"' : "") + (n & 2 ? ' fo:font-style="italic"' : "") + (n & 4 ? ' style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"' : "") + (n & 8 ? ' style:font-name="Courier New" fo:font-family="\'Courier New\'" fo:font-size="10pt"' : "") + (n & 16 ? ' style:text-line-through-style="solid"' : "") + "/></style:style>";
    auto += '<style:style style:name="Cel" style:family="table-cell"><style:table-cell-properties fo:border="0.5pt solid #a6adb7" fo:padding="0.1cm"/></style:style>';
    auto += '<style:style style:name="Kop" style:family="table-cell"><style:table-cell-properties fo:border="0.5pt solid #a6adb7" fo:padding="0.1cm" fo:background-color="#eef1f4"/></style:style>';
    auto += '<style:style style:name="Inspr" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-left="1cm"/></style:style>';
    auto += '<style:style style:name="Beeld" style:family="graphic"><style:graphic-properties style:wrap="none" style:vertical-pos="top" style:horizontal-pos="left"/></style:style>';
    var body = "", tn = 0, pn = 0;
    blocks.forEach(function (b) {
      if (b.type === "para") {
        if (b.level) { body += '<text:h text:style-name="Heading_20_' + b.level + '" text:outline-level="' + b.level + '">' + runs(b.runs) + "</text:h>"; return; }
        var style = b.pre ? "Preformatted_20_Text" : b.quote ? "Quotations" : "Text_20_body";
        if (b.list) {
          if (!b.list.ordered && b.list.first !== false) {
            var open = "", close = "";
            for (var d = 0; d <= b.list.depth; d++) { open += "<text:list><text:list-item>"; close = "</text:list-item></text:list>" + close; }
            body += open + '<text:p text:style-name="Text_20_body">' + runs(b.runs) + "</text:p>" + close;
          } else {
            body += '<text:p text:style-name="Inspr">' + (b.list.ordered && b.list.first !== false ? b.list.index + ". " : "") + runs(b.runs) + "</text:p>";
          }
          return;
        }
        body += '<text:p text:style-name="' + style + '">' + runs(b.runs) + "</text:p>";
      } else if (b.type === "table") {
        var cols = 0; b.rows.forEach(function (r) { cols = Math.max(cols, r.cells.length); });
        body += '<table:table table:name="Tabel' + (++tn) + '"><table:table-column table:number-columns-repeated="' + cols + '"/>';
        b.rows.forEach(function (r) {
          body += "<table:table-row>";
          for (var c = 0; c < cols; c++) {
            var cell = r.cells[c] || { runs: [], header: false };
            body += '<table:table-cell table:style-name="' + (cell.header ? "Kop" : "Cel") + '" office:value-type="string"><text:p text:style-name="Table_20_Contents">' + runs(cell.runs, cell.header) + "</text:p></table:table-cell>";
          }
          body += "</table:table-row>";
        });
        body += '</table:table><text:p text:style-name="Text_20_body"/>';
      } else if (b.type === "img") {
        var e = b.mime === "image/jpeg" ? "jpg" : "png", name = "Pictures/beeld" + (++pn) + "." + e;
        pics.push({ name: name, data: b.bytes, mime: b.mime });
        var wcm = b.w * 2.54 / 96, hcm = b.h * 2.54 / 96, k = Math.min(1, 16 / wcm, 23 / hcm);
        body += '<text:p text:style-name="Text_20_body"><draw:frame draw:style-name="Beeld" draw:name="Afbeelding' + pn + '" text:anchor-type="as-char" svg:width="' + (wcm * k).toFixed(2) + 'cm" svg:height="' + (hcm * k).toFixed(2) + 'cm"><draw:image xlink:href="' + name + '" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame></text:p>';
      } else if (b.type === "hr") {
        body += '<text:p text:style-name="Horizontal_20_Line"/>';
      }
    });
    var content = '<?xml version="1.0" encoding="UTF-8"?>\n<office:document-content ' + O_NS + "><office:automatic-styles>" + auto + "</office:automatic-styles><office:body><office:text>" + body + "</office:text></office:body></office:document-content>";
    function ps(name, display, props, tprops, parent) { return '<style:style style:name="' + name + '" style:display-name="' + display + '" style:family="paragraph"' + (parent ? ' style:parent-style-name="' + parent + '"' : "") + '><style:paragraph-properties ' + props + "/>" + (tprops ? "<style:text-properties " + tprops + "/>" : "") + "</style:style>"; }
    var hsz = [0, 20, 16, 13, 12, 11, 11], heads = "";
    for (var h = 1; h <= 6; h++) heads += ps("Heading_20_" + h, "Heading " + h, 'fo:margin-top="0.5cm" fo:margin-bottom="0.2cm" fo:keep-with-next="always"', 'fo:font-size="' + hsz[h] + 'pt" fo:font-weight="bold"', "Standard");
    var styles = '<?xml version="1.0" encoding="UTF-8"?>\n<office:document-styles ' + O_NS + '><office:font-face-decls><style:font-face style:name="Calibri" svg:font-family="Calibri, Carlito, Arial" style:font-family-generic="swiss"/><style:font-face style:name="Courier New" svg:font-family="\'Courier New\'" style:font-family-generic="modern"/></office:font-face-decls><office:styles><style:default-style style:family="paragraph"><style:paragraph-properties fo:line-height="120%"/><style:text-properties style:font-name="Calibri" fo:font-size="11pt" fo:language="nl" fo:country="NL"/></style:default-style>' +
      '<style:style style:name="Standard" style:family="paragraph"/>' + ps("Text_20_body", "Text body", 'fo:margin-top="0cm" fo:margin-bottom="0.25cm"', "", "Standard") + heads +
      ps("Quotations", "Quotations", 'fo:margin-left="1cm" fo:margin-bottom="0.25cm"', 'fo:color="#444444"', "Standard") +
      ps("Preformatted_20_Text", "Preformatted Text", 'fo:margin-bottom="0.25cm" fo:background-color="#f3f5f7"', 'style:font-name="Courier New" fo:font-size="10pt"', "Standard") +
      ps("Table_20_Contents", "Table Contents", 'fo:margin-bottom="0cm"', "", "Standard") +
      ps("Horizontal_20_Line", "Horizontal Line", 'fo:margin-bottom="0.5cm" fo:border-bottom="0.5pt solid #a6adb7" fo:padding="0cm"', 'fo:font-size="6pt"', "Standard") +
      '</office:styles><office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="' + (opts.landscape ? "29.7cm" : "21cm") + '" fo:page-height="' + (opts.landscape ? "21cm" : "29.7cm") + '" style:print-orientation="' + (opts.landscape ? "landscape" : "portrait") + '" fo:margin="2.5cm"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles></office:document-styles>';
    var manifest = '<?xml version="1.0" encoding="UTF-8"?>\n<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>' +
      pics.map(function (p) { return '<manifest:file-entry manifest:full-path="' + p.name + '" manifest:media-type="' + p.mime + '"/>'; }).join("") + "</manifest:manifest>";
    var meta = '<?xml version="1.0" encoding="UTF-8"?>\n<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" office:version="1.2"><office:meta><dc:title>' + X(opts.title || "") + "</dc:title><meta:generator>Omzetter</meta:generator></office:meta></office:document-meta>";
    var z = new JSZip();
    z.file("mimetype", "application/vnd.oasis.opendocument.text", { compression: "STORE" });
    z.file("content.xml", content); z.file("styles.xml", styles); z.file("meta.xml", meta);
    z.file("META-INF/manifest.xml", manifest);
    pics.forEach(function (p) { z.file(p.name, p.data); });
    return z.generateAsync({ type: "blob", compression: "DEFLATE", mimeType: "application/vnd.oasis.opendocument.text" });
  };

  /* ================= RTF ================= */
  function rtfEsc(s) {
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i), ch = s[i];
      if (ch === "\\" || ch === "{" || ch === "}") out += "\\" + ch;
      else if (ch === "\n") out += "\\line ";
      else if (ch === "\t") out += "\\tab ";
      else if (c < 32) continue;
      else if (c < 128) out += ch;
      else out += "\\u" + (c > 32767 ? c - 65536 : c) + "?";
    }
    return out;
  }
  D.toRtf = function (blocks, opts) {
    function runs(rs, forceB) {
      return rs.map(function (r) {
        if (r.br) return "\\line ";
        var on = "", t = rtfEsc(r.text);
        if (r.b || forceB) on += "\\b";
        if (r.i) on += "\\i";
        if (r.u || r.link) on += "\\ul";
        if (r.s) on += "\\strike";
        if (r.code) on += "\\f1";
        return on ? "{" + on + " " + t + "}" : t;
      }).join("");
    }
    var hsz = [0, 40, 32, 26, 24, 22, 22];
    var out = "{\\rtf1\\ansi\\ansicpg1252\\deff0\\deflang1043{\\fonttbl{\\f0\\fswiss Calibri;}{\\f1\\fmodern Courier New;}}\\paperw11906\\paperh16838\\margl1440\\margr1440\\margt1440\\margb1440\\f0\\fs22\n";
    blocks.forEach(function (b) {
      if (b.type === "para") {
        if (b.level) { out += "\\pard\\sb240\\sa120\\keepn{\\b\\fs" + hsz[b.level] + " " + runs(b.runs) + "}\\par\n"; return; }
        if (b.list) {
          var li = 720 + 360 * b.list.depth, mark = b.list.first === false ? "" : (b.list.ordered ? b.list.index + "." : "\\bullet") + "\\tab ";
          out += "\\pard\\li" + li + (mark ? "\\fi-360" : "") + "\\sa60 " + mark + runs(b.runs) + "\\par\n"; return;
        }
        out += "\\pard" + (b.quote ? "\\li720" : "") + "\\sa160 " + (b.pre ? "{\\f1\\fs20 " + runs(b.runs) + "}" : runs(b.runs)) + "\\par\n";
      } else if (b.type === "table") {
        var n = 0; b.rows.forEach(function (r) { n = Math.max(n, r.cells.length); });
        var cw = Math.floor(9026 / n);
        b.rows.forEach(function (r) {
          out += "\\trowd\\trgaph100";
          for (var c = 1; c <= n; c++) out += "\\clbrdrt\\brdrs\\brdrw10\\clbrdrl\\brdrs\\brdrw10\\clbrdrb\\brdrs\\brdrw10\\clbrdrr\\brdrs\\brdrw10\\cellx" + cw * c;
          out += "\n";
          for (var c2 = 0; c2 < n; c2++) { var cell = r.cells[c2] || { runs: [] }; out += "\\pard\\intbl " + runs(cell.runs, cell.header) + "\\cell\n"; }
          out += "\\row\n";
        });
        out += "\\pard\\par\n";
      } else if (b.type === "hr") {
        out += "\\pard\\brdrb\\brdrs\\brdrw10\\brsp20 \\par\\pard\n";
      } else if (b.type === "img" && b.alt) {
        out += "\\pard\\sa160 [" + rtfEsc(b.alt) + "]\\par\n";
      }
    });
    return new Blob([out + "}"], { type: "application/rtf" });
  };

  /* ================= EPUB ================= */
  D.toEpub = async function (body, opts) {
    opts = opts || {};
    var title = opts.title || "Document", z = new JSZip(), doc = body.ownerDocument;
    z.file("mimetype", "application/epub+zip", { compression: "STORE" });   /* moet het eerste bestand zijn, onverpakt */
    var uid = "urn:uuid:" + ("10000000-1000-4000-8000-100000000000").replace(/[018]/g, function (c) { return (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16); });
    body = body.cloneNode(true);
    /* afbeeldingen uit data-URI's naar losse bestanden */
    var images = [], imgs = body.querySelectorAll("img");
    for (var i = 0; i < imgs.length; i++) {
      var p = OZ.dataUriParts(imgs[i].getAttribute("src") || "");
      var e = p && { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/svg+xml": "svg", "image/webp": "webp" }[p.mime];
      if (!e) { imgs[i].remove(); continue; }
      var name = "images/beeld" + (images.length + 1) + "." + e;
      images.push({ name: name, data: p.bytes, mime: p.mime });
      imgs[i].setAttribute("src", name);
      if (!imgs[i].hasAttribute("alt")) imgs[i].setAttribute("alt", "");
    }
    /* hoofdstukken: knippen op de hoogste kop die vaker dan één keer voorkomt */
    var splitTag = body.querySelectorAll("h1").length > 1 ? "H1" : body.querySelectorAll("h2").length > 1 ? "H2" : null;
    var chapters = [], cur = { title: title, nodes: [] };
    Array.prototype.slice.call(body.childNodes).forEach(function (n) {
      if (splitTag && n.nodeType === 1 && n.tagName.toUpperCase() === splitTag && cur.nodes.some(function (x) { return x.nodeType === 1 || x.nodeValue.trim(); })) {
        chapters.push(cur); cur = { title: n.textContent.trim() || title, nodes: [] };
      } else if (splitTag && n.nodeType === 1 && n.tagName.toUpperCase() === splitTag) cur.title = n.textContent.trim() || title;
      cur.nodes.push(n);
    });
    chapters.push(cur);
    var ser = new XMLSerializer();
    var css = "body{font-family:serif;line-height:1.5;margin:1em}h1,h2,h3{font-family:sans-serif;line-height:1.2}img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid #999;padding:.3em .5em;text-align:left}pre{white-space:pre-wrap;font-size:.85em}blockquote{margin-left:1em;padding-left:1em;border-left:3px solid #bbb}";
    var manifest = "", spine = "", nav = "";
    chapters.forEach(function (ch, idx) {
      var holder = doc.createElement("div");
      ch.nodes.forEach(function (n) { holder.appendChild(n); });
      var inner = ser.serializeToString(holder).replace(/^<div[^>]*>/, "").replace(/<\/div>$/, "").replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, "");
      var file = "h" + OZ.pad(idx + 1, 3) + ".xhtml";
      z.file("OEBPS/" + file, '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="nl" lang="nl"><head><meta charset="utf-8"/><title>' + X(ch.title) + '</title><link rel="stylesheet" type="text/css" href="stijl.css"/></head><body>' + inner + "</body></html>");
      manifest += '<item id="h' + (idx + 1) + '" href="' + file + '" media-type="application/xhtml+xml"/>';
      spine += '<itemref idref="h' + (idx + 1) + '"/>';
      nav += '<li><a href="' + file + '">' + X(ch.title) + "</a></li>";
    });
    images.forEach(function (im, idx) { z.file("OEBPS/" + im.name, im.data); manifest += '<item id="b' + (idx + 1) + '" href="' + im.name + '" media-type="' + im.mime + '"/>'; });
    z.file("META-INF/container.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/inhoud.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
    z.file("OEBPS/stijl.css", css);
    z.file("OEBPS/nav.xhtml", '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="nl" lang="nl"><head><meta charset="utf-8"/><title>Inhoud</title></head><body><nav epub:type="toc" id="toc"><h1>Inhoud</h1><ol>' + nav + "</ol></nav></body></html>");
    z.file("OEBPS/inhoud.opf", '<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="boekid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="boekid">' + uid + "</dc:identifier><dc:title>" + X(title) + '</dc:title><dc:language>nl</dc:language><meta property="dcterms:modified">' + new Date().toISOString().replace(/\.\d+Z$/, "Z") + '</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="stijl.css" media-type="text/css"/>' + manifest + "</manifest><spine>" + spine + "</spine></package>");
    return z.generateAsync({ type: "blob", compression: "DEFLATE", mimeType: "application/epub+zip" });
  };
})();
