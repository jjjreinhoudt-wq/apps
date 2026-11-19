'use strict';
/* Papierwerk — document: PDF bouwen en opslaan, pagina's ordenen, exporteren, menu, openen, start */

/* ---------- opslaan (via het platform; los in de browser via een gewone download) ---------- */
let DL = null;
const inClaude = () => !!(window.claude && typeof window.claude.use === 'function');
async function getCap(name) { if (!inClaude()) return null; try { return await window.claude.use(name); } catch (e) { return null; } }
const MIME = { pdf: 'application/pdf', zip: 'application/zip', png: 'image/png', jpg: 'image/jpeg', txt: 'text/plain' };
async function saveFile(filename, data) {
  const ext = filename.split('.').pop().toLowerCase();
  const blob = data instanceof Blob ? data : new Blob([data], { type: MIME[ext] || 'application/octet-stream' });
  if (inClaude()) {
    if (!DL) DL = await getCap('downloads');
    if (!DL) { toast('Opslaan is in deze weergave niet beschikbaar. Open Papierwerk in Claude en probeer het opnieuw.', true); return false; }
    try { await DL.save({ filename, data: blob }); return true; }
    catch (e) {
      const code = e && e.code;
      if (code === 'declined') toast('Opslaan geannuleerd.');
      else if (code === 'rate_limited') toast('Er staat nog een opslagvraag open. Rond die eerst af.', true);
      else if (code === 'too_large') toast('Het bestand is te groot om hier op te slaan. Probeer Verkleinen in het menu.', true);
      else toast('Opslaan lukte niet' + (e && e.message ? ': ' + e.message : '.'), true);
      return false;
    }
  }
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  return true;
}
const baseName = () => (S.name.replace(/\.pdf$/i, '') || 'document');
const cleanName = s => (s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'document';

/* ---------- zip (zonder compressie; PDF en JPG zijn al compact) ---------- */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  const now = new Date(), dt = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate(), tm = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), len = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(10, tm, true); lh.setUint16(12, dt, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, len, true); lh.setUint32(22, len, true); lh.setUint16(26, name.length, true);
    parts.push(lh.buffer, name, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(12, tm, true); ch.setUint16(14, dt, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, len, true); ch.setUint32(24, len, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    central.push(ch.buffer, name);
    off += 30 + name.length + len;
  }
  const csize = central.reduce((s, b) => s + b.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

/* ---------- PDF bouwen ---------- */
function invert(m) {
  const d = m[0] * m[3] - m[1] * m[2];
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
}
function hexRgb(hex) {
  const n = parseInt((hex || '#000000').slice(1), 16);
  return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
function dataUrlBytes(url) {
  const b = atob(url.slice(url.indexOf(',') + 1)), u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}
function hasAcro(d) { try { return !!d.catalog.lookup(PDFLib.PDFName.of('AcroForm')); } catch (e) { return false; } }
function applyForm(d, src, flatten) {
  if (!hasAcro(d)) return;
  const L = PDFLib;
  let form;
  try { form = d.getForm(); } catch (e) { return; }
  for (const [name, val] of Object.entries(src.form || {})) {
    try {
      const f = form.getFieldMaybe(name);
      if (!f) continue;
      if (f instanceof L.PDFTextField) { let v = safeText(String(val)); const ml = f.getMaxLength(); if (ml != null && v.length > ml) v = v.slice(0, ml); f.setText(v); }
      else if (f instanceof L.PDFCheckBox) { if (val && val !== 'Off') f.check(); else f.uncheck(); }
      else if (f instanceof L.PDFRadioGroup) {
        const opts = f.getOptions();
        if (opts.includes(val)) f.select(val); else if (/^\d+$/.test(val) && opts[+val] != null) f.select(opts[+val]);
      }
      else if (f instanceof L.PDFDropdown || f instanceof L.PDFOptionList) { if (val) f.select(val); else f.clear(); }
    } catch (e) { console.warn('Veld overgeslagen:', name, e); }
  }
  if (flatten) { try { if (form.getFields().length) form.flatten(); } catch (e) { console.warn('Afvlakken lukte niet', e); } }
}
async function drawItem(ctx, page, it, T) {
  const L = PDFLib;
  const U = (x, y) => [T[0] * x + T[2] * y + T[4], T[1] * x + T[3] * y + T[5]];
  const ang = r => { const a = r * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a); return Math.atan2(T[1] * dx + T[3] * dy, T[0] * dx + T[2] * dy) * 180 / Math.PI; };
  if (it.k === 'path') {
    const ops = [L.pushGraphicsState()];
    const o = it.o == null ? 1 : it.o;
    if (o < 1 || it.blend) {
      const gs = ctx.out.context.obj(Object.assign({ Type: 'ExtGState', ca: o, CA: o }, it.blend ? { BM: 'Multiply' } : {}));
      ops.push(L.setGraphicsState(page.node.newExtGState('GS', gs)));
    }
    if (it.stroke) ops.push(L.setStrokingColor(hexRgb(it.stroke)), L.setLineWidth(it.sw || 1), L.setLineCap(it.miter ? 0 : 1), L.setLineJoin(it.miter ? 0 : 1));
    if (it.fill) ops.push(L.setFillingColor(hexRgb(it.fill)));
    let cur = [0, 0];
    for (const s of it.segs) {
      if (s[0] === 'M') { ops.push(L.moveTo(...U(s[1], s[2]))); cur = [s[1], s[2]]; }
      else if (s[0] === 'L') { ops.push(L.lineTo(...U(s[1], s[2]))); cur = [s[1], s[2]]; }
      else if (s[0] === 'C') { ops.push(L.appendBezierCurve(...U(s[1], s[2]), ...U(s[3], s[4]), ...U(s[5], s[6]))); cur = [s[5], s[6]]; }
      else if (s[0] === 'Q') {
        const c1 = [cur[0] + 2 / 3 * (s[1] - cur[0]), cur[1] + 2 / 3 * (s[2] - cur[1])], c2 = [s[3] + 2 / 3 * (s[1] - s[3]), s[4] + 2 / 3 * (s[2] - s[4])];
        ops.push(L.appendBezierCurve(...U(c1[0], c1[1]), ...U(c2[0], c2[1]), ...U(s[3], s[4]))); cur = [s[3], s[4]];
      } else if (s[0] === 'Z') ops.push(L.closePath());
    }
    ops.push(it.fill && it.stroke ? L.fillAndStroke() : it.fill ? L.fill() : L.stroke(), L.popGraphicsState());
    page.pushOperators(...ops);
  } else if (it.k === 'text') {
    if (!it.str || !it.str.trim()) return;
    const [x, y] = U(it.x, it.y);
    page.drawText(it.str, { x, y, size: it.size, font: ctx.font(it.font), color: hexRgb(it.c), rotate: L.degrees(ang(it.rot || 0)), opacity: it.o == null ? 1 : it.o });
  } else if (it.k === 'img') {
    const b = it.box, im = await ctx.image(it.asset);
    if (!im) return;
    const [x, y] = U(...L2V(b, -b.w / 2, b.h / 2));
    page.drawImage(im, Object.assign({ x, y, width: b.w, height: b.h, rotate: L.degrees(ang(b.rot || 0)), opacity: b.o == null ? 1 : b.o }, it.blend ? { blendMode: L.BlendMode.Multiply } : null));
  }
}
function addNoteAnnot(ctx, page, a, T) {
  const L = PDFLib, out = ctx.out;
  const U = (x, y) => [T[0] * x + T[2] * y + T[4], T[1] * x + T[3] * y + T[5]];
  const p1 = U(a.x, a.y), p2 = U(a.x + 18, a.y + 18);
  const rect = [Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]), Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1])];
  const ap = out.context.register(out.context.stream('', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 18, 18] }));
  const dict = out.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: rect, Contents: L.PDFHexString.fromText(a.text), T: L.PDFHexString.fromText('Papierwerk'), Name: 'Comment', F: 4, AP: { N: ap } });
  page.node.addAnnot(out.context.register(dict));
}
async function renderDocFor(ctx, src) {
  if (ctx.renderDocs[src.id]) return ctx.renderDocs[src.id];
  let doc = src.pdf;
  if (!src.rasterOnly && Object.keys(src.form || {}).length) {
    try {
      const d = await PDFLib.PDFDocument.load(src.bytes, { updateMetadata: false, password: src.password || '' });
      applyForm(d, src, true);
      doc = await pdfjsLib.getDocument({ data: await d.save(), isEvalSupported: false }).promise;
      ctx.temp.push(doc);
    } catch (e) { doc = src.pdf; }
  }
  return (ctx.renderDocs[src.id] = doc);
}
async function rasterPage(ctx, p, k, q) {
  const doc = await renderDocFor(ctx, S.sources[p.src]);
  const pg = await doc.getPage(p.idx + 1);
  const W = viewW(p), H = viewH(p);
  k = Math.min(k, Math.sqrt(1.5e7 / (W * H)));
  const vp = pg.getViewport({ scale: k, rotation: (pg.rotate + p.rot) % 360 });
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height));
  const cx = c.getContext('2d', { alpha: false });
  await pg.render({ canvasContext: cx, viewport: vp }).promise;
  for (const a of p.annots) {
    if (a.t !== 'redact') continue;
    cx.save(); cx.translate(a.cx * k, a.cy * k); cx.rotate((a.rot || 0) * Math.PI / 180);
    cx.fillStyle = '#000'; cx.fillRect(-a.w * k / 2, -a.h * k / 2, a.w * k, a.h * k); cx.restore();
  }
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
  c.width = c.height = 0;
  return new Uint8Array(await blob.arrayBuffer());
}
/* Maakt de nieuwe PDF. Zolang er geen pagina's uit de hoofdbron verdwijnen, wordt het origineel zelf
   bijgewerkt (formulieren, bladwijzers en links blijven werken). Anders worden alleen de gekozen
   pagina's naar een schoon bestand gekopieerd, zodat verwijderde inhoud niet stiekem meereist. */
