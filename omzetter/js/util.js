/* Omzetter — gedeelde hulpfuncties. Alles hangt onder window.OZ. */
(function () {
  "use strict";
  var OZ = (window.OZ = window.OZ || {});
  OZ.conv = {};

  /* ---------- namen en maten ---------- */
  OZ.ext = function (name) {
    var m = /\.([A-Za-z0-9]{1,8})$/.exec(name || "");
    return m ? m[1].toLowerCase() : "";
  };
  OZ.base = function (name) {
    var n = String(name || "bestand").replace(/^.*[\\/]/, "");
    var i = n.lastIndexOf(".");
    return i > 0 ? n.slice(0, i) : n;
  };
  OZ.safeName = function (name) {
    var n = String(name || "bestand").replace(/[\u0000-\u001f<>:"|?*\\]/g, "_").replace(/^\.+/, "").trim();
    return n || "bestand";
  };
  OZ.fmtSize = function (n) {
    if (n == null) return "";
    if (n < 1000) return n + " bytes";
    var u = ["kB", "MB", "GB"], i = -1;
    do { n /= 1000; i++; } while (n >= 1000 && i < u.length - 1);
    return (n < 10 ? n.toFixed(1) : String(Math.round(n))).replace(".", ",") + " " + u[i];
  };
  OZ.pad = function (n, w) { n = String(n); while (n.length < w) n = "0" + n; return n; };
  OZ.uniqueNames = function (items) {
    var seen = Object.create(null);
    items.forEach(function (it) {
      var name = it.name, key = name.toLowerCase(), k = 2;
      while (seen[key]) {
        var e = OZ.ext(it.name);
        name = e ? it.name.slice(0, -(e.length + 1)) + " (" + k + ")." + e : it.name + " (" + k + ")";
        key = name.toLowerCase(); k++;
      }
      seen[key] = true; it.name = name;
    });
    return items;
  };

  /* ---------- tekst ---------- */
  OZ.escHtml = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };
  OZ.escXml = function (s) {
    return String(s == null ? "" : s)
      .replace(/[^\u0009\u000A\u000D -\ud7ff\ue000-\ufffd\uD800-\uDFFF]/g, "")
      .replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c];
      });
  };
  OZ.toBytes = async function (x) {
    if (x instanceof Uint8Array) return x;
    if (x instanceof ArrayBuffer) return new Uint8Array(x);
    return new Uint8Array(await x.arrayBuffer());
  };
  /* Leest tekst met de juiste codering: BOM, anders UTF-8, anders Windows-1252 (oude Excel-export). */
  OZ.decodeText = function (bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
      return new TextDecoder("utf-8").decode(bytes.subarray(3));
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe)
      return new TextDecoder("utf-16le").decode(bytes.subarray(2));
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff)
      return new TextDecoder("utf-16be").decode(bytes.subarray(2));
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (e) {
      return new TextDecoder("windows-1252").decode(bytes);
    }
  };
  OZ.readText = async function (blob) {
    return OZ.decodeText(await OZ.toBytes(blob));
  };
  OZ.textBlob = function (str, mime) {
    return new Blob([str], { type: (mime || "text/plain") + ";charset=utf-8" });
  };
  OZ.b64ToBytes = function (b64) {
    var bin = atob(b64.replace(/[^A-Za-z0-9+/=]/g, ""));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  OZ.bytesToB64 = function (bytes) {
    var s = "", CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  };
  OZ.dataUriParts = function (uri) {
    var m = /^data:([^;,]*)((?:;[^;,]*)*?)(;base64)?,([\s\S]*)$/i.exec(String(uri || "").trim());
    if (!m) return null;
    var bytes;
    try {
      bytes = m[3] ? OZ.b64ToBytes(m[4]) : new TextEncoder().encode(decodeURIComponent(m[4]));
    } catch (e) { return null; }
    return { mime: (m[1] || "text/plain").toLowerCase(), bytes: bytes };
  };
  OZ.tick = function () { return new Promise(function (r) { setTimeout(r, 0); }); };

  /* Een fout met een nette Nederlandse boodschap voor de gebruiker. */
  OZ.fail = function (msg) { var e = new Error(msg); e.friendly = true; return e; };

  /* ---------- afbeeldingen ---------- */
  OZ.loadImg = function (blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () { resolve({ img: img, release: function () { URL.revokeObjectURL(url); } }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(OZ.fail("De afbeelding kan niet worden gelezen. Mogelijk is het bestand beschadigd of kent deze browser het formaat niet.")); };
      img.decoding = "async";
      img.src = url;
    });
  };
  OZ.canvasBlob = function (canvas, mime, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) {
        if (!b) return reject(OZ.fail("De afbeelding is te groot om hier te verwerken. Kies een kleinere maximale breedte bij Opties."));
        resolve(b);
      }, mime, quality);
    });
  };
  OZ.makeCanvas = function (w, h) {
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    return c;
  };

  /* ---------- zip ---------- */
  OZ.zip = async function (items, level) {
    var z = new JSZip();
    OZ.uniqueNames(items).forEach(function (it) {
      z.file(it.name, it.blob || it.data, { binary: true });
    });
    return z.generateAsync({ type: "blob", compression: level === 0 ? "STORE" : "DEFLATE", compressionOptions: { level: level || 6 }, mimeType: "application/zip" });
  };

  /* ---------- opslaan ----------
     Gepubliceerd kan alleen de downloads-voorziening van het platform een bestand bewaren,
     en alleen voor een vaste lijst extensies. Al het andere gaat in een zip. */
  OZ.SAVE_EXT = {};
  "gif png jpg jpeg webp mp4 webm mov txt json md docx pptx epub csv ttf html svg pdf xlsx zip fig".split(" ").forEach(function (e) { OZ.SAVE_EXT[e] = true; });
  OZ.needsZip = function (nameOrExt) {
    if (!(window.claude && window.claude.use)) return false;      // buiten Claude (als losse app) mag elk type direct worden opgeslagen
    var e = nameOrExt.indexOf(".") >= 0 ? OZ.ext(nameOrExt) : nameOrExt.toLowerCase();
    return !OZ.SAVE_EXT[e];
  };
  OZ.savedName = function (name) { return OZ.needsZip(name) ? name + ".zip" : name; };

  var dlPromise = null;
  function getDownloads() {
    if (!(window.claude && window.claude.use)) return Promise.resolve(null);
    if (!dlPromise) {
      dlPromise = Promise.resolve()
        .then(function () { return window.claude.use("downloads"); })
        .catch(function () { return null; });
    }
    return dlPromise;
  }
  OZ.warmDownloads = function () { getDownloads(); };

  function anchorSave(name, blob) {
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; a.style.display = "none";
    document.body.appendChild(a); a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 4000);
  }

  var queue = Promise.resolve();
  /* Geeft {ok:true, name} of {ok:false, code, message}. Opslagvragen gaan één voor één. */
  OZ.saveFile = function (name, blob) {
    var job = queue.then(function () { return doSave(OZ.safeName(name), blob); });
    queue = job.catch(function () {});
    return job;
  };
  async function doSave(name, blob) {
    var outName = name, data = blob;
    if (OZ.needsZip(name)) {
      data = await OZ.zip([{ name: name, blob: blob }], 0);
      outName = name + ".zip";
    }
    var hasPlatform = !!(window.claude && window.claude.use);
    var dl = await getDownloads();
    if (dl && typeof dl.save === "function") {
      for (var attempt = 0; attempt < 3; attempt++) {
        try {
          await dl.save({ filename: outName, data: data });
          return { ok: true, name: outName };
        } catch (e) {
          var code = (e && e.code) || "unavailable";
          if (code === "rejected_extension" && !/\.zip$/i.test(outName)) {
            data = await OZ.zip([{ name: name, blob: blob }], 0);
            outName = name + ".zip";
            continue;
          }
          if (code === "rate_limited" && attempt < 2) {
            await new Promise(function (r) { setTimeout(r, 1500); });
            continue;
          }
          return { ok: false, code: code, message: saveMessage(code) };
        }
      }
      return { ok: false, code: "unavailable", message: saveMessage("unavailable") };
    }
    if (!hasPlatform) {
      anchorSave(outName, data);
      return { ok: true, name: outName };
    }
    return { ok: false, code: "unavailable", message: saveMessage("unavailable") };
  }
  function saveMessage(code) {
    if (code === "declined") return "Niet opgeslagen.";
    if (code === "too_large") return "Dit bestand is te groot om hier op te slaan. Zet het om met een lagere kwaliteit of kleinere maat en probeer het opnieuw.";
    if (code === "rate_limited") return "Er staat nog een opslagvraag open. Rond die eerst af en tik daarna opnieuw op Sla op.";
    if (code === "rejected_extension") return "Dit bestandstype mag hier niet worden opgeslagen.";
    return "Opslaan is hier nu niet beschikbaar. Open de app opnieuw en probeer het nog eens.";
  }

  /* ---------- bestandstype raden uit de eerste bytes ---------- */
  OZ.sniff = function (b) {
    function at(o, s) { for (var i = 0; i < s.length; i++) if (b[o + i] !== s.charCodeAt(i)) return false; return true; }
    if (b.length < 4) return "";
    if (b[0] === 0x89 && at(1, "PNG")) return "png";
    if (b[0] === 0xff && b[1] === 0xd8) return "jpg";
    if (at(0, "GIF8")) return "gif";
    if (at(0, "%PDF")) return "pdf";
    if (at(0, "RIFF") && at(8, "WEBP")) return "webp";
    if (at(0, "RIFF") && at(8, "WAVE")) return "wav";
    if (at(0, "BM")) return "bmp";
    if (at(0, "PK\u0003\u0004")) return "zip";
    if (b[0] === 0x1f && b[1] === 0x8b) return "gz";
    if (at(0, "ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "mp3";
    if (at(0, "OggS")) return "ogg";
    if (at(0, "fLaC")) return "flac";
    if (at(4, "ftyp")) return "mp4";
    if (at(0, "II*\u0000") || at(0, "MM\u0000*")) return "tif";
    if (at(0, "{\\rtf")) return "rtf";
    var head = new TextDecoder("utf-8").decode(b.subarray(0, 200)).trim().toLowerCase();
    if (head.indexOf("<svg") >= 0) return "svg";
    if (head.indexOf("<!doctype html") === 0 || head.indexOf("<html") === 0) return "html";
    if (head.indexOf("<?xml") === 0) return "xml";
    return "";
  };
})();
