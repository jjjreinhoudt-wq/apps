/* Omzetter — welke bestanden herkend worden en waar ze naartoe kunnen. */
(function () {
  "use strict";
  var OZ = window.OZ;

  /* Doelformaten. ext = extensie van het resultaat, label = wat op de knop staat. */
  OZ.TARGETS = {
    png: { label: "PNG", ext: "png" }, jpg: { label: "JPG", ext: "jpg" }, webp: { label: "WEBP", ext: "webp" },
    gif: { label: "GIF", ext: "gif" }, bmp: { label: "BMP", ext: "bmp" }, ico: { label: "ICO", ext: "ico" },
    tiff: { label: "TIFF", ext: "tiff" }, svg: { label: "SVG", ext: "svg" }, pdf: { label: "PDF", ext: "pdf" },
    txt: { label: "TXT", ext: "txt" }, html: { label: "HTML", ext: "html" }, md: { label: "Markdown", ext: "md" },
    docx: { label: "Word (DOCX)", ext: "docx" }, odt: { label: "ODT", ext: "odt" }, rtf: { label: "RTF", ext: "rtf" },
    epub: { label: "EPUB", ext: "epub" },
    xlsx: { label: "Excel (XLSX)", ext: "xlsx" }, xls: { label: "XLS", ext: "xls" }, ods: { label: "ODS", ext: "ods" },
    csv: { label: "CSV", ext: "csv" }, tsv: { label: "TSV", ext: "tsv" }, json: { label: "JSON", ext: "json" },
    xml: { label: "XML", ext: "xml" }, yaml: { label: "YAML", ext: "yaml" },
    mp3: { label: "MP3", ext: "mp3" }, wav: { label: "WAV", ext: "wav" },
    srt: { label: "SRT", ext: "srt" }, vtt: { label: "VTT", ext: "vtt" },
    unzip: { label: "Uitpakken", ext: "" }, listtxt: { label: "Inhoudslijst (TXT)", ext: "txt" }, listcsv: { label: "Inhoudslijst (CSV)", ext: "csv" },
    gunzip: { label: "Uitpakken", ext: "" }, decode: { label: "Terug naar bestand", ext: "" },
    zip: { label: "ZIP", ext: "zip", hint: "Inpakken zonder om te zetten" },
    gz: { label: "GZ", ext: "gz" }, b64: { label: "Base64 (TXT)", ext: "txt" },
    klein: { label: "Kleiner maken", ext: "", hint: "Zelfde bestand, minder MB" }
  };

  var DOC_OUT = ["pdf", "docx", "klein", "html", "txt", "md", "epub", "odt", "rtf"];
  var DATA_OUT = ["xlsx", "csv", "json", "pdf", "html", "md", "tsv", "xml", "yaml", "ods", "xls"];

  /* Soorten. order bepaalt de volgorde in het overzicht. */
  OZ.KINDS = {
    image: {
      label: "Afbeeldingen", one: "afbeelding", icon: "image",
      exts: ["png", "jpg", "jpeg", "jfif", "webp", "gif", "bmp", "svg", "ico", "tif", "tiff", "heic", "heif", "avif"],
      targets: ["jpg", "png", "webp", "pdf", "gif", "bmp", "ico", "tiff", "svg"],
      def: function (e) { return e === "jpg" || e === "jpeg" || e === "jfif" ? "png" : "jpg"; }
    },
    pdf: {
      label: "Pdf", one: "pdf", icon: "pdf", exts: ["pdf"],
      targets: ["png", "jpg", "pdf", "klein", "docx", "txt", "html", "md"], def: function () { return "png"; }, noZip: false
    },
    doc: {
      label: "Documenten", one: "document", icon: "doc",
      exts: ["docx", "docm", "odt", "rtf", "txt", "log", "md", "markdown", "html", "htm", "epub", "pptx"],
      targets: DOC_OUT, def: function (e) { return "pdf"; }
    },
    data: {
      label: "Tabellen en gegevens", one: "tabel", icon: "table",
      exts: ["xlsx", "xlsm", "xlsb", "xls", "ods", "csv", "tsv", "json", "xml", "yaml", "yml"],
      targets: DATA_OUT, def: function (e) { return e === "xlsx" || e === "xlsm" || e === "xlsb" ? "csv" : "xlsx"; }
    },
    audio: {
      label: "Geluid", one: "geluidsbestand", icon: "audio",
      exts: ["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus", "weba"],
      targets: ["mp3", "wav"], def: function (e) { return e === "mp3" ? "wav" : "mp3"; }
    },
    video: {
      label: "Video", one: "video", icon: "video", exts: ["mp4", "m4v", "mov", "webm"],
      targets: ["mp3", "wav", "png", "jpg"], def: function () { return "mp3"; },
      note: "Een video naar een ander videoformaat omzetten kan niet in de browser. Wel het geluid eruit halen of een beeld uit de video opslaan."
    },
    subs: {
      label: "Ondertitels", one: "ondertitelbestand", icon: "subs", exts: ["srt", "vtt"],
      targets: ["srt", "vtt", "txt"], def: function (e) { return e === "srt" ? "vtt" : "srt"; }
    },
    agenda: {
      label: "Agenda", one: "agendabestand", icon: "calendar", exts: ["ics"],
      targets: ["csv", "xlsx", "json"], def: function () { return "csv"; }
    },
    contacts: {
      label: "Contacten", one: "contactbestand", icon: "contact", exts: ["vcf"],
      targets: ["csv", "xlsx", "json"], def: function () { return "csv"; }
    },
    archive: {
      label: "Zip-archieven", one: "archief", icon: "zip", exts: ["zip", "tar"],
      targets: ["unzip", "listtxt", "listcsv"], def: function () { return "unzip"; }, noZip: true
    },
    gzip: {
      label: "Gz-bestanden", one: "gz-bestand", icon: "zip", exts: ["gz", "tgz"],
      targets: ["gunzip"], def: function () { return "gunzip"; }, noZip: true
    },
    base64: {
      label: "Base64-tekst", one: "base64-bestand", icon: "code", exts: ["b64", "base64"],
      targets: ["decode"], def: function () { return "decode"; }, noZip: true
    },
    other: {
      label: "Overige bestanden", one: "bestand", icon: "file", exts: [],
      targets: ["zip", "gz", "b64"], def: function () { return "zip"; }, noZip: true,
      note: "Dit bestandstype kan niet worden omgezet. Inpakken of als tekst coderen kan wel."
    }
  };
  OZ.KIND_ORDER = ["image", "pdf", "doc", "data", "audio", "video", "subs", "agenda", "contacts", "archive", "gzip", "base64", "other"];

  /* Herkend, maar in een browser niet te lezen. Met een tip die wel werkt. */
  OZ.BLOCKED = {
    doc: "Oude Word-bestanden (.doc) kunnen niet in de browser worden gelezen. Open het bestand in Word, Pages of Google Documenten, sla het op als .docx en kies het daarna opnieuw.",
    dot: "Oude Word-sjablonen (.dot) kunnen niet in de browser worden gelezen. Sla het bestand eerst op als .docx.",
    ppt: "Oude PowerPoint-bestanden (.ppt) kunnen niet in de browser worden gelezen. Open het bestand in PowerPoint of Google Presentaties, sla het op als .pptx en kies het daarna opnieuw.",
    pps: "Oude PowerPoint-voorstellingen (.pps) kunnen niet in de browser worden gelezen. Sla het bestand eerst op als .pptx.",
    pages: "Pages-bestanden kunnen hier niet worden gelezen. Kies in Pages voor Exporteer naar Word of Pdf en zet dat bestand om.",
    numbers: "Numbers-bestanden kunnen hier niet worden gelezen. Kies in Numbers voor Exporteer naar Excel of CSV en zet dat bestand om.",
    key: "Keynote-bestanden kunnen hier niet worden gelezen. Kies in Keynote voor Exporteer naar PowerPoint of Pdf en zet dat bestand om.",
    psd: "Photoshop-bestanden kunnen hier niet worden gelezen. Exporteer de afbeelding eerst als PNG of JPG.",
    ai: "Illustrator-bestanden kunnen hier niet worden gelezen. Exporteer de tekening eerst als SVG, PNG of PDF.",
    indd: "InDesign-bestanden kunnen hier niet worden gelezen. Exporteer het document eerst als PDF.",
    mkv: "MKV-video kan een browser niet afspelen en dus ook niet omzetten. Zet de video eerst om naar MP4, bijvoorbeeld met VLC of HandBrake.",
    avi: "AVI-video kan een browser niet afspelen en dus ook niet omzetten. Zet de video eerst om naar MP4, bijvoorbeeld met VLC of HandBrake.",
    wmv: "WMV-video kan een browser niet afspelen en dus ook niet omzetten. Zet de video eerst om naar MP4, bijvoorbeeld met VLC of HandBrake.",
    flv: "FLV-video kan een browser niet afspelen en dus ook niet omzetten. Zet de video eerst om naar MP4.",
    wma: "WMA-geluid kan een browser niet afspelen en dus ook niet omzetten. Zet het bestand eerst om naar MP3, bijvoorbeeld met VLC.",
    aiff: "AIFF-geluid kan deze browser niet lezen. Zet het bestand eerst om naar WAV, bijvoorbeeld met VLC of Audacity.",
    aif: "AIFF-geluid kan deze browser niet lezen. Zet het bestand eerst om naar WAV, bijvoorbeeld met VLC of Audacity.",
    rar: "RAR-archieven kunnen hier niet worden uitgepakt. Pak het archief uit op je computer en kies daarna de losse bestanden.",
    "7z": "7z-archieven kunnen hier niet worden uitgepakt. Pak het archief uit op je computer en kies daarna de losse bestanden.",
    odp: "ODP-presentaties kunnen hier niet worden gelezen. Sla de presentatie eerst op als .pptx of .pdf."
  };

  var byExt = {};
  OZ.KIND_ORDER.forEach(function (k) { OZ.KINDS[k].exts.forEach(function (e) { byExt[e] = k; }); });

  /* Geeft {kind, ext, blocked}. */
  OZ.detect = function (file) {
    var e = OZ.ext(file.name), t = (file.type || "").toLowerCase();
    if (/\.tar\.gz$/i.test(file.name)) return { kind: "gzip", ext: "gz" };
    if (byExt[e]) return { kind: byExt[e], ext: e };
    if (OZ.BLOCKED[e]) return { kind: "blocked", ext: e, blocked: OZ.BLOCKED[e] };
    /* Geen bekende extensie: probeer het mime-type (telefoons geven soms namen zonder extensie). */
    var mimeMap = {
      "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/bmp": "bmp",
      "image/svg+xml": "svg", "image/heic": "heic", "image/heif": "heif", "image/avif": "avif", "image/tiff": "tiff",
      "application/pdf": "pdf", "text/plain": "txt", "text/html": "html", "text/csv": "csv", "text/markdown": "md",
      "application/json": "json", "text/xml": "xml", "application/xml": "xml", "application/zip": "zip",
      "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/mp4": "m4a",
      "audio/aac": "aac", "audio/flac": "flac", "audio/webm": "weba", "video/mp4": "mp4", "video/quicktime": "mov",
      "video/webm": "webm", "text/calendar": "ics", "text/vcard": "vcf", "text/x-vcard": "vcf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
      "application/vnd.ms-excel": "xls", "application/epub+zip": "epub"
    };
    if (mimeMap[t]) return { kind: byExt[mimeMap[t]], ext: mimeMap[t] };
    if (/^text\//.test(t)) return { kind: "doc", ext: "txt" };
    return { kind: "other", ext: e };
  };

  OZ.targetsFor = function (kind) {
    var k = OZ.KINDS[kind];
    if (!k) return [];
    return k.noZip ? k.targets.slice() : k.targets.concat(["zip"]);
  };
})();