async function buildPdf(pageList, opt) {
  opt = opt || {};
  const L = PDFLib, prog = opt.progress || (() => {}), N = pageList.length;
  const isRaster = p => !!opt.raster || S.sources[p.src].rasterOnly || p.annots.some(a => a.t === 'redact');
  const lib = {};
  if (!opt.raster) {
    for (const sid of new Set(pageList.map(p => p.src))) {
      const src = S.sources[sid];
      if (src.rasterOnly) continue;
      try { lib[sid] = await L.PDFDocument.load(src.bytes, { updateMetadata: false, password: src.password || '' }); }
      catch (e) { src.rasterOnly = true; }
    }
  }
  const count = {};
  for (const p of pageList) if (!isRaster(p)) count[p.src] = (count[p.src] || 0) + 1;
  let primary = null;
  for (const sid in count) if (lib[sid] && (!primary || count[sid] > count[primary])) primary = sid;
  let inPlace = false, identity = false;
  if (primary && !pageList.some(isRaster)) {
    const n = lib[primary].getPageCount();
    inPlace = new Set(pageList.filter(p => p.src === primary).map(p => p.idx)).size === n;
    identity = inPlace && N === n && pageList.every((p, i) => p.src === primary && p.idx === i);
  }
  for (const sid in lib) applyForm(lib[sid], S.sources[sid], !(inPlace && sid === primary && !opt.flatten));

  let out, orig = null;
  if (inPlace) {
    out = lib[primary];
    orig = out.getPages().slice();
    if (!identity) {
      for (const pg of orig) for (const key of ['Resources', 'MediaBox', 'CropBox', 'Rotate']) {
        const nm = L.PDFName.of(key);
        if (!pg.node.has(nm)) { const v = pg.node.getInheritableAttribute(nm); if (v) pg.node.set(nm, v); }
      }
    }
  } else {
    out = await L.PDFDocument.create();
    for (const sid in lib) {
      const used = new Set(pageList.filter(p => p.src === sid && !isRaster(p)).map(p => p.idx));
      lib[sid].getPages().forEach((pg, i) => { if (!used.has(i)) for (const key of ['Contents', 'Resources', 'Annots', 'Thumb', 'B']) pg.node.delete(L.PDFName.of(key)); });
    }
    if (primary) { try { const t = lib[primary].getTitle(); if (t) out.setTitle(t); const au = lib[primary].getAuthor(); if (au) out.setAuthor(au); } catch (e) {} }
  }
  const need = {}, seen = new Set();
  const plan = pageList.map(p => {
    if (isRaster(p)) return { kind: 'raster' };
    if (inPlace && p.src === primary) {
      if (!seen.has(p.idx)) { seen.add(p.idx); return { kind: 'orig' }; }
      (need['~dup'] = need['~dup'] || []).push(p.idx);
      return { kind: 'copy', key: '~dup' };
    }
    (need[p.src] = need[p.src] || []).push(p.idx);
    return { kind: 'copy', key: p.src };
  });
  const copied = {}, ptr = {};
  for (const key in need) {
    let from = lib[key];
    if (key === '~dup') { from = await L.PDFDocument.load(S.sources[primary].bytes, { updateMetadata: false, password: S.sources[primary].password || '' }); applyForm(from, S.sources[primary], true); }
    copied[key] = await out.copyPages(from, need[key]);
  }
  const ctx = {
    out, fonts: {}, imgs: {}, renderDocs: {}, temp: [],
    font(k) { return this.fonts[k] || (this.fonts[k] = out.embedStandardFont(FONTS[k].std)); },
    async image(id) {
      if (!(id in this.imgs)) {
        const as = S.assets[id];
        try { this.imgs[id] = !as ? null : /^data:image\/png/.test(as.url) ? await out.embedPng(dataUrlBytes(as.url)) : await out.embedJpg(dataUrlBytes(as.url)); }
        catch (e) { this.imgs[id] = null; }
      }
      return this.imgs[id];
    },
  };
  const order = [], built = [];
  try {
    for (let i = 0; i < N; i++) {
      const p = pageList[i], src = S.sources[p.src];
      prog(i / N);
      if (i % 2 === 0) await tick();
      const pg = await getPg(src, p.idx), rotTot = (pg.rotate + p.rot) % 360, W = viewW(p), H = viewH(p);
      let page, T;
      if (plan[i].kind === 'raster') {
        const r = opt.raster || { scale: 2.4, q: 0.9 };
        const im = await out.embedJpg(await rasterPage(ctx, p, r.scale, r.q));
        page = out.addPage([W, H]);
        page.drawImage(im, { x: 0, y: 0, width: W, height: H });
        T = [1, 0, 0, -1, 0, H];
      } else {
        if (plan[i].kind === 'orig') page = orig[p.idx];
        else { const k = plan[i].key; ptr[k] = ptr[k] || 0; page = out.addPage(copied[k][ptr[k]++]); }
        page.setRotation(L.degrees(rotTot));
        T = invert(pg.getViewport({ scale: 1, rotation: rotTot }).transform);
      }
      const items = fxItems(p, i, N);
      for (const a of p.annots) { if (a.t === 'text' && !a.lines) layoutText(a, p); items.push(...annotItems(a)); }
      for (const it of items) if (!it.screenOnly) await drawItem(ctx, page, it, T);
      for (const a of p.annots) if (a.t === 'note' && a.text) addNoteAnnot(ctx, page, a, T);
      order.push(page.ref);
      built.push({ p, page, T });
    }
  } finally {
    for (const d of ctx.temp) { try { d.destroy(); } catch (e) {} }
  }
  if (inPlace && !identity) {
    // volgorde gewijzigd: de paginaboom van het origineel opnieuw vlak opbouwen in de nieuwe volgorde
    const pagesRef = out.catalog.get(L.PDFName.of('Pages')), root = out.catalog.Pages();
    root.set(L.PDFName.of('Kids'), out.context.obj(order));
    root.set(L.PDFName.of('Count'), L.PDFNumber.of(order.length));
    for (const ref of order) out.context.lookup(ref).set(L.PDFName.of('Parent'), pagesRef);
    try { out.pageCount = order.length; if (out.pageCache && out.pageCache.invalidate) out.pageCache.invalidate(); } catch (e) {}
  }
  if (!opt.plain) finishExtras(out, built);
  if (S.meta) {
    out.setTitle(S.meta.title || ''); out.setAuthor(S.meta.author || ''); out.setSubject(S.meta.subject || '');
    out.setKeywords((S.meta.keywords || '').split(',').map(s => s.trim()).filter(Boolean));
  }
  out.setModificationDate(new Date());
  const rs = opt.restrict, limited = rs && (rs.print || rs.copy || rs.edit);
  if (limited) {
    // beperkingen gelden alleen als het eigenaarswachtwoord anders is dan het wachtwoord om te openen
    const owner = Array.from(crypto.getRandomValues(new Uint8Array(18)), b => b.toString(36)).join('');
    out.encrypt({ userPassword: opt.password || '', ownerPassword: owner, permissions: { printing: rs.print ? false : 'highResolution', copying: !rs.copy, modifying: !rs.edit, annotating: !rs.edit, documentAssembly: !rs.edit, fillingForms: true, contentAccessibility: true } });
  } else if (opt.password) out.encrypt({ userPassword: opt.password, ownerPassword: opt.password });
  prog(1);
  await tick();
  try { return await out.save(); } catch (e) { return await out.save({ updateFieldAppearances: false }); }
}
async function run(label, fn) {
  endTextEdit();
  busy(label, 0);
  await tick();
  try { return await fn(f => busy(label, f)); }
  catch (e) { console.error(e); toast('Dat lukte niet: ' + (e && e.message ? e.message : 'onbekende fout') + '.', true); return null; }
  finally { busyOff(); }
}

