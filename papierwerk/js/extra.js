'use strict';
/* Papierwerk — extra's: slim verkleinen, scan-look, persoonsgegevens zwartlakken, leestijd, papieren vliegtuigje */

/* ---------- slim verkleinen: alleen de plaatjes in de pdf worden kleiner, tekst blijft tekst ---------- */
async function inflateBytes(bytes) {
  const ds = new DecompressionStream('deflate');
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
}
/* Eenvoudige Flate-plaatjes (8 bits, RGB of grijs, met of zonder PNG-voorspeller) naar een bitmap. Al het andere: null. */
async function flateImageToBitmap(stream, dict, W, H) {
  const L = PDFLib, N = n => L.PDFName.of(n), ctx = stream.dict.context;
  const look = v => (v instanceof L.PDFRef ? ctx.lookup(v) : v);
  const num = (v, d) => { v = look(v); return v instanceof L.PDFNumber ? v.asNumber() : d; };
  if (num(dict.get(N('BitsPerComponent')), 8) !== 8 || W * H > 36e6) return null;
  let cs = look(dict.get(N('ColorSpace'))), comps = 0;
  if (cs === N('DeviceRGB') || cs === N('CalRGB')) comps = 3;
  else if (cs === N('DeviceGray') || cs === N('CalGray')) comps = 1;
  else if (cs instanceof L.PDFArray && look(cs.get(0)) === N('ICCBased')) { const icc = look(cs.get(1)); comps = icc && icc.dict ? num(icc.dict.get(N('N')), 0) : 0; }
  if (comps !== 3 && comps !== 1) return null;
  let parms = look(dict.get(N('DecodeParms')));
  if (parms instanceof L.PDFArray) parms = look(parms.get(0));
  const pred = parms instanceof L.PDFDict ? num(parms.get(N('Predictor')), 1) : 1;
  if (pred !== 1 && pred < 10) return null;
  const raw = await inflateBytes(stream.contents);
  const rowLen = W * comps;
  let px;
  if (pred >= 10) {
    if (raw.length < (rowLen + 1) * H) return null;
    px = new Uint8Array(rowLen * H);
    for (let y = 0; y < H; y++) {
      const ft = raw[y * (rowLen + 1)], si = y * (rowLen + 1) + 1, di = y * rowLen, up = di - rowLen;
      for (let i = 0; i < rowLen; i++) {
        const a = i >= comps ? px[di + i - comps] : 0, b = y ? px[up + i] : 0, c = (y && i >= comps) ? px[up + i - comps] : 0, v = raw[si + i];
        let o;
        if (ft === 0) o = v; else if (ft === 1) o = v + a; else if (ft === 2) o = v + b; else if (ft === 3) o = v + ((a + b) >> 1);
        else { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); o = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
        px[di + i] = o & 255;
      }
    }
  } else { if (raw.length < rowLen * H) return null; px = raw; }
  const img = new ImageData(W, H), d = img.data;
  if (comps === 3) for (let i = 0, j = 0; i < W * H; i++, j += 3) { d[i * 4] = px[j]; d[i * 4 + 1] = px[j + 1]; d[i * 4 + 2] = px[j + 2]; d[i * 4 + 3] = 255; }
  else for (let i = 0; i < W * H; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = px[i]; d[i * 4 + 3] = 255; }
  return await createImageBitmap(img);
}
async function shrinkPdfImages(bytes, opt) {
  const L = PDFLib, N = n => L.PDFName.of(n);
  const doc = await L.PDFDocument.load(bytes, { updateMetadata: false });
  const objs = doc.context.enumerateIndirectObjects();
  let changed = 0, images = 0;
  for (let i = 0; i < objs.length; i++) {
    const ref = objs[i][0], obj = objs[i][1];
    if (!(obj instanceof L.PDFRawStream)) continue;
    const d = obj.dict;
    if (d.get(N('Subtype')) !== N('Image') || d.has(N('ImageMask')) && d.get(N('ImageMask')) === L.PDFBool.True || d.has(N('Mask'))) continue;
    const W = d.get(N('Width')) instanceof L.PDFNumber ? d.get(N('Width')).asNumber() : 0, H = d.get(N('Height')) instanceof L.PDFNumber ? d.get(N('Height')).asNumber() : 0;
    if (!W || !H) continue;
    images++;
    let filter = d.get(N('Filter'));
    if (filter instanceof L.PDFArray) { if (filter.size() !== 1) continue; filter = filter.get(0); }
    if (Math.max(W, H) <= opt.maxDim * 1.12 && obj.contents.length < 70000) continue;
    let bm = null;
    try {
      if (filter === N('DCTDecode')) bm = await createImageBitmap(new Blob([obj.contents], { type: 'image/jpeg' }));
      else if (filter === N('FlateDecode')) bm = await flateImageToBitmap(obj, d, W, H);
    } catch (e) { bm = null; }
    if (!bm) continue;
    const k = Math.min(1, opt.maxDim / Math.max(W, H)), w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.imageSmoothingQuality = 'high'; x.drawImage(bm, 0, 0, w, h);
    if (bm.close) bm.close();
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', opt.q));
    c.width = c.height = 0;
    if (!blob || blob.size > obj.contents.length * 0.9) continue;
    const nd = d.clone(doc.context);
    nd.set(N('Width'), L.PDFNumber.of(w)); nd.set(N('Height'), L.PDFNumber.of(h));
    nd.set(N('Filter'), N('DCTDecode')); nd.set(N('ColorSpace'), N('DeviceRGB')); nd.set(N('BitsPerComponent'), L.PDFNumber.of(8));
    nd.delete(N('DecodeParms')); nd.delete(N('Decode')); nd.delete(N('Length'));
    doc.context.assign(ref, L.PDFRawStream.of(nd, new Uint8Array(await blob.arrayBuffer())));
    changed++;
    if (opt.progress) opt.progress(i / objs.length);
    if (changed % 4 === 0) await tick();
  }
  return { bytes: await doc.save({ useObjectStreams: true }), changed, images };
}
const SHRINK_STEPS = [[2200, 0.85], [1700, 0.76], [1300, 0.66], [1000, 0.56], [800, 0.46], [620, 0.36]];
const RASTER_STEPS = [[175, 0.82], [130, 0.72], [110, 0.62], [96, 0.55], [80, 0.48], [64, 0.4]];

