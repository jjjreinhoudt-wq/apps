/* Rechtzetter — een foto van een bon of brief rechttrekken tot een nette pagina.
   Eén los bestand zonder afhankelijkheden; de opmaak wordt hier zelf ingevoegd en gebruikt de
   kleuren en knoppen uit base.css (met terugval als die er niet is).

   Rechtzetter.open(files, opts) geeft een Promise met per foto { canvas, name }, of null bij annuleren.
     files  lijst met afbeeldingen (File of Blob). Leeg mag: dan kiest of maakt de gebruiker eerst een foto.
     opts   { maxSide: 2200,          langste zijde van een pagina in pixels
              decode: function        optioneel, voor formaten die de browser niet zelf leest (HEIC, TIFF):
                                      krijgt het bestand en geeft een Blob, canvas, afbeelding of ImageBitmap }
   Alles gebeurt op het apparaat zelf: geen netwerk, geen eval, geen alert of confirm. */
(function () {
  "use strict";

  var VIEW_MAX = 1200;                 /* werkformaat op het scherm; het origineel wordt pas bij Klaar opnieuw gelezen */
  var DETECT_MAX = 300;                /* formaat voor de randherkenning */
  var PREVIEW_SMALL = 420, PREVIEW_BIG = 1100;
  var LOUPE = 124, LOUPE_ZOOM = 2.6;
  var PAD = 26;                        /* ruimte rond de foto zodat de hoekgrepen altijd te pakken zijn */
  var LOOKS = [["document", "Document"], ["kleur", "Kleur"], ["grijs", "Grijs"], ["zwartwit", "Zwart-wit"]];
  var CORNER_NAMES = ["linksboven", "rechtsboven", "rechtsonder", "linksonder"];
  var MSG_UNREADABLE = "Deze afbeelding kan je browser niet lezen. Zet hem eerst om naar JPG of PNG.";

  /* ================= kleine hulpjes ================= */
  function makeCanvas(w, h) {
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    return c;
  }
  function freeCanvas(c) { if (c) { c.width = 0; c.height = 0; } }
  function ctx2d(c, read) { return c.getContext("2d", read ? { willReadFrequently: true } : undefined); }
  function now() { return window.performance && performance.now ? performance.now() : Date.now(); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms || 0); }); }
  /* Even de beurt afgeven zonder de wachttijd van een timer (die is minstens 4 ms). */
  var hop = (function () {
    if (typeof MessageChannel === "undefined") return function () { return sleep(0); };
    var ch = new MessageChannel(), waiting = [];
    ch.port1.onmessage = function () { var r = waiting.shift(); if (r) r(); };
    return function () { return new Promise(function (r) { waiting.push(r); ch.port2.postMessage(0); }); };
  })();
  /* Geeft de browser lucht als het rekenen langer dan ~40 ms achter elkaar duurt; af en toe via een echte timer,
     zodat ook tekenen en andere timers zeker aan de beurt komen. */
  function makeBreather() {
    var t = now(), slow = t;
    return function () {
      var n = now();
      if (n - t < 40) return null;
      var viaTimer = n - slow > 240;
      return (viaTimer ? sleep(0) : hop()).then(function () { t = now(); if (viaTimer) slow = t; });
    };
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function dist(a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag), k;
    if (attrs) for (k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else n.setAttribute(k, v === true ? "" : v);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function svgEl(tag, attrs) {
    var n = document.createElementNS("http://www.w3.org/2000/svg", tag), k;
    for (k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  /* ================= foto's lezen ================= */
  /* Geeft { src, w, h, close }. Eerst createImageBitmap (zet een telefoonfoto meteen rechtop), anders een <img>. */
  async function readDrawable(blob) {
    if (window.createImageBitmap) {
      try {
        var bm = await createImageBitmap(blob, { imageOrientation: "from-image" });
        if (bm && bm.width && bm.height) return { src: bm, w: bm.width, h: bm.height, close: function () { if (bm.close) bm.close(); } };
      } catch (e) { /* dan via een <img> */ }
    }
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () {
        if (!img.naturalWidth || !img.naturalHeight) { URL.revokeObjectURL(url); reject(new Error("geen afmetingen")); return; }
        resolve({ src: img, w: img.naturalWidth, h: img.naturalHeight, close: function () { img.onload = img.onerror = null; URL.revokeObjectURL(url); img.removeAttribute("src"); } });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("onleesbaar")); };
      img.decoding = "async";
      img.src = url;
    });
  }
  /* Leest de foto van een pagina; lukt dat niet, dan mag de app het proberen (opts.decode). Het resultaat daarvan
     wordt als JPG bewaard, zodat de tweede keer lezen (bij Klaar) snel gaat. */
  async function openSource(p, opts) {
    try { return await readDrawable(p.blob); }
    catch (e) {
      if (!opts || typeof opts.decode !== "function" || p.decoded) throw e;
      var x = await opts.decode(p.file);
      if (!x) throw e;
      if (typeof Blob !== "undefined" && x instanceof Blob) p.blob = x;
      else {
        var w = x.naturalWidth || x.width, h = x.naturalHeight || x.height;
        if (!w || !h) throw e;
        var k = Math.min(1, 4096 / Math.max(w, h)), c = makeCanvas(w * k, h * k), g = ctx2d(c);
        g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(x, 0, 0, c.width, c.height);
        if (x.close) x.close(); else if (x !== c && x.getContext) freeCanvas(x);
        p.blob = await new Promise(function (res, rej) { c.toBlob(function (b) { if (b) res(b); else rej(e); }, "image/jpeg", 0.92); });
        freeCanvas(c);
      }
      p.decoded = true;
      return readDrawable(p.blob);
    }
  }

  /* ================= randherkenning ================= */
  function boxBlur(a, w, h, r) {
    var n = w * h, t = new Float32Array(n), o = new Float32Array(n), x, y, i, s, k, win = 2 * r + 1;
    for (y = 0; y < h; y++) {
      i = y * w; s = 0;
      for (k = -r; k <= r; k++) s += a[i + clamp(k, 0, w - 1)];
      for (x = 0; x < w; x++) {
        t[i + x] = s / win;
        s += a[i + Math.min(w - 1, x + r + 1)] - a[i + Math.max(0, x - r)];
      }
    }
    for (x = 0; x < w; x++) {
      s = 0;
      for (k = -r; k <= r; k++) s += t[clamp(k, 0, h - 1) * w + x];
      for (y = 0; y < h; y++) {
        o[y * w + x] = s / win;
        s += t[Math.min(h - 1, y + r + 1) * w + x] - t[Math.max(0, y - r) * w + x];
      }
    }
    return o;
  }
  /* Otsu: de drempel die licht en donker het best uit elkaar haalt. Waarden 0..255. */
  function otsu(a) {
    var hist = new Float64Array(256), n = a.length, i, sum = 0;
    for (i = 0; i < n; i++) hist[clamp(a[i] | 0, 0, 255)]++;
    for (i = 0; i < 256; i++) sum += i * hist[i];
    var wB = 0, sumB = 0, best = -1, thr = 127;
    for (i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      var wF = n - wB;
      if (!wF) break;
      sumB += i * hist[i];
      var mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = i; }
    }
    return thr;
  }
  function median(list) {
    if (!list.length) return 0;
    var s = Array.prototype.slice.call(list).sort(function (a, b) { return a - b; });
    return s[s.length >> 1];
  }
  function cross(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
  function convexHull(pts) {
    var p = pts.slice().sort(function (a, b) { return a.x - b.x || a.y - b.y; }), n = p.length, i, lo = [], up = [];
    if (n < 3) return p;
    for (i = 0; i < n; i++) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p[i]) <= 0) lo.pop(); lo.push(p[i]); }
    for (i = n - 1; i >= 0; i--) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p[i]) <= 0) up.pop(); up.push(p[i]); }
    lo.pop(); up.pop();
    return lo.concat(up);
  }
  function polyArea(p) {
    var s = 0;
    for (var i = 0, n = p.length; i < n; i++) { var a = p[i], b = p[(i + 1) % n]; s += a.x * b.y - b.x * a.y; }
    return Math.abs(s) / 2;
  }
  /* Vier punten in de volgorde linksboven, rechtsboven, rechtsonder, linksonder. */
  function orderCorners(q) {
    var cx = 0, cy = 0;
    q.forEach(function (p) { cx += p.x / 4; cy += p.y / 4; });
    var s = q.slice().sort(function (a, b) { return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx); });
    var first = 0;
    for (var i = 1; i < 4; i++) if (s[i].x + s[i].y < s[first].x + s[first].y) first = i;
    return [s[first], s[(first + 1) % 4], s[(first + 2) % 4], s[(first + 3) % 4]];
  }
  /* Bol, met de klok mee en geen te scherpe hoeken of te korte zijden. Punten in elke gewenste eenheid. */
  function quadOk(q, minSide) {
    for (var i = 0; i < 4; i++) {
      var a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
      var l1 = dist(a, b), l2 = dist(b, c);
      if (l1 < minSide || l2 < minSide) return false;
      if (cross(a, b, c) < 0.2 * l1 * l2) return false;
    }
    return true;
  }
  /* Rechte lijn door de randpunten die bij één zijde horen (kleinste kwadraten, alle richtingen). */
  function fitSide(pts, A, B, tol) {
    var dx = B.x - A.x, dy = B.y - A.y, len = Math.sqrt(dx * dx + dy * dy);
    if (len < 4) return null;
    var ux = dx / len, uy = dy / len, n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (var i = 0; i < pts.length; i++) {
      var px = pts[i].x - A.x, py = pts[i].y - A.y, t = (px * ux + py * uy) / len;
      if (t < 0.1 || t > 0.9) continue;
      if (Math.abs(px * uy - py * ux) > tol) continue;
      n++; sx += pts[i].x; sy += pts[i].y; sxx += pts[i].x * pts[i].x; syy += pts[i].y * pts[i].y; sxy += pts[i].x * pts[i].y;
    }
    if (n < 8) return null;
    var mx = sx / n, my = sy / n, cxx = sxx / n - mx * mx, cyy = syy / n - my * my, cxy = sxy / n - mx * my;
    var ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    return { x: mx, y: my, dx: Math.cos(ang), dy: Math.sin(ang) };
  }
  function lineCross(L1, L2) {
    var det = L1.dx * L2.dy - L1.dy * L2.dx;
    if (Math.abs(det) < 1e-6) return null;
    var t = ((L2.x - L1.x) * L2.dy - (L2.y - L1.y) * L2.dx) / det;
    return { x: L1.x + t * L1.dx, y: L1.y + t * L1.dy };
  }

  /* Maakt van een masker (1 = waarschijnlijk papier) een vierhoek rond het grootste vlak.
     Geeft { q, score } of null als het niet overtuigt. */
  function quadFromMask(mask, w, h, R, G, B) {
    var n = w * h, i, x, y, tmp = new Uint8Array(n);
    /* dunne bruggetjes weg: eerst krimpen, dan weer groeien */
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      tmp[i] = mask[i] && x > 0 && x < w - 1 && y > 0 && y < h - 1 && mask[i - 1] && mask[i + 1] && mask[i - w] && mask[i + w] ? 1 : 0;
    }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      mask[i] = tmp[i] || (x > 0 && tmp[i - 1]) || (x < w - 1 && tmp[i + 1]) || (y > 0 && tmp[i - w]) || (y < h - 1 && tmp[i + w]) ? 1 : 0;
    }
    /* gaten dichten (tekst, logo's, het midden van een groot vel): alles wat vanaf de fotorand niet te bereiken is, hoort erbij */
    var stack = new Int32Array(n), sp = 0, j, jx;
    tmp.fill(0);
    function seed(k) { if (!mask[k] && !tmp[k]) { tmp[k] = 1; stack[sp++] = k; } }
    for (x = 0; x < w; x++) { seed(x); seed(n - w + x); }
    for (y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
    while (sp) {
      j = stack[--sp]; jx = j % w;
      if (jx > 0) seed(j - 1);
      if (jx < w - 1) seed(j + 1);
      if (j >= w) seed(j - w);
      if (j < n - w) seed(j + w);
    }
    for (i = 0; i < n; i++) mask[i] = tmp[i] ? 0 : 1;
    /* grootste samenhangende vlak */
    var lab = new Int32Array(n), best = 0, bestId = 0, cur = 0;
    for (i = 0; i < n; i++) {
      if (!mask[i] || lab[i]) continue;
      cur++; var cnt = 0; sp = 0; stack[sp++] = i; lab[i] = cur;
      while (sp) {
        j = stack[--sp]; jx = j % w; cnt++;
        if (jx > 0 && mask[j - 1] && !lab[j - 1]) { lab[j - 1] = cur; stack[sp++] = j - 1; }
        if (jx < w - 1 && mask[j + 1] && !lab[j + 1]) { lab[j + 1] = cur; stack[sp++] = j + 1; }
        if (j >= w && mask[j - w] && !lab[j - w]) { lab[j - w] = cur; stack[sp++] = j - w; }
        if (j < n - w && mask[j + w] && !lab[j + w]) { lab[j + w] = cur; stack[sp++] = j + w; }
      }
      if (cnt > best) { best = cnt; bestId = cur; }
    }
    if (best < 0.1 * n) return null;
    /* randpunten: per rij de uiterste links en rechts, per kolom de uiterste boven en onder */
    var pts = [], lo, hi;
    for (y = 0; y < h; y++) {
      lo = -1; hi = -1;
      for (x = 0; x < w; x++) if (lab[y * w + x] === bestId) { if (lo < 0) lo = x; hi = x; }
      if (lo >= 0) { pts.push({ x: lo, y: y + 0.5 }); pts.push({ x: hi + 1, y: y + 0.5 }); }
    }
    for (x = 0; x < w; x++) {
      lo = -1; hi = -1;
      for (y = 0; y < h; y++) if (lab[y * w + x] === bestId) { if (lo < 0) lo = y; hi = y; }
      if (lo >= 0) { pts.push({ x: x + 0.5, y: lo }); pts.push({ x: x + 0.5, y: hi + 1 }); }
    }
    var hull = convexHull(pts);
    if (hull.length < 4) return null;
    var hullArea = polyArea(hull);
    /* de omtrek uitdunnen tot een handvol punten: steeds het punt weg dat het minst toevoegt */
    while (hull.length > 32) {
      var mi = 0, ma = Infinity, m = hull.length;
      for (i = 0; i < m; i++) {
        var ar = Math.abs(cross(hull[(i + m - 1) % m], hull[i], hull[(i + 1) % m]));
        if (ar < ma) { ma = ar; mi = i; }
      }
      hull.splice(mi, 1);
    }
    /* de vier punten die samen het grootste vlak omspannen */
    var H = hull, hn = H.length, bq = null, ba = 0, a, b, c, d;
    for (a = 0; a < hn - 3; a++) for (b = a + 1; b < hn - 2; b++) for (c = b + 1; c < hn - 1; c++) for (d = c + 1; d < hn; d++) {
      var qa = Math.abs((H[a].x * H[b].y - H[b].x * H[a].y) + (H[b].x * H[c].y - H[c].x * H[b].y) + (H[c].x * H[d].y - H[d].x * H[c].y) + (H[d].x * H[a].y - H[a].x * H[d].y)) / 2;
      if (qa > ba) { ba = qa; bq = [H[a], H[b], H[c], H[d]]; }
    }
    if (!bq) return null;
    if (ba < 0.86 * hullArea) return null;            /* het vlak is geen vierhoek */
    if (best < 0.45 * hullArea) return null;          /* te rafelig */
    var q = orderCorners(bq), diag = Math.sqrt(w * w + h * h), round, k;
    /* hoeken verfijnen: per zijde een lijn door de randpunten, de snijpunten zijn de hoeken */
    for (round = 0; round < 2; round++) {
      var lines = [];
      for (k = 0; k < 4; k++) lines.push(fitSide(pts, q[k], q[(k + 1) % 4], round ? 1.6 : 2.6));
      var nq = [];
      for (k = 0; k < 4; k++) {
        var L1 = lines[(k + 3) % 4], L2 = lines[k], pt = L1 && L2 ? lineCross(L1, L2) : null;
        if (pt && dist(pt, q[k]) < 0.06 * diag) nq.push({ x: clamp(pt.x, 0, w), y: clamp(pt.y, 0, h) });
        else nq.push(q[k]);
      }
      q = nq;
    }
    if (!quadOk(q, 0.08 * Math.min(w, h))) return null;
    var area = polyArea(q);
    if (area < 0.15 * n) return null;
    /* Zijden die op de fotorand liggen zeggen niets; de andere moeten een echte overgang laten zien. */
    var cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
    var onBorder = 0, contrast = [];
    function px(arr, fx, fy) { return arr[clamp(Math.round(fy - 0.5), 0, h - 1) * w + clamp(Math.round(fx - 0.5), 0, w - 1)]; }
    for (k = 0; k < 4; k++) {
      var A = q[k], Bp = q[(k + 1) % 4], ex = Bp.x - A.x, ey = Bp.y - A.y, el2 = Math.sqrt(ex * ex + ey * ey);
      var nx = ey / el2, ny = -ex / el2;
      if ((cx - A.x) * nx + (cy - A.y) * ny > 0) { nx = -nx; ny = -ny; }          /* naar buiten */
      var vals = [];
      for (var s = 0; s < 24; s++) {
        var t = 0.15 + 0.7 * s / 23, sx = A.x + ex * t, sy = A.y + ey * t;
        var ox = sx + nx * 4, oy = sy + ny * 4, ix = sx - nx * 4, iy = sy - ny * 4;
        if (ox < 1 || oy < 1 || ox > w - 1 || oy > h - 1) continue;
        var dr = px(R, ox, oy) - px(R, ix, iy), dg = px(G, ox, oy) - px(G, ix, iy), db = px(B, ox, oy) - px(B, ix, iy);
        vals.push(Math.sqrt(dr * dr + dg * dg + db * db));
      }
      if (vals.length < 8) { onBorder++; continue; }
      contrast.push(median(vals));
    }
    if (onBorder > 2 || !contrast.length) return null;
    var minC = Math.min.apply(null, contrast), meanC = contrast.reduce(function (u, v) { return u + v; }, 0) / contrast.length;
    if (minC < 14) return null;
    return { q: q, score: meanC * Math.sqrt(area / n) * (onBorder ? 0.7 : 1) };
  }

  /* Geeft vier hoeken (0..1, linksboven met de klok mee) of null als er geen duidelijk vel papier is. */
  function detectCorners(view) {
    var k = Math.min(1, DETECT_MAX / Math.max(view.width, view.height));
    var w = Math.max(16, Math.round(view.width * k)), h = Math.max(16, Math.round(view.height * k));
    var c = makeCanvas(w, h), g = ctx2d(c, true);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.drawImage(view, 0, 0, w, h);
    var d = g.getImageData(0, 0, w, h).data, n = w * h, i;
    freeCanvas(c);
    var R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
    for (i = 0; i < n; i++) { R[i] = d[i * 4]; G[i] = d[i * 4 + 1]; B[i] = d[i * 4 + 2]; }
    R = boxBlur(R, w, h, 2); G = boxBlur(G, w, h, 2); B = boxBlur(B, w, h, 2);
    /* kaart 1: licht en weinig kleur (wit papier op een donkere of gekleurde ondergrond) */
    var light = new Float32Array(n);
    for (i = 0; i < n; i++) light[i] = Math.min(R[i], G[i], B[i]);
    /* De ondergrond wordt afgemeten aan de rand van de foto. Omdat het licht zelden overal even sterk is,
       is dat geen vaste kleur maar een vlak met een verloop (per kanaal: a + b*x + c*y), twee keer gepast
       zodat een hoek papier die de rand raakt niet meetelt. */
    var ring = Math.max(2, Math.round(0.03 * Math.min(w, h))), bx = [], by = [], bi = [], x, y;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      if (x >= ring && x < w - ring && y >= ring && y < h - ring) continue;
      bx.push(x); by.push(y); bi.push(y * w + x);
    }
    function fitPlane(arr) {
      var keep = null, co = [0, 0, 0], pass, j, m = bi.length;
      for (pass = 0; pass < 3; pass++) {
        var s1 = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sv = 0, sxv = 0, syv = 0;
        for (j = 0; j < m; j++) {
          if (keep && !keep[j]) continue;
          var X = bx[j], Y = by[j], V = arr[bi[j]];
          s1++; sx += X; sy += Y; sxx += X * X; syy += Y * Y; sxy += X * Y; sv += V; sxv += X * V; syv += Y * V;
        }
        var det = s1 * (sxx * syy - sxy * sxy) - sx * (sx * syy - sxy * sy) + sy * (sx * sxy - sxx * sy);
        if (s1 < 12 || Math.abs(det) < 1e-6) break;
        co = [
          (sv * (sxx * syy - sxy * sxy) - sx * (sxv * syy - sxy * syv) + sy * (sxv * sxy - sxx * syv)) / det,
          (s1 * (sxv * syy - syv * sxy) - sv * (sx * syy - sxy * sy) + sy * (sx * syv - sxv * sy)) / det,
          (s1 * (sxx * syv - sxy * sxv) - sx * (sx * syv - sxv * sy) + sv * (sx * sxy - sxx * sy)) / det
        ];
        var res = new Float32Array(m);
        for (j = 0; j < m; j++) res[j] = Math.abs(arr[bi[j]] - (co[0] + co[1] * bx[j] + co[2] * by[j]));
        var lim = 2.5 * median(res) + 4;
        keep = new Uint8Array(m);
        for (j = 0; j < m; j++) keep[j] = res[j] <= lim ? 1 : 0;
      }
      return co;
    }
    var pr = fitPlane(R), pg = fitPlane(G), pb = fitPlane(B), pl = fitPlane(light);
    /* kaart 2: anders van kleur dan de ondergrond; kaart 3: lichter dan de ondergrond ter plekke */
    var other = new Float32Array(n), lighter = new Float32Array(n), mx = 1;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      var dr = R[i] - (pr[0] + pr[1] * x + pr[2] * y), dg = G[i] - (pg[0] + pg[1] * x + pg[2] * y), db = B[i] - (pb[0] + pb[1] * x + pb[2] * y);
      var v = Math.sqrt(dr * dr + dg * dg + db * db);
      other[i] = v; if (v > mx) mx = v;
      lighter[i] = clamp(128 + 1.5 * (light[i] - (pl[0] + pl[1] * x + pl[2] * y)), 0, 255);
    }
    for (i = 0; i < n; i++) other[i] = other[i] * 255 / mx;
    /* kaart 4: lichter dan de directe omgeving. Werkt ook als er een schaduw (hand, telefoon) over een deel van het papier valt. */
    var flat = light, pass, t2;
    for (pass = 0; pass < 2; pass++) {            /* tekst wegpoetsen: eerst het maximum, dan het minimum over 7 bij 7 */
      var pick = pass ? Math.min : Math.max; t2 = new Float32Array(n);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        var m1 = flat[y * w + x];
        for (var k1 = Math.max(0, x - 3); k1 <= Math.min(w - 1, x + 3); k1++) m1 = pick(m1, flat[y * w + k1]);
        t2[y * w + x] = m1;
      }
      flat = new Float32Array(n);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        var m2 = t2[y * w + x];
        for (var k3 = Math.max(0, y - 3); k3 <= Math.min(h - 1, y + 3); k3++) m2 = pick(m2, t2[k3 * w + x]);
        flat[y * w + x] = m2;
      }
    }
    var around = boxBlur(flat, w, h, Math.max(6, Math.round(0.1 * Math.min(w, h)))), local = new Uint8Array(n);
    for (i = 0; i < n; i++) local[i] = flat[i] - around[i] > Math.max(5, 0.04 * around[i]) ? 1 : 0;
    function byOtsu(map) {
      var t = otsu(map), m = new Uint8Array(n);
      for (var k2 = 0; k2 < n; k2++) m[k2] = map[k2] > t ? 1 : 0;
      return m;
    }
    var best = null;
    [byOtsu(light), byOtsu(other), byOtsu(lighter), local].forEach(function (mask) {
      var r = quadFromMask(mask, w, h, R, G, B);
      if (r && (!best || r.score > best.score)) best = r;
    });
    if (!best) return null;
    /* een haar naar binnen, zodat er geen randje tafel meekomt */
    var cx = (best.q[0].x + best.q[1].x + best.q[2].x + best.q[3].x) / 4, cy = (best.q[0].y + best.q[1].y + best.q[2].y + best.q[3].y) / 4;
    return best.q.map(function (p) {
      var dx = cx - p.x, dy = cy - p.y, len = Math.sqrt(dx * dx + dy * dy) || 1, inset = Math.min(1.2, len * 0.02);
      return { x: clamp((p.x + dx / len * inset) / w, 0, 1), y: clamp((p.y + dy / len * inset) / h, 0, 1) };
    });
  }
  function defaultCorners() { return [{ x: 0.08, y: 0.08 }, { x: 0.92, y: 0.08 }, { x: 0.92, y: 0.92 }, { x: 0.08, y: 0.92 }]; }
  function fullCorners() { return [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]; }

  /* ================= verhouding en rechttrekken ================= */
  /* Breedte gedeeld door hoogte van het papier. P = hoeken in pixels, iw/ih = maat van de hele foto.
     Basis is het gemiddelde van tegenoverliggende zijden. Is de foto schuin genomen, dan klopt dat niet meer
     (de verre kant lijkt korter); daarom wordt het perspectief teruggerekend met het midden van de foto als
     kijkrichting (Zhang en He, 2003). Geeft dat iets onwaarschijnlijks, dan blijft het bij het gemiddelde.
     Ligt de uitkomst binnen 6% van A4, dan wordt het precies A4. */
  function quadAspect(P, iw, ih) {
    var avg = ((dist(P[0], P[1]) + dist(P[3], P[2])) / 2) / Math.max(1e-6, (dist(P[0], P[3]) + dist(P[1], P[2])) / 2);
    var r = avg, u0 = iw / 2, v0 = ih / 2, big = Math.max(iw, ih);
    function hom(p) { return [(p.x - u0) / big, (p.y - v0) / big, 1]; }
    function crs(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
    function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
    var m1 = hom(P[0]), m2 = hom(P[1]), m3 = hom(P[3]), m4 = hom(P[2]);
    var d2 = dot(crs(m2, m4), m3), d3 = dot(crs(m3, m4), m2);
    if (Math.abs(d2) > 1e-9 && Math.abs(d3) > 1e-9) {
      var k2 = dot(crs(m1, m4), m3) / d2, k3 = dot(crs(m1, m4), m2) / d3;
      var n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 - 1], n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 - 1];
      var f2 = 0.8 * 0.8;                              /* gewone telefooncamera: brandpunt ongeveer 0,8 keer de lange zijde */
      if (Math.abs(n2[2]) > 0.04 && Math.abs(n3[2]) > 0.04) {
        var est = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);
        if (est > 0.5 * 0.5 && est < 2.5 * 2.5) f2 = est;
      }
      var num = n2[0] * n2[0] + n2[1] * n2[1] + f2 * n2[2] * n2[2], den = n3[0] * n3[0] + n3[1] * n3[1] + f2 * n3[2] * n3[2];
      var z = den > 1e-12 ? Math.sqrt(num / den) : 0;
      if (z > avg * 0.7 && z < avg * 1.43) r = z;
    }
    if (Math.abs(r * Math.SQRT2 - 1) <= 0.06) r = 1 / Math.SQRT2;
    else if (Math.abs(r / Math.SQRT2 - 1) <= 0.06) r = Math.SQRT2;
    return r;
  }
  /* Afbeelding van het eenheidsvierkant op de vierhoek Q (linksboven, rechtsboven, rechtsonder, linksonder). */
  function unitToQuad(Q) {
    var x0 = Q[0].x, y0 = Q[0].y, x1 = Q[1].x, y1 = Q[1].y, x2 = Q[2].x, y2 = Q[2].y, x3 = Q[3].x, y3 = Q[3].y;
    var dx1 = x1 - x2, dx2 = x3 - x2, sx = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, sy = y0 - y1 + y2 - y3;
    var den = dx1 * dy2 - dx2 * dy1, g = 0, h = 0;
    if (Math.abs(den) > 1e-9) { g = (sx * dy2 - dx2 * sy) / den; h = (dx1 * sy - sx * dy1) / den; }
    return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h];
  }
  /* Zwaar rekenwerk gaat in stroken van een paar rijen. De stroken zelf zijn gewone functies; tussen de stroken
     door krijgt de browser zo nodig lucht, zodat de pagina blijft reageren. */
  async function inBands(h, breathe, band) {
    if (!breathe) { band(0, h); return; }
    for (var y = 0; y < h; y += 48) {
      band(y, Math.min(h, y + 48));
      var wait = breathe();
      if (wait) await wait;
    }
  }
  /* Rechttrekken: elke uitvoerpixel haalt zijn kleur op in de bron, gemengd uit de vier buren. */
  function warpRows(sd, sw, sh, m, dst, ow, oh, j0, j1) {
    var a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], hh = m[7];
    var xmax = sw - 1, ymax = sh - 1, sw4 = sw * 4, o = j0 * ow * 4;
    for (var j = j0; j < j1; j++) {
      var v = (j + 0.5) / oh, bx = b * v + c, by = e * v + f, bw = hh * v + 1;
      for (var i = 0; i < ow; i++) {
        var u = (i + 0.5) / ow, iw = 1 / (g * u + bw);
        var x = (a * u + bx) * iw - 0.5, y = (d * u + by) * iw - 0.5;
        if (x < 0) x = 0; else if (x > xmax) x = xmax;
        if (y < 0) y = 0; else if (y > ymax) y = ymax;
        var xi = x | 0, yi = y | 0, fx = ((x - xi) * 256) | 0, fy = ((y - yi) * 256) | 0;      /* gewichten in 256sten */
        var p0 = yi * sw4 + xi * 4, p1 = xi < xmax ? p0 + 4 : p0, p2 = yi < ymax ? p0 + sw4 : p0, p3 = p2 + (p1 - p0);
        var w11 = fx * fy, w10 = (fx << 8) - w11, w01 = (fy << 8) - w11, w00 = 65536 - (fx << 8) - (fy << 8) + w11;
        dst[o] = (sd[p0] * w00 + sd[p1] * w10 + sd[p2] * w01 + sd[p3] * w11 + 32768) >> 16;
        dst[o + 1] = (sd[p0 + 1] * w00 + sd[p1 + 1] * w10 + sd[p2 + 1] * w01 + sd[p3 + 1] * w11 + 32768) >> 16;
        dst[o + 2] = (sd[p0 + 2] * w00 + sd[p1 + 2] * w10 + sd[p2 + 2] * w01 + sd[p3 + 2] * w11 + 32768) >> 16;
        dst[o + 3] = 255;
        o += 4;
      }
    }
  }
  async function warp(sd, sw, sh, Q, ow, oh, breathe) {
    var m = unitToQuad(Q), out = new Uint8ClampedArray(ow * oh * 4), dst = new Uint8Array(out.buffer);
    await inBands(oh, breathe, function (j0, j1) { warpRows(sd, sw, sh, m, dst, ow, oh, j0, j1); });
    return out;
  }

  /* ================= looks ================= */
  /* Schat per plek hoe licht het papier daar is (per kleurkanaal), op een grof raster.
     Kleine blokjes middelen, per cel het lichtste blokje nemen, dan tekst en logo's eruit halen door eerst het
     maximum en daarna het minimum over de buurt te nemen, en tot slot verzachten. */
  function paperMap(d, w, h) {
    var bs = Math.max(1, Math.round(Math.max(w, h) / 200)), step = bs >= 6 ? 2 : 1;
    var sw = Math.ceil(w / bs), sh = Math.ceil(h / bs), sn = sw * sh;
    var sum = new Float32Array(sn * 3), cnt = new Uint32Array(sn), x, y, i, c;
    for (y = 0; y < h; y += step) {
      var row = ((y / bs) | 0) * sw, o = y * w * 4;
      for (x = 0; x < w; x += step) {
        i = row + ((x / bs) | 0); var p = o + x * 4;
        sum[i * 3] += d[p]; sum[i * 3 + 1] += d[p + 1]; sum[i * 3 + 2] += d[p + 2]; cnt[i]++;
      }
    }
    var gw = Math.ceil(sw / 2), gh = Math.ceil(sh / 2), gn = gw * gh, G = [new Float32Array(gn), new Float32Array(gn), new Float32Array(gn)];
    for (y = 0; y < sh; y++) for (x = 0; x < sw; x++) {
      i = y * sw + x; if (!cnt[i]) continue;
      var gi = (y >> 1) * gw + (x >> 1);
      for (c = 0; c < 3; c++) { var val = sum[i * 3 + c] / cnt[i]; if (val > G[c][gi]) G[c][gi] = val; }
    }
    var r = Math.max(2, Math.round(Math.max(gw, gh) * 0.055));
    function pass(a, r2, pick) {            /* maximum of minimum over een venster, eerst horizontaal dan verticaal */
      var t = new Float32Array(gn), o2 = new Float32Array(gn), xx, yy, k2, best;
      for (yy = 0; yy < gh; yy++) for (xx = 0; xx < gw; xx++) {
        best = a[yy * gw + xx];
        for (k2 = Math.max(0, xx - r2); k2 <= Math.min(gw - 1, xx + r2); k2++) best = pick(best, a[yy * gw + k2]);
        t[yy * gw + xx] = best;
      }
      for (yy = 0; yy < gh; yy++) for (xx = 0; xx < gw; xx++) {
        best = t[yy * gw + xx];
        for (k2 = Math.max(0, yy - r2); k2 <= Math.min(gh - 1, yy + r2); k2++) best = pick(best, t[k2 * gw + xx]);
        o2[yy * gw + xx] = best;
      }
      return o2;
    }
    for (c = 0; c < 3; c++) {
      var a = pass(G[c], r, Math.max);
      a = pass(a, r, Math.min);
      a = boxBlur(a, gw, gh, 2); a = boxBlur(a, gw, gh, 1);
      G[c] = a;
    }
    /* Papier is nooit veel donkerder dan het lichtste papier op de pagina, en nooit sterk gekleurd.
       Zo blijft een groot donker of gekleurd vlak (foto, logo) staan in plaats van wit te worden. */
    for (c = 0; c < 3; c++) {
      var sorted = Array.prototype.slice.call(G[c]).sort(function (p1, p2) { return p1 - p2; });
      var floor = Math.max(24, 0.5 * sorted[Math.min(gn - 1, Math.floor(gn * 0.85))]);
      for (i = 0; i < gn; i++) if (G[c][i] < floor) G[c][i] = floor;
    }
    for (i = 0; i < gn; i++) {
      var top = Math.max(G[0][i], G[1][i], G[2][i]) * 0.62;
      for (c = 0; c < 3; c++) if (G[c][i] < top) G[c][i] = top;
    }
    return { w: gw, h: gh, cell: bs * 2, ch: G };
  }
  /* Hulp om de papierkaart per pixel op te vragen: per kolom alvast de cel en het gewicht. */
  function mapColumns(M, w) {
    var ix = new Int32Array(w), fx = new Float32Array(w);
    for (var x = 0; x < w; x++) {
      var gx = clamp((x + 0.5) / M.cell - 0.5, 0, M.w - 1), x0 = Math.min(M.w - 2, gx | 0);
      if (x0 < 0) x0 = 0;
      ix[x] = x0; fx[x] = M.w > 1 ? gx - x0 : 0;
    }
    return { ix: ix, fx: fx };
  }
  function mapRow(M, y, rows) {             /* vult rows[c] met de kaart op hoogte y, per celkolom */
    var gy = clamp((y + 0.5) / M.cell - 0.5, 0, M.h - 1), y0 = Math.min(M.h - 2, gy | 0);
    if (y0 < 0) y0 = 0;
    var fy = M.h > 1 ? gy - y0 : 0, y1 = Math.min(M.h - 1, y0 + 1);
    for (var c = 0; c < 3; c++) {
      var a = M.ch[c], r = rows[c];
      for (var x = 0; x < M.w; x++) r[x] = a[y0 * M.w + x] * (1 - fy) + a[y1 * M.w + x] * fy;
    }
  }
  /* Helderheid van het papier op hoogte y, per pixelkolom (uit de rij die mapRow heeft klaargezet). */
  function paperLum(rows, col, x, Mw) {
    var i = col.ix[x], f = col.fx[x], i1 = i + 1 < Mw ? i + 1 : i;
    return 0.299 * (rows[0][i] + (rows[0][i1] - rows[0][i]) * f) + 0.587 * (rows[1][i] + (rows[1][i1] - rows[1][i]) * f) + 0.114 * (rows[2][i] + (rows[2][i1] - rows[2][i]) * f);
  }
  /* Document: belichting vlak trekken (delen door het papier), licht verscherpen en het contrast aantrekken
     tot het papier wit is en de tekst donker. Per kanaal, zodat een rood stempel rood blijft. */
  function documentRows(d, w, h, M, col, rows, inv, lut, st, y0, y1) {
    var w4 = w * 4, prev = st.prev, cur = st.cur, swap, Mw = M.w, ix = col.ix, fxs = col.fx, i0 = inv[0], i1 = inv[1], i2 = inv[2];
    var x, k, p, a, b, f, xl, xr, dn, v, s, q;
    for (var y = y0; y < y1; y++) {
      mapRow(M, y, rows);
      for (k = 0; k < Mw; k++) { i0[k] = 800 / rows[0][k]; i1[k] = 800 / rows[1][k]; i2[k] = 800 / rows[2][k]; }      /* delen wordt vermenigvuldigen */
      var o = y * w4, last = y === h - 1;
      for (x = 0; x < w; x++) {
        p = x * 4; a = ix[x]; b = a + 1 < Mw ? a + 1 : a; f = fxs[x];
        xl = x > 0 ? p - 4 : p; xr = x < w - 1 ? p + 4 : p; dn = o + w4 + p;
        /* per kanaal: licht verscherpen (verschil met de vier buren), delen door het papier, contrastkromme */
        v = cur[p]; s = v + 0.5 * (v - (prev[p] + (last ? v : d[dn]) + cur[xl] + cur[xr]) * 0.25);
        q = (s * (i0[a] + (i0[b] - i0[a]) * f)) | 0; d[o + p] = lut[q < 0 ? 0 : q > 1023 ? 1023 : q];
        v = cur[p + 1]; s = v + 0.5 * (v - (prev[p + 1] + (last ? v : d[dn + 1]) + cur[xl + 1] + cur[xr + 1]) * 0.25);
        q = (s * (i1[a] + (i1[b] - i1[a]) * f)) | 0; d[o + p + 1] = lut[q < 0 ? 0 : q > 1023 ? 1023 : q];
        v = cur[p + 2]; s = v + 0.5 * (v - (prev[p + 2] + (last ? v : d[dn + 2]) + cur[xl + 2] + cur[xr + 2]) * 0.25);
        q = (s * (i2[a] + (i2[b] - i2[a]) * f)) | 0; d[o + p + 2] = lut[q < 0 ? 0 : q > 1023 ? 1023 : q];
      }
      swap = prev; prev = cur; cur = swap;
      if (!last) cur.set(d.subarray(o + w4, o + 2 * w4));
    }
    st.prev = prev; st.cur = cur;
  }
  async function lookDocument(d, w, h, breathe) {
    var M = paperMap(d, w, h), col = mapColumns(M, w), rows = [new Float32Array(M.w), new Float32Array(M.w), new Float32Array(M.w)];
    var x, y, i, p, w4 = w * 4;
    /* zwartpunt: hoe donker is de donkerste procent van de pagina, afgemeten aan het papier ter plekke */
    var hist = new Uint32Array(256), total = 0, st = Math.max(1, Math.round(Math.max(w, h) / 600));
    for (y = 0; y < h; y += st) {
      mapRow(M, y, rows);
      for (x = 0; x < w; x += st) {
        p = (y * w + x) * 4;
        hist[clamp(Math.round((0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]) / paperLum(rows, col, x, M.w) * 200), 0, 255)]++; total++;
      }
    }
    var acc = 0, lo = 0;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * 0.01) { lo = i / 200; break; } }
    lo = clamp(lo, 0.05, 0.3);
    var hi = 0.9, lut = new Uint8Array(1024);          /* papier (90% of meer van de plaatselijke helderheid) wordt wit */
    for (i = 0; i < 1024; i++) lut[i] = Math.round(255 * Math.pow(clamp((i / 800 - lo) / (hi - lo), 0, 1), 1.12));
    var state = { prev: new Uint8Array(w4), cur: new Uint8Array(w4) };
    state.cur.set(d.subarray(0, w4)); state.prev.set(state.cur);
    var inv = [new Float32Array(M.w), new Float32Array(M.w), new Float32Array(M.w)];
    await inBands(h, breathe, function (y0, y1) { documentRows(d, w, h, M, col, rows, inv, lut, state, y0, y1); });
  }
  /* Zwart-wit: belichting vlak trekken, dan per plek vergelijken met het gemiddelde van de omgeving. */
  function bwSumRows(d, w, M, col, rows, L, I, y0, y1) {
    var W1 = w + 1, Mw = M.w;
    for (var y = y0; y < y1; y++) {
      mapRow(M, y, rows);
      var rs = 0, o = y * w, a = y * W1 + 1, b = a + W1;
      for (var x = 0; x < w; x++) {
        var p = (o + x) * 4, v = (0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]) * 240 / paperLum(rows, col, x, Mw);
        v = v > 255 ? 255 : v | 0;
        L[o + x] = v; rs += v;
        I[b + x] = I[a + x] + rs;
      }
    }
  }
  function bwCutRows(d, w, h, L, I, r, y0, y1) {
    var W1 = w + 1;
    for (var y = y0; y < y1; y++) {
      var ya = Math.max(0, y - r), yb = Math.min(h, y + r + 1), ra = ya * W1, rb = yb * W1, o = y * w;
      for (var x = 0; x < w; x++) {
        var xa = x - r < 0 ? 0 : x - r, xb = x + r + 1 > w ? w : x + r + 1;
        var mean = ((I[rb + xb] - I[ra + xb] - I[rb + xa] + I[ra + xa]) >>> 0) / ((xb - xa) * (yb - ya));
        var T = mean * 0.88; if (T < 90) T = 90; else if (T > 205) T = 205;
        var p = (o + x) * 4;
        d[p] = d[p + 1] = d[p + 2] = 128 + (L[o + x] - T) * 9;          /* steile overgang in plaats van een harde knip: minder kartels */
      }
    }
  }
  async function lookBW(d, w, h, breathe) {
    var M = paperMap(d, w, h), col = mapColumns(M, w), rows = [new Float32Array(M.w), new Float32Array(M.w), new Float32Array(M.w)];
    var L = new Uint8Array(w * h), I = new Uint32Array((w + 1) * (h + 1)), r = Math.max(4, Math.round(Math.max(w, h) / 36));
    await inBands(h, breathe, function (y0, y1) { bwSumRows(d, w, M, col, rows, L, I, y0, y1); });
    await inBands(h, breathe, function (y0, y1) { bwCutRows(d, w, h, L, I, r, y0, y1); });
  }
  /* Kleur en Grijs: alleen een lichte contrastcorrectie (donkerste en lichtste halve procent naar de uitersten). */
  function plainRows(d, w, lut, gray, y0, y1) {
    for (var p = y0 * w * 4, end = y1 * w * 4; p < end; p += 4) {
      if (gray) d[p] = d[p + 1] = d[p + 2] = lut[(0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2] + 0.5) | 0];
      else { d[p] = lut[d[p]]; d[p + 1] = lut[d[p + 1]]; d[p + 2] = lut[d[p + 2]]; }
    }
  }
  async function lookPlain(d, w, h, gray, breathe) {
    var hist = new Uint32Array(256), st = Math.max(1, Math.round(Math.max(w, h) / 600)), x, y, p, i, total = 0;
    for (y = 0; y < h; y += st) for (x = 0; x < w; x += st) {
      p = (y * w + x) * 4; hist[(0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]) | 0]++; total++;
    }
    var acc = 0, lo = 0, hi = 255;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * 0.005) { lo = i; break; } }
    for (acc = 0, i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= total * 0.005) { hi = i; break; } }
    lo = Math.min(lo, 40); hi = Math.max(hi, 215);
    var lut = new Uint8Array(256);
    for (i = 0; i < 256; i++) lut[i] = clamp(Math.round((i - lo) * 255 / (hi - lo)), 0, 255);
    await inBands(h, breathe, function (y0, y1) { plainRows(d, w, lut, gray, y0, y1); });
  }
  function rotateCanvas(c, rot) {
    rot = ((rot % 360) + 360) % 360;
    if (!rot) return c;
    var quarter = rot === 90 || rot === 270, o = makeCanvas(quarter ? c.height : c.width, quarter ? c.width : c.height), g = ctx2d(o);
    g.translate(o.width / 2, o.height / 2); g.rotate(rot * Math.PI / 180);
    g.drawImage(c, -c.width / 2, -c.height / 2);
    freeCanvas(c);
    return o;
  }

  /* Maakt van een bron (canvas, afbeelding of ImageBitmap van iw bij ih) de rechtgetrokken pagina.
     corners 0..1; look en rot zoals gekozen; maxSide = langste zijde van het resultaat. */
  async function renderPage(src, iw, ih, corners, look, rot, maxSide, breathe) {
    var P = corners.map(function (c) { return { x: c.x * iw, y: c.y * ih }; });
    var whole = corners[0].x === 0 && corners[0].y === 0 && corners[1].x === 1 && corners[1].y === 0 && corners[2].x === 1 && corners[2].y === 1 && corners[3].x === 0 && corners[3].y === 1;
    var ratio = whole ? iw / ih : quadAspect(P, iw, ih);          /* de hele foto: die heeft al de juiste verhouding */
    var longest = Math.max(dist(P[0], P[1]), dist(P[1], P[2]), dist(P[2], P[3]), dist(P[3], P[0]));
    var L = Math.max(16, Math.min(maxSide, Math.round(longest)));
    var ow = ratio >= 1 ? L : Math.max(8, Math.round(L * ratio)), oh = ratio >= 1 ? Math.max(8, Math.round(L / ratio)) : L;
    /* bron: alleen het stuk rond de vierhoek, en niet groter dan nodig */
    var x0 = Math.max(0, Math.floor(Math.min(P[0].x, P[1].x, P[2].x, P[3].x)) - 1), y0 = Math.max(0, Math.floor(Math.min(P[0].y, P[1].y, P[2].y, P[3].y)) - 1);
    var x1 = Math.min(iw, Math.ceil(Math.max(P[0].x, P[1].x, P[2].x, P[3].x)) + 1), y1 = Math.min(ih, Math.ceil(Math.max(P[0].y, P[1].y, P[2].y, P[3].y)) + 1);
    var k = Math.min(1, (L * 1.25) / longest);
    var cw = Math.max(2, Math.round((x1 - x0) * k)), ch = Math.max(2, Math.round((y1 - y0) * k));
    var kx = cw / (x1 - x0), ky = ch / (y1 - y0);
    var c = makeCanvas(cw, ch), g = ctx2d(c, true);
    g.fillStyle = "#fff"; g.fillRect(0, 0, cw, ch);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.drawImage(src, x0, y0, x1 - x0, y1 - y0, 0, 0, cw, ch);
    var sd = g.getImageData(0, 0, cw, ch).data;
    freeCanvas(c);
    var Q = P.map(function (pt) { return { x: (pt.x - x0) * kx, y: (pt.y - y0) * ky }; });
    var out = await warp(sd, cw, ch, Q, ow, oh, breathe);
    sd = null;
    if (look === "kleur") await lookPlain(out, ow, oh, false, breathe);
    else if (look === "grijs") await lookPlain(out, ow, oh, true, breathe);
    else if (look === "zwartwit") await lookBW(out, ow, oh, breathe);
    else await lookDocument(out, ow, oh, breathe);
    var oc = makeCanvas(ow, oh);
    ctx2d(oc).putImageData(new ImageData(out, ow, oh), 0, 0);
    return rotateCanvas(oc, rot);
  }

  /* ================= opmaak ================= */
  var CSS = [
    ".rz{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;background:var(--desk,#E3E6EA);color:var(--ink,#17202B);font:15px/1.45 var(--font-body,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif);overscroll-behavior:contain;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;touch-action:manipulation;animation:rz-in .16s ease-out}",
    ".rz *,.rz *::before,.rz *::after{box-sizing:border-box}",
    ".rz [hidden]{display:none!important}",
    ".rz :focus-visible{outline:2px solid var(--accent,#1F4FD1);outline-offset:2px}",
    "@keyframes rz-in{from{opacity:0}to{opacity:1}}",
    ".rz-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 14px;border:1px solid var(--line,#CBD1D9);border-radius:var(--r-m,10px);background:var(--raised,#fff);color:var(--ink,#17202B);font:inherit;font-weight:550;cursor:pointer;white-space:nowrap}",
    ".rz-btn:disabled{opacity:.45;cursor:default}",
    ".rz-btn.btn-primary{background:var(--accent,#1F4FD1);border-color:var(--accent,#1F4FD1);color:var(--on-accent,#fff)}",
    ".rz-btn.btn-quiet{background:transparent;border-color:transparent}",
    ".rz-top{flex:none;display:flex;align-items:center;gap:8px;padding:max(8px,env(safe-area-inset-top,0px)) max(10px,env(safe-area-inset-right,0px)) 8px max(10px,env(safe-area-inset-left,0px));background:var(--panel,#F6F7F9);border-bottom:1px solid var(--line,#CBD1D9)}",
    ".rz-top .rz-btn{min-width:76px}",
    ".rz-top .rz-cancel{justify-content:flex-start;padding:0 8px}",
    ".rz-title{flex:1;min-width:0;margin:0;text-align:center;font-family:var(--font-display,inherit);font-weight:650;font-size:18px;line-height:1.15;letter-spacing:-0.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".rz-main{flex:1;min-height:0;display:flex;flex-direction:column}",
    ".rz-stage{flex:1;min-height:0;min-width:0;position:relative;display:grid;place-items:center;overflow:hidden;touch-action:none}",
    ".rz-frame{position:relative;background:#fff;box-shadow:var(--paper-shadow,0 1px 1px rgba(23,32,43,.1),0 6px 18px rgba(23,32,43,.14))}",
    ".rz-photo{display:block;width:100%;height:100%}",
    ".rz-ov{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none}",
    ".rz-dim{fill:rgba(15,20,27,.48)}",
    ".rz-edge-bg{fill:none;stroke:#fff;stroke-width:4.5;stroke-linejoin:round}",
    ".rz-edge{fill:none;stroke:#1F4FD1;stroke-width:2;stroke-linejoin:round}",
    ".rz-h{position:absolute;left:0;top:0;width:48px;height:48px;margin:-24px 0 0 -24px;padding:0;border:0;border-radius:50%;background:transparent;display:grid;place-items:center;cursor:grab;touch-action:none;outline:none}",
    ".rz-h::after{content:'';width:22px;height:22px;border-radius:50%;background:#fff;border:3px solid #1F4FD1;box-shadow:0 1px 5px rgba(0,0,0,.4);transition:transform .12s}",
    ".rz-h.is-held{cursor:grabbing}",
    ".rz-h.is-held::after{background:#FFDD3C;transform:scale(1.2)}",
    ".rz-h:focus-visible::after{background:#FFDD3C;outline:2px solid #fff;outline-offset:2px}",
    ".rz-big{position:absolute;inset:0;display:grid;place-items:center;padding:68px " + PAD + "px " + PAD + "px}",
    ".rz-big canvas{display:block;max-width:100%;max-height:100%;min-width:0;min-height:0;box-shadow:var(--paper-shadow,0 6px 18px rgba(23,32,43,.14));background:#fff}",
    ".rz-back{position:absolute;left:12px;top:12px}",
    ".rz-loupe{position:absolute;left:0;top:0;width:" + LOUPE + "px;height:" + LOUPE + "px;border-radius:50%;overflow:hidden;border:3px solid #fff;box-shadow:0 0 0 1px rgba(23,32,43,.5),0 8px 24px rgba(0,0,0,.4);background:#17202B;pointer-events:none;z-index:3}",
    ".rz-loupe canvas{display:block;width:100%;height:100%}",
    ".rz-msg{position:absolute;left:10px;right:10px;top:10px;z-index:4;max-width:520px;margin:0 auto;display:flex;align-items:center;gap:10px;padding:10px 10px 10px 14px;border-radius:var(--r-m,10px);background:var(--danger,#B8301F);color:#fff;font-size:14px;font-weight:500;box-shadow:var(--shadow,0 8px 24px rgba(23,32,43,.2));-webkit-user-select:text;user-select:text}",
    ".rz-msg.is-ask{background:var(--ink,#17202B);color:var(--panel,#F6F7F9)}",
    ".rz-msg span{flex:1;min-width:0}",
    ".rz-msg-btns{display:flex;gap:6px;flex:none}",
    ".rz-msg .rz-btn{min-height:36px;padding:0 12px;flex:none}",
    ".rz-msg .rz-x{width:36px;min-width:36px;padding:0;background:transparent;border-color:transparent;color:inherit}",
    ".rz-msg .rz-x svg{width:18px;height:18px}",
    ".rz-busy{position:absolute;inset:0;z-index:5;display:grid;place-items:center;background:rgba(15,20,27,.35)}",
    ".rz-card{min-width:240px;max-width:calc(100% - 32px);display:grid;gap:10px;padding:16px 20px;border-radius:var(--r-l,16px);background:var(--panel,#F6F7F9);color:var(--ink,#17202B);box-shadow:var(--shadow,0 8px 24px rgba(23,32,43,.2));font-weight:550}",
    ".rz-bar{height:6px;border-radius:3px;background:var(--line,#CBD1D9);overflow:hidden}",
    ".rz-bar i{display:block;height:100%;width:0;background:var(--accent,#1F4FD1);transition:width .15s}",
    ".rz-pick{display:grid;gap:12px;justify-items:stretch;width:min(360px,calc(100% - 40px));text-align:center}",
    ".rz-pick h3{margin:0;font-family:var(--font-display,inherit);font-weight:650;font-size:24px;line-height:1.15;letter-spacing:-0.015em}",
    ".rz-pick p{margin:0 0 6px;color:var(--muted,#5B6675)}",
    ".rz-pick .rz-btn{min-height:52px;font-size:16px}",
    ".rz-panel{flex:none;display:flex;flex-direction:column;gap:10px;padding:10px max(12px,env(safe-area-inset-right,0px)) max(12px,env(safe-area-inset-bottom,0px)) max(12px,env(safe-area-inset-left,0px));background:var(--panel,#F6F7F9);border-top:1px solid var(--line,#CBD1D9)}",
    ".rz-panel>*{flex:none}",
    ".rz-hint{margin:0;font-size:13px;color:var(--muted,#5B6675);min-height:19px}",
    ".rz-pages{display:flex;align-items:center;gap:8px;min-width:0}",
    ".rz-strip{flex:1;min-width:0;display:flex;gap:8px;overflow-x:auto;padding:4px;scrollbar-width:none;touch-action:pan-x}",
    ".rz-strip::-webkit-scrollbar{display:none}",
    ".rz-thumb{flex:none;position:relative;width:44px;height:56px;padding:0;border:1px solid var(--line,#CBD1D9);border-radius:var(--r-s,7px);background:var(--raised,#fff);overflow:hidden;cursor:pointer}",
    ".rz-thumb canvas{display:block;width:100%;height:100%;object-fit:cover}",
    ".rz-thumb b{position:absolute;left:3px;bottom:3px;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:var(--ink,#17202B);color:var(--panel,#F6F7F9);font-size:11px;font-weight:650;line-height:17px;text-align:center}",
    ".rz-thumb[aria-current='true']{border-color:var(--ink,#17202B);box-shadow:0 0 0 3px var(--mark,#FFDD3C)}",
    ".rz-thumb[aria-current='true'] b{background:var(--mark,#FFDD3C);color:var(--on-mark,#17202B)}",
    ".rz-lookrow{display:grid;grid-template-columns:auto minmax(0,1fr);gap:12px;align-items:start}",
    ".rz-prev{position:relative;display:grid;place-items:center;width:86px;height:112px;padding:5px;border:1px solid var(--line,#CBD1D9);border-radius:var(--r-s,7px);background:var(--desk,#E3E6EA);cursor:pointer;color:inherit;font:inherit}",
    ".rz-prev canvas{display:block;max-width:100%;max-height:100%;min-width:0;min-height:0;background:#fff;box-shadow:0 1px 3px rgba(23,32,43,.25)}",
    ".rz-prev i{position:absolute;right:4px;bottom:4px;width:24px;height:24px;display:grid;place-items:center;border-radius:50%;background:var(--raised,#fff);color:var(--ink,#17202B);box-shadow:0 1px 3px rgba(23,32,43,.3)}",
    ".rz-prev i svg{width:15px;height:15px}",
    ".rz-prev[aria-pressed='true']{border-color:var(--ink,#17202B);box-shadow:0 0 0 3px var(--mark,#FFDD3C)}",
    ".rz-look{display:grid;gap:6px;min-width:0}",
    ".rz-label{font-size:13px;color:var(--muted,#5B6675);font-weight:550}",
    ".rz-chips{display:flex;flex-wrap:wrap;gap:6px}",
    ".rz-chip{display:inline-flex;align-items:center;min-height:38px;padding:0 13px;border:1px solid var(--line,#CBD1D9);border-radius:999px;background:var(--raised,#fff);color:var(--ink,#17202B);font:inherit;font-size:14px;font-weight:550;cursor:pointer;white-space:nowrap}",
    ".rz-chip[aria-pressed='true']{background:var(--mark,#FFDD3C);color:var(--on-mark,#17202B);border-color:transparent}",
    ".rz-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}",
    ".rz-actions .rz-btn{padding:0 6px;font-size:14.5px}",
    ".rz.is-empty .rz-panel,.rz.is-empty .rz-done,.rz.is-empty .rz-frame,.rz.is-empty .rz-big{display:none}",
    ".rz:not(.is-empty) .rz-pick{display:none}",
    ".rz.is-big .rz-frame{visibility:hidden}",
    ".rz:not(.is-big) .rz-big{display:none}",
    ".rz.is-busy .rz-panel{pointer-events:none;opacity:.6}",
    ".rz.is-busy .rz-pick{visibility:hidden}",
    "@media (min-width:860px),(orientation:landscape) and (min-width:600px){",
    ".rz-main{flex-direction:row}",
    ".rz-panel{width:340px;gap:16px;padding:18px max(18px,env(safe-area-inset-right,0px)) max(18px,env(safe-area-inset-bottom,0px)) 18px;border-top:0;border-left:1px solid var(--line,#CBD1D9);overflow-y:auto}",
    ".rz-lookrow{grid-template-columns:minmax(0,1fr);gap:14px}",
    ".rz-prev{width:100%;height:min(300px,34vh);padding:10px}",
    ".rz-actions{grid-template-columns:repeat(2,minmax(0,1fr))}",
    ".rz-actions .rz-btn{font-size:15px}",
    ".rz-actions .rz-more{grid-column:1/-1}",
    ".rz-title{font-size:20px}",
    ".rz-top{padding-left:max(14px,env(safe-area-inset-left,0px));padding-right:max(14px,env(safe-area-inset-right,0px))}",
    "}",
    "@media (orientation:landscape) and (max-height:520px){.rz-panel{width:300px;gap:10px;padding-top:10px}.rz-prev{height:110px}}",
    "@media (prefers-reduced-motion:reduce){.rz,.rz *{animation:none!important;transition:none!important}}"
  ].join("\n");
  function addStyle() {
    if (document.getElementById("rechtzetter-style")) return;
    var s = document.createElement("style");
    s.id = "rechtzetter-style"; s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  var ICON_X = ["M6 6l12 12", "M18 6L6 18"], ICON_ZOOM = ["M14 4h6v6", "M20 4l-7 7", "M10 20H4v-6", "M4 20l7-7"];
  function icon(paths) {
    var s = svgEl("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" });
    paths.forEach(function (d) { s.appendChild(svgEl("path", { d: d })); });
    return s;
  }

  /* ================= de laag zelf ================= */
  var active = null;                   /* de open sessie, hooguit één */

  function open(files, opts) {
    if (active) active.close(null);
    opts = opts || {};
    var maxSide = clamp(Math.round(+opts.maxSide || 2200), 200, 8000);
    addStyle();

    var pages = [], index = 0, sessionLook = "document", closed = false, busy = 0, dirty = false, big = false;
    var drag = null, fw = 0, fh = 0, prevTimer = 0, prevToken = 0, lastPrev = 0, timings = [];
    var lastFocus = document.activeElement, resolveOpen;
    var promise = new Promise(function (r) { resolveOpen = r; });

    /* ---------- opbouw ---------- */
    function button(cls, text) { return el("button", { type: "button", class: cls, text: text }); }
    var titleId = "rz-title-" + Math.random().toString(36).slice(2, 8);
    var cancelBtn = button("btn btn-quiet rz-btn rz-cancel", "Annuleer");
    var title = el("h2", { class: "rz-title", id: titleId, text: "Foto rechtzetten" });
    var doneBtn = button("btn btn-primary rz-btn rz-done", "Klaar");
    var top = el("div", { class: "rz-top" }, [cancelBtn, title, doneBtn]);

    var photo = el("canvas", { class: "rz-photo", "aria-hidden": "true" });
    var ov = svgEl("svg", { class: "rz-ov", "aria-hidden": "true" });
    var dimPath = svgEl("path", { class: "rz-dim", "fill-rule": "evenodd" });
    var edgeBg = svgEl("polygon", { class: "rz-edge-bg" }), edge = svgEl("polygon", { class: "rz-edge" });
    ov.appendChild(dimPath); ov.appendChild(edgeBg); ov.appendChild(edge);
    var handles = CORNER_NAMES.map(function (nm, i) {
      return el("div", { class: "rz-h", role: "button", tabindex: "0", "data-i": i, "aria-label": "Hoek " + nm + ". Sleep, of verplaats met de pijltjestoetsen." });
    });
    var frame = el("div", { class: "rz-frame" }, [photo, ov].concat(handles));

    var bigCanvas = el("canvas", { "aria-label": "Voorbeeld van het resultaat", role: "img" });
    var backBtn = button("btn rz-btn rz-back", "Terug naar de hoeken");
    var bigBox = el("div", { class: "rz-big" }, [bigCanvas, backBtn]);

    var loupeCanvas = makeCanvas(LOUPE * 2, LOUPE * 2);
    var loupe = el("div", { class: "rz-loupe", hidden: true, "aria-hidden": "true" }, [loupeCanvas]);

    var pickFile = button("btn rz-btn", "Kies een foto"), pickCam = button("btn btn-primary rz-btn", "Maak een foto");
    var pick = el("div", { class: "rz-pick" }, [
      el("h3", { text: "Foto van een bon of brief" }),
      el("p", { text: "Leg het papier op een donkere ondergrond en zorg dat alle vier de hoeken in beeld zijn." }),
      pickCam, pickFile
    ]);

    var msgText = el("span"), msgBtns = el("div", { class: "rz-msg-btns" });
    var msg = el("div", { class: "rz-msg", role: "alert", hidden: true }, [msgText, msgBtns]);
    var busyText = el("span", { text: "Bezig" }), busyBar = el("i");
    var busyBox = el("div", { class: "rz-busy", role: "status", "aria-live": "polite", hidden: true }, [el("div", { class: "rz-card" }, [busyText, el("div", { class: "rz-bar" }, [busyBar])])]);
    var stage = el("div", { class: "rz-stage" }, [pick, frame, bigBox, loupe, msg, busyBox]);

    var hint = el("p", { class: "rz-hint", "aria-live": "polite" });
    var strip = el("div", { class: "rz-strip", role: "group", "aria-label": "Foto's" });
    var removeBtn = button("btn rz-btn", "Haal weg");
    var pagesRow = el("div", { class: "rz-pages", hidden: true }, [strip, removeBtn]);
    var prevCanvas = el("canvas", { "aria-hidden": "true" });
    var prevBtn = el("button", { type: "button", class: "rz-prev", "aria-pressed": "false", "aria-label": "Bekijk het resultaat groot" }, [prevCanvas, el("i", { "aria-hidden": "true" }, [icon(ICON_ZOOM)])]);
    var chips = LOOKS.map(function (L) { return el("button", { type: "button", class: "chip rz-chip", "data-look": L[0], "aria-pressed": "false", text: L[1] }); });
    var lookId = "rz-look-" + Math.random().toString(36).slice(2, 8);
    var lookRow = el("div", { class: "rz-lookrow" }, [prevBtn, el("div", { class: "rz-look" }, [
      el("span", { class: "rz-label", id: lookId, text: "Look" }),
      el("div", { class: "rz-chips", role: "group", "aria-labelledby": lookId }, chips)
    ])]);
    var fullBtn = button("btn rz-btn", "Hele foto"), rotBtn = button("btn rz-btn", "Draai"), moreBtn = button("btn rz-btn rz-more", "Nog een foto");
    rotBtn.setAttribute("aria-label", "Draai een kwartslag rechtsom");
    var panel = el("div", { class: "rz-panel" }, [pagesRow, hint, lookRow, el("div", { class: "rz-actions" }, [fullBtn, rotBtn, moreBtn])]);

    var inFile = el("input", { type: "file", accept: "image/*", multiple: true, hidden: true, tabindex: "-1" });
    var inCam = el("input", { type: "file", accept: "image/*", capture: "environment", hidden: true, tabindex: "-1" });
    var root = el("div", { class: "rz is-empty", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId }, [top, el("div", { class: "rz-main" }, [stage, panel]), inFile, inCam]);

    /* ---------- toestand tonen ---------- */
    function cur() { return pages[index] || null; }
    function lookOf(p) { return p.look || sessionLook; }
    function setBusy(text, frac) {
      busyText.textContent = text; busyBar.style.width = Math.round((frac || 0) * 100) + "%";
      busyBox.hidden = false; root.classList.add("is-busy"); doneBtn.disabled = true;
    }
    function clearBusy() { busyBox.hidden = true; root.classList.remove("is-busy"); doneBtn.disabled = false; }
    function hideMsg() { msg.hidden = true; msgBtns.textContent = ""; }
    function showMsg(text) {
      hideMsg();
      msg.className = "rz-msg"; msg.setAttribute("role", "alert"); msgText.textContent = text;
      var x = el("button", { type: "button", class: "rz-btn rz-x", "aria-label": "Sluit de melding" }, [icon(ICON_X)]);
      x.addEventListener("click", hideMsg);
      msgBtns.appendChild(x); msg.hidden = false;
    }
    function askStop() {
      hideMsg();
      msg.className = "rz-msg is-ask"; msg.setAttribute("role", "alertdialog");
      msgText.textContent = pages.length > 1 ? "Stoppen? De foto's worden niet bewaard." : "Stoppen? De foto wordt niet bewaard.";
      var go = button("btn rz-btn", "Ga door"), stop = button("btn rz-btn", "Stop");
      go.addEventListener("click", function () { hideMsg(); cancelBtn.focus(); });
      stop.addEventListener("click", function () { close(null); });
      msgBtns.appendChild(go); msgBtns.appendChild(stop); msg.hidden = false;
      stop.focus();
    }
    function renderStrip() {
      strip.textContent = "";
      pages.forEach(function (p, i) {
        var b = el("button", { type: "button", class: "rz-thumb", "data-page": i, "aria-label": "Foto " + (i + 1) + " van " + pages.length, "aria-current": i === index ? "true" : "false" }, [p.thumb, el("b", { text: String(i + 1), "aria-hidden": "true" })]);
        strip.appendChild(b);
      });
      pagesRow.hidden = pages.length < 2;
    }
    function syncChrome() {
      var p = cur(), n = pages.length;
      root.classList.toggle("is-empty", !n);
      title.textContent = n > 1 ? "Foto " + (index + 1) + " van " + n : "Foto rechtzetten";
      removeBtn.setAttribute("aria-label", "Haal foto " + (index + 1) + " weg");
      Array.prototype.forEach.call(strip.children, function (b, i) { b.setAttribute("aria-current", i === index ? "true" : "false"); });
      chips.forEach(function (c) { c.setAttribute("aria-pressed", p && c.getAttribute("data-look") === lookOf(p) ? "true" : "false"); });
      var say = !p ? "" : big ? "Zo wordt de pagina." : p.touched ? "Sleep een hoek om bij te sturen." : p.auto ? "Randen gevonden. Sleep een hoek om bij te sturen." : "Sleep de hoeken naar de randen van het papier.";
      if (hint.textContent !== say) hint.textContent = say;
      var act = strip.children[index];
      if (act && act.scrollIntoView && n > 1) act.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    function setBig(on) {
      big = !!on && !!cur();
      root.classList.toggle("is-big", big);
      prevBtn.setAttribute("aria-pressed", big ? "true" : "false");
      prevBtn.setAttribute("aria-label", big ? "Terug naar de hoeken" : "Bekijk het resultaat groot");
      handles.forEach(function (hd) { hd.tabIndex = big ? -1 : 0; });
      syncChrome();
      if (big) runPreview();
    }
    /* De foto zo groot mogelijk in het beschikbare vlak, met ruimte voor de grepen. */
    function layout() {
      var p = cur();
      if (!p || closed) return;
      var w = stage.clientWidth, h = stage.clientHeight;
      if (!w || !h) return;
      var k = Math.min((w - 2 * PAD) / p.view.width, (h - 2 * PAD) / p.view.height);
      if (!(k > 0)) k = 0.1;
      fw = Math.max(40, Math.round(p.view.width * k)); fh = Math.max(40, Math.round(p.view.height * k));
      frame.style.width = fw + "px"; frame.style.height = fh + "px";
      ov.setAttribute("viewBox", "0 0 " + fw + " " + fh);
      drawQuad();
    }
    /* Tekent de vierhoek en zet de grepen neer. Past alleen attributen aan: er wordt niets vervangen. */
    function drawQuad() {
      var p = cur();
      if (!p || !fw) return;
      var pts = p.corners.map(function (c) { return (c.x * fw).toFixed(1) + "," + (c.y * fh).toFixed(1); });
      dimPath.setAttribute("d", "M0 0H" + fw + "V" + fh + "H0Z M" + pts[0] + " L" + pts[1] + " L" + pts[2] + " L" + pts[3] + "Z");
      edgeBg.setAttribute("points", pts.join(" ")); edge.setAttribute("points", pts.join(" "));
      for (var i = 0; i < 4; i++) handles[i].style.transform = "translate(" + (p.corners[i].x * fw).toFixed(1) + "px," + (p.corners[i].y * fh).toFixed(1) + "px)";
    }
    function showPage(i) {
      index = clamp(i, 0, Math.max(0, pages.length - 1));
      var p = cur();
      syncChrome();
      if (!p) { freeCanvas(photo); freeCanvas(prevCanvas); freeCanvas(bigCanvas); setBig(false); return; }
      photo.width = p.view.width; photo.height = p.view.height;
      ctx2d(photo).drawImage(p.view, 0, 0);
      layout();
      schedulePreview(0);
    }

    /* ---------- voorbeeld ---------- */
    function schedulePreview(delay) {
      clearTimeout(prevTimer);
      prevTimer = setTimeout(runPreview, delay == null ? 60 : delay);
    }
    async function runPreview() {
      clearTimeout(prevTimer);
      var p = cur();
      if (!p || closed) return;
      var token = ++prevToken; lastPrev = now();
      try {
        var c = await renderPage(p.view, p.view.width, p.view.height, p.corners, lookOf(p), p.rot, big ? PREVIEW_BIG : PREVIEW_SMALL, null);
        if (token !== prevToken || closed) { freeCanvas(c); return; }
        var k = Math.min(1, PREVIEW_SMALL / Math.max(c.width, c.height));
        prevCanvas.width = Math.max(1, Math.round(c.width * k)); prevCanvas.height = Math.max(1, Math.round(c.height * k));
        var g = ctx2d(prevCanvas); g.imageSmoothingQuality = "high"; g.drawImage(c, 0, 0, prevCanvas.width, prevCanvas.height);
        if (big) { bigCanvas.width = c.width; bigCanvas.height = c.height; ctx2d(bigCanvas).drawImage(c, 0, 0); }
        freeCanvas(c);
      } catch (e) { /* het voorbeeld is een hulpmiddel; bij Klaar volgt zo nodig een echte melding */ }
    }

    /* ---------- hoeken verslepen ---------- */
    function tryMove(i, nx, ny) {
      var p = cur();
      if (!p) return false;
      var q = p.corners.map(function (c) { return { x: c.x, y: c.y }; });
      q[i] = { x: clamp(nx, 0, 1), y: clamp(ny, 0, 1) };
      var px = q.map(function (c) { return { x: c.x * p.view.width, y: c.y * p.view.height }; });
      if (!quadOk(px, 0.04 * Math.min(p.view.width, p.view.height))) return false;
      p.corners = q; p.touched = true; dirty = true;
      drawQuad();
      return true;
    }
    function drawLoupe(i, clientX, clientY) {
      var p = cur(), c = p.corners[i], g = ctx2d(loupeCanvas), D = loupeCanvas.width;
      var s = LOUPE_ZOOM * (fw / p.view.width) * (D / LOUPE);            /* bronpixel naar looppixel */
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = "#17202B"; g.fillRect(0, 0, D, D);
      g.setTransform(s, 0, 0, s, D / 2 - c.x * p.view.width * s, D / 2 - c.y * p.view.height * s);
      g.imageSmoothingEnabled = true;
      g.drawImage(p.view, 0, 0);
      g.beginPath();
      p.corners.forEach(function (q, k) { if (k) g.lineTo(q.x * p.view.width, q.y * p.view.height); else g.moveTo(q.x * p.view.width, q.y * p.view.height); });
      g.closePath();
      g.lineJoin = "round";
      g.lineWidth = 5 / s * (D / LOUPE) * 0.9; g.strokeStyle = "rgba(255,255,255,.95)"; g.stroke();
      g.lineWidth = 2.2 / s * (D / LOUPE); g.strokeStyle = "#1F4FD1"; g.stroke();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.strokeStyle = "rgba(23,32,43,.9)"; g.lineWidth = 2;
      g.beginPath(); g.moveTo(D / 2 - 18, D / 2); g.lineTo(D / 2 - 5, D / 2); g.moveTo(D / 2 + 5, D / 2); g.lineTo(D / 2 + 18, D / 2);
      g.moveTo(D / 2, D / 2 - 18); g.lineTo(D / 2, D / 2 - 5); g.moveTo(D / 2, D / 2 + 5); g.lineTo(D / 2, D / 2 + 18); g.stroke();
      /* plek: boven de vinger; is daar geen ruimte, dan opzij. Nooit onder de vinger. */
      var sr = stage.getBoundingClientRect(), fx = clientX - sr.left, fy = clientY - sr.top, r = LOUPE / 2;
      var lx = fx, ly = fy - r - 56;
      if (ly - r < 6) { ly = clamp(fy - 20, r + 6, sr.height - r - 6); lx = fx > sr.width / 2 ? fx - r - 64 : fx + r + 64; }
      lx = clamp(lx, r + 6, sr.width - r - 6);
      loupe.style.transform = "translate(" + Math.round(lx - r) + "px," + Math.round(ly - r) + "px)";
    }
    function onDown(ev) {
      if (busy || big || drag || (ev.pointerType === "mouse" && ev.button !== 0)) return;
      var hd = ev.currentTarget, i = +hd.getAttribute("data-i"), p = cur();
      if (!p) return;
      var fr = frame.getBoundingClientRect();
      drag = { i: i, id: ev.pointerId, hd: hd, ox: fr.left + p.corners[i].x * fw - ev.clientX, oy: fr.top + p.corners[i].y * fh - ev.clientY, touch: ev.pointerType !== "mouse" };
      try { hd.setPointerCapture(ev.pointerId); } catch (e) { /* oudere webview: dan volgen de gebeurtenissen de vinger zo ook */ }
      hd.classList.add("is-held");
      hideMsg();
      if (drag.touch) { loupe.hidden = false; drawLoupe(i, ev.clientX, ev.clientY); }
      ev.preventDefault();
    }
    function onMove(ev) {
      if (!drag || ev.pointerId !== drag.id) return;
      var fr = frame.getBoundingClientRect();
      tryMove(drag.i, (ev.clientX + drag.ox - fr.left) / fw, (ev.clientY + drag.oy - fr.top) / fh);
      if (drag.touch) drawLoupe(drag.i, ev.clientX, ev.clientY);
      if (now() - lastPrev > 150) runPreview();
      ev.preventDefault();
    }
    function onUp(ev) {
      if (!drag || (ev.pointerId != null && ev.pointerId !== drag.id)) return;
      var hd = drag.hd;
      try { if (hd.hasPointerCapture && hd.hasPointerCapture(drag.id)) hd.releasePointerCapture(drag.id); } catch (e) { /* al losgelaten */ }
      hd.classList.remove("is-held");
      drag = null; loupe.hidden = true;
      syncChrome();
      schedulePreview(0);
    }
    function onHandleKey(ev) {
      var d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
      if (!d || busy || big) return;
      var i = +ev.currentTarget.getAttribute("data-i"), p = cur(), step = ev.shiftKey ? 10 : 1;
      if (!p || !fw) return;
      tryMove(i, p.corners[i].x + d[0] * step / fw, p.corners[i].y + d[1] * step / fh);
      syncChrome(); schedulePreview();
      ev.preventDefault(); ev.stopPropagation();
    }
    handles.forEach(function (hd) {
      hd.addEventListener("pointerdown", onDown);
      hd.addEventListener("pointermove", onMove);
      hd.addEventListener("pointerup", onUp);
      hd.addEventListener("pointercancel", onUp);
      hd.addEventListener("lostpointercapture", onUp);
      hd.addEventListener("keydown", onHandleKey);
      hd.addEventListener("touchmove", function (ev) { if (ev.cancelable) ev.preventDefault(); }, { passive: false });
      hd.addEventListener("contextmenu", function (ev) { ev.preventDefault(); });
    });
    /* De pagina erachter mag niet meeschuiven of inzoomen. Alleen het rijtje foto's en het zijpaneel schuiven zelf. */
    function onTouchMove(ev) {
      if (!ev.cancelable) return;
      var t = ev.target;
      if (!drag && t && t.closest && (t.closest(".rz-strip") || (t.closest(".rz-panel") && panel.scrollHeight > panel.clientHeight + 1))) return;
      ev.preventDefault();
    }
    function onGesture(ev) { ev.preventDefault(); }
    function onWheel(ev) {
      var t = ev.target;
      if (!ev.ctrlKey && t && t.closest && t.closest(".rz-panel") && panel.scrollHeight > panel.clientHeight + 1) return;
      ev.preventDefault();
    }
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    root.addEventListener("gesturestart", onGesture);
    root.addEventListener("wheel", onWheel, { passive: false });

    /* ---------- foto's toevoegen en weghalen ---------- */
    async function loadPage(file) {
      var p = { file: file, blob: file, name: (file && file.name) || "foto", decoded: false, look: null, rot: 0, auto: false, touched: false };
      var s = await openSource(p, opts);
      try {
        p.nw = s.w; p.nh = s.h;
        var k = Math.min(1, VIEW_MAX / Math.max(s.w, s.h));
        p.view = makeCanvas(s.w * k, s.h * k);
        var g = ctx2d(p.view, true);
        g.fillStyle = "#fff"; g.fillRect(0, 0, p.view.width, p.view.height);
        g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
        g.drawImage(s.src, 0, 0, p.view.width, p.view.height);
      } finally { s.close(); }
      var found = null;
      try { found = detectCorners(p.view); } catch (e) { found = null; }
      p.auto = !!found; p.corners = found || defaultCorners();
      var tk = Math.min(1, 132 / Math.max(p.view.width, p.view.height));
      p.thumb = makeCanvas(p.view.width * tk, p.view.height * tk);
      ctx2d(p.thumb).drawImage(p.view, 0, 0, p.thumb.width, p.thumb.height);
      return p;
    }
    async function addFiles(list, jump) {
      var files = Array.prototype.slice.call(list || []).filter(Boolean);
      if (!files.length || closed) return;
      busy++; hideMsg();
      var failed = 0, first = -1;
      try {
        for (var i = 0; i < files.length && !closed; i++) {
          setBusy(files.length > 1 ? "Foto " + (i + 1) + " van " + files.length + " wordt geladen" : "De foto wordt geladen", i / files.length);
          await sleep(20);
          try {
            var p = await loadPage(files[i]);
            if (closed) { freePage(p); return; }
            pages.push(p);
            if (first < 0) first = pages.length - 1;
          } catch (e) { failed++; }
        }
      } finally { busy--; if (!busy) clearBusy(); }
      if (closed) return;
      renderStrip();
      showPage(first >= 0 && (jump || pages.length === files.length - failed) ? first : index);
      if (failed) showMsg(files.length === 1 ? MSG_UNREADABLE : failed === 1 ? "Eén afbeelding kan je browser niet lezen. Zet hem eerst om naar JPG of PNG." : failed + " afbeeldingen kan je browser niet lezen. Zet ze eerst om naar JPG of PNG.");
      trapFocusInside();
    }
    function freePage(p) { freeCanvas(p.view); freeCanvas(p.thumb); p.view = p.thumb = null; }
    function removeCurrent() {
      var p = cur();
      if (!p || busy) return;
      pages.splice(index, 1); freePage(p); dirty = true;
      if (!pages.length) setBig(false);
      renderStrip();
      showPage(Math.min(index, pages.length - 1));
      (pages.length > 1 ? removeBtn : pages.length ? moreBtn : pickFile).focus();
    }

    /* ---------- klaar: alle pagina's op volle grootte ---------- */
    async function finish() {
      if (busy || !pages.length || closed) return;
      busy++; hideMsg(); timings = [];
      var out = [], ok = false;
      try {
        for (var i = 0; i < pages.length; i++) {
          var p = pages[i];
          setBusy(pages.length > 1 ? "Pagina " + (i + 1) + " van " + pages.length + " wordt rechtgezet" : "De pagina wordt rechtgezet", i / pages.length);
          await sleep(30);
          if (closed) return;
          var t0 = now(), s = await openSource(p, opts), t1 = now(), c;
          try { c = await renderPage(s.src, s.w, s.h, p.corners, lookOf(p), p.rot, maxSide, makeBreather()); }
          finally { s.close(); }
          timings.push({ name: p.name, lezen: Math.round(t1 - t0), rekenen: Math.round(now() - t1), breedte: c.width, hoogte: c.height });
          out.push({ canvas: c, name: p.name });
          if (closed) return;
        }
        busyBar.style.width = "100%";
        ok = true;
      } catch (e) {
        if (!closed) showMsg("Het rechtzetten is niet gelukt. Mogelijk is de foto te groot voor dit apparaat. Haal een foto weg of probeer het opnieuw.");
      } finally {
        busy--;
        if (!ok) out.forEach(function (o) { freeCanvas(o.canvas); });
        if (!busy && !closed) clearBusy();
      }
      if (ok && !closed) close(out);
    }

    /* ---------- sluiten ---------- */
    function close(result) {
      if (closed) return;
      closed = true;
      clearTimeout(prevTimer);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", layout);
      if (ro) ro.disconnect();
      pages.forEach(freePage);
      [photo, prevCanvas, bigCanvas, loupeCanvas].forEach(freeCanvas);
      if (root.parentNode) root.parentNode.removeChild(root);
      if (active === session) active = null;
      NS._last = { timings: timings };
      try { if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus(); } catch (e) { /* niets */ }
      resolveOpen(result && result.length ? result : null);
    }
    /* Annuleer vraagt eerst even na als er al aan de hoeken of de look is gewerkt; een tweede tik sluit meteen. */
    function requestCancel() {
      var asking = !msg.hidden && msg.className.indexOf("is-ask") >= 0;
      if (dirty && pages.length && !busy && !asking) askStop();
      else close(null);
    }

    /* ---------- toetsen en focus ---------- */
    function focusables() {
      return Array.prototype.filter.call(root.querySelectorAll("button, [tabindex='0']"), function (n) {
        return !n.disabled && n.tabIndex >= 0 && n.getClientRects().length > 0;
      });
    }
    function trapFocusInside() {
      if (closed || root.contains(document.activeElement)) return;
      var f = pages.length ? doneBtn : (pickCam.getClientRects().length ? pickCam : cancelBtn);
      try { f.focus({ preventScroll: true }); } catch (e) { /* niets */ }
    }
    function onKey(ev) {
      if (closed) return;
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(null); return; }
      if (ev.key === "Tab") {
        var f = focusables();
        if (!f.length) { ev.preventDefault(); return; }
        var a = document.activeElement, i = f.indexOf(a);
        if (ev.shiftKey && (i <= 0)) { ev.preventDefault(); f[f.length - 1].focus(); }
        else if (!ev.shiftKey && (i < 0 || i === f.length - 1)) { ev.preventDefault(); f[0].focus(); }
      }
    }

    /* ---------- knoppen ---------- */
    cancelBtn.addEventListener("click", requestCancel);
    doneBtn.addEventListener("click", finish);
    backBtn.addEventListener("click", function () { setBig(false); prevBtn.focus(); });
    prevBtn.addEventListener("click", function () { if (!busy) setBig(!big); });
    chips.forEach(function (c) {
      c.addEventListener("click", function () {
        var p = cur();
        if (!p || busy) return;
        p.look = sessionLook = c.getAttribute("data-look"); dirty = true;
        syncChrome(); schedulePreview(0);
      });
    });
    fullBtn.addEventListener("click", function () {
      var p = cur();
      if (!p || busy) return;
      p.corners = fullCorners(); p.touched = true; dirty = true;
      drawQuad(); syncChrome(); schedulePreview(0);
    });
    rotBtn.addEventListener("click", function () {
      var p = cur();
      if (!p || busy) return;
      p.rot = (p.rot + 90) % 360; dirty = true;
      schedulePreview(0);
    });
    removeBtn.addEventListener("click", removeCurrent);
    strip.addEventListener("click", function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-page]");
      if (!b || busy) return;
      showPage(+b.getAttribute("data-page"));
    });
    function pickFrom(input) { if (!busy) { input.value = ""; input.click(); } }
    moreBtn.addEventListener("click", function () { pickFrom(inFile); });
    pickFile.addEventListener("click", function () { pickFrom(inFile); });
    pickCam.addEventListener("click", function () { pickFrom(inCam); });
    [inFile, inCam].forEach(function (input) {
      input.addEventListener("change", function () {
        var list = Array.prototype.slice.call(input.files || []);
        input.value = "";
        if (list.length) { if (pages.length) dirty = true; addFiles(list, true); }
      });
    });

    /* ---------- starten ---------- */
    var session = { close: close, peek: function () {
      var p = cur();
      return { open: !closed, count: pages.length, index: index, busy: busy > 0, big: big,
        corners: p ? p.corners.map(function (c) { return { x: c.x, y: c.y }; }) : null,
        auto: p ? p.auto : false, look: p ? lookOf(p) : null, rot: p ? p.rot : 0 };
    } };
    active = session;
    (document.body || document.documentElement).appendChild(root);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", layout);
    var ro = null;
    if (window.ResizeObserver) { ro = new ResizeObserver(function () { layout(); }); ro.observe(stage); }
    trapFocusInside();
    var initial = Array.prototype.slice.call(files || []).filter(Boolean);
    if (initial.length) addFiles(initial, false);
    return promise;
  }

  var NS = {
    open: open,
    /* Voor tests en foutzoeken: de stand van de open laag, en de rekentijden van de laatste keer. */
    _peek: function () { return active ? active.peek() : { open: false }; },
    _last: null
  };
  window.Rechtzetter = NS;
})();