/* ---------- opslaan ---------- */
function openSave() {
  endTextEdit();
  const name = h('input', { class: 'input', id: 'saveName', type: 'text', value: baseName(), autocomplete: 'off' });
  const hasForm = S.pages.some(p => S.sources[p.src].hasForm);
  const flat = h('input', { type: 'checkbox', id: 'saveFlat' });
  const redacted = S.pages.filter(p => p.annots.some(a => a.t === 'redact')).length;
  const locked = S.pages.some(p => S.sources[p.src].rasterOnly);
  const pw = h('input', { class: 'input', id: 'savePw', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'Leeg laten = geen wachtwoord' });
  const notes = [];
  if (redacted) notes.push(redacted + (redacted === 1 ? ' pagina met zwartlak wordt' : " pagina's met zwartlak worden") + ' als afbeelding opgeslagen, zodat de tekst eronder echt weg is.');
  if (locked) notes.push("Een deel van dit document heeft een beveiliging die ik niet kan openen. Die pagina's worden als afbeelding opgeslagen.");
  const body = [h('div', { class: 'field' }, h('label', { for: 'saveName', text: 'Bestandsnaam' }), name)];
  if (hasForm) body.push(h('label', { class: 'check', for: 'saveFlat' }, flat, h('span', null, 'Maak ingevulde velden definitief', h('br'), h('span', { class: 'hint', text: 'De ontvanger kan de velden daarna niet meer aanpassen.' }))));
  body.push(h('div', { class: 'field' }, h('label', { for: 'savePw', text: 'Wachtwoord om te openen (mag leeg)' }), pw));
  const rsBox = (id, label) => h('input', { type: 'checkbox', id });
  const noPrint = rsBox('saveNoPrint'), noCopy = rsBox('saveNoCopy'), noEdit = rsBox('saveNoEdit');
  body.push(h('div', { class: 'field' }, h('span', { text: 'De ontvanger mag niet (mag je overslaan)' }),
    h('label', { class: 'check', for: 'saveNoPrint' }, noPrint, h('span', null, 'afdrukken')),
    h('label', { class: 'check', for: 'saveNoCopy' }, noCopy, h('span', null, 'tekst kopiëren')),
    h('label', { class: 'check', for: 'saveNoEdit' }, noEdit, h('span', null, 'wijzigen')),
    h('span', { class: 'hint', text: 'Nette pdf-lezers houden zich hieraan. Het is een slot op de deur, geen kluis.' })));
  for (const n of notes) body.push(h('p', { class: 'hint', text: n }));
  body.push(h('p', { class: 'hint', text: 'Je krijgt een nieuwe PDF met al je aanpassingen. Het origineel blijft zoals het was.' }));
  const canPick = !inClaude() && typeof window.showSaveFilePicker === 'function';
  const same = canPick && S.saveHandle ? S.saveHandle : null;
  const canShare = !canPick && !inClaude() && IS_TOUCH && typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
  const go = async mode => {
    const nm = cleanName(name.value);
    let handle = null;
    // de keuze waar het bestand komt moet meteen na de klik, dus vóór het opbouwen
    if (mode === 'pick') {
      try { handle = await window.showSaveFilePicker({ suggestedName: nm + '.pdf', types: [{ description: 'PDF-document', accept: { 'application/pdf': ['.pdf'] } }] }); }
      catch (e) { if (e && e.name === 'AbortError') return; mode = 'download'; }
    } else if (mode === 'same') {
      handle = same;
      try { if (handle.requestPermission && (await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return; } catch (e) { return; }
    }
    sh.close();
    const bytes = await run('PDF opbouwen', prog => buildPdf(S.pages, { flatten: flat.checked, password: pw.value, restrict: { print: noPrint.checked, copy: noCopy.checked, edit: noEdit.checked }, progress: prog }));
    if (!bytes) return;
    let ok = false, saved = nm + '.pdf', where = '';
    if (handle) {
      try { const w = await handle.createWritable(); await w.write(bytes); await w.close(); ok = true; saved = handle.name || saved; S.saveHandle = handle; }
      catch (e) { toast('Opslaan op die plek lukte niet. Ik zet het bestand in je downloads.', true); }
    } else if (mode === 'share') {
      try {
        const f = new File([bytes], saved, { type: 'application/pdf' });
        if (navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: saved }); ok = true; where = ' via delen'; }
      } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    if (!ok) ok = await saveFile(saved, bytes);
    if (ok) {
      S.name = saved;
      $('#docName').textContent = S.name;
      setDirty(false);
      scheduleSessionSave();
      flyPlane();
      toast('Opgeslagen als ' + S.name + ' (' + fmtSize(bytes.length) + ')' + where + (pw.value ? ', beveiligd met je wachtwoord' : ''));
    }
  };
  name.addEventListener('keydown', e => { if (e.key === 'Enter') go(canPick ? 'pick' : 'download'); });
  const foot = canPick
    ? [same ? h('button', { class: 'btn', id: 'saveSame', html: ico('save') + '<span>Opslaan in ' + (same.name || 'hetzelfde bestand') + '</span>', title: 'Overschrijft dit bestand', onclick: () => go('same') })
        : h('button', { class: 'btn', id: 'saveDown', text: 'Zet in Downloads', onclick: () => go('download') }),
      h('button', { class: 'btn btn-primary', id: 'savePick', html: ico('save') + '<span>Opslaan als…</span>', onclick: () => go('pick') })]
    : [canShare ? h('button', { class: 'btn', id: 'saveShare', text: 'Bewaar elders of deel', onclick: () => go('share') }) : null,
      h('button', { class: 'btn btn-primary', html: ico('save') + '<span>Sla PDF op</span>', onclick: () => go('download') })];
  if (canPick) body.push(h('p', { class: 'hint', text: same ? '“Opslaan als…” laat je een map en naam kiezen. “Opslaan in ' + (same.name || 'hetzelfde bestand') + '” overschrijft dat bestand.' : 'Met “Opslaan als…” kies je zelf de map en de naam.' }));
  const sh = sheet('Opslaan', body, foot);
}

/* ---------- verkleinen, afbeeldingen, tekst, splitsen ---------- */
function openExportImages() {
  let fmt = 'jpg', dpi = 150, scope = 'all';
  const rows = h('div', { style: { display: 'grid', gap: '12px' } });
  const draw = () => {
    rows.textContent = '';
    rows.append(h('div', { class: 'field' }, h('span', { text: 'Formaat' }), chips([['jpg', 'JPG'], ['png', 'PNG']], fmt, v => { fmt = v; draw(); })),
      h('div', { class: 'field' }, h('span', { text: 'Scherpte' }), chips([[96, 'Scherm'], [150, 'Normaal'], [220, 'Drukwerk']], dpi, v => { dpi = v; draw(); })),
      h('div', { class: 'field' }, h('span', { text: "Welke pagina's" }), chips([['all', "Alle " + S.pages.length], ['cur', 'Alleen pagina ' + (curIndex() + 1)]], scope, v => { scope = v; draw(); })));
  };
  draw();
  const sh = sheet("Pagina's als afbeelding", [rows, h('p', { class: 'hint', text: 'Je aantekeningen staan erop. Meerdere pagina\'s komen samen in één zip.' })],
    [h('button', { class: 'btn btn-primary', html: ico('save') + '<span>Maak afbeeldingen</span>', onclick: async () => {
      sh.close();
      const list = scope === 'cur' ? [S.pages[curIndex()]] : S.pages, first = scope === 'cur' ? curIndex() : 0;
      const files = await run('Afbeeldingen maken', async prog => {
        const bytes = await buildPdf(list, { progress: f => prog(f * 0.35) });
        const doc = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise, out = [];
        for (let i = 0; i < doc.numPages; i++) {
          const pg = await doc.getPage(i + 1), v0 = pg.getViewport({ scale: 1 });
          const k = Math.min(dpi / 72, Math.sqrt(1.5e7 / (v0.width * v0.height))), vp = pg.getViewport({ scale: k });
          const c = document.createElement('canvas');
          c.width = Math.round(vp.width); c.height = Math.round(vp.height);
          await pg.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp }).promise;
          const blob = await new Promise(r => c.toBlob(r, fmt === 'png' ? 'image/png' : 'image/jpeg', 0.9));
          out.push({ name: baseName() + '-p' + String(first + i + 1).padStart(String(S.pages.length).length, '0') + '.' + fmt, data: new Uint8Array(await blob.arrayBuffer()) });
          c.width = c.height = 0;
          prog(0.35 + 0.65 * (i + 1) / doc.numPages);
          await tick();
        }
        doc.destroy();
        return out;
      });
      if (!files || !files.length) return;
      const ok = files.length === 1 ? await saveFile(files[0].name, files[0].data) : await saveFile(baseName() + '-afbeeldingen.zip', makeZip(files));
      if (ok) toast(files.length === 1 ? 'Afbeelding opgeslagen' : files.length + ' afbeeldingen opgeslagen als zip');
    } })]);
}
async function docText(maxChars, marks) {
  let out = '';
  for (let i = 0; i < S.pages.length; i++) {
    const p = S.pages[i], tc = await getText(S.sources[p.src], p.idx);
    let t = '';
    for (const it of tc.items) t += it.str + (it.hasEOL ? '\n' : '');
    out += (marks || S.pages.length > 1 ? '[Pagina ' + (i + 1) + ']\n' : '') + t.trim() + '\n\n';
    if (maxChars && out.length > maxChars) return out.slice(0, maxChars) + '\n[…ingekort…]';
  }
  return out.trim();
}
async function openExportText() {
  const text = await run('Tekst ophalen', () => docText());
  if (text == null) return;
  const box = h('div', { class: 'out', text: text || 'Er zit geen selecteerbare tekst in dit document. Is het een scan? Gebruik dan Tekst herkennen in de assistent.' });
  sheet('Tekst uit het document', [box, h('p', { class: 'hint', text: text ? text.length.toLocaleString('nl-NL') + ' tekens' : '' })],
    text ? [h('button', { class: 'btn', html: ico('copy') + '<span>Kopieer</span>', onclick: () => copyText(text) }), h('button', { class: 'btn btn-primary', html: ico('save') + '<span>Sla op als .txt</span>', onclick: async () => { if (await saveFile(baseName() + '.txt', text)) toast('Tekst opgeslagen'); } })] : []);
}
async function copyText(t) { try { await navigator.clipboard.writeText(t); toast('Gekopieerd'); } catch (e) { toast('Kopiëren lukte niet. Selecteer de tekst en kopieer met de hand.', true); } }
function parseRanges(str, n) {
  const out = [];
  for (const part of str.split(/[,;]+/)) {
    const m = part.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!m) { if (part.trim()) return null; continue; }
    const a = clamp(parseInt(m[1], 10), 1, n), b = clamp(m[2] ? parseInt(m[2], 10) : a, 1, n), g = [];
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) g.push(i - 1);
    out.push(g);
  }
  return out.length ? out : null;
}
function openSplit() {
  const n = S.pages.length;
  let mode = 'every';
  const every = h('input', { class: 'input', id: 'splitEvery', type: 'number', min: 1, max: n, value: 1 });
  const ranges = h('input', { class: 'input', id: 'splitRanges', type: 'text', placeholder: 'Bijvoorbeeld 1-3, 4-8, 9', autocomplete: 'off' });
  const pane = h('div'), tabs = h('div');
  const draw = () => {
    tabs.textContent = ''; tabs.append(chips([['every', "Elke zoveel pagina's"], ['ranges', 'Eigen delen']], mode, v => { mode = v; draw(); }));
    pane.textContent = '';
    pane.append(mode === 'every' ? h('div', { class: 'field' }, h('label', { for: 'splitEvery', text: "Nieuw bestand na elke … pagina's" }), every) : h('div', { class: 'field' }, h('label', { for: 'splitRanges', text: 'Delen, gescheiden door komma\'s' }), ranges));
  };
  draw();
  const sh = sheet('Splitsen', [h('p', { text: 'Dit document heeft ' + n + (n === 1 ? ' pagina.' : " pagina's.") }), tabs, pane, h('p', { class: 'hint', text: 'Je krijgt één zip met de losse PDF\'s. Je huidige document blijft heel.' })],
    [h('button', { class: 'btn btn-primary', html: ico('split') + '<span>Splits en sla op</span>', onclick: async () => {
      let groups;
      if (mode === 'every') { const k = clamp(parseInt(every.value, 10) || 1, 1, n); groups = []; for (let i = 0; i < n; i += k) groups.push(Array.from({ length: Math.min(k, n - i) }, (_, j) => i + j)); }
      else groups = parseRanges(ranges.value, n);
      if (!groups) { toast('Ik begrijp de delen niet. Schrijf ze als 1-3, 4-8, 9.', true); return; }
      sh.close();
      const files = await run('Splitsen', async prog => {
        const out = [];
        for (let g = 0; g < groups.length; g++) {
          const bytes = await buildPdf(groups[g].map(i => S.pages[i]), { progress: f => prog((g + f) / groups.length) });
          const a = groups[g][0] + 1, b = groups[g][groups[g].length - 1] + 1;
          out.push({ name: baseName() + '-p' + a + (b !== a ? '-' + b : '') + '.pdf', data: bytes });
        }
        return out;
      });
      if (!files) return;
      const ok = files.length === 1 ? await saveFile(files[0].name, files[0].data) : await saveFile(baseName() + '-gesplitst.zip', makeZip(files));
      if (ok) toast(files.length + (files.length === 1 ? ' deel' : ' delen') + ' opgeslagen');
    } })]);
}