function openCompress() {
  let mode = 'smart', level = 1, result = null;
  const origSize = Object.values(S.sources).filter(s => S.pages.some(p => p.src === s.id)).reduce((n, s) => n + s.bytes.length, 0);
  const target = h('input', { class: 'input', id: 'cmpTarget', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: 'Bijvoorbeeld 2' });
  const modes = h('div'), levels = h('div'), viz = h('div', { class: 'squeeze', hidden: true }), note = h('p', { class: 'hint' });
  const draw = () => {
    modes.textContent = ''; modes.append(chips([['smart', 'Slim: tekst blijft tekst'], ['max', "Maximaal: pagina's worden plaatjes"]], mode, v => { mode = v; reset(); draw(); }));
    levels.textContent = ''; levels.append(chips([[0, 'Licht'], [1, 'Normaal'], [3, 'Sterk']], level, v => { level = v; reset(); draw(); }));
    note.textContent = mode === 'smart'
      ? "Alleen de foto's en plaatjes in de pdf worden kleiner gemaakt. Tekst blijft scherp, selecteerbaar en doorzoekbaar."
      : "Elke pagina wordt één plaatje. Dat scheelt het meest bij scans, maar tekst is daarna niet meer te selecteren.";
  };
  const reset = () => { result = null; viz.hidden = true; saveBtn.hidden = true; };
  const makeBtn = h('button', { class: 'btn', text: 'Maak kleiner', onclick: async () => {
    const goal = parseFloat(String(target.value).replace(',', '.')) > 0 ? parseFloat(String(target.value).replace(',', '.')) * 1048576 : 0;
    const out = await run('Verkleinen', async prog => {
      let best = null, info = '';
      const steps = mode === 'smart' ? SHRINK_STEPS : RASTER_STEPS, from = goal ? 0 : level, to = goal ? steps.length - 1 : level;
      const base = mode === 'smart' ? await buildPdf(S.pages, { progress: f => prog(f * 0.3) }) : null;
      for (let i = from; i <= to; i++) {
        let bytes;
        if (mode === 'smart') { const r = await shrinkPdfImages(base, { maxDim: steps[i][0], q: steps[i][1] }); bytes = r.bytes; info = r.images ? '' : 'none'; if (base.length < bytes.length) bytes = base; }
        else bytes = await buildPdf(S.pages, { raster: { scale: steps[i][0] / 72, q: steps[i][1] }, progress: f => prog((i - from + f) / (to - from + 1)) });
        if (!best || bytes.length < best.length) best = bytes;
        prog(0.3 + 0.7 * (i - from + 1) / (to - from + 1));
        if (goal && best.length <= goal) break;
        if (info === 'none') break;
      }
      return { bytes: best, info, goal };
    });
    if (!out) return;
    result = out.bytes;
    showSqueeze(viz, origSize, result.length);
    const pct = Math.round((1 - result.length / origSize) * 100);
    let msg = pct >= 3 ? '' : 'Dit bestand wordt er zo nauwelijks kleiner van.';
    if (out.info === 'none' && mode === 'smart') msg = "Er zitten geen plaatjes in deze pdf, dus slim verkleinen levert niets op. Probeer Maximaal als het echt kleiner moet.";
    else if (out.goal && result.length > out.goal) msg = 'Onder de ' + fmtSize(out.goal) + ' lukt op deze manier niet; dit is het kleinste resultaat.' + (mode === 'smart' ? ' Maximaal gaat verder, maar dan wordt tekst een plaatje.' : '');
    note.textContent = msg || note.textContent;
    saveBtn.hidden = result.length >= origSize;
  } });
  const saveBtn = h('button', { class: 'btn btn-primary', hidden: true, html: ico('save') + '<span>Sla kleine PDF op</span>', onclick: async () => { if (result && await saveFile(baseName() + '-klein.pdf', result)) { flyPlane(); toast('Kleine versie opgeslagen (' + fmtSize(result.length) + ')'); sh.close(); } } });
  draw();
  const sh = sheet('Verkleinen', [modes, h('div', { class: 'row' }, h('div', { class: 'field grow' }, h('span', { text: 'Hoe sterk' }), levels),
    h('div', { class: 'field', style: { width: '150px' } }, h('label', { for: 'cmpTarget', text: 'Of: onder … MB' }), target)), viz, note,
    h('p', { class: 'hint', text: 'Nu: ' + fmtSize(origSize) + '. Je huidige document blijft ongemoeid.' })], [makeBtn, saveBtn]);
  target.addEventListener('input', reset);
}
/* Twee balken: voor en na. De onderste krimpt terwijl de teller terugloopt. */
function showSqueeze(box, before, after) {
  const ratio = clamp(after / before, 0.02, 1), pct = Math.round((1 - after / before) * 100);
  const bar2 = h('i'), num = h('b', { text: fmtSize(before) }), badge = h('span', { class: 'squeeze-pct', text: pct > 0 ? pct + '% kleiner' : 'Niet kleiner' });
  box.textContent = '';
  box.append(h('div', { class: 'squeeze-row' }, h('span', { text: 'Was' }), h('div', { class: 'squeeze-bar' }, h('i', { style: { width: '100%' } })), h('b', { text: fmtSize(before) })),
    h('div', { class: 'squeeze-row is-new' }, h('span', { text: 'Wordt' }), h('div', { class: 'squeeze-bar' }, bar2), num), badge);
  box.hidden = false;
  bar2.style.width = '100%';
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches, t0 = performance.now(), dur = still ? 1 : 1100;
  const step = t => {
    const k = clamp((t - t0) / dur, 0, 1), e = 1 - Math.pow(1 - k, 3);
    bar2.style.width = (100 - (100 - ratio * 100) * e) + '%';
    num.textContent = fmtSize(Math.round(before - (before - after) * e));
    if (k < 1) requestAnimationFrame(step); else badge.classList.add('is-in');
  };
  requestAnimationFrame(step);
}

