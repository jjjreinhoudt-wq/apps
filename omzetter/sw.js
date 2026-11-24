/* Omzetter — offline en "Delen naar deze app". Verhoog VERSION bij elke nieuwe uitgave. */
const VERSION = "v12";
const PREFIX = "omzetter-";
const CACHE = PREFIX + VERSION;
const SHARED = PREFIX + "gedeeld";
const GROOT = PREFIX + "groot";   // grote, vaste bestanden (tekstherkenning): pas ophalen bij gebruik, bewaren over versies heen
const SHELL = ["./", "app.css", "base.css", "index.html", "manifest.webmanifest", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "lib/gifenc.js", "lib/heic2any.min.js", "lib/js-yaml.min.js", "lib/jszip.min.js", "lib/lame.min.js", "lib/mammoth.browser.min.js", "lib/marked.min.js", "lib/pako.min.js", "lib/pdf-lib.min.js", "lib/pdf.min.js", "lib/pdf.worker.min.js", "lib/turndown.js", "lib/utif.js", "lib/xlsx.full.min.js", "js/conv-data.js", "js/conv-doc.js", "js/conv-image.js", "js/conv-klein.js", "js/conv-media.js", "js/conv-misc.js", "js/conv-pdf.js", "js/docmodel.js", "js/docout.js", "js/docpdf.js", "js/formats.js", "js/overview.js", "js/rechtzetter.js", "js/reframe.js", "js/ui.js", "js/util.js", "pwa.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: "reload" })).catch(() => {}))))
    .then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE && k !== SHARED && k !== GROOT).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
/* Bestanden die vanuit een andere app worden gedeeld even bewaren en de app openen. */
async function takeShare(req) {
  try {
    const form = await req.formData();
    const files = form.getAll("files").filter(f => f && typeof f === "object" && f.size);
    const c = await caches.open(SHARED);
    for (const k of await c.keys()) await c.delete(k);
    let i = 0;
    for (const f of files) {
      await c.put("gedeeld/" + (i++), new Response(f, { headers: { "Content-Type": f.type || "application/octet-stream", "X-Naam": encodeURIComponent(f.name || "bestand") } }));
    }
    return Response.redirect("./?gedeeld=" + files.length, 303);
  } catch (err) { return Response.redirect("./", 303); }
}
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method === "POST" && url.pathname.endsWith("/share-target")) { e.respondWith(takeShare(req)); return; }
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.indexOf("/lib/ocr/") >= 0) {
    e.respondWith((async () => {
      const c = await caches.open(GROOT), hit = await c.match(req.url);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) e.waitUntil(c.put(req.url, res.clone()));
      return res;
    })());
    return;
  }
  // eerst het netwerk (zo komen updates direct door), de bewaarde kopie alleen als er geen verbinding is
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) { const copy = res.clone(); e.waitUntil(caches.open(CACHE).then(c => c.put(req.url.split("?")[0], copy))); }
      return res;
    } catch (err) {
      const c = await caches.open(CACHE);
      const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === "navigate" && (await c.match("./") || await c.match("index.html")));
      if (hit) return hit;
      throw err;
    }
  })());
});