/* ---------- pagina's ordenen ---------- */
const ORG = { sel: new Set(), open: false };
function openOrganizer() {
  endTextEdit();
  ORG.open = true; ORG.sel = new Set();
  $('#organizer').hidden = false;
  orgRender();
}
function closeOrganizer(goTo) {
  ORG.open = false;
  $('#organizer').hidden = true;
  $('#organizer').textContent = '';
  if (goTo != null) goToPage(goTo);
}
function orgRefresh() { if (ORG.open) { ORG.sel = new Set([...ORG.sel].filter(id => pageById(id))); orgRender(); } }
function orgApply() { commit(); buildPages(true); orgRender(); }
function orgSelected() { return S.pages.filter(p => ORG.sel.has(p.id)); }
function orgRender() {
  const root = $('#organizer'), keep = $('#orgGrid') ? $('#orgGrid').scrollTop : 0;
  root.textContent = '';
  const n = ORG.sel.size, some = n > 0;
  const btn = (icon, label, fn, on, cls) => h('button', { class: 'btn' + (cls ? ' ' + cls : ''), disabled: on === false, html: ico(icon) + '<span>' + label + '</span>', onclick: fn });
  root.append(h('div', { class: 'org-head' }, h('h2', { text: "Pagina's" }), h('span', { class: 'hint', text: some ? n + ' gekozen' : S.pages.length + " pagina's" }),
    h('button', { class: 'btn btn-primary', text: 'Klaar', onclick: () => closeOrganizer() })));
  root.append(h('div', { class: 'org-actions' },
    h('button', { class: 'chip', 'aria-pressed': String(n === S.pages.length && some), text: n === S.pages.length && some ? 'Niets kiezen' : 'Alles kiezen', onclick: () => { ORG.sel = n === S.pages.length ? new Set() : new Set(S.pages.map(p => p.id)); orgRender(); } }),
    btn('left', 'Eerder', () => orgMove(-1), some), btn('right', 'Later', () => orgMove(1), some),
    btn('rotl', 'Draai links', () => { orgSelected().forEach(p => rotatePage(p, -1)); orgApply(); }, some),
    btn('rotr', 'Draai rechts', () => { orgSelected().forEach(p => rotatePage(p, 1)); orgApply(); }, some),
    btn('copy', 'Dupliceer', () => {
      const out = [];
      for (const p of S.pages) { out.push(p); if (ORG.sel.has(p.id)) { const c = clone(p); c.id = uid(); c.annots.forEach(a => { a.id = uid(); }); out.push(c); } }
      S.pages = out; orgApply();
    }, some),
    btn('trash', 'Verwijder', () => {
      if (n >= S.pages.length) { toast('Er moet minstens één pagina overblijven.', true); return; }
      S.pages = S.pages.filter(p => !ORG.sel.has(p.id)); ORG.sel = new Set(); orgApply();
    }, some, 'btn-danger'),
    btn('save', 'Sla keuze op als PDF', async () => {
      const list = orgSelected();
      const bytes = await run('PDF opbouwen', prog => buildPdf(list, { progress: prog }));
      if (bytes && await saveFile(baseName() + '-selectie.pdf', bytes)) toast(list.length + (list.length === 1 ? ' pagina' : " pagina's") + ' opgeslagen als aparte PDF');
    }, some),
    h('span', { class: 'sep' }),
    btn('addfile', "Voeg PDF of foto's toe", () => { addAt = orgInsertIndex(); $('#fileAdd').click(); }),
    btn('blank', 'Lege pagina', async () => {
      const at = orgInsertIndex(), ref = S.pages[Math.max(0, at - 1)];
      const src = await blankSource(viewW(ref), viewH(ref));
      S.sources[src.id] = src;
      S.pages.splice(at, 0, ...(await pagesOf(src)));
      orgApply();
    })));
  const grid = h('div', { id: 'orgGrid' });
  S.pages.forEach((p, i) => {
    const tile = h('button', { class: 'tile', 'aria-pressed': String(ORG.sel.has(p.id)), draggable: 'true', 'data-id': p.id, title: 'Pagina ' + (i + 1) }, thumbHolder(p), h('span', { text: i + 1 }));
    tile.addEventListener('click', () => { if (ORG.sel.has(p.id)) ORG.sel.delete(p.id); else ORG.sel.add(p.id); orgRender(); });
    tile.addEventListener('dblclick', () => closeOrganizer(i));
    tile.addEventListener('dragstart', e => { if (!ORG.sel.has(p.id)) { ORG.sel = new Set([p.id]); } e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.id); });
    tile.addEventListener('dragover', e => { e.preventDefault(); $$('.tile.drop-before', grid).forEach(t => t.classList.remove('drop-before')); tile.classList.add('drop-before'); });
    tile.addEventListener('dragleave', () => tile.classList.remove('drop-before'));
    tile.addEventListener('drop', e => {
      e.preventDefault();
      const moving = orgSelected();
      if (!moving.length || ORG.sel.has(p.id)) { orgRender(); return; }
      const rest = S.pages.filter(q => !ORG.sel.has(q.id)), at = rest.indexOf(p);
      rest.splice(at, 0, ...moving);
      S.pages = rest; orgApply();
    });
    grid.append(tile);
  });
  root.append(grid);
  grid.scrollTop = keep;
}
function orgInsertIndex() {
  let at = S.pages.length;
  S.pages.forEach((p, i) => { if (ORG.sel.has(p.id)) at = i + 1; });
  return ORG.open && ORG.sel.size ? at : S.pages.length;
}
function orgMove(dir) {
  const arr = S.pages, idx = arr.map((p, i) => (ORG.sel.has(p.id) ? i : -1)).filter(i => i >= 0);
  if (dir < 0) { for (const i of idx) if (i > 0 && !ORG.sel.has(arr[i - 1].id)) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; }
  else { for (const i of idx.reverse()) if (i < arr.length - 1 && !ORG.sel.has(arr[i + 1].id)) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; }
  orgApply();
}

