/* Omzetter — archieven (zip, tar, gz), ondertitels, agenda (ics), contacten (vcf) en base64. */
(function () {
  "use strict";
  var OZ = window.OZ, T = OZ.table;

  /* ---------- gzip ---------- */
  async function streamThrough(blob, stream) {
    return new Uint8Array(await new Response(blob.stream().pipeThrough(stream)).arrayBuffer());
  }
  async function gunzip(blob) {
    try {
      if (window.DecompressionStream) return await streamThrough(blob, new DecompressionStream("gzip"));
      return pako.ungzip(new Uint8Array(await blob.arrayBuffer()));
    } catch (e) { throw OZ.fail("Dit gz-bestand kan niet worden uitgepakt. Mogelijk is het beschadigd."); }
  }
  async function gzip(blob) {
    if (window.CompressionStream) { try { return await streamThrough(blob, new CompressionStream("gzip")); } catch (e) { /* dan pako */ } }
    return pako.gzip(new Uint8Array(await blob.arrayBuffer()));
  }

  /* ---------- tar ---------- */
  function untar(bytes) {
    var out = [], off = 0, dec = new TextDecoder("utf-8"), longName = null;
    function str(o, n) { var e = o; while (e < o + n && bytes[e]) e++; return dec.decode(bytes.subarray(o, e)); }
    while (off + 512 <= bytes.length) {
      var name = str(off, 100);
      if (!name && !bytes[off]) break;
      var size = parseInt(str(off + 124, 12).trim() || "0", 8) || 0, type = String.fromCharCode(bytes[off + 156] || 48);
      var prefix = str(off + 257, 6) === "ustar" ? str(off + 345, 155) : "";
      var data = bytes.subarray(off + 512, off + 512 + size);
      if (type === "L") longName = dec.decode(data).replace(/\u0000+$/, "");
      else if (type === "0" || type === "\u0000" || type === "7") { out.push({ name: longName || (prefix ? prefix + "/" + name : name), data: data }); longName = null; }
      else if (type !== "x" && type !== "g") longName = null;
      off += 512 + Math.ceil(size / 512) * 512;
    }
    if (!out.length) throw OZ.fail("In dit tar-archief zijn geen bestanden gevonden.");
    return out;
  }

  async function entriesOf(file, ext) {
    if (ext === "tar") return untar(new Uint8Array(await file.arrayBuffer())).map(function (e) { return { name: e.name, size: e.data.length, get: function () { return Promise.resolve(e.data); } }; });
    var zip;
    try { zip = await JSZip.loadAsync(await file.arrayBuffer()); }
    catch (e) { throw OZ.fail("Dit zip-bestand kan niet worden geopend. Mogelijk is het beschadigd of met een wachtwoord beveiligd."); }
    var list = [];
    zip.forEach(function (path, f) {
      if (f.dir || /^__MACOSX\//.test(path) || /(^|\/)\.DS_Store$/.test(path)) return;
      list.push({ name: path, size: f._data && f._data.uncompressedSize != null ? f._data.uncompressedSize : null, date: f.date, get: function () { return f.async("uint8array"); } });
    });
    if (!list.length) throw OZ.fail("Dit archief is leeg.");
    return list;
  }
  function flatName(path) { return path.replace(/^\/+/, "").replace(/\//g, " - "); }

  OZ.conv.archive = async function (file, ext, target, opts, ctx) {
    var entries = await entriesOf(file, ext), base = OZ.base(file.name);
    if (target === "unzip") {
      var outs = [];
      for (var i = 0; i < entries.length; i++) {
        if (ctx && ctx.progress) ctx.progress(i / entries.length);
        var data;
        try { data = await entries[i].get(); }
        catch (e) { throw OZ.fail('Het bestand "' + entries[i].name + '" in dit archief is beveiligd of beschadigd en kan niet worden uitgepakt.'); }
        outs.push({ name: flatName(entries[i].name), path: entries[i].name, blob: new Blob([data]) });
      }
      outs.bundleName = base + " (uitgepakt).zip";
      return outs;
    }
    var rows = [["Bestand", "Grootte (bytes)", "Gewijzigd"]];
    entries.forEach(function (e) {
      var d = e.date;
      rows.push([e.name, e.size, d ? { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), H: d.getHours(), M: d.getMinutes(), S: 0 } : null]);
    });
    if (target === "listcsv") return [{ name: base + " - inhoud.csv", blob: OZ.textBlob("\ufeff" + T.toCsv(rows, opts.delimiter === "," ? "," : ";"), "text/csv") }];
    var total = 0, text = entries.map(function (e) { total += e.size || 0; return e.name + (e.size != null ? "\t" + OZ.fmtSize(e.size) : ""); }).join("\n");
    return [{ name: base + " - inhoud.txt", blob: OZ.textBlob(file.name + "\n" + entries.length + (entries.length === 1 ? " bestand, " : " bestanden, ") + OZ.fmtSize(total) + " uitgepakt\n\n" + text + "\n", "text/plain") }];
  };

  OZ.conv.gzip = async function (file, ext, target, opts, ctx) {
    var bytes = await gunzip(file), name = file.name.replace(/\.tgz$/i, ".tar").replace(/\.gz$/i, "");
    if (name === file.name) name = OZ.base(file.name);
    if (/\.tar$/i.test(name)) {
      var outs = untar(bytes).map(function (e) { return { name: flatName(e.name), path: e.name, blob: new Blob([e.data]) }; });
      outs.bundleName = OZ.base(name) + " (uitgepakt).zip";
      return outs;
    }
    if (!OZ.ext(name)) { var s = OZ.sniff(bytes); if (s) name += "." + s; }
    return [{ name: name, blob: new Blob([bytes]) }];
  };

  /* ---------- base64 ---------- */
  OZ.conv.base64 = async function (file) {
    var text = (await OZ.readText(file)).trim(), bytes, mime = "";
    var m = /^data:([^;,]+)[^,]*;base64,/i.exec(text.slice(0, 200));
    if (m) { mime = m[1].toLowerCase(); text = text.slice(text.indexOf(",") + 1); }
    text = text.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    if (!text || /[^A-Za-z0-9+/=]/.test(text)) throw OZ.fail("Dit bestand bevat geen geldige base64-tekst.");
    try { bytes = OZ.b64ToBytes(text); } catch (e) { throw OZ.fail("Deze base64-tekst is onvolledig of beschadigd."); }
    var base = OZ.base(file.name).replace(/\.b64$/i, ""), ext = OZ.ext(base) ? "" : OZ.sniff(bytes) || { "image/png": "png", "image/jpeg": "jpg", "application/pdf": "pdf", "text/plain": "txt" }[mime] || "bin";
    return [{ name: base + (ext ? "." + ext : ""), blob: new Blob([bytes], { type: mime }) }];
  };

  OZ.conv.other = async function (file, ext, target) {
    if (target === "gz") return [{ name: file.name + ".gz", blob: new Blob([await gzip(file)], { type: "application/gzip" }) }];
    if (target === "b64") return [{ name: file.name + ".b64.txt", blob: OZ.textBlob(OZ.bytesToB64(new Uint8Array(await file.arrayBuffer())).replace(/(.{76})/g, "$1\n") + "\n", "text/plain") }];
    return [{ name: OZ.base(file.name) + ".zip", blob: await OZ.zip([{ name: file.name, blob: file }]) }];
  };

  /* ---------- ondertitels ---------- */
  function parseCues(text) {
    text = text.replace(/\r\n?/g, "\n").replace(/^\ufeff/, "");
    var cues = [], blocks = text.split(/\n{2,}/), re = /(\d{1,2}:)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}:)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;
    function ms(h, m, s, f) { return ((parseInt(h, 10) || 0) * 3600 + (+m) * 60 + (+s)) * 1000 + +(f + "00").slice(0, 3); }
    blocks.forEach(function (b) {
      var lines = b.split("\n"), idx = -1, m = null;
      for (var i = 0; i < lines.length; i++) { m = re.exec(lines[i]); if (m) { idx = i; break; } }
      if (!m) return;
      var body = lines.slice(idx + 1).join("\n").trim();
      if (body) cues.push({ a: ms(m[1], m[2], m[3], m[4]), b: ms(m[5], m[6], m[7], m[8]), text: body });
    });
    if (!cues.length) throw OZ.fail("In dit bestand zijn geen ondertitels met tijden gevonden.");
    return cues;
  }
  function stamp(t, sep) {
    var h = Math.floor(t / 3600000), m = Math.floor(t / 60000) % 60, s = Math.floor(t / 1000) % 60;
    return OZ.pad(h, 2) + ":" + OZ.pad(m, 2) + ":" + OZ.pad(s, 2) + sep + OZ.pad(t % 1000, 3);
  }
  OZ.conv.subs = async function (file, ext, target) {
    var cues = parseCues(await OZ.readText(file)), base = OZ.base(file.name), out;
    if (target === "srt") out = cues.map(function (c, i) { return (i + 1) + "\n" + stamp(c.a, ",") + " --> " + stamp(c.b, ",") + "\n" + c.text.replace(/<\/?[cv][^>]*>/g, "") + "\n"; }).join("\n");
    else if (target === "vtt") out = "WEBVTT\n\n" + cues.map(function (c) { return stamp(c.a, ".") + " --> " + stamp(c.b, ".") + "\n" + c.text.replace(/\{\\an\d\}/g, "") + "\n"; }).join("\n");
    else out = cues.map(function (c) { return c.text.replace(/<[^>]+>/g, "").replace(/\{\\[^}]+\}/g, ""); }).join("\n") + "\n";
    return [{ name: base + "." + target, blob: OZ.textBlob(out, target === "vtt" ? "text/vtt" : "text/plain") }];
  };

  /* ---------- ics en vcf ---------- */
  function unfold(text) {
    return text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  }
  function qpDecode(s, charset) {
    var bytes = [];
    s = s.replace(/=\n/g, "");
    for (var i = 0; i < s.length; i++) {
      if (s[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) { bytes.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
      else bytes.push(s.charCodeAt(i) & 255);
    }
    try { return new TextDecoder(charset || "utf-8").decode(new Uint8Array(bytes)); } catch (e) { return new TextDecoder("utf-8").decode(new Uint8Array(bytes)); }
  }
  function propLines(text) {
    /* quoted-printable regels die op = eindigen lopen door op de volgende regel */
    var raw = unfold(text), lines = [];
    for (var i = 0; i < raw.length; i++) {
      var l = raw[i];
      if (/ENCODING=QUOTED-PRINTABLE/i.test(l.split(":")[0] || "")) while (/=$/.test(l) && i + 1 < raw.length) l = l.slice(0, -1) + raw[++i];
      lines.push(l);
    }
    return lines.map(function (l) {
      var m = /^([^:;]+)((?:;(?:[^:"]|"[^"]*")*)?):(.*)$/.exec(l);
      if (!m) return null;
      var params = {}, types = [];
      m[2].split(";").forEach(function (p) {
        if (!p) return;
        var kv = p.split("="), k = kv[0].toUpperCase(), v = (kv[1] || "").replace(/^"|"$/g, "");
        if (kv.length === 1) types.push(k); else if (k === "TYPE") v.split(",").forEach(function (t) { types.push(t.toUpperCase()); }); else params[k] = v;
      });
      var value = m[3];
      if (/QUOTED-PRINTABLE/i.test(params.ENCODING || "")) value = qpDecode(value, params.CHARSET);
      return { name: m[1].replace(/^.*\./, "").toUpperCase(), params: params, types: types, value: value };
    }).filter(Boolean);
  }
  function splitSemi(v) {             /* splitsen op ; maar niet op \; */
    var out = [], cur = "";
    for (var i = 0; i < v.length; i++) {
      if (v[i] === "\\" && i + 1 < v.length) { cur += v[i] + v[i + 1]; i++; }
      else if (v[i] === ";") { out.push(cur); cur = ""; }
      else cur += v[i];
    }
    out.push(cur);
    return out;
  }
  function unesc(v) { return String(v || "").replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1"); }
  function icsDate(p) {
    var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/.exec(p.value.trim());
    if (!m) return p.value || null;
    if (!m[4]) return { y: +m[1], m: +m[2], d: +m[3], H: 0, M: 0, S: 0 };
    if (m[7]) { var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))); return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), H: d.getHours(), M: d.getMinutes(), S: d.getSeconds() }; }
    return { y: +m[1], m: +m[2], d: +m[3], H: +m[4], M: +m[5], S: +(m[6] || 0) };
  }
  function readIcs(text) {
    var lines = propLines(text), rows = [["Titel", "Begin", "Einde", "Hele dag", "Locatie", "Omschrijving", "Organisator", "Herhaling", "Status"]], cur = null, depth = 0;
    lines.forEach(function (p) {
      if (p.name === "BEGIN" && p.value.toUpperCase() === "VEVENT") { cur = {}; depth = 0; return; }
      if (!cur) return;
      if (p.name === "BEGIN") { depth++; return; }
      if (p.name === "END" && p.value.toUpperCase() !== "VEVENT") { depth--; return; }
      if (p.name === "END") {
        var allDay = cur.DTSTART && /^\d{8}$/.test(cur.DTSTART.value.trim()), end = cur.DTEND ? icsDate(cur.DTEND) : null;
        if (allDay && end && end.y) { var e = new Date(end.y, end.m - 1, end.d - 1); end = { y: e.getFullYear(), m: e.getMonth() + 1, d: e.getDate(), H: 0, M: 0, S: 0 }; }   /* einddatum is exclusief */
        rows.push([unesc(cur.SUMMARY && cur.SUMMARY.value) || null, cur.DTSTART ? icsDate(cur.DTSTART) : null, end, allDay ? "ja" : "nee", unesc(cur.LOCATION && cur.LOCATION.value) || null, unesc(cur.DESCRIPTION && cur.DESCRIPTION.value) || null,
          cur.ORGANIZER ? (cur.ORGANIZER.params.CN || cur.ORGANIZER.value.replace(/^mailto:/i, "")) : null, cur.RRULE ? cur.RRULE.value : null, cur.STATUS ? cur.STATUS.value : null]);
        cur = null; return;
      }
      if (depth === 0 && !cur[p.name]) cur[p.name] = p;
    });
    if (rows.length === 1) throw OZ.fail("In dit agendabestand staan geen afspraken.");
    return [{ name: "Afspraken", rows: rows }];
  }
  function readVcf(text) {
    var lines = propLines(text), cards = [], cur = null;
    lines.forEach(function (p) {
      if (p.name === "BEGIN" && /VCARD/i.test(p.value)) { cur = { tel: [], email: [], adr: [] }; return; }
      if (!cur) return;
      if (p.name === "END") { cards.push(cur); cur = null; return; }
      var v = p.value;
      switch (p.name) {
        case "FN": cur.fn = unesc(v); break;
        case "N": { var n = splitSemi(v).map(unesc); cur.last = n[0] || ""; cur.first = [n[1], n[2]].filter(Boolean).join(" "); break; }
        case "ORG": cur.org = splitSemi(v).map(unesc).filter(Boolean).join(", "); break;
        case "TITLE": cur.title = unesc(v); break;
        case "TEL": cur.tel.push(v.replace(/^tel:/i, "")); break;
        case "EMAIL": cur.email.push(v); break;
        case "ADR": cur.adr.push(splitSemi(v).map(unesc).map(function (s) { return s.trim(); }).filter(Boolean).join(", ")); break;
        case "BDAY": { var m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(v); cur.bday = m ? { y: +m[1], m: +m[2], d: +m[3], H: 0, M: 0, S: 0 } : v; break; }
        case "URL": cur.url = v; break;
        case "NOTE": cur.note = unesc(v); break;
      }
    });
    if (!cards.length) throw OZ.fail("In dit contactbestand staan geen contacten.");
    var nt = 1, ne = 1, na = 1;
    cards.forEach(function (c) { nt = Math.max(nt, c.tel.length); ne = Math.max(ne, c.email.length); na = Math.max(na, c.adr.length); });
    nt = Math.min(nt, 4); ne = Math.min(ne, 3); na = Math.min(na, 2);
    function cols(label, n) { var o = []; for (var i = 1; i <= n; i++) o.push(n > 1 ? label + " " + i : label); return o; }
    function vals(arr, n) { var o = []; for (var i = 0; i < n; i++) o.push(arr[i] || null); return o; }
    var rows = [["Naam", "Voornaam", "Achternaam", "Organisatie", "Functie"].concat(cols("Telefoon", nt), cols("E-mail", ne), cols("Adres", na), ["Geboortedatum", "Website", "Notitie"])];
    cards.forEach(function (c) {
      rows.push([c.fn || [c.first, c.last].filter(Boolean).join(" ") || null, c.first || null, c.last || null, c.org || null, c.title || null].concat(vals(c.tel, nt), vals(c.email, ne), vals(c.adr, na), [c.bday || null, c.url || null, c.note || null]));
    });
    return [{ name: "Contacten", rows: rows }];
  }
  OZ.conv.agenda = async function (file, ext, target, opts) {
    return T.write({ tables: readIcs(await OZ.readText(file)) }, target, OZ.base(file.name), opts);
  };
  OZ.conv.contacts = async function (file, ext, target, opts) {
    return T.write({ tables: readVcf(await OZ.readText(file)) }, target, OZ.base(file.name), opts);
  };
})();
