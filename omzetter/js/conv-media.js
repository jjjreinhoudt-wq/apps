/* Omzetter — geluid en video. De browser decodeert (AudioContext / video-element);
   WAV schrijven we zelf, MP3 met lamejs. Video naar video kan niet in een browser. */
(function () {
  "use strict";
  var OZ = window.OZ;

  function parseTime(v) {
    v = String(v == null ? "" : v).trim().replace(",", ".");
    if (!v) return null;
    var parts = v.split(":").map(Number);
    if (parts.some(isNaN)) throw OZ.fail('Het tijdstip "' + v + '" is niet te lezen. Schrijf seconden (12.5) of minuten:seconden (1:30).');
    return parts.reduce(function (a, p) { return a * 60 + p; }, 0);
  }
  OZ.parseTime = parseTime;

  async function decodeAudio(file, isVideo) {
    var AC = window.AudioContext || window.webkitAudioContext, OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!AC && !OAC) throw OZ.fail("Deze browser kan geen geluid decoderen.");
    if (file.size > 700 * 1000 * 1000) throw OZ.fail("Dit bestand is te groot om in de browser te decoderen. Knip het eerst in kleinere stukken.");
    var buf = await file.arrayBuffer(), ctx;
    try { ctx = OAC ? new OAC(2, 44100, 44100) : new AC(); } catch (e) { ctx = new AC(); }
    try {
      return await new Promise(function (resolve, reject) {
        var p = ctx.decodeAudioData(buf, resolve, reject);
        if (p && p.then) p.then(resolve, reject);
      });
    } catch (e2) {
      throw OZ.fail(isVideo
        ? "Uit deze video kan geen geluid worden gehaald. Mogelijk heeft de video geen geluidsspoor of kent deze browser het formaat niet."
        : "Dit geluidsbestand kan niet worden gelezen. Mogelijk kent deze browser het formaat niet of is het bestand beschadigd.");
    } finally { if (ctx.close) { try { ctx.close(); } catch (e3) { /* niets */ } } }
  }

  /* Knippen en eventueel mono maken. Geeft {channels:[Float32Array], rate}. */
  function prepare(ab, opts) {
    var rate = ab.sampleRate, total = ab.length;
    var t0 = parseTime(opts.trimStart) || 0, t1 = parseTime(opts.trimEnd);
    var a = Math.max(0, Math.min(total, Math.round(t0 * rate))), b = t1 == null ? total : Math.max(0, Math.min(total, Math.round(t1 * rate)));
    if (b <= a) throw OZ.fail("Het eindpunt ligt voor het beginpunt, of buiten het fragment (lengte " + fmtDur(total / rate) + "). Pas Knippen aan bij Opties.");
    var chans = [];
    for (var c = 0; c < Math.min(2, ab.numberOfChannels); c++) chans.push(ab.getChannelData(c).subarray(a, b));
    if (opts.mono && chans.length === 2) {
      var m = new Float32Array(b - a), L = chans[0], R = chans[1];
      for (var i = 0; i < m.length; i++) m[i] = (L[i] + R[i]) * 0.5;
      chans = [m];
    }
    return { channels: chans, rate: rate, seconds: (b - a) / rate };
  }
  function fmtDur(s) { s = Math.round(s); return Math.floor(s / 60) + ":" + OZ.pad(s % 60, 2); }
  OZ.fmtDur = fmtDur;

  function toInt16(f) {
    var out = new Int16Array(f.length);
    for (var i = 0; i < f.length; i++) { var v = f[i]; v = v < -1 ? -1 : v > 1 ? 1 : v; out[i] = v < 0 ? v * 32768 : v * 32767; }
    return out;
  }
  function wavBlob(pcm) {
    var nch = pcm.channels.length, n = pcm.channels[0].length, bytes = n * nch * 2;
    var buf = new ArrayBuffer(44 + bytes), v = new DataView(buf);
    function str(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    str(0, "RIFF"); v.setUint32(4, 36 + bytes, true); str(8, "WAVE"); str(12, "fmt "); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, nch, true); v.setUint32(24, pcm.rate, true); v.setUint32(28, pcm.rate * nch * 2, true);
    v.setUint16(32, nch * 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, bytes, true);
    var out = new Int16Array(buf, 44), ch0 = pcm.channels[0], ch1 = pcm.channels[1];
    for (var i = 0, o = 0; i < n; i++) {
      var a = ch0[i]; a = a < -1 ? -1 : a > 1 ? 1 : a; out[o++] = a < 0 ? a * 32768 : a * 32767;
      if (ch1) { var b = ch1[i]; b = b < -1 ? -1 : b > 1 ? 1 : b; out[o++] = b < 0 ? b * 32768 : b * 32767; }
    }
    return new Blob([buf], { type: "audio/wav" });
  }
  async function mp3Blob(pcm, kbps, ctx) {
    var nch = pcm.channels.length, enc = new lamejs.Mp3Encoder(nch, pcm.rate, kbps);
    var L = toInt16(pcm.channels[0]), R = nch > 1 ? toInt16(pcm.channels[1]) : null;
    var parts = [], block = 1152, n = L.length, lastTick = Date.now();
    for (var i = 0; i < n; i += block) {
      var l = L.subarray(i, i + block), out = R ? enc.encodeBuffer(l, R.subarray(i, i + block)) : enc.encodeBuffer(l);
      if (out.length) parts.push(new Uint8Array(out));
      if (Date.now() - lastTick > 60) {
        if (ctx && ctx.progress) ctx.progress(i / n);
        if (ctx && ctx.cancelled && ctx.cancelled()) throw OZ.fail("Gestopt.");
        await OZ.tick(); lastTick = Date.now();
      }
    }
    var end = enc.flush();
    if (end.length) parts.push(new Uint8Array(end));
    return new Blob(parts, { type: "audio/mpeg" });
  }

  async function audioOut(file, target, opts, ctx, isVideo) {
    var ab = await decodeAudio(file, isVideo), pcm = prepare(ab, opts), base = OZ.base(file.name);
    var info = fmtDur(pcm.seconds) + " min, " + (pcm.channels.length === 1 ? "mono" : "stereo");
    if (target === "wav") {
      if (pcm.seconds * pcm.rate * pcm.channels.length * 2 > 1900 * 1000 * 1000) throw OZ.fail("Dit fragment is te lang voor WAV in de browser. Kies MP3 of knip een korter stuk.");
      return [{ name: base + ".wav", blob: wavBlob(pcm), dims: info }];
    }
    return [{ name: base + ".mp3", blob: await mp3Blob(pcm, +opts.bitrate || 192, ctx), dims: info + ", " + (+opts.bitrate || 192) + " kbps" }];
  }
  OZ.conv.audio = function (file, ext, target, opts, ctx) { return audioOut(file, target, opts || {}, ctx, false); };

  /* Eén beeld uit een video. */
  function videoFrame(file, t) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), v = document.createElement("video"), done = false, timer;
      function fail() { if (done) return; done = true; cleanup(); reject(OZ.fail("Deze video kan niet worden afgespeeld in de browser, dus er kan geen beeld uit worden gehaald. Zet de video eerst om naar MP4 (H.264).")); }
      function cleanup() { clearTimeout(timer); v.removeAttribute("src"); try { v.load(); } catch (e) { /* niets */ } URL.revokeObjectURL(url); }
      v.muted = true; v.playsInline = true; v.preload = "auto"; v.crossOrigin = "anonymous";
      v.setAttribute("playsinline", ""); v.setAttribute("muted", "");
      v.onerror = fail;
      timer = setTimeout(fail, 20000);
      v.onloadedmetadata = function () {
        var dur = isFinite(v.duration) ? v.duration : 0;
        var at = Math.max(0, Math.min(t == null ? Math.min(1, dur / 2) : t, Math.max(0, dur - 0.05)));
        v.currentTime = at || 0.001;
      };
      v.onseeked = function () {
        if (done) return;
        var grab = function () {
          if (done) return;
          if (!v.videoWidth) return fail();
          var c = OZ.makeCanvas(v.videoWidth, v.videoHeight);
          try { c.getContext("2d").drawImage(v, 0, 0, c.width, c.height); } catch (e) { return fail(); }
          done = true; var dur = v.duration; cleanup(); resolve({ canvas: c, duration: dur });
        };
        if (v.readyState >= 2) grab(); else v.onloadeddata = grab;
      };
      v.src = url;
      try { v.load(); } catch (e) { /* niets */ }
    });
  }
  OZ.videoFrame = videoFrame;

  OZ.conv.video = async function (file, ext, target, opts, ctx) {
    opts = opts || {};
    if (target === "mp3" || target === "wav") return audioOut(file, target, opts, ctx, true);
    var f = await videoFrame(file, parseTime(opts.frameTime)), base = OZ.base(file.name);
    var blob = target === "png" ? await OZ.canvasBlob(f.canvas, "image/png") : await OZ.canvasBlob(f.canvas, "image/jpeg", (+opts.quality || 90) / 100);
    return [{ name: base + "." + target, blob: blob, dims: f.canvas.width + " × " + f.canvas.height }];
  };
})();