/* ---------- watermerk, nummers, eigenschappen, ga naar ---------- */
function openWatermark() {
  const cur = S.fx.wm || { text: 'CONCEPT', c: '#B8301F', o: 0.18, ang: -35, size: 0 };
  const st = clone(cur);
  const text = h('input', { class: 'input', id: 'wmText', type: 'text', value: st.text });
  const rows = h('div', { style: { display: 'grid', gap: '12px' } });
  const draw = () => {
    rows.textContent = '';
    rows.append(h('div', { class: 'field' }, h('span', { text: 'Kleur' }), swatches(['#B8301F', '#5B6675', '#1F4FD1', '#1B7446'], st.c, c => { st.c = c; draw(); })),
      h('div', { class: 'field' }, h('span', { text: 'Richting' }), chips([[-35, 'Schuin'], [0, 'Recht'], [-90, 'Verticaal']], st.ang, v => { st.ang = v; draw(); })),
      h('div', { class: 'field' }, h('span', { text: 'Sterkte' }), chips([[0.1, 'Licht'], [0.18, 'Normaal'], [0.35, 'Stevig']], st.o, v => { st.o = v; draw(); })));
  };
  draw();
  const sh = sheet('Watermerk', [h('div', { class: 'field' }, h('label', { for: 'wmText', text: 'Tekst over elke pagina' }), text), rows],
    [S.fx.wm ? h('button', { class: 'btn btn-danger', text: 'Haal watermerk weg', onclick: () => { S.fx.wm = null; drawAll(); commit(); sh.close(); } }) : null,
      h('button', { class: 'btn btn-primary', text: 'Zet watermerk', onclick: () => { st.text = text.value.trim(); if (!st.text) { toast('Vul eerst een tekst in.', true); return; } S.fx.wm = st; drawAll(); commit(); sh.close(); } })]);
}
function openNumbers() {
  const num = clone(S.fx.num || { fmt: 'n/N', pos: 'bc', start: 1, skipFirst: false, size: 10 });
  const head = clone(S.fx.head || { text: '', pos: 'tc', size: 10 });
  const POS = [['tl', 'Boven links'], ['tc', 'Boven midden'], ['tr', 'Boven rechts'], ['bl', 'Onder links'], ['bc', 'Onder midden'], ['br', 'Onder rechts']];
  const sel = (id, opts, val, set) => { const s = h('select', { class: 'input', id }, opts.map(o => h('option', { value: o[0], text: o[1] }))); s.value = val; s.addEventListener('change', () => set(s.value)); return s; };
  const numOn = h('input', { type: 'checkbox', id: 'numOn', checked: !!S.fx.num });
  const skip = h('input', { type: 'checkbox', id: 'numSkip', checked: !!num.skipFirst });
  const start = h('input', { class: 'input', id: 'numStart', type: 'number', min: 1, value: num.start });
  const htext = h('input', { class: 'input', id: 'headText', type: 'text', value: head.text, placeholder: 'Bijvoorbeeld de naam van het document' });
  const sh = sheet('Paginanummers en koptekst', [
    h('label', { class: 'check', for: 'numOn' }, numOn, h('span', { text: "Zet paginanummers op elke pagina" })),
    h('div', { class: 'row' },
      h('div', { class: 'field grow' }, h('label', { for: 'numFmt', text: 'Vorm' }), sel('numFmt', [['n', '1'], ['n/N', '1 / 12'], ['pn', 'Pagina 1'], ['pnN', 'Pagina 1 van 12'], ['dash', '- 1 -']], num.fmt, v => { num.fmt = v; })),
      h('div', { class: 'field grow' }, h('label', { for: 'numPos', text: 'Plek' }), sel('numPos', POS, num.pos, v => { num.pos = v; }))),
    h('div', { class: 'row' }, h('div', { class: 'field', style: { width: '120px' } }, h('label', { for: 'numStart', text: 'Begin bij' }), start),
      h('label', { class: 'check grow', for: 'numSkip' }, skip, h('span', { text: 'Sla de eerste pagina over (voorblad)' }))),
    h('div', { class: 'row' },
      h('div', { class: 'field grow' }, h('label', { for: 'headText', text: 'Koptekst (leeg laten mag)' }), htext),
      h('div', { class: 'field', style: { width: '170px' } }, h('label', { for: 'headPos', text: 'Plek' }), sel('headPos', POS, head.pos, v => { head.pos = v; })))],
  [h('button', { class: 'btn btn-primary', text: 'Pas toe', onclick: () => {
    num.start = Math.max(1, parseInt(start.value, 10) || 1); num.skipFirst = skip.checked;
    S.fx.num = numOn.checked ? num : null;
    head.text = htext.value.trim();
    S.fx.head = head.text ? head : null;
    drawAll(); commit(); sh.close();
  } })]);
}
function openProps() {
  const m = S.meta || { title: '', author: '', subject: '', keywords: '' };
  const f = (id, label, val) => { const inp = h('input', { class: 'input', id, type: 'text', value: val || '' }); return [h('div', { class: 'field' }, h('label', { for: id, text: label }), inp), inp]; };
  const [n1, name] = f('prName', 'Bestandsnaam', baseName()), [n2, title] = f('prTitle', 'Titel', m.title), [n3, author] = f('prAuthor', 'Auteur', m.author), [n4, subject] = f('prSubject', 'Onderwerp', m.subject), [n5, keys] = f('prKeys', 'Trefwoorden (met komma\'s)', m.keywords);
  const srcs = Object.values(S.sources).filter(s => S.pages.some(p => p.src === s.id));
  const annots = S.pages.reduce((n, p) => n + p.annots.length, 0);
  const p0 = S.pages[curIndex()];
  const mm = v => Math.round(v / 72 * 25.4);
  const readDd = h('dd', { text: 'Even tellen' });
  readingStats().then(r => { readDd.textContent = r.words ? 'Ongeveer ' + r.minutes + (r.minutes === 1 ? ' minuut' : ' minuten') + ' (' + r.words.toLocaleString('nl-NL') + ' woorden)' : 'Geen leesbare tekst gevonden'; }).catch(() => { readDd.textContent = 'Onbekend'; });
  const sh = sheet('Eigenschappen', [n1, n2, n3, n4, n5,
    h('dl', { class: 'kv' }, h('dt', { text: "Pagina's" }), h('dd', { text: S.pages.length }), h('dt', { text: 'Deze pagina' }), h('dd', { text: mm(viewW(p0)) + ' × ' + mm(viewH(p0)) + ' mm' }),
      h('dt', { text: 'Aantekeningen' }), h('dd', { text: annots }), h('dt', { text: 'Grootte nu' }), h('dd', { text: fmtSize(srcs.reduce((n, s) => n + s.bytes.length, 0)) }),
      h('dt', { text: 'Leestijd' }), readDd,
      h('dt', { text: 'Samengesteld uit' }), h('dd', { text: srcs.map(s => s.name).join(', ') }))],
  [h('button', { class: 'btn btn-primary', text: 'Bewaar eigenschappen', onclick: () => {
    S.name = cleanName(name.value) + '.pdf';
    $('#docName').textContent = S.name;
    const nm = { title: title.value.trim(), author: author.value.trim(), subject: subject.value.trim(), keywords: keys.value.trim() };
    S.meta = (nm.title || nm.author || nm.subject || nm.keywords || S.meta) ? nm : null;
    setDirty(); scheduleSessionSave(); sh.close();
  } })]);
}
function openGoTo() {
  const inp = h('input', { class: 'input', id: 'gotoNum', type: 'number', min: 1, max: S.pages.length, value: curIndex() + 1, inputmode: 'numeric' });
  const go = () => { goToPage((parseInt(inp.value, 10) || 1) - 1); sh.close(); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  const sh = sheet('Ga naar pagina', [h('div', { class: 'field' }, h('label', { for: 'gotoNum', text: 'Paginanummer (1 tot ' + S.pages.length + ')' }), inp)], [h('button', { class: 'btn btn-primary', text: 'Ga', onclick: go })]);
  setTimeout(() => { inp.focus(); inp.select(); }, 60);
}

/* ---------- assistent (vraagt Claude; alleen als de weergave dat toestaat) ---------- */
async function openAssistant() {
  const out = h('div', { class: 'out', text: 'Kies wat je wilt weten. De tekst van je document gaat daarvoor naar Claude.' });
  const q = h('input', { class: 'input', id: 'aiQ', type: 'text', placeholder: 'Stel een vraag over dit document', autocomplete: 'off' });
  const actions = h('div', { class: 'row' });
  const foot = h('div', { class: 'row' });
  let sample = null, working = false, last = '';
  const sh = sheet('Assistent', [actions, h('div', { class: 'row' }, h('div', { class: 'grow' }, q), h('button', { class: 'btn', text: 'Vraag', onclick: () => ask() })), out, foot], null, { wide: true });
  q.addEventListener('keydown', e => { if (e.key === 'Enter') ask(); });
  const fail = e => {
    const code = e && e.code;
    out.textContent = code === 'not_granted' ? 'Je hebt geen toestemming gegeven om Claude te vragen. Zonder die toestemming werkt de assistent niet.'
      : code === 'rate_limited' ? 'Even te veel vragen achter elkaar. Probeer het over een minuut opnieuw.'
      : 'Dat lukte niet' + (e && e.message ? ': ' + e.message : '.') ;
  };
  const drawFoot = () => { foot.textContent = ''; if (last) foot.append(h('button', { class: 'btn', html: ico('copy') + '<span>Kopieer</span>', onclick: () => copyText(last) }), h('button', { class: 'btn', html: ico('save') + '<span>Sla op als .txt</span>', onclick: () => saveFile(baseName() + '-assistent.txt', last) })); };
  const runAI = async (prompt, opts) => {
    if (working) return null;
    working = true; last = ''; drawFoot();
    out.textContent = 'Bezig…';
    try {
      const res = await sample(prompt, Object.assign({ onText: ({ text }) => { out.textContent = text; } }, opts || {}));
      last = (res && res.text) || out.textContent;
      out.textContent = last;
      drawFoot();
      return last;
    } catch (e) { fail(e); return null; } finally { working = false; }
  };
  const getDoc = async () => {
    const t = await docText(110000, true);
    if (!t.replace(/\[Pagina \d+\]/g, '').trim()) { out.textContent = 'Er zit geen selecteerbare tekst in dit document. Is het een scan? Kies dan Tekst herkennen.'; return null; }
    return t;
  };
  const ask = async () => {
    const question = q.value.trim();
    if (!question || !sample) return;
    const t = await getDoc();
    if (t) runAI('Je helpt iemand met een PDF-document. Beantwoord de vraag in het Nederlands en alleen op basis van het document. Staat het antwoord er niet in, zeg dat dan. Noem het paginanummer waar je het vond.\n\nVraag: ' + question + '\n\n<document>\n' + t + '\n</document>');
  };
  sample = await getCap('sample');
  if (!sample) {
    out.textContent = inClaude() ? 'De assistent is in deze weergave niet beschikbaar.' : 'De assistent werkt alleen als je Papierwerk binnen Claude opent.';
    return;
  }
  const act = (icon, label, fn) => h('button', { class: 'btn', html: ico(icon) + '<span>' + label + '</span>', onclick: fn });
  actions.append(
    act('textfile', 'Vat samen', async () => { const t = await getDoc(); if (t) runAI('Vat dit document samen in het Nederlands. Begin met twee of drie zinnen over waar het over gaat. Geef daarna de belangrijkste punten als korte lijst. Noem bedragen, data, termijnen en afspraken letterlijk, met het paginanummer erbij.\n\n<document>\n' + t + '\n</document>'); }),
    act('highlight', 'Markeer de kern', async () => {
      const t = await getDoc();
      if (!t || working) return;
      working = true; out.textContent = 'Bezig met lezen…';
      try {
        const res = await sample.json('Lees dit document en kies de 5 tot 12 passages die iemand niet mag missen: bedragen, data, termijnen, verplichtingen, namen van partijen en conclusies. Geef alleen een JSON-array van strings terug. Elke string is een LETTERLIJK citaat uit het document van 2 tot 10 woorden, precies zo gespeld, zonder regeleindes.\n\n<document>\n' + t + '\n</document>');
        const list = Array.isArray(res) ? res : (res && Array.isArray(res.passages) ? res.passages : []);
        let made = 0; const got = [];
        for (const raw of list) {
          const phrase = String(raw).replace(/\s+/g, ' ').trim().toLowerCase();
          if (phrase.length < 3) continue;
          for (const p of S.pages) {
            const found = await findInPage(p, phrase);
            if (!found.length) continue;
            for (const poly of found[0]) {
              const xs = poly.map(v => v[0]), ys = poly.map(v => v[1]);
              const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
              p.annots.push({ id: uid(), t: 'hl', c: '#FFE14A', mode: 'mark', rot: 0, cx: r2((x0 + x1) / 2), cy: r2((y0 + y1) / 2), w: r2(x1 - x0), h: r2(y1 - y0) });
            }
            drawAnnots(p); made++; got.push('p. ' + (S.pages.indexOf(p) + 1) + ': ' + raw);
            break;
          }
        }
        if (made) { commit(); last = got.join('\n'); out.textContent = made + ' passages gemarkeerd in het document:\n\n' + last; drawFoot(); }
        else out.textContent = 'Ik kon de gekozen passages niet letterlijk terugvinden in de tekst. Probeer Vat samen.';
      } catch (e) { fail(e); } finally { working = false; }
    }),
    act('search', 'Tekst herkennen op deze pagina', async () => {
      if (working) return;
      let ok = false;
      try { ok = !!(await sample.limits()).images; } catch (e) {}
      if (!ok) { out.textContent = 'Afbeeldingen meesturen kan in deze weergave niet, dus tekst herkennen werkt hier niet.'; return; }
      const p = S.pages[curIndex()], src = S.sources[p.src], pg = await getPg(src, p.idx);
      const vp = pg.getViewport({ scale: Math.min(2, 1800 / Math.max(viewW(p), viewH(p))), rotation: (pg.rotate + p.rot) % 360 });
      const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      await pg.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp }).promise;
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
      runAI('Neem alle tekst op deze pagina letterlijk over, in dezelfde volgorde en met dezelfde regelindeling. Geef alleen de tekst, zonder uitleg. Tabellen zet je om naar regels met tabs.', { images: [blob] });
    }));
}