/* ---------- scan-look: alsof het is geprint, getekend en weer gescand ---------- */
function seeded(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function scanEffect(src, rnd, o) {
  const w = src.width, hh = src.height, c = document.createElement('canvas');
  c.width = w; c.height = hh;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, hh);
  x.save();
  x.translate(w / 2 + (rnd() - 0.5) * w * 0.008, hh / 2 + (rnd() - 0.5) * hh * 0.006);
  if (o.skew) x.rotate((rnd() - 0.5) * 0.024);
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, -w / 2, -hh / 2);
  x.restore();
  const img = x.getImageData(0, 0, w, hh), d = img.data, paper = [250, 248, 243];
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    if (o.gray) { const l = 0.299 * r + 0.587 * g + 0.114 * b; r = g = b = l; }
    const n = (rnd() - 0.5) * 16;
    r = (r - 128) * 1.2 + 134 + n; g = (g - 128) * 1.2 + 134 + n; b = (b - 128) * 1.2 + 134 + n;
    d[i] = clamp(r, 0, 255) * paper[0] / 255; d[i + 1] = clamp(g, 0, 255) * paper[1] / 255; d[i + 2] = clamp(b, 0, 255) * paper[2] / 255;
  }
  x.putImageData(img, 0, 0);
  // schaduw van de scannerklep langs twee randen en een paar stofjes
  let gr = x.createLinearGradient(0, 0, w * 0.035, 0);
  gr.addColorStop(0, 'rgba(0,0,0,0.16)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = gr; x.fillRect(0, 0, w * 0.035, hh);
  gr = x.createLinearGradient(0, 0, 0, hh * 0.02);
  gr.addColorStop(0, 'rgba(0,0,0,0.10)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = gr; x.fillRect(0, 0, w, hh * 0.02);
  for (let i = 0, n = 5 + Math.floor(rnd() * 9); i < n; i++) {
    x.fillStyle = 'rgba(30,30,30,' + (0.15 + rnd() * 0.3).toFixed(2) + ')';
    x.beginPath(); x.arc(rnd() * w, rnd() * hh, 0.6 + rnd() * 1.6, 0, 7); x.fill();
  }
  return c;
}
async function scanPdf(bytes, o, prog) {
  const src = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise, out = await PDFLib.PDFDocument.create();
  const rnd = seeded(Date.now());
  try {
    for (let i = 0; i < src.numPages; i++) {
      const pg = await src.getPage(i + 1), v0 = pg.getViewport({ scale: 1 });
      const k = Math.min(150 / 72, Math.sqrt(1.2e7 / (v0.width * v0.height))), vp = pg.getViewport({ scale: k });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      await pg.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp }).promise;
      const s = scanEffect(c, rnd, o);
      const blob = await new Promise(r => s.toBlob(r, 'image/jpeg', 0.74));
      const im = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      out.addPage([v0.width, v0.height]).drawImage(im, { x: 0, y: 0, width: v0.width, height: v0.height });
      c.width = c.height = s.width = s.height = 0;
      if (prog) prog((i + 1) / src.numPages);
      await tick();
    }
  } finally { src.destroy(); }
  return await out.save();
}
function openScanLook() {
  let gray = false, skew = true;
  const rows = h('div', { style: { display: 'grid', gap: '12px' } });
  const draw = () => {
    rows.textContent = '';
    rows.append(h('div', { class: 'field' }, h('span', { text: 'Kleur' }), chips([[false, 'In kleur'], [true, 'Grijs']], gray, v => { gray = v; draw(); })),
      h('div', { class: 'field' }, h('span', { text: 'Ligging' }), chips([[true, 'Een tikje scheef'], [false, 'Kaarsrecht']], skew, v => { skew = v; draw(); })));
  };
  draw();
  const sh = sheet('Maak er een scan van', [h('p', { text: 'Je document krijgt de look van een vel dat is geprint, ondertekend en weer op de scanner gelegd: korrel, iets vergeeld papier, een schaduwrandje en net niet recht.' }), rows,
    h('p', { class: 'hint', text: "Handig als iemand om een gescand exemplaar vraagt. Pagina's worden plaatjes; je huidige document verandert niet." })],
  [h('button', { class: 'btn btn-primary', html: ico('save') + '<span>Maak scan en sla op</span>', onclick: async () => {
    sh.close();
    const bytes = await run('Scannen', async prog => scanPdf(await buildPdf(S.pages, { progress: f => prog(f * 0.3) }), { gray, skew }, f => prog(0.3 + f * 0.7)));
    if (bytes && await saveFile(baseName() + '-scan.pdf', bytes)) { flyPlane(); toast('Scan opgeslagen (' + fmtSize(bytes.length) + ')'); }
  } })]);
}

