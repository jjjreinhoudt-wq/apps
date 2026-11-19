/* Omzetter als losse app: offline, gedeelde bestanden ophalen, "Openen met" op de computer. */
(function () {
  "use strict";
  var SHARED = "omzetter-gedeeld";
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
  window.PWA = {
    takeShared: async function () {
      var files = [];
      try {
        if (!/[?&]gedeeld=/.test(location.search) || !window.caches) return files;
        var c = await caches.open(SHARED), keys = await c.keys();
        for (var i = 0; i < keys.length; i++) {
          var r = await c.match(keys[i]); if (!r) continue;
          var b = await r.blob();
          files.push(new File([b], decodeURIComponent(r.headers.get("X-Naam") || "bestand"), { type: r.headers.get("Content-Type") || b.type }));
          await c.delete(keys[i]);
        }
        history.replaceState(null, "", location.pathname);
      } catch (e) {}
      return files;
    },
    onLaunch: function (cb) {
      if (!("launchQueue" in window)) return;
      try {
        window.launchQueue.setConsumer(async function (p) {
          if (!p || !p.files || !p.files.length) return;
          var out = [];
          for (var i = 0; i < p.files.length; i++) { try { var f = await p.files[i].getFile(); try { f.handle = p.files[i]; } catch (e2) {} out.push(f); } catch (e) {} }
          if (out.length) cb(out);
        });
      } catch (e) {}
    }
  };
})();
