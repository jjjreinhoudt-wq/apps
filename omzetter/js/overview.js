/* Omzetter — pictogrammen en het overzicht van formaten. Draait meteen, zonder op de bibliotheken te wachten,
   zodat de pagina bij het openen al compleet is. */
(function () {
  "use strict";
  var OZ = window.OZ;

  /* Lettertypen pas toepassen als ze binnen zijn; de pagina wacht er niet op. */
  var fl = document.getElementById("fontLink");
  if (fl) {
    var fontsOn = function () { fl.media = "all"; };
    if (fl.sheet) fontsOn(); else fl.addEventListener("load", fontsOn);
  }

  var P = {
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5-8 8"/>',
    pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 17v-4h1.2a1.3 1.3 0 0 1 0 2.6H9"/><path d="M14 13v4"/>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M3 15h18"/><path d="M9 4v16"/>',
    audio: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10.5l5-3v9l-5-3"/>',
    subs: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 12h4"/><path d="M14 12h3"/><path d="M7 15.5h8"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/>',
    contact: '<circle cx="12" cy="9" r="3.5"/><path d="M5 20c1-4 4-5.5 7-5.5s6 1.5 7 5.5"/>',
    zip: '<path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M12 10.5v1.5"/><path d="M12 14.5V16"/>',
    code: '<path d="M8 8l-4 4 4 4"/><path d="M16 8l4 4-4 4"/><path d="M13.5 6l-3 12"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    add: '<path d="M12 16V5"/><path d="M7 10l5-5 5 5"/><path d="M5 19h14"/>',
    save: '<path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/>',
    x: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    up: '<path d="M12 19V6"/><path d="M6 11l6-6 6 6"/>',
    down: '<path d="M12 5v13"/><path d="M6 13l6 6 6-6"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.3v.2"/>',
    into: '<path d="M6 5v7a3 3 0 0 0 3 3h9"/><path d="M14 11l4 4-4 4"/>',
    sliders: '<path d="M4 7h9"/><path d="M19 7h1"/><path d="M4 17h1"/><path d="M11 17h9"/><circle cx="16" cy="7" r="2.5"/><circle cx="8" cy="17" r="2.5"/>',
    grip: '<path d="M9 6v.01"/><path d="M15 6v.01"/><path d="M9 12v.01"/><path d="M15 12v.01"/><path d="M9 18v.01"/><path d="M15 18v.01"/>',
    frame: '<path d="M6 3v13a2 2 0 0 0 2 2h13"/><path d="M3 6h13a2 2 0 0 1 2 2v13"/>',
    resize: '<path d="M14 4h6v6"/><path d="M20 4l-7 7"/><path d="M10 20H4v-6"/><path d="M4 20l7-7"/>',
    stack: '<path d="M12 4l8 4-8 4-8-4z"/><path d="M4 12l8 4 8-4"/><path d="M4 16l8 4 8-4"/>',
    scan: '<path d="M4 8V6a2 2 0 0 1 2-2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v2"/><path d="M20 16v2a2 2 0 0 1-2 2h-2"/><path d="M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M8 9h8"/><path d="M8 12h8"/><path d="M8 15h5"/>'
  };
  OZ.icon = function (name, cls) {
    return '<svg class="' + (cls || "ic") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || P.file) + "</svg>";
  };

  function joinNl(list) {
    if (list.length < 2) return list.join("");
    return list.slice(0, -1).join(", ") + " of " + list[list.length - 1];
  }
  var SAY = {
    image: "wordt jpg, png, webp, pdf, gif, bmp, ico, tiff of svg. Ook verkleinen, draaien en in een andere verhouding zetten",
    pdf: "wordt png, jpg, docx, txt, html of md. Ook samenvoegen, splitsen en pagina's eruit halen",
    archive: "uitpakken, of de inhoudslijst als txt of csv",
    gzip: "uitpakken",
    base64: "terug naar het oorspronkelijke bestand",
    video: "wordt mp3 of wav (alleen het geluid), of png of jpg (\u00e9\u00e9n beeld)"
  };
  OZ.renderOverview = function () {
    var host = document.getElementById("formatList");
    if (!host) return;
    var html = "", n = 0;
    ["image", "pdf", "doc", "data", "audio", "video", "subs", "agenda", "contacts", "archive", "gzip", "base64"].forEach(function (k) {
      var K = OZ.KINDS[k];
      n += K.exts.length;
      var outs = K.targets.filter(function (t) { return t !== "klein"; }).map(function (t) { var T = OZ.TARGETS[t]; return T.ext ? T.ext : T.label.toLowerCase(); });
      var seen = {}; outs = outs.filter(function (o) { if (seen[o]) return false; seen[o] = 1; return true; });
      html += '<div class="fmt" data-kind="' + k + '"><div class="fmt-head">' + OZ.icon(K.icon) + "<h3>" + K.label + "</h3></div>" +
        '<p class="fmt-in">' + K.exts.map(function (e) { return "<span>" + e + "</span>"; }).join(" ") + "</p>" +
        '<p class="fmt-out">' + (SAY[k] || "wordt " + joinNl(outs)) + "</p></div>";
    });
    host.innerHTML = html;
    var foot = document.getElementById("formatsFoot");
    if (foot) foot.textContent = "Samen " + n + " bestandstypen. Ander type? Dat kan altijd nog als zip, gz of base64-tekst worden ingepakt. Oude .doc en .ppt, en video naar video, kan een browser niet aan; de app zegt dan wat wel werkt.";
  };
  OZ.renderOverview();

  /* Veelgebruikte klussen: een tik zet het doel alvast klaar en opent de bestandskiezer. */
  OZ.RECIPES = [
    { icon: "image", text: "Foto's kleiner maken voor e-mail", kind: "image", target: "jpg", preset: "mail", accept: "image/*,.heic,.heif" },
    { icon: "stack", text: "Foto's of scans samenvoegen tot \u00e9\u00e9n pdf", kind: "image", target: "pdf", merge: true, accept: "image/*,.heic,.heif" },
    { icon: "image", text: "iPhone-foto's (HEIC) naar JPG", kind: "image", target: "jpg", accept: "image/*,.heic,.heif" },
    { icon: "doc", text: "Word-document naar pdf", kind: "doc", target: "pdf", accept: ".docx,.docm,.odt,.rtf,.txt,.md,.html,.htm,.epub,.pptx" },
    { icon: "pdf", text: "Pdf naar Word", kind: "pdf", target: "docx", accept: ".pdf,application/pdf" },
    { icon: "pdf", text: "Pdf's samenvoegen of splitsen", kind: "pdf", target: "pdf", accept: ".pdf,application/pdf" },
    { icon: "resize", text: "Pdf kleiner maken, tekst blijft tekst", kind: "pdf", target: "klein", accept: ".pdf,application/pdf" },
    { icon: "resize", text: "Word of PowerPoint kleiner maken", kind: "doc", target: "klein", accept: ".docx,.docm,.pptx,.odt,.epub" },
    { icon: "table", text: "Excel naar CSV", kind: "data", target: "csv", accept: ".xlsx,.xlsm,.xlsb,.xls,.ods" },
    { icon: "audio", text: "Geluid uit een video halen", kind: "video", target: "mp3", accept: "video/*,.mp4,.mov,.m4v,.webm" },
    /* scan: de foto's gaan eerst door de Rechtzetter (js/rechtzetter.js). top: staat vooraan in de lijst; de nummers van de andere blijven gelijk. */
    { icon: "scan", text: "Foto van bon of brief naar nette pdf", sub: "Trekt de foto recht en maakt het papier wit", kind: "image", scan: true, top: true, accept: "image/*,.heic,.heif" }
  ];
  var ratioHost = document.getElementById("ratioList");
  if (ratioHost) ratioHost.innerHTML = [["16:9", "Liggend 16:9"], ["9:16", "Staand 9:16"], ["1:1", "Vierkant 1:1"], ["4:5", "4:5"], ["4:3", "4:3"], ["3:2", "3:2"], ["custom", "Eigen maat"]].map(function (r) {
    return '<button type="button" class="chip" data-start-ratio="' + r[0] + '">' + r[1] + "</button>";
  }).join("");
  var rl = document.getElementById("recipeList");
  if (rl) rl.innerHTML = OZ.RECIPES.map(function (r, i) { return i; }).sort(function (a, b) {
    return (OZ.RECIPES[b].top ? 1 : 0) - (OZ.RECIPES[a].top ? 1 : 0) || a - b;
  }).map(function (i) {
    var r = OZ.RECIPES[i];
    return '<li><button type="button" class="recipe" data-recipe="' + i + '">' + OZ.icon(r.icon) + "<span>" + r.text + (r.sub ? "<small>" + r.sub + "</small>" : "") + "</span></button></li>";
  }).join("");
})();