/* ---------- persoonsgegevens zoeken en zwartlakken ---------- */
function bsnOk(s) { let t = 0; for (let i = 0; i < 9; i++) t += (i === 8 ? -1 : 9 - i) * +s[i]; return t % 11 === 0 && +s !== 0; }
const PII = [
  { id: 'mail', label: 'E-mailadressen', on: true, re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g },
  { id: 'iban', label: 'Rekeningnummers (IBAN)', on: true, re: /\b[A-Z]{2}\d{2}[ ]?[A-Z]{4}(?:[ ]?\d{4}){2}[ ]?\d{2}\b|\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,6}(?:[ ]?[A-Z0-9]{1,3})?\b/g },
  { id: 'tel', label: 'Telefoonnummers', on: true, re: /(?:\+31[ ]?\(?0?\)?[ ]?|0031[ ]?|\b0)(?:6[ -]?(?:\d[ -]?){7}\d|[1-9]\d{1,2}[ -]?(?:\d[ -]?){5,6}\d)\b/g },
  { id: 'pc', label: 'Postcodes', on: true, re: /\b[1-9]\d{3}[ ]?[A-Z]{2}\b/g },
  { id: 'bsn', label: 'Burgerservicenummers', on: true, re: /\b\d{9}\b/g, ok: bsnOk },
  { id: 'geld', label: 'Bedragen in euro', on: false, re: /€[ ]?\d[\d.]*(?:,\d{2}|,-)?|\b\d[\d.]*,\d{2}[ ]?(?:euro|EUR)\b/g },
];
async function rangePolys(p, k, end) {
  const ix = await textIndex(p), pg = await getPg(S.sources[p.src], p.idx);
  const vp = pg.getViewport({ scale: 1, rotation: (pg.rotate + p.rot) % 360 }), polys = [];
  for (const m of ix.map) {
    const a = m.at, b = m.at + m.it.str.length;
    if (b <= k) continue;
    if (a >= end) break;
    const lo = Math.max(k, a), n = Math.min(end, b) - lo;
    if (n > 0) polys.push(itemPoly(vp, m.it, lo - a, n));
  }
  return polys;
}
async function openPrivacy() {
  const found = await run('Document doorzoeken', async prog => {
    const out = {};
    for (const t of PII) out[t.id] = [];
    for (let i = 0; i < S.pages.length; i++) {
      const p = S.pages[i], ix = await textIndex(p), taken = [];
      for (const t of PII) {
        t.re.lastIndex = 0;
        let m;
        while ((m = t.re.exec(ix.raw))) {
          if (!m[0]) { t.re.lastIndex++; continue; }
          const k = m.index, end = k + m[0].length;
          if (t.ok && !t.ok(m[0])) continue;
          if (t.id !== 'geld' && taken.some(r => k < r[1] && end > r[0])) continue;      // niet dubbel tellen (een IBAN is geen telefoonnummer)
          if (t.id !== 'geld') taken.push([k, end]);
          out[t.id].push({ p, k, end, text: m[0] });
        }
      }
      prog((i + 1) / S.pages.length);
    }
    return out;
  });
  if (!found) return;
  const total = Object.values(found).reduce((n, a) => n + a.length, 0);
  if (!total) {
    sheet('Persoonsgegevens zwartlakken', [h('p', { text: 'Ik vind geen e-mailadressen, rekeningnummers, telefoonnummers, postcodes of burgerservicenummers in de tekst van dit document.' }),
      h('p', { class: 'hint', text: 'Een scan of foto heeft geen leesbare tekst; daar kan ik niet in zoeken. Lak zulke gegevens met de hand via Afdekken.' })]);
    return;
  }
  const state = {}; PII.forEach(t => { state[t.id] = t.on; });
  const list = h('div', { style: { display: 'grid', gap: '10px' } }), btn = h('button', { class: 'btn btn-primary' });
  const count = () => PII.reduce((n, t) => n + (state[t.id] ? found[t.id].length : 0), 0);
  const draw = () => {
    list.textContent = '';
    for (const t of PII) {
      const hits = found[t.id];
      if (!hits.length) continue;
      const cb = h('input', { type: 'checkbox', id: 'pii_' + t.id, checked: state[t.id] });
      cb.addEventListener('change', () => { state[t.id] = cb.checked; draw(); });
      const ex = [...new Set(hits.map(x => x.text.replace(/\s+/g, ' ')))].slice(0, 3).join(', ') + (hits.length > 3 ? ', …' : '');
      list.append(h('label', { class: 'check', for: 'pii_' + t.id }, cb, h('span', null, h('b', { text: t.label + ' (' + hits.length + ')' }), h('br'), h('span', { class: 'hint', text: ex }))));
    }
    const n = count();
    btn.textContent = n ? 'Lak ' + n + (n === 1 ? ' vondst' : ' vondsten') + ' zwart' : 'Niets gekozen';
    btn.disabled = !n;
  };
  btn.addEventListener('click', async () => {
    const touched = new Set();
    for (const t of PII) {
      if (!state[t.id]) continue;
      for (const hit of found[t.id]) {
        for (const poly of await rangePolys(hit.p, hit.k, hit.end)) {
          const xs = poly.map(v => v[0]), ys = poly.map(v => v[1]);
          const x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1, y0 = Math.min(...ys) - 0.5, y1 = Math.max(...ys) + 0.5;
          hit.p.annots.push({ id: uid(), t: 'redact', rot: 0, cx: r2((x0 + x1) / 2), cy: r2((y0 + y1) / 2), w: r2(x1 - x0), h: r2(y1 - y0) });
        }
        touched.add(hit.p);
      }
    }
    for (const p of touched) drawAnnots(p);
    commit();
    sh.close();
    const first = S.pages.findIndex(p => touched.has(p));
    if (first >= 0) goToPage(first);
    toast(count() + ' gegevens zwartgelakt op ' + touched.size + (touched.size === 1 ? ' pagina' : " pagina's") + '. Loop het na voordat je opslaat.');
  });
  draw();
  const sh = sheet('Persoonsgegevens zwartlakken', [h('p', { text: 'Dit vond ik in de tekst. Vink uit wat mag blijven staan.' }), list,
    h('p', { class: 'hint', text: "Namen en adressen herken ik niet vanzelf; lak die met de hand via Afdekken. Bij opslaan worden pagina's met zwartlak een afbeelding, zodat de tekst eronder echt weg is." })], [btn]);
}

/* ---------- leestijd ---------- */
async function readingStats() {
  let words = 0;
  for (const p of S.pages) { const ix = await textIndex(p); const m = ix.raw.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu); words += m ? m.length : 0; }
  return { words, minutes: Math.max(1, Math.round(words / 230)) };
}

/* ---------- papieren vliegtuigje na het opslaan ---------- */
function flyPlane() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const el = h('div', { class: 'plane', 'aria-hidden': 'true', html: '<svg viewBox="0 0 64 64"><path d="M4 30L60 6 40 58 28 38z" fill="#fff" stroke="#17202B" stroke-width="2.5" stroke-linejoin="round"/><path d="M28 38L60 6 22 34z" fill="#FFDD3C" stroke="#17202B" stroke-width="2.5" stroke-linejoin="round"/><path d="M28 38l-3 14 9-9" fill="#CBD1D9" stroke="#17202B" stroke-width="2.5" stroke-linejoin="round"/></svg>' });
  document.body.append(el);
  el.addEventListener('animationend', () => el.remove());
  setTimeout(() => el.remove(), 2500);
}