/* ---------- openen, toevoegen, voorbeeld ---------- */
let addAt = null;
const isPdfBytes = b => b && b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
async function imagesToPdf(files) {
  const d = await PDFLib.PDFDocument.create();
  for (const f of files) {
    const bm = await loadBitmap(f);
    const k = Math.min(1, 2400 / Math.max(bm.width, bm.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bm.width * k)); c.height = Math.max(1, Math.round(bm.height * k));
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bm, 0, 0, c.width, c.height);
    const png = /png/i.test(f.type) && c.width * c.height < 2.2e6;
    const blob = await new Promise(r => c.toBlob(r, png ? 'image/png' : 'image/jpeg', 0.88));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const im = png ? await d.embedPng(bytes) : await d.embedJpg(bytes);
    const [PW, PH] = im.width > im.height ? [841.89, 595.28] : [595.28, 841.89];
    const s = Math.min(PW / im.width, PH / im.height), w = im.width * s, hh = im.height * s;
    d.addPage([PW, PH]).drawImage(im, { x: (PW - w) / 2, y: (PH - hh) / 2, width: w, height: hh });
    c.width = c.height = 0;
  }
  return await d.save();
}
async function filesToSources(files) {
  const out = [];
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    const src = await makeSource(await imagesToPdf(batch), batch.length === 1 ? batch[0].name : batch.length + " foto's");
    out.push({ src, pages: await pagesOf(src) });
    batch = [];
  };
  for (const f of files) {
    const buf = new Uint8Array(await f.arrayBuffer());
    if (isPdfBytes(buf) || /\.pdf$/i.test(f.name)) {
      await flush();
      const src = await makeSource(buf, f.name);
      out.push({ src, pages: await pagesOf(src) });
    } else if (/^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif)$/i.test(f.name)) batch.push(f);
    else throw new Error('“' + f.name + '” is geen PDF of afbeelding. Zet het bestand eerst om naar PDF');
  }
  await flush();
  return out;
}
async function blankSource(w, hh) {
  const d = await PDFLib.PDFDocument.create();
  d.addPage([w || 595.28, hh || 841.89]);
  return makeSource(await d.save(), 'Lege pagina');
}
function replaceDoc(list, name, extra) {
  extra = extra || {};
  endTextEdit(true);
  for (const s of Object.values(S.sources)) { try { s.pdf.destroy(); } catch (e) {} }
  clearThumbs();
  S.sources = {}; S.pages = [];
  S.assets = extra.assets || {}; S.fx = extra.fx || { wm: null, num: null, head: null }; S.meta = extra.meta || null;
  S.sel = null; S.hist = []; S.fut = []; S.outline = extra.outline; S.saveHandle = extra.saveHandle || null;
  for (const it of list) { S.sources[it.src.id] = it.src; S.pages.push(...it.pages); }
  S.name = name; S.isExample = !!extra.isExample;
  Q.q = ''; Q.hits = []; Q.cur = -1;
  lastSnap = snap();
  setDirty(false); updateUndoUI();
  $('#docName').textContent = S.name;
  $('#banner').hidden = !S.isExample;
  setTool('select');
  pagesEl.classList.remove('fresh'); void pagesEl.offsetWidth; pagesEl.classList.add('fresh');
  buildPages(false);
  viewer.scrollTop = 0; viewer.scrollLeft = 0;
  S.scale = 1;
  fitWidth();
  viewer.scrollTop = 0; viewer.scrollLeft = 0;
  if (ORG.open) closeOrganizer();
}
async function guardUnsaved() {
  if (!S.dirty || S.isExample) return true;
  const c = await choose('Nog niet opgeslagen', 'Je hebt wijzigingen in “' + S.name + '” die nog niet zijn opgeslagen.', [
    { label: 'Annuleer', value: 'no' }, { label: 'Ga door zonder opslaan', value: 'go', danger: true }, { label: 'Eerst opslaan', value: 'save', primary: true }]);
  if (c === 'save') openSave();
  return c === 'go';
}
async function openDocHere(files) {
  files = Array.from(files || []);
  if (!files.length || !(await guardUnsaved())) return;
  busy('Openen');
  await tick();
  try {
    const list = await filesToSources(files);
    const first = files[0].name.replace(/\.[^.]+$/, '');
    replaceDoc(list, cleanName(first) + '.pdf');
    scheduleSessionSave();
    if (list.some(it => it.src.hasForm)) toast('Dit document heeft invulvelden. Tik erin om ze in te vullen.');
  } catch (e) {
    if (e && e.message !== 'cancel') toast(/invalid pdf|missing pdf|unexpected/i.test(e.message || '') ? 'Dit bestand is geen geldige PDF of is beschadigd.' : (e && e.message) || 'Het bestand kon niet worden geopend.', true);
  } finally { busyOff(); }
}
async function addFiles(files, at) {
  files = Array.from(files || []);
  if (!files.length) return;
  busy('Toevoegen');
  await tick();
  try {
    const list = await filesToSources(files);
    const pages = [];
    for (const it of list) { S.sources[it.src.id] = it.src; pages.push(...it.pages); }
    const pos = at == null ? S.pages.length : clamp(at, 0, S.pages.length);
    S.pages.splice(pos, 0, ...pages);
    if (S.isExample) { S.isExample = false; $('#banner').hidden = true; }
    commit();
    buildPages(true);
    if (ORG.open) orgRender(); else goToPage(pos);
    toast(pages.length + (pages.length === 1 ? ' pagina' : " pagina's") + ' toegevoegd');
  } catch (e) {
    if (e && e.message !== 'cancel') toast((e && e.message) || 'Toevoegen lukte niet.', true);
  } finally { busyOff(); }
}
async function buildExample() {
  const L = PDFLib, d = await L.PDFDocument.create();
  const F = d.embedStandardFont(L.StandardFonts.Helvetica), B = d.embedStandardFont(L.StandardFonts.HelveticaBold);
  const ink = L.rgb(0.09, 0.125, 0.17), mut = L.rgb(0.36, 0.4, 0.46), yel = L.rgb(1, 0.867, 0.235), blue = L.rgb(0.12, 0.31, 0.82), rule = L.rgb(0.8, 0.82, 0.85), paper = L.rgb(0.965, 0.969, 0.976);
  const W = 595.28, H = 841.89, M = 62;
  const para = (pg, text, x, y, maxW, font, size, color, lh) => {
    let line = '';
    for (const w of text.split(' ')) {
      const t = line ? line + ' ' + w : w;
      if (font.widthOfTextAtSize(t, size) > maxW && line) { pg.drawText(line, { x, y, size, font, color }); y -= lh; line = w; } else line = t;
    }
    if (line) { pg.drawText(line, { x, y, size, font, color }); y -= lh; }
    return y;
  };
  let pg = d.addPage([W, H]), y = H - 92;
  pg.drawText('Welkom bij', { x: M, y: y + 46, size: 15, font: F, color: mut });
  pg.drawRectangle({ x: M - 5, y: y - 5, width: B.widthOfTextAtSize('Papierwerk', 44) + 10, height: 17, color: yel });
  pg.drawText('Papierwerk', { x: M, y, size: 44, font: B, color: ink });
  y -= 38;
  y = para(pg, 'Dit is een voorbeelddocument. Probeer hier alles uit, er kan niets stuk. Open daarna je eigen PDF via het menu linksboven.', M, y, W - 2 * M, F, 12.5, ink, 18) - 14;
  const parts = [
    ['Lezen en zoeken', 'Blader door het document, zoom in en zoek op woorden. Op je telefoon zoom je door met twee vingers te knijpen.'],
    ['Markeren en aantekenen', 'Selecteer tekst en kies Markeer, of pak de markeerstift, de pen, vormen, notities en stempels uit de gereedschapsbalk.'],
    ['Tekst toevoegen en herschrijven', 'Met Tekst typ je overal op de pagina. Met Bewerk tekst tik je op een bestaande regel en pas je die aan.'],
    ['Invullen en ondertekenen', 'Op de volgende pagina staat een oefenformulier. Vul de velden in en zet je handtekening: getekend, getypt of van een foto.'],
    ["Pagina's ordenen", "Herorden, draai, dupliceer en verwijder pagina's. Voeg andere PDF's of foto's toe, of splits het document in delen."],
    ['Afdekken en zwartlakken', 'Dek iets wit af, of lak het zwart zodat het echt uit het bestand verdwijnt.'],
    ['Opslaan', 'Je bestanden blijven op je eigen apparaat. Met Opslaan krijg je een nieuwe PDF en blijft het origineel zoals het was.'],
  ];
  for (const [t, b] of parts) {
    pg.drawRectangle({ x: M, y: y - 1, width: 3, height: 13, color: blue });
    pg.drawText(t, { x: M + 12, y, size: 13.5, font: B, color: ink });
    y = para(pg, b, M + 12, y - 18, W - 2 * M - 12, F, 11.5, mut, 16) - 12;
  }
  y -= 6;
  pg.drawRectangle({ x: M, y: y - 76, width: W - 2 * M, height: 92, color: paper, borderColor: rule, borderWidth: 0.8 });
  pg.drawText('Oefen hier', { x: M + 16, y: y - 6, size: 11, font: B, color: blue });
  para(pg, 'Markeer deze zin, streep een woord door of zet er een notitie bij. Het bedrag van € 1.250,00 moet uiterlijk 15 december 2026 zijn betaald op rekening van Voorbeeld B.V.', M + 16, y - 26, W - 2 * M - 32, F, 12, ink, 17);

  pg = d.addPage([W, H]); y = H - 92;
  pg.drawText('Oefenformulier', { x: M, y, size: 30, font: B, color: ink });
  y -= 26;
  y = para(pg, 'Tik in een veld om het in te vullen. Onderaan is plek voor je handtekening: kies Onderteken in de gereedschapsbalk.', M, y, W - 2 * M, F, 12, mut, 17) - 22;
  const form = d.getForm();
  const fieldBox = { borderColor: rule, borderWidth: 1, backgroundColor: L.rgb(1, 1, 1), textColor: ink };
  const label = (t, yy) => pg.drawText(t, { x: M, y: yy, size: 11, font: B, color: ink });
  label('Naam', y); const naam = form.createTextField('naam'); naam.addToPage(pg, Object.assign({ x: M, y: y - 34, width: 300, height: 26, font: F }, fieldBox)); y -= 64;
  label('E-mailadres', y); const mail = form.createTextField('email'); mail.addToPage(pg, Object.assign({ x: M, y: y - 34, width: 300, height: 26, font: F }, fieldBox)); y -= 64;
  label('Met hoeveel personen kom je?', y); const aantal = form.createDropdown('aantal'); aantal.addOptions(['1', '2', '3', '4']); aantal.select('1'); aantal.addToPage(pg, Object.assign({ x: M, y: y - 34, width: 90, height: 26, font: F }, fieldBox)); y -= 64;
  label('Hoe kom je?', y);
  const rg = form.createRadioGroup('vervoer');
  ['Fiets', 'Auto', 'Trein'].forEach((o, i) => { rg.addOptionToPage(o, pg, { x: M + i * 110, y: y - 30, width: 15, height: 15, borderColor: mut, borderWidth: 1 }); pg.drawText(o, { x: M + i * 110 + 23, y: y - 26, size: 11.5, font: F, color: ink }); });
  y -= 58;
  const cb = form.createCheckBox('eet_mee'); cb.addToPage(pg, { x: M, y: y - 4, width: 15, height: 15, borderColor: mut, borderWidth: 1 });
  pg.drawText('Ik eet mee', { x: M + 23, y, size: 11.5, font: F, color: ink });
  const cb2 = form.createCheckBox('nieuwsbrief'); cb2.addToPage(pg, { x: M + 150, y: y - 4, width: 15, height: 15, borderColor: mut, borderWidth: 1 });
  pg.drawText('Houd me op de hoogte', { x: M + 173, y, size: 11.5, font: F, color: ink });
  y -= 44;
  label('Dieetwensen of opmerkingen', y); const opm = form.createTextField('opmerkingen'); opm.enableMultiline(); opm.addToPage(pg, Object.assign({ x: M, y: y - 84, width: W - 2 * M, height: 76, font: F }, fieldBox)); y -= 128;
  pg.drawText('Datum', { x: M, y, size: 11, font: B, color: ink });
  pg.drawText('Handtekening', { x: M + 200, y, size: 11, font: B, color: ink });
  pg.drawLine({ start: { x: M, y: y - 52 }, end: { x: M + 160, y: y - 52 }, thickness: 0.8, color: mut });
  pg.drawLine({ start: { x: M + 200, y: y - 52 }, end: { x: W - M, y: y - 52 }, thickness: 0.8, color: mut });
  pg.drawText('Zet hier de datum met Stempel of Tekst', { x: M, y: y - 66, size: 8.5, font: F, color: mut });
  pg.drawText('Zet hier je handtekening met Onderteken', { x: M + 200, y: y - 66, size: 8.5, font: F, color: mut });
  naam.setFontSize(12); mail.setFontSize(12); aantal.setFontSize(12); opm.setFontSize(11);
  d.setTitle('Voorbeeld Papierwerk');
  return await d.save();
}
async function loadExample() {
  const src = await makeSource(await buildExample(), 'Voorbeeld');
  replaceDoc([{ src, pages: await pagesOf(src) }], 'Voorbeeld Papierwerk.pdf', { isExample: true });
}

