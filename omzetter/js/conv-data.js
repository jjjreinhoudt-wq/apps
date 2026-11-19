/* Omzetter — tabellen en gegevens. Alles wordt eerst een lijst tabellen {name, rows:[[cel]]};
   JSON, YAML en XML houden daarnaast hun boomvorm zodat ze onderling zonder verlies omgezet worden. */
(function () {
  "use strict";
  var OZ = window.OZ, D = OZ.doc, T = (OZ.table = {});

  /* ---------- datums ---------- */
  function isDate(v) { return v && typeof v === "object" && v.y != null; }
  var p2 = function (n) { return OZ.pad(n, 2); };
  T.fmtDate = function (d, style) {
    var hasTime = d.H || d.M || d.S, hasDay = d.y > 1900 || d.m > 1 || d.d > 0;
    var time = p2(d.H) + ":" + p2(d.M) + (d.S ? ":" + p2(d.S) : "");
    if (!hasDay && hasTime) return time;
    if (style === "iso") return d.y + "-" + p2(d.m) + "-" + p2(d.d) + (hasTime ? "T" + p2(d.H) + ":" + p2(d.M) + ":" + p2(d.S) : "");
    return p2(d.d) + "-" + p2(d.m) + "-" + d.y + (hasTime ? " " + time : "");
  };
  function plain(v, style) { return v == null ? "" : isDate(v) ? T.fmtDate(v, style || "nl") : v; }
  function cellText(v, style, comma) {
    if (v == null) return "";
    if (isDate(v)) return T.fmtDate(v, style);
    if (typeof v === "number") { var s = String(v); return comma ? s.replace(".", ",") : s; }
    if (typeof v === "boolean") return v ? (comma ? "WAAR" : "TRUE") : (comma ? "ONWAAR" : "FALSE");
    return String(v);
  }

  /* ---------- CSV ---------- */
  T.detectDelimiter = function (text) {
    var lines = [], line = "", q = false, i, ch;
    for (i = 0; i < text.length && lines.length < 30; i++) {
      ch = text[i];
      if (ch === '"') q = !q;
      if ((ch === "\n" || ch === "\r") && !q) { if (line.trim()) lines.push(line); line = ""; }
      else line += ch;
    }
    if (line.trim() && lines.length < 30) lines.push(line);
    var best = ",", bestScore = 0;
    [";", ",", "\t", "|"].forEach(function (d) {
      var counts = lines.map(function (l) {
        var n = 0, inq = false;
        for (var k = 0; k < l.length; k++) { if (l[k] === '"') inq = !inq; else if (l[k] === d && !inq) n++; }
        return n;
      });
      if (!counts.length || !counts[0]) return;
      var same = counts.filter(function (c) { return c === counts[0]; }).length / counts.length;
      var score = counts[0] * same * same + (same === 1 ? 0.5 : 0);
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  };
  T.parseCsv = function (text, delim) {
    var rows = [], row = [], cell = "", q = false, i = 0, n = text.length, ch, quoted = false;
    while (i < n) {
      ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i += 2; continue; } q = false; i++; continue; }
        cell += ch; i++; continue;
      }
      if (ch === '"' && cell === "") { q = true; quoted = true; i++; continue; }
      if (ch === delim) { row.push(quoted ? { q: cell } : cell); cell = ""; quoted = false; i++; continue; }
      if (ch === "\r" || ch === "\n") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(quoted ? { q: cell } : cell); cell = ""; quoted = false;
        rows.push(row); row = []; i++; continue;
      }
      cell += ch; i++;
    }
    if (cell !== "" || quoted || row.length) { row.push(quoted ? { q: cell } : cell); rows.push(row); }
    while (rows.length && rows[rows.length - 1].every(function (c) { return c === ""; })) rows.pop();
    return rows;
  };
  /* Maakt van tekstcellen getallen waar dat veilig kan. Postcodes, telefoonnummers en lange codes blijven tekst. */
  T.typeCells = function (rows, delim, recognise) {
    var comma = 0, point = 0;
    if (recognise && delim !== ",") {
      rows.slice(0, 500).forEach(function (r) {
        r.forEach(function (c) {
          if (typeof c !== "string") return;
          if (/^-?\d+,\d+$/.test(c)) comma++; else if (/^-?\d+\.\d+$/.test(c) && !/^-?\d{1,3}(\.\d{3})+$/.test(c)) point++;
        });
      });
    }
    var dutch = delim !== "," && (comma > 0 || point === 0);
    return rows.map(function (r) {
      return r.map(function (c) {
        if (c && typeof c === "object") return c.q;              /* stond tussen aanhalingstekens: tekst */
        if (!recognise || c === "") return c === "" ? null : c;
        var s = c.trim();
        if (!/^-?[\d.,]+$/.test(s) || /^-?0\d/.test(s) || s.replace(/\D/g, "").length > 15) return c;
        var num = null;
        if (dutch) {
          if (/^-?\d+(,\d+)?$/.test(s)) num = s.replace(",", ".");
          else if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) num = s.replace(/\./g, "").replace(",", ".");
          else if (/^-?\d+\.\d+$/.test(s) && comma === 0) num = s;
        } else {
          if (/^-?\d+(\.\d+)?$/.test(s)) num = s;
        }
        return num == null ? c : parseFloat(num);
      });
    });
  };
  T.toCsv = function (rows, delim, opts) {
    var comma = delim === ";", style = delim === ";" ? "nl" : "iso";
    var re = new RegExp('["\\r\\n' + (delim === "\t" ? "\\t" : "\\" + delim) + "]");
    return rows.map(function (r) {
      return r.map(function (v) {
        var s = cellText(v, style, comma && typeof v === "number");
        if (typeof v === "boolean") s = v ? "TRUE" : "FALSE";
        return re.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(delim);
    }).join("\r\n") + "\r\n";
  };

  /* ---------- boom (JSON/YAML/XML) <-> tabellen ---------- */
  function flatten(obj, prefix, out) {
    Object.keys(obj).forEach(function (k) {
      var v = obj[k], key = prefix ? prefix + "." + k : k;
      if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) flatten(v, key, out);
      else if (Array.isArray(v)) out[key] = v.every(function (x) { return x == null || typeof x !== "object"; }) ? v.join("; ") : JSON.stringify(v);
      else if (v instanceof Date) out[key] = v.toISOString();
      else out[key] = v;
    });
    return out;
  }
  function prim(v) {
    if (v == null) return null;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "object") return JSON.stringify(v);
    return v;
  }
  function tableFromArray(arr, name) {
    if (arr.length && arr.every(Array.isArray)) return { name: name, rows: arr.map(function (r) { return r.map(prim); }) };
    var keys = [], seen = {}, flat = arr.map(function (it) {
      var f = it && typeof it === "object" && !Array.isArray(it) ? flatten(it, "", {}) : { waarde: prim(it) };
      Object.keys(f).forEach(function (k) { if (!seen[k]) { seen[k] = 1; keys.push(k); } });
      return f;
    });
    return { name: name, rows: [keys].concat(flat.map(function (f) { return keys.map(function (k) { return f[k] === undefined ? null : f[k]; }); })) };
  }
  T.fromTree = function (value) {
    if (Array.isArray(value)) return [tableFromArray(value, "Gegevens")];
    if (value && typeof value === "object") {
      var found = [], queue = [{ v: value, key: "Gegevens", depth: 0 }];
      while (queue.length) {
        var it = queue.shift();
        Object.keys(it.v).forEach(function (k) {
          var c = it.v[k];
          if (Array.isArray(c)) { if (c.length && c.some(function (x) { return x && typeof x === "object"; })) found.push(tableFromArray(c, k)); }
          else if (c && typeof c === "object" && it.depth < 6) queue.push({ v: c, key: k, depth: it.depth + 1 });
        });
      }
      if (found.length) return found;
      var f = flatten(value, "", {});
      return [{ name: "Gegevens", rows: [["sleutel", "waarde"]].concat(Object.keys(f).map(function (k) { return [k, prim(f[k])]; })) }];
    }
    return [{ name: "Gegevens", rows: [["waarde"], [prim(value)]] }];
  };
  function headerKeys(row) {
    var seen = {};
    return row.map(function (h, i) {
      var k = String(plain(h)).trim() || "kolom" + (i + 1), base = k, n = 2;
      while (seen[k]) k = base + "_" + n++;
      seen[k] = 1; return k;
    });
  }
  T.toObjects = function (tables, header) {
    function one(t) {
      if (!header) return t.rows.map(function (r) { return r.map(function (v) { return isDate(v) ? T.fmtDate(v, "iso") : v; }); });
      if (!t.rows.length) return [];
      var keys = headerKeys(t.rows[0]);
      return t.rows.slice(1).map(function (r) {
        var o = {};
        keys.forEach(function (k, i) { var v = r[i]; o[k] = v === undefined ? null : isDate(v) ? T.fmtDate(v, "iso") : v; });
        return o;
      });
    }
    if (tables.length === 1) return one(tables[0]);
    var out = {};
    tables.forEach(function (t) { out[t.name] = one(t); });
    return out;
  };

  /* ---------- XML ---------- */
  function xmlToTree(el) {
    var obj = {}, has = false, text = "", i;
    for (i = 0; i < el.attributes.length; i++) { var a = el.attributes[i]; if (a.name.indexOf("xmlns") !== 0) { obj["@" + a.name] = a.value; has = true; } }
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3 || n.nodeType === 4) text += n.nodeValue;
      else if (n.nodeType === 1) {
        var v = xmlToTree(n), k = n.nodeName;
        if (obj[k] === undefined) obj[k] = v; else if (Array.isArray(obj[k])) obj[k].push(v); else obj[k] = [obj[k], v];
        has = true;
      }
    }
    text = text.trim();
    if (!has) {
      if (/^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(text)) return parseFloat(text);
      return text === "" ? null : text;
    }
    if (text) obj["#text"] = text;
    return obj;
  }
  function xmlName(k) {
    var n = String(k).trim().replace(/[^\w.\-À-\uffff]+/g, "_").replace(/^_+|_+$/g, "");
    if (!n) n = "veld";
    if (!/^[A-Za-z_À-\uffff]/.test(n)) n = "_" + n;
    return /^xml/i.test(n) ? "_" + n : n;
  }
  function treeToXml(value, name, indent) {
    var pad = new Array(indent + 1).join("  "), X = OZ.escXml;
    if (Array.isArray(value)) return value.map(function (v) { return treeToXml(v, name, indent); }).join("");
    if (value instanceof Date) value = value.toISOString();
    if (value == null) return pad + "<" + name + "/>\n";
    if (typeof value !== "object") return pad + "<" + name + ">" + X(value) + "</" + name + ">\n";
    var attrs = "", inner = "", text = null;
    Object.keys(value).forEach(function (k) {
      var v = value[k];
      if (k[0] === "@" && (v == null || typeof v !== "object")) attrs += " " + xmlName(k.slice(1)) + '="' + X(v) + '"';
      else if (k === "#text") text = v;
      else if (Array.isArray(v) && v.some(Array.isArray)) inner += v.map(function (r) { return treeToXml({ item: r }, xmlName(k), indent + 1); }).join("");
      else inner += treeToXml(v, xmlName(k), indent + 1);
    });
    if (!inner) return pad + "<" + name + attrs + (text == null ? "/>" : ">" + X(text) + "</" + name + ">") + "\n";
    return pad + "<" + name + attrs + ">\n" + (text != null ? pad + "  " + X(text) + "\n" : "") + inner + pad + "</" + name + ">\n";
  }
  T.treeToXmlDoc = function (tree) {
    var root = "gegevens", val = tree;
    if (tree && typeof tree === "object" && !Array.isArray(tree)) {
      var ks = Object.keys(tree);
      if (ks.length === 1 && tree[ks[0]] && typeof tree[ks[0]] === "object" && !Array.isArray(tree[ks[0]])) { root = xmlName(ks[0]); val = tree[ks[0]]; }
    } else if (Array.isArray(tree)) val = { item: tree };
    else val = { waarde: tree };
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + treeToXml(val, root, 0);
  };
  T.tablesToXmlDoc = function (tables, header) {
    var X = OZ.escXml, out = '<?xml version="1.0" encoding="UTF-8"?>\n<gegevens>\n';
    tables.forEach(function (t) {
      var keys = header && t.rows.length ? headerKeys(t.rows[0]).map(xmlName) : null, ind = "  ";
      if (tables.length > 1) { out += '  <blad naam="' + X(t.name) + '">\n'; ind = "    "; }
      t.rows.slice(keys ? 1 : 0).forEach(function (r) {
        out += ind + "<rij>\n";
        var n = keys ? keys.length : r.length;
        for (var i = 0; i < n; i++) {
          var v = r[i], k = keys ? keys[i] : "kolom" + (i + 1);
          out += v == null || v === "" ? ind + "  <" + k + "/>\n" : ind + "  <" + k + ">" + X(cellText(v, "iso")) + "</" + k + ">\n";
        }
        out += ind + "</rij>\n";
      });
      if (tables.length > 1) out += "  </blad>\n";
    });
    return out + "</gegevens>\n";
  };

  /* ---------- werkmap (SheetJS) ---------- */
  function sheetRows(ws) {
    if (!ws || !ws["!ref"]) return [];
    var rg = XLSX.utils.decode_range(ws["!ref"]), rows = [], lastRow = -1, lastCol = -1;
    if (rg.e.r - rg.s.r > 200000) rg.e.r = rg.s.r + 200000;
    for (var R = rg.s.r; R <= rg.e.r; R++) {
      var row = [];
      for (var C = rg.s.c; C <= rg.e.c; C++) {
        var cell = ws[XLSX.utils.encode_cell({ r: R, c: C })], v = null;
        if (cell && cell.t !== "z" && cell.v !== undefined) {
          if (cell.t === "n") {
            if (cell.z && XLSX.SSF.is_date(String(cell.z))) { var d = XLSX.SSF.parse_date_code(cell.v); v = d ? { y: d.y, m: d.m, d: d.d, H: d.H, M: d.M, S: Math.round(d.S), serial: cell.v } : cell.v; }
            else v = cell.v;
          } else if (cell.t === "b") v = !!cell.v;
          else if (cell.t === "e") v = cell.w || "#FOUT";
          else if (cell.t === "d") { var dt = new Date(cell.v); v = { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate(), H: dt.getHours(), M: dt.getMinutes(), S: dt.getSeconds() }; }
          else v = String(cell.v);
          if (v !== "" && v != null) { lastRow = rows.length; if (C - rg.s.c > lastCol) lastCol = C - rg.s.c; }
          if (v === "") v = null;
        }
        row.push(v);
      }
      rows.push(row);
    }
    return rows.slice(0, lastRow + 1).map(function (r) { return r.slice(0, lastCol + 1); });
  }
  function sheetName(name, used) {
    var n = String(name || "Blad").replace(/[\[\]:*?\/\\]/g, " ").trim().slice(0, 31) || "Blad", base = n, k = 2;
    while (used[n.toLowerCase()]) { var suf = " " + k++; n = base.slice(0, 31 - suf.length) + suf; }
    used[n.toLowerCase()] = 1; return n;
  }
  function dateSerial(d) {
    if (d.serial != null) return d.serial;
    var ms = Date.UTC(d.y, d.m - 1, d.d, d.H || 0, d.M || 0, d.S || 0);
    return ms / 86400000 + 25569;
  }
  T.toWorkbook = function (tables) {
    var wb = XLSX.utils.book_new(), used = {};
    tables.forEach(function (t) {
      var ws = {}, maxC = 0, widths = [];
      t.rows.forEach(function (r, R) {
        r.forEach(function (v, C) {
          if (v == null || v === "") return;
          var cell;
          if (isDate(v)) { var hasT = v.H || v.M || v.S; cell = { t: "n", v: dateSerial(v), z: hasT ? "dd-mm-yyyy hh:mm" : "dd-mm-yyyy" }; }
          else if (typeof v === "number" && isFinite(v)) cell = { t: "n", v: v };
          else if (typeof v === "boolean") cell = { t: "b", v: v };
          else cell = { t: "s", v: String(v).slice(0, 32767) };
          ws[XLSX.utils.encode_cell({ r: R, c: C })] = cell;
          if (C > maxC) maxC = C;
          if (R < 200) { var len = isDate(v) ? 11 : String(v).length; if (!widths[C] || len > widths[C]) widths[C] = len; }
        });
      });
      ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, t.rows.length - 1), c: maxC } });
      ws["!cols"] = []; for (var c = 0; c <= maxC; c++) ws["!cols"].push({ wch: Math.max(6, Math.min(50, (widths[c] || 6) + 2)) });
      XLSX.utils.book_append_sheet(wb, ws, sheetName(t.name, used));
    });
    return wb;
  };

  /* ---------- lezen ---------- */
  T.read = async function (file, ext, opts) {
    opts = opts || {};
    var recognise = opts.numbers !== false;
    if (ext === "csv" || ext === "tsv") {
      var text = await OZ.readText(file), delim = ext === "tsv" ? "\t" : T.detectDelimiter(text);
      return { tables: [{ name: OZ.base(file.name), rows: T.typeCells(T.parseCsv(text, delim), delim, recognise) }], delimiter: delim };
    }
    if (ext === "json") {
      var jt = (await OZ.readText(file)).trim(), tree;
      try { tree = JSON.parse(jt); }
      catch (e) {
        try { tree = jt.split(/\r?\n/).filter(function (l) { return l.trim(); }).map(function (l) { return JSON.parse(l); }); }   /* JSON Lines */
        catch (e2) { throw OZ.fail("Dit JSON-bestand bevat een fout en kan niet worden gelezen: " + String(e.message).replace(/^JSON\.parse: /, "") + "."); }
      }
      return { tree: tree, tables: T.fromTree(tree) };
    }
    if (ext === "yaml" || ext === "yml") {
      var y;
      try { var docs = jsyaml.loadAll(await OZ.readText(file)); y = docs.length === 1 ? docs[0] : docs; }
      catch (e3) { throw OZ.fail("Dit YAML-bestand bevat een fout" + (e3.mark ? " op regel " + (e3.mark.line + 1) : "") + " en kan niet worden gelezen."); }
      return { tree: y, tables: T.fromTree(y) };
    }
    if (ext === "xml") {
      var xd = new DOMParser().parseFromString(await OZ.readText(file), "application/xml");
      if (xd.getElementsByTagName("parsererror").length) throw OZ.fail("Dit XML-bestand is niet goed gevormd en kan niet worden gelezen. Controleer of alle elementen netjes zijn afgesloten.");
      var xt = {}; xt[xd.documentElement.nodeName] = xmlToTree(xd.documentElement);
      return { tree: xt, tables: T.fromTree(xt) };
    }
    var wb, bytes = new Uint8Array(await file.arrayBuffer());
    if (ext === "ods") {
      /* SheetJS leest een kale datum in ODS als UTC en verschuift hem dan met de tijdzone.
         Met een expliciete tijd erbij wordt het gewoon lokale tijd, zoals bedoeld. */
      try {
        var oz = await JSZip.loadAsync(bytes), cf = oz.file("content.xml");
        if (cf) {
          oz.file("content.xml", (await cf.async("string")).replace(/(office:date-value=")(\d{4}-\d{2}-\d{2})(")/g, "$1$2T00:00:00$3"));
          bytes = await oz.generateAsync({ type: "uint8array" });
        }
      } catch (e0) { /* dan het origineel proberen */ }
    }
    try { wb = XLSX.read(bytes, { type: "array", cellNF: true, cellText: false, cellHTML: false, cellFormula: false }); }
    catch (e4) {
      if (/password|encrypt/i.test(String(e4 && e4.message))) throw OZ.fail("Dit bestand is met een wachtwoord beveiligd. Sla het eerst op zonder wachtwoord.");
      throw OZ.fail("Dit rekenblad kan niet worden gelezen. Mogelijk is het beschadigd of heeft het een verkeerde extensie.");
    }
    var tables = wb.SheetNames.map(function (n) { return { name: n, rows: sheetRows(wb.Sheets[n]) }; }).filter(function (t) { return t.rows.length; });
    if (!tables.length) throw OZ.fail("Dit rekenblad is leeg: er staan geen gegevens in.");
    return { tables: tables };
  };

  /* ---------- schrijven ---------- */
  function tablesHtml(tables, header) {
    return tables.map(function (t) {
      var h = tables.length > 1 ? "<h2>" + OZ.escHtml(t.name) + "</h2>\n" : "";
      var n = 0; t.rows.forEach(function (r) { n = Math.max(n, r.length); });
      return h + "<table>\n" + t.rows.map(function (r, ri) {
        var tag = header && ri === 0 ? "th" : "td", cells = "";
        for (var i = 0; i < n; i++) {
          var v = r[i], num = typeof v === "number";
          cells += "<" + tag + (num ? ' align="right"' : "") + ">" + OZ.escHtml(cellText(v, "nl", num)) + "</" + tag + ">";
        }
        return (header && ri === 0 ? "<thead>" : "") + "<tr>" + cells + "</tr>" + (header && ri === 0 ? "</thead>" : "");
      }).join("\n") + "\n</table>";
    }).join("\n");
  }
  T.write = async function (src, target, base, opts) {
    opts = opts || {};
    var tables = src.tables, header = opts.header !== false, ext = OZ.TARGETS[target].ext, name = base + "." + ext;
    var multi = tables.length > 1;
    function perTable(fn, mime) {
      var used = {};
      return tables.map(function (t) {
        return { name: base + (multi ? " - " + sheetName(t.name, used) : "") + "." + ext, blob: OZ.textBlob(fn(t), mime) };
      });
    }
    switch (target) {
      case "csv": {
        var delim = opts.delimiter === "," ? "," : ";";
        return perTable(function (t) { return "\ufeff" + T.toCsv(t.rows, delim); }, "text/csv");
      }
      case "tsv": return perTable(function (t) { return T.toCsv(t.rows, "\t"); }, "text/tab-separated-values");
      case "json": return [{ name: name, blob: OZ.textBlob(JSON.stringify(src.tree !== undefined ? src.tree : T.toObjects(tables, header), null, 2) + "\n", "application/json") }];
      case "yaml": return [{ name: name, blob: OZ.textBlob(jsyaml.dump(src.tree !== undefined ? JSON.parse(JSON.stringify(src.tree)) : T.toObjects(tables, header), { lineWidth: 120, noRefs: true }), "text/yaml") }];
      case "xml": return [{ name: name, blob: OZ.textBlob(src.tree !== undefined ? T.treeToXmlDoc(src.tree) : T.tablesToXmlDoc(tables, header), "application/xml") }];
      case "html": return [{ name: name, blob: OZ.textBlob(D.toHtmlPage(tablesHtml(tables, header), base, "body{max-width:none;font:15px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif}td[align=right],th[align=right]{text-align:right}"), "text/html") }];
      case "md": return [{ name: name, blob: OZ.textBlob(tables.map(function (t) {
        var n = 0; t.rows.forEach(function (r) { n = Math.max(n, r.length); });
        var rows = t.rows.map(function (r) { var o = []; for (var i = 0; i < n; i++) o.push(cellText(r[i], "nl", typeof r[i] === "number").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")); return o; });
        if (!header) { var hh = []; for (var i = 0; i < n; i++) hh.push("Kolom " + (i + 1)); rows.unshift(hh); }
        return (multi ? "## " + t.name + "\n\n" : "") + D.mdTable(rows);
      }).join("\n\n") + "\n", "text/markdown") }];
      case "pdf": {
        var body = D.parse(tablesHtml(tables, header)), cols = 0;
        tables.forEach(function (t) { t.rows.slice(0, 50).forEach(function (r) { cols = Math.max(cols, r.length); }); });
        var blocks = D.blocks(body);
        return [{ name: name, blob: await D.toPdf(blocks, { landscape: cols > 5, fontSize: 10, tableSize: cols > 12 ? 6.5 : cols > 8 ? 7.5 : 9, margin: 36, title: base }) }];
      }
      case "xlsx": case "xls": case "ods": {
        var wb = T.toWorkbook(tables), out;
        try { out = XLSX.write(wb, { bookType: target === "xls" ? "biff8" : target, type: "array", compression: true }); }
        catch (e) { throw OZ.fail("Het rekenblad kan niet worden geschreven: " + (e && e.message ? e.message : "onbekende fout") + "."); }
        var mime = { xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel", ods: "application/vnd.oasis.opendocument.spreadsheet" }[target];
        return [{ name: name, blob: new Blob([out], { type: mime }) }];
      }
    }
    throw OZ.fail("Dit doelformaat wordt voor tabellen niet ondersteund.");
  };

  OZ.conv.data = async function (file, ext, target, opts) {
    var src = await T.read(file, ext, opts);
    return T.write(src, target, OZ.base(file.name), opts);
  };
})();