/* ---------- verder waar je was (bewaard in deze browser) ---------- */
const IDB = {
  db: null,
  open() {
    return new Promise(res => {
      try {
        const r = indexedDB.open('papierwerk', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null);
      } catch (e) { res(null); }
    });
  },
  async tx(mode, fn) {
    if (!this.db) this.db = await this.open();
    const db = this.db;
    if (!db) return null;
    return new Promise(res => {
      try { const t = db.transaction('kv', mode), rq = fn(t.objectStore('kv')); t.oncomplete = () => res(rq ? rq.result : null); t.onerror = t.onabort = () => res(null); }
      catch (e) { res(null); }
    });
  },
  get(k) { return this.tx('readonly', s => s.get(k)); },
  set(k, v) { return this.tx('readwrite', s => s.put(v, k)); },
  del(k) { return this.tx('readwrite', s => s.delete(k)); },
  keys() { return this.tx('readonly', s => s.getAllKeys()); },
};
let sessTimer = 0;
const sessSaved = new Set();
function scheduleSessionSave() { clearTimeout(sessTimer); sessTimer = setTimeout(saveSession, 1400); }
async function saveSession() {
  try {
    if (S.isExample) { await IDB.del('session'); return; }
    const srcs = Object.values(S.sources).filter(s => S.pages.some(p => p.src === s.id));
    if (srcs.reduce((n, s) => n + s.bytes.length, 0) > 90e6) { await IDB.del('session'); return; }
    for (const s of srcs) if (!sessSaved.has(s.id)) { await IDB.set('src:' + s.id, s.bytes); sessSaved.add(s.id); }
    const used = new Set();
    for (const p of S.pages) for (const a of p.annots) if (a.asset) used.add(a.asset);
    if (S.fx && S.fx.bg) used.add(S.fx.bg.asset);
    const assets = {};
    for (const id of used) if (S.assets[id]) assets[id] = S.assets[id];
    await IDB.set('session', { v: 1, name: S.name, dirty: S.dirty, pages: S.pages, fx: S.fx, meta: S.meta, assets, sources: srcs.map(s => ({ id: s.id, name: s.name, form: s.form, rasterOnly: s.rasterOnly })) });
    const keys = (await IDB.keys()) || [], keep = new Set(srcs.map(s => 'src:' + s.id));
    for (const k of keys) if (typeof k === 'string' && k.startsWith('src:') && !keep.has(k)) { await IDB.del(k); sessSaved.delete(k.slice(4)); }
  } catch (e) { /* bewaren is een gemak, geen vereiste */ }
}
async function restoreSession() {
  const data = await IDB.get('session');
  if (!data || !data.pages || !data.pages.length) return false;
  const map = {};
  for (const meta of data.sources) {
    const bytes = await IDB.get('src:' + meta.id);
    if (!bytes) return false;
    const src = await makeSource(new Uint8Array(bytes), meta.name);
    src.id = meta.id; src.form = meta.form || {}; src.rasterOnly = !!meta.rasterOnly;
    map[meta.id] = src; sessSaved.add(meta.id);
  }
  if (data.pages.some(p => !map[p.src])) return false;
  replaceDoc(Object.values(map).map(src => ({ src, pages: [] })), data.name, { assets: data.assets, fx: data.fx, meta: data.meta });
  S.pages = data.pages;
  lastSnap = snap();
  buildPages(false);
  fitWidth();
  viewer.scrollTop = 0;
  setDirty(!!data.dirty);
  toast('Je bent verder waar je was met ' + data.name);
  return true;
}

/* ---------- menu ---------- */
function openMenu() {
  const item = (icon, label, sub, fn) => h('button', { class: 'menu-item', html: ico(icon) + '<span>' + label + (sub ? '<small>' + sub + '</small>' : '') + '</span>', onclick: () => { sh.close(); fn(); } });
  const group = (title, items) => h('div', { class: 'menu-group' }, h('h3', { text: title }), h('div', { class: 'menu-list' }, items));
  const night = document.body.classList.contains('night');
  const sh = sheet('Menu', [
    group('Bestand', [
      item('open', 'Open een PDF', 'Komt in een eigen tabblad naast wat al open staat', () => $('#fileOpen').click()),
      item('addfile', "Voeg PDF's of foto's toe", 'Achteraan dit document', () => { addAt = null; $('#fileAdd').click(); }),
      item('camera', 'Foto rechttrekken tot pagina', 'Bon of brief: recht, wit en scherp', openStraighten),
      item('blank', 'Begin met een leeg vel', 'Nieuw document op A4', () => inNewTab(async () => { const src = await blankSource(); replaceDoc([{ src, pages: await pagesOf(src) }], 'Nieuw document.pdf'); scheduleSessionSave(); })),
      item('open', 'Recent geopend', 'Snel terug naar een eerder document', openRecent),
      item('info', 'Open het voorbeeld', 'Om alles uit te proberen', () => inNewTab(async () => { await loadExample(); scheduleSessionSave(); })),
    ]),
    group('Document', [
      item('pages', "Pagina's ordenen", 'Herorden, draai, verwijder, voeg toe', openOrganizer),
      item('hash', 'Paginanummers en koptekst', '', openNumbers),
      item('drop', 'Watermerk', 'Bijvoorbeeld Concept of Vertrouwelijk', openWatermark),
      item('crop', 'Pagina bijsnijden', 'Randen eraf of een deel uitsnijden', openCrop),
      item('field', 'Invulveld toevoegen', 'Maak je eigen invulformulier', openFieldAdd),
      item('link', 'Link toevoegen', 'Naar een website of een pagina', openLinkAdd),
      item('bookmark', 'Bladwijzers en inhoudsopgave', '', openBookmarks),
      item('qr', 'QR-code maken', 'Link, tekst of wifi-toegang', openQr),
      item('compare', 'Vergelijk met een andere versie', 'Zie woord voor woord wat er veranderd is', openCompare),
      canOcr() ? item('search', 'Maak scan doorzoekbaar', 'Tekst herkennen in gescande pagina\'s', openOcr) : null,
      item('shield', 'Persoonsgegevens zwartlakken', 'IBAN, e-mail, telefoon, postcode, BSN', openPrivacy),
      item('info', 'Eigenschappen', 'Naam, titel, auteur, leestijd', openProps),
    ]),
    group('Bekijken', [
      item('note', 'Alles wat je hebt toegevoegd', 'Overzicht van notities, markeringen en meer', openMarks),
      item('search', 'Zoek in alle open documenten', '', openSearchAll),
      IS_TOUCH && isNarrow() ? null : item('compare', BESIDE.el ? 'Sluit het document ernaast' : 'Leg een document ernaast', 'Twee documenten tegelijk in beeld', openBeside),
    ]),
    group('Opslaan en exporteren', [
      item('save', 'Opslaan of opslaan als', 'Kies zelf de map en de naam', openSave),
      inClaude() ? null : item('print', 'Afdrukken', '', openPrint),
      item('shrink', 'Verkleinen', 'Slim of tot onder een aantal MB', openCompress),
      item('scan', 'Maak er een scan van', 'Alsof het geprint en gescand is', openScanLook),
      item('split', 'Splitsen', 'In losse PDF\'s', openSplit),
      item('image', "Pagina's als afbeelding", 'JPG of PNG', openExportImages),
      item('textfile', 'Tekst uit het document', 'Kopiëren of opslaan', openExportText),
    ]),
    group('Van mij', [
      item('stamp', 'Mijn stempels en logo', 'Eigen bedrijfsstempel of logo met één tik', openMyStamps),
      item('blank', 'Briefpapier', 'Je eigen briefpapier achter het document', openLetterhead),
      item('edit', 'Mijn gegevens', 'Naam, adres en meer in een formulier zetten', openMine),
      item('swap', 'Instellingen meenemen', 'Naar je andere apparaat', openTransfer),
    ]),
    group('Hulp', [
      inClaude() ? item('spark', 'Assistent', 'Samenvatten, vragen, kern markeren, scan lezen', openAssistant) : null,
      canSpeak() ? item('speaker', 'Lees voor', 'Vanaf deze pagina, zin voor zin', openReadAloud) : null,
      item('moon', night ? 'Nachtlezen uit' : 'Nachtlezen aan', "Donkere pagina's voor je ogen", () => { document.body.classList.toggle('night'); try { localStorage.setItem('papierwerk.nacht', document.body.classList.contains('night') ? '1' : ''); } catch (e) {} }),
      h('a', { class: 'menu-item', href: inClaude() ? '../omzetter/' : '../omzetter/', html: ico('swap') + '<span>Omzetter<small>Zet bestanden om naar een ander formaat</small></span>' }),
      IS_TOUCH ? null : item('keyboard', 'Sneltoetsen', '', openKeys),
    ]),
  ], null, { wide: true });
}
function openKeys() {
  const rows = [['Ctrl + O', 'Open een PDF'], ['Ctrl + S', 'Opslaan'], ['Ctrl + F', 'Zoeken'], ['Ctrl + Z / Ctrl + Y', 'Ongedaan maken / opnieuw'], ['Ctrl + scrollen', 'Zoomen'], ['V', 'Selecteer'], ['T', 'Tekst'], ['H', 'Markeer'], ['P', 'Teken'], ['N', 'Notitie'], ['E', 'Gum'], ['Delete', 'Verwijder de selectie'], ['Ctrl + D', 'Dupliceer de selectie'], ['Pijltjes', 'Schuif de selectie'], ['Esc', 'Stop of sluit']];
  sheet('Sneltoetsen', [h('dl', { class: 'kv' }, rows.map(r => [h('dt', null, h('kbd', { text: r[0] })), h('dd', { text: r[1] })]))]);
}

/* ---------- bediening ---------- */
function openSearch() { $('#searchbar').hidden = false; const i = $('#searchInput'); i.focus(); i.select(); }
function closeSearch() { $('#searchbar').hidden = true; $('#searchInput').value = ''; runSearch(''); }
function wire() {
  const set = (id, icon) => { $(id).innerHTML = ico(icon) + $(id).innerHTML; };
  set('#btnMenu', 'menu'); set('#btnZoomOut', 'minus'); set('#btnZoomIn', 'plus'); set('#btnUndo', 'undo'); set('#btnRedo', 'redo');
  set('#btnSearch', 'search'); set('#btnPages', 'pages'); set('#btnSave', 'save'); set('#btnPrevHit', 'up'); set('#btnNextHit', 'down'); set('#btnCloseSearch', 'close');
  $('#btnMenu').onclick = openMenu;
  $('#btnZoomOut').onclick = () => setScale(S.scale / 1.2);
  $('#btnZoomIn').onclick = () => setScale(S.scale * 1.2);
  $('#zoomPct').onclick = fitWidth;
  $('#btnUndo').onclick = undo; $('#btnRedo').onclick = redo;
  $('#btnSearch').onclick = () => ($('#searchbar').hidden ? openSearch() : closeSearch());
  $('#btnPages').onclick = openOrganizer;
  $('#btnSave').onclick = openSave;
  $('#docName').onclick = openProps;
  $('#pill').onclick = openGoTo;
  $('#btnBannerOpen').onclick = () => $('#fileOpen').click();
  $('#btnPrevHit').onclick = () => stepHit(-1); $('#btnNextHit').onclick = () => stepHit(1); $('#btnCloseSearch').onclick = closeSearch;
  let st = 0;
  $('#searchInput').addEventListener('input', e => { clearTimeout(st); const v = e.target.value; st = setTimeout(() => runSearch(v), 220); });
  $('#searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); stepHit(e.shiftKey ? -1 : 1); } });
  $('#fileOpen').addEventListener('change', e => { const f = Array.from(e.target.files); e.target.value = ''; openDoc(f); });
  $('#fileAdd').addEventListener('change', e => { const f = Array.from(e.target.files); e.target.value = ''; addFiles(f, addAt); addAt = null; });

  // slepen van bestanden
  const stop = e => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); return true; } return false; };
  document.addEventListener('dragover', stop);
  document.addEventListener('drop', async e => {
    if (!stop(e)) return;
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;
    if (S.isExample) { openDoc(files); return; }
    const c = await choose('Bestand gesleept', 'Wat wil je doen met ' + (files.length === 1 ? '“' + files[0].name + '”' : files.length + ' bestanden') + '?', [
      { label: 'Voeg toe aan dit document', value: 'add' }, { label: 'Open als nieuw document', value: 'open', primary: true }]);
    if (c === 'add') addFiles(files, ORG.open ? orgInsertIndex() : null); else if (c === 'open') openDoc(files);
  });

  // zoomen: Ctrl + wiel, en knijpen met twee vingers
  viewer.addEventListener('wheel', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const vr = viewer.getBoundingClientRect();
    setScale(S.scale * Math.exp(-e.deltaY * 0.0022), e.clientX - vr.left, e.clientY - vr.top);
  }, { passive: false });
  let pinch = null;
  const mid = t => [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2, Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)];
  viewer.addEventListener('touchstart', e => {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    cancelDrag();
    const [mx, my, d] = mid(e.touches), pr = pagesEl.getBoundingClientRect();
    pinch = { d0: d || 1, s0: S.scale, k: 1, mx, my };
    pagesEl.style.transformOrigin = (mx - pr.left) + 'px ' + (my - pr.top) + 'px';
  }, { passive: false });
  viewer.addEventListener('touchmove', e => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const [mx, my, d] = mid(e.touches);
    pinch.k = clamp(d / pinch.d0, 0.2 / pinch.s0, 6 / pinch.s0);
    viewer.scrollLeft -= mx - pinch.mx; viewer.scrollTop -= my - pinch.my;
    pinch.mx = mx; pinch.my = my;
    pagesEl.style.transform = 'scale(' + pinch.k + ')';
  }, { passive: false });
  const endPinch = e => {
    if (!pinch || e.touches.length >= 2) return;
    const p = pinch; pinch = null;
    pagesEl.style.transform = ''; pagesEl.style.transformOrigin = '';
    const vr = viewer.getBoundingClientRect();
    if (Math.abs(p.k - 1) > 0.02) setScale(p.s0 * p.k, p.mx - vr.left, p.my - vr.top);
  };
  viewer.addEventListener('touchend', endPinch); viewer.addEventListener('touchcancel', endPinch);

  // toetsenbord
  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase(), typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    const mod = e.ctrlKey || e.metaKey, key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === 'Escape') {
      if (openSheets.length) { openSheets[openSheets.length - 1].close(); return; }
      if (ORG.open) { closeOrganizer(); return; }
      if (!$('#searchbar').hidden && e.target === $('#searchInput')) { closeSearch(); return; }
      if (typing) return;
      if (S.sel) setSel(null); else if (S.tool !== 'select') setTool('select');
      return;
    }
    if (mod && key === 's') { e.preventDefault(); if (!openSheets.length) openSave(); return; }
    if (mod && key === 'o') { e.preventDefault(); $('#fileOpen').click(); return; }
    if (mod && key === 'f') { e.preventDefault(); openSearch(); return; }
    if (typing || openSheets.length) return;
    if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && key === 'y') { e.preventDefault(); redo(); return; }
    if (mod && key === 'd') { e.preventDefault(); dupSel(); return; }
    if (mod && (key === '=' || key === '+')) { e.preventDefault(); setScale(S.scale * 1.2); return; }
    if (mod && key === '-') { e.preventDefault(); setScale(S.scale / 1.2); return; }
    if (mod && key === '0') { e.preventDefault(); fitWidth(); return; }
    if (mod || ORG.open) return;
    if (key === 'Delete' || key === 'Backspace') { if (S.sel) { e.preventDefault(); delSel(); } return; }
    if (S.sel && key.startsWith('Arrow')) {
      const f = findAnnot(S.sel), st2 = e.shiftKey ? 10 : 1;
      const dx = key === 'ArrowLeft' ? -st2 : key === 'ArrowRight' ? st2 : 0, dy = key === 'ArrowUp' ? -st2 : key === 'ArrowDown' ? st2 : 0;
      if (f) { e.preventDefault(); moveAnnot(f.a, clone(f.a), dx, dy, f.p); drawAnnots(f.p); commit(); }
      return;
    }
    const tools = { v: 'select', t: 'text', h: 'hl', p: 'ink', n: 'note', e: 'eraser' };
    if (tools[key]) setTool(tools[key]);
  });
  let wasNarrow = isNarrow();
  window.addEventListener('resize', () => { if (isNarrow() !== wasNarrow) { wasNarrow = isNarrow(); renderSidebar(); } updatePill(); });
}

/* ---------- start ---------- */
async function boot() {
  pdfjsLib.GlobalWorkerOptions.workerSrc = window.PDF_WORKER_URL || 'lib/pdf.worker.min.js';
  try { if (localStorage.getItem('papierwerk.nacht')) document.body.classList.add('night'); } catch (e) {}
  wire();
  renderDock();
  updateUndoUI();
  getCap('downloads').then(v => { if (v) DL = v; });
  try {
    await initFonts();
    let ok = false;
    try { ok = await restoreSession(); } catch (e) { ok = false; }
    if (!ok) await loadExample();
    window.__gestart = true;
    if (window.PWA) {                      // als losse app: bestanden die gedeeld of ermee geopend zijn
      const shared = await window.PWA.takeShared();
      if (shared.length) openDoc(shared);
      window.PWA.onLaunch(files => openDoc(files));
    }
  } catch (e) {
    console.error(e);
    toast('Papierwerk kon niet starten: ' + (e && e.message ? e.message : 'onbekende fout') + '. Herlaad de pagina.', true);
  }
}
boot();
