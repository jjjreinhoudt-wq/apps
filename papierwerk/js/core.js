'use strict';
/* Papierwerk — kern: hulpfuncties, model, weergave van pagina's, zoeken, invulvelden */

const $ = (q, r = document) => r.querySelector(q);
const $$ = (q, r = document) => Array.from(r.querySelectorAll(q));
const SVGNS = 'http://www.w3.org/2000/svg';
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const tick = () => new Promise(r => setTimeout(r, 0));
const IS_TOUCH = matchMedia('(pointer: coarse)').matches;
const isNarrow = () => matchMedia('(max-width: 719px)').matches;

function setAttrs(e, attrs) {
  if (!attrs) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'html') e.innerHTML = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
}
function addKids(e, kids) {
  for (const k of kids.flat(3)) { if (k == null || k === false) continue; e.append(k.nodeType ? k : document.createTextNode(String(k))); }
}
function h(tag, attrs, ...kids) { const e = document.createElement(tag); setAttrs(e, attrs); addKids(e, kids); return e; }
function sv(tag, attrs, ...kids) { const e = document.createElementNS(SVGNS, tag); setAttrs(e, attrs); addKids(e, kids); return e; }

/* ---------- pictogrammen (eigen lijntekeningen, 24x24) ---------- */
const ICONS = {
  menu: 'M4 7h16M4 12h16M4 17h16',
  cursor: 'M5 3l14 8-6 2-2 6z',
  text: 'M5 7V4h14v3M12 4v16M9 20h6',
  edittext: 'M3 7V5h10v2M8 5v12M6 17h4M14 19l6-6 2 2-6 6h-2z',
  highlight: 'M9 14l8-9 3 3-9 8zM9 14l-3 3 2 2 3-3M4 21h8',
  pen: 'M4 20l1-5L16 4l4 4L9 19zM14 6l4 4',
  shapes: 'M3 4h11v11H3zM21 15.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z',
  note: 'M5 4h14v11l-5 5H5zM14 20v-5h5',
  sign: 'M3 16c3-9 5-10 6-6s1 6 3 3 3-5 4-2 2 3 5 1M3 21h18',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9.5 9.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z',
  stamp: 'M9 4h6v5l2 4H7l2-4zM5 13h14v4H5zM5 20h14',
  check: 'M5 12.5l4.5 4.5L19 7',
  cover: 'M4 5h10M4 19h13M3 9.5h18v5H3z',
  eraser: 'M9 20l-5-5L14 5l6 6-9 9zM9.5 9.5l5 5M9 20h11',
  undo: 'M8 6L4 10l4 4M4 10h10a5 5 0 0 1 0 10h-3',
  redo: 'M16 6l4 4-4 4M20 10H10a5 5 0 0 0 0 10h3',
  search: 'M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0zM15.5 15.5L20 20',
  pages: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  save: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  left: 'M15 6l-6 6 6 6',
  right: 'M9 6l6 6-6 6',
  rotl: 'M4 5v5h5M4.6 10A8 8 0 1 1 6 17.5',
  rotr: 'M20 5v5h-5M19.4 10A8 8 0 1 0 18 17.5',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6',
  copy: 'M8 8h11v12H8zM5 16V4h11',
  open: 'M3 7V5h7l2 2h9v12H3z',
  addfile: 'M6 3h8l4 4v14H6zM14 3v4h4M12 11v6M9 14h6',
  blank: 'M6 3h8l4 4v14H6zM14 3v4h4',
  hash: 'M9 4L7 20M17 4l-2 16M4 9h16M4 15h16',
  drop: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z',
  shrink: 'M4 14h6v6M20 10h-6V4M14 10l6-6M10 14l-6 6',
  split: 'M8 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM8 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM7.5 9.5L20 18M7.5 14.5L20 6',
  info: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM12 11v6M12 7.5v.5',
  spark: 'M11 3l1.9 5.6L18.5 10.5l-5.6 1.9L11 18l-1.9-5.6L3.5 10.5l5.6-1.9zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  textfile: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
  front: 'M12 19V5M6 11l6-6 6 6',
  edit: 'M4 20l1-5L16 4l4 4L9 19zM14 6l4 4',
  swap: 'M4 8h13l-3-3M20 16H7l3 3',
  keyboard: 'M3 6h18v12H3zM7 10h.5M11 10h.5M15 10h.5M7 14h10',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  scan: 'M4 8V5h3M20 8V5h-3M4 16v3h3M20 16v3h-3M3 12h18',
  shield: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6zM9 12l2 2 4-4',
};
function ico(name) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (ICONS[name] || '') + '"/></svg>';
}

/* ---------- meldingen, voortgang, vellen ---------- */
function toast(msg, isErr) {
  const t = h('div', { class: 'toast' + (isErr ? ' is-error' : ''), text: msg });
  $('#toasts').append(t);
  setTimeout(() => t.remove(), isErr ? 6500 : 3200);
}
let busyEl = null;
function busy(text, frac) {
  if (!busyEl) {
    busyEl = h('div', { class: 'busy' }, h('div', { class: 'busy-card' }, h('div', { class: 'busy-t' }), h('div', { class: 'bar' }, h('i'))));
    document.body.append(busyEl);
  }
  $('.busy-t', busyEl).textContent = text;
  $('i', busyEl).style.width = (frac == null ? 100 : Math.round(clamp(frac, 0, 1) * 100)) + '%';
}
function busyOff() { if (busyEl) { busyEl.remove(); busyEl = null; } }

const openSheets = [];
function sheet(title, body, foot, opts) {
  opts = opts || {};
  const scrim = h('div', { class: 'scrim' });
  const api = {
    el: null,
    close() { if (!scrim.isConnected) return; scrim.remove(); const i = openSheets.indexOf(api); if (i >= 0) openSheets.splice(i, 1); if (opts.onClose) opts.onClose(); },
  };
  const s = h('div', { class: 'sheet', role: 'dialog', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h2', { text: title }), h('button', { class: 'icon-btn', 'aria-label': 'Sluiten', html: ico('close'), onclick: () => api.close() })),
    h('div', { class: 'sheet-body' }, body),
    foot && foot.length ? h('div', { class: 'sheet-foot' }, foot) : null);
  if (opts.wide) s.style.width = 'min(780px, 100%)';
  api.el = s;
  scrim.append(s);
  scrim.addEventListener('pointerdown', e => { if (e.target === scrim) api.close(); });
  document.body.append(scrim);
  openSheets.push(api);
  return api;
}
/* Keuzevraag in plaats van confirm(): geeft de gekozen waarde, of null bij sluiten. */
function choose(title, text, options) {
  return new Promise(resolve => {
    let done = false;
    const fin = v => { if (done) return; done = true; resolve(v); sh.close(); };
    const sh = sheet(title, [h('p', { text })],
      options.map(o => h('button', { class: 'btn' + (o.primary ? ' btn-primary' : '') + (o.danger ? ' btn-danger' : ''), text: o.label, onclick: () => fin(o.value) })),
      { onClose: () => { if (!done) { done = true; resolve(null); } } });
  });
}
function askPassword(name, wrong) {
  return new Promise(resolve => {
    let done = false;
    const inp = h('input', { class: 'input', type: 'password', id: 'pwInput', autocomplete: 'off' });
    const fin = v => { if (done) return; done = true; resolve(v); sh.close(); };
    const sh = sheet('Wachtwoord nodig', [
      h('p', { text: (wrong ? 'Dat wachtwoord klopt niet. ' : '') + '“' + name + '” is beveiligd. Vul het wachtwoord in om het te openen.' }),
      h('div', { class: 'field' }, h('label', { for: 'pwInput', text: 'Wachtwoord' }), inp)],
      [h('button', { class: 'btn', text: 'Annuleer', onclick: () => fin(null) }), h('button', { class: 'btn btn-primary', text: 'Open', onclick: () => fin(inp.value) })],
      { onClose: () => { if (!done) { done = true; resolve(null); } } });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') fin(inp.value); });
    setTimeout(() => inp.focus(), 50);
  });
}
function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' kB';
  return (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
}

/* ---------- model ---------- */
const S = {
  name: 'document.pdf',
  sources: {},      // id -> { id, name, bytes, pdf, form, rasterOnly, pageCache, textCache, annCache }
  pages: [],        // { id, src, idx, rot, bw, bh, annots: [] }
  assets: {},       // id -> { url, w, h }
  fx: { wm: null, num: null, head: null },
  meta: null,
  tool: 'select', sel: null, scale: 1,
  dirty: false, isExample: false,
  hist: [], fut: [],
  style: {
    text: { c: '#17202B', fs: 12, font: 'helv', bold: false },
    hl: { c: '#FFE14A', mode: 'mark' },
    ink: { c: '#1F4FD1', w: 2, marker: false },
    shape: { kind: 'rect', c: '#D7263D', w: 2, fill: false },
    note: { c: '#FFD84A' },
    stamp: { label: 'Goedgekeurd', c: '#1B7446' },
    sym: { kind: 'check', c: '#17202B' },
    cover: { kind: 'white', c: '#FFFFFF' },
  },
};
const RT = new Map();   // pagina-id -> { el, svg, canvas, tok, task, rs, vis }
const viewW = p => (p.rot % 180 ? p.bh : p.bw);
const viewH = p => (p.rot % 180 ? p.bw : p.bh);
const pageById = id => S.pages.find(p => p.id === id);

async function openPdfJs(bytes, name, keep) {
  let pw;
  for (;;) {
    try {
      const doc = await pdfjsLib.getDocument({ data: bytes.slice(), password: pw, isEvalSupported: false }).promise;
      if (keep) keep.password = pw || '';
      return doc;
    } catch (e) {
      if (e && e.name === 'PasswordException') {
        const wasBusy = !!busyEl;
        busyOff();
        pw = await askPassword(name, e.code === 2);
        if (pw == null) throw new Error('cancel');
        if (wasBusy) busy('Openen');
      } else throw e;
    }
  }
}
async function makeSource(bytes, name) {
  const src = { id: uid(), name, bytes, form: {}, rasterOnly: false, hasForm: false, pageCache: new Map(), textCache: new Map(), annCache: new Map() };
  src.pdf = await openPdfJs(bytes, name, src);
  try { src.hasForm = !!(await src.pdf.getFieldObjects()); } catch (e) {}
  return src;
}
function getPg(src, i) {
  let p = src.pageCache.get(i);
  if (!p) { p = src.pdf.getPage(i + 1); src.pageCache.set(i, p); }
  return p;
}
function getText(src, i) {
  let t = src.textCache.get(i);
  if (!t) { t = getPg(src, i).then(pg => pg.getTextContent()); src.textCache.set(i, t); }
  return t;
}
function getAnns(src, i) {
  let t = src.annCache.get(i);
  if (!t) { t = getPg(src, i).then(pg => pg.getAnnotations()).catch(() => []); src.annCache.set(i, t); }
  return t;
}
async function pagesOf(src) {
  const out = [];
  for (let i = 0; i < src.pdf.numPages; i++) {
    const pg = await getPg(src, i);
    const vp = pg.getViewport({ scale: 1 });
    out.push({ id: uid(), src: src.id, idx: i, rot: 0, bw: vp.width, bh: vp.height, annots: [] });
  }
  return out;
}

/* ---------- geschiedenis ---------- */
let lastSnap = null;
const snap = () => JSON.stringify({ pages: S.pages, fx: S.fx });
function setDirty(v) {
  S.dirty = v !== false;
  document.title = (S.dirty ? '• ' : '') + 'Papierwerk PDF';
}
function commit() {
  S.hist.push(lastSnap);
  if (S.hist.length > 80) S.hist.shift();
  S.fut.length = 0;
  lastSnap = snap();
  setDirty();
  updateUndoUI();
  if (typeof scheduleSessionSave === 'function') scheduleSessionSave();
}
function restoreSnap(json) {
  const o = JSON.parse(json);
  S.pages = o.pages; S.fx = o.fx; S.sel = null;
  if (typeof endTextEdit === 'function') endTextEdit(true);
  buildPages(true);
  if (typeof updateStrip === 'function') updateStrip();
  if (typeof orgRefresh === 'function') orgRefresh();
  setDirty(); updateUndoUI();
  if (typeof scheduleSessionSave === 'function') scheduleSessionSave();
}
function undo() { if (!S.hist.length) return; S.fut.push(lastSnap); lastSnap = S.hist.pop(); restoreSnap(lastSnap); }
function redo() { if (!S.fut.length) return; S.hist.push(lastSnap); lastSnap = S.fut.pop(); restoreSnap(lastSnap); }
function updateUndoUI() {
  $('#btnUndo').disabled = !S.hist.length;
  $('#btnRedo').disabled = !S.fut.length;
}

/* ---------- pagina's tonen ---------- */
const viewer = $('#viewer');
const pagesEl = $('#pages');
let io = null;
let renderQ = Promise.resolve();
const lru = [];

function buildPages(keepScroll) {
  const st = viewer.scrollTop, sl = viewer.scrollLeft;
  for (const rt of RT.values()) { if (rt.task) { try { rt.task.cancel(); } catch (e) {} } }
  RT.clear(); lru.length = 0;
  pagesEl.textContent = '';
  if (io) io.disconnect();
  io = new IntersectionObserver(onVisible, { root: viewer, rootMargin: '500px 0px' });
  for (const p of S.pages) {
    const el = h('div', { class: 'page', 'data-id': p.id, style: { width: viewW(p) * S.scale + 'px', height: viewH(p) * S.scale + 'px' } },
      h('div', { class: 'textLayer' }), h('div', { class: 'formLayer' }));
    const svg = sv('svg', { class: 'annots', viewBox: '0 0 ' + viewW(p) + ' ' + viewH(p), preserveAspectRatio: 'none' });
    el.append(svg);
    RT.set(p.id, { el, svg, canvas: null, tok: 0, task: null, rs: 0, vis: false });
    pagesEl.append(el);
    io.observe(el);
    if (typeof drawAnnots === 'function') drawAnnots(p);
  }
  if (keepScroll) { viewer.scrollTop = st; viewer.scrollLeft = sl; }
  renderSidebar();
  updatePill();
}
function onVisible(entries) {
  for (const en of entries) {
    const rt = RT.get(en.target.dataset.id);
    if (!rt) continue;
    rt.vis = en.isIntersecting;
    if (rt.vis && rt.rs !== S.scale) queueRender(en.target.dataset.id);
  }
}
function queueRender(id) {
  renderQ = renderQ.then(() => renderPage(id)).catch(e => console.warn('render', e));
}
function rerenderVisible() {
  for (const [id, rt] of RT) if (rt.vis && rt.rs !== S.scale) queueRender(id);
}
async function renderPage(id) {
  const p = pageById(id), rt = RT.get(id);
  if (!p || !rt || !rt.vis || rt.rs === S.scale) return;
  const src = S.sources[p.src];
  const pg = await getPg(src, p.idx);
  const rot = (pg.rotate + p.rot) % 360;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  let k = S.scale * dpr;
  const area = viewW(p) * viewH(p), maxPx = IS_TOUCH ? 5.5e6 : 1.4e7;
  if (area * k * k > maxPx) k = Math.sqrt(maxPx / area);
  const vp = pg.getViewport({ scale: k, rotation: rot });
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height));
  const scaleAt = S.scale, tok = ++rt.tok;
  if (rt.task) { try { rt.task.cancel(); } catch (e) {} }
  const task = pg.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp });
  rt.task = task;
  try { await task.promise; } catch (e) { return; }
  if (RT.get(id) !== rt || tok !== rt.tok) return;
  if (rt.canvas) rt.canvas.remove();
  rt.el.prepend(c); rt.canvas = c; rt.rs = scaleAt; rt.task = null;
  // geheugen sparen: oudste onzichtbare pagina's loslaten
  const li = lru.indexOf(id); if (li >= 0) lru.splice(li, 1); lru.push(id);
  const cap = IS_TOUCH ? 6 : 14;
  for (let i = 0; lru.length > cap && i < lru.length;) {
    const o = RT.get(lru[i]);
    if (o && !o.vis) { if (o.canvas) { o.canvas.width = o.canvas.height = 0; o.canvas.remove(); o.canvas = null; } o.rs = 0; lru.splice(i, 1); } else i++;
  }
  await buildTextLayer(p, src, pg, rot, rt, scaleAt);
  await buildFormLayer(p, src, pg, rot, rt, scaleAt);
}
async function buildTextLayer(p, src, pg, rot, rt, sc) {
  const tl = $('.textLayer', rt.el);
  tl.textContent = '';
  try {
    const tc = await getText(src, p.idx);
    if (RT.get(p.id) !== rt) return;
    const vp = pg.getViewport({ scale: sc, rotation: rot });
    rt.el.style.setProperty('--scale-factor', sc);
    await pdfjsLib.renderTextLayer({ textContentSource: tc, container: tl, viewport: vp }).promise;
  } catch (e) { /* tekstlaag is een extra; de pagina blijft bruikbaar */ }
}

/* ---------- invulvelden van formulieren ---------- */
async function buildFormLayer(p, src, pg, rot, rt, sc) {
  const fl = $('.formLayer', rt.el);
  fl.textContent = '';
  const anns = await getAnns(src, p.idx);
  if (RT.get(p.id) !== rt) return;
  const ws = anns.filter(a => a.subtype === 'Widget' && a.fieldName && !a.hidden);
  if (!ws.length) return;
  const vp = pg.getViewport({ scale: sc, rotation: rot });
  for (const w of ws) {
    const r = vp.convertToViewportRectangle(w.rect);
    const x = Math.min(r[0], r[2]), y = Math.min(r[1], r[3]), ww = Math.abs(r[2] - r[0]), hh = Math.abs(r[3] - r[1]);
    const name = w.fieldName, has = name in src.form, cur = has ? src.form[name] : w.fieldValue;
    let el;
    if (w.fieldType === 'Tx') {
      el = w.multiLine ? h('textarea') : h('input', { type: 'text' });
      el.value = cur == null ? '' : String(cur);
      el.style.fontSize = (w.multiLine ? clamp(11 * sc, 9, 22) : clamp(hh * 0.62, 8, 15 * sc)) + 'px';
      if (w.maxLen) el.maxLength = w.maxLen;
      el.addEventListener('input', () => { src.form[name] = el.value; el.classList.add('on'); formChanged(src); });
    } else if (w.fieldType === 'Btn' && w.checkBox) {
      const on = w.exportValue || 'Yes';
      el = h('input', { type: 'checkbox', class: 'cb' });
      el.checked = has ? (cur && cur !== 'Off') : (cur === on);
      el.addEventListener('change', () => { src.form[name] = el.checked ? on : 'Off'; el.classList.add('on'); formChanged(src); });
    } else if (w.fieldType === 'Btn' && w.radioButton) {
      const gname = 'f_' + src.id + '_' + name;
      el = h('input', { type: 'radio', class: 'cb rb', name: gname });
      el.checked = cur === w.buttonValue;
      el.addEventListener('change', () => {
        src.form[name] = w.buttonValue;
        $$('input[type="radio"]').forEach(rb => { if (rb.name === gname) rb.classList.add('on'); });
        formChanged(src);
      });
    } else if (w.fieldType === 'Ch' && Array.isArray(w.options) && w.options.length) {
      el = h('select', null, h('option', { value: '', text: '' }), w.options.map(o => h('option', { value: o.displayValue, text: o.displayValue })));
      const cv = Array.isArray(cur) ? cur[0] : cur;
      const hit = w.options.find(o => o.exportValue === cv || o.displayValue === cv);
      el.value = hit ? hit.displayValue : '';
      el.style.fontSize = clamp(hh * 0.6, 8, 15 * sc) + 'px';
      el.addEventListener('change', () => { src.form[name] = el.value; el.classList.add('on'); formChanged(src); });
    } else continue;
    src.hasForm = true;
    el.classList.add('ff');
    if (has) el.classList.add('on');
    if (w.readOnly) el.disabled = true;
    el.setAttribute('aria-label', w.alternativeText || name);
    Object.assign(el.style, { left: x + 'px', top: y + 'px', width: ww + 'px', height: hh + 'px' });
    fl.append(el);
  }
}
function formChanged() {
  setDirty();
  if (typeof scheduleSessionSave === 'function') scheduleSessionSave();
}

/* ---------- zoom ---------- */
let zoomTimer = 0;
function setScale(ns, ax, ay) {
  ns = clamp(ns, 0.2, 6);
  const r = ns / S.scale;
  const vr = viewer.getBoundingClientRect();
  if (ax == null) ax = vr.width / 2;
  if (ay == null) ay = Math.min(vr.height / 2, 200);
  const sl = viewer.scrollLeft, st = viewer.scrollTop;
  S.scale = ns;
  for (const p of S.pages) {
    const rt = RT.get(p.id);
    if (!rt) continue;
    rt.el.style.width = viewW(p) * ns + 'px';
    rt.el.style.height = viewH(p) * ns + 'px';
  }
  viewer.scrollLeft = (sl + ax) * r - ax;
  viewer.scrollTop = (st + ay) * r - ay;
  $('#zoomPct').textContent = Math.round(ns / (96 / 72) * 100) + '%';
  if (typeof onScaleChanged === 'function') onScaleChanged();
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(rerenderVisible, 170);
}
function fitWidth() {
  const p = S.pages[curIndex()] || S.pages[0];
  if (!p) return;
  const w = viewer.clientWidth - (isNarrow() ? 20 : 60);
  setScale(clamp(w / viewW(p), 0.2, isNarrow() ? 4 : 1.4));
}

/* ---------- huidige pagina, navigatie ---------- */
function curIndex() {
  if (!S.pages.length) return 0;
  const vr = viewer.getBoundingClientRect();
  const mid = vr.top + vr.height * 0.4;
  let best = 0, bd = Infinity;
  for (let i = 0; i < S.pages.length; i++) {
    const rt = RT.get(S.pages[i].id);
    if (!rt) continue;
    const r = rt.el.getBoundingClientRect();
    const d = mid < r.top ? r.top - mid : mid > r.bottom ? mid - r.bottom : 0;
    if (d < bd) { bd = d; best = i; if (d === 0) break; }
  }
  return best;
}
function goToPage(i, yFrac) {
  const p = S.pages[clamp(i, 0, S.pages.length - 1)];
  if (!p) return;
  const rt = RT.get(p.id);
  const off = rt.el.offsetTop + (yFrac ? yFrac * rt.el.offsetHeight - viewer.clientHeight * 0.35 : -10);
  viewer.scrollTop = Math.max(0, off);
}
let pillRaf = 0;
function updatePill() {
  cancelAnimationFrame(pillRaf);
  pillRaf = requestAnimationFrame(() => {
    const i = curIndex();
    $('#pill').textContent = (S.pages.length ? i + 1 : 0) + ' / ' + S.pages.length;
    $$('#thumbs .thumb').forEach((t, k) => t.setAttribute('aria-current', k === i ? 'true' : 'false'));
  });
}
viewer.addEventListener('scroll', updatePill, { passive: true });

/* ---------- miniaturen ---------- */
const thumbCache = new Map();
let thumbQ = Promise.resolve();
const thumbKey = p => p.src + ':' + p.idx + ':' + p.rot;
function getThumb(p) {
  const k = thumbKey(p);
  if (!thumbCache.has(k)) {
    const job = thumbQ.then(() => makeThumb(p)).catch(() => null);
    thumbQ = job;
    thumbCache.set(k, job);
  }
  return thumbCache.get(k);
}
async function makeThumb(p) {
  const src = S.sources[p.src];
  if (!src) return null;
  const pg = await getPg(src, p.idx);
  const rot = (pg.rotate + p.rot) % 360;
  const vp = pg.getViewport({ scale: 220 / Math.max(viewW(p), viewH(p)), rotation: rot });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  await pg.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp }).promise;
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
  c.width = c.height = 0;
  return blob ? URL.createObjectURL(blob) : null;
}
function clearThumbs() {
  for (const pr of thumbCache.values()) pr.then(u => { if (u) URL.revokeObjectURL(u); });
  thumbCache.clear();
}
const thumbIO = new IntersectionObserver(entries => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    const el = en.target;
    thumbIO.unobserve(el);
    const p = pageById(el.dataset.pid);
    if (!p) continue;
    getThumb(p).then(url => {
      if (!url || !el.isConnected) return;
      const img = h('img', { src: url, alt: '', draggable: 'false' });
      el.replaceWith(img);
    });
  }
}, { rootMargin: '300px' });
function thumbHolder(p) {
  const ph = h('div', { class: 'ph', 'data-pid': p.id, style: { aspectRatio: viewW(p) + ' / ' + viewH(p) } });
  thumbIO.observe(ph);
  return ph;
}
function renderSidebar() {
  const box = $('#thumbs');
  box.textContent = '';
  if (isNarrow()) return;
  S.pages.forEach((p, i) => {
    box.append(h('button', { class: 'thumb', title: 'Ga naar pagina ' + (i + 1), onclick: () => goToPage(i) }, thumbHolder(p), h('span', { text: i + 1 })));
  });
}

/* ---------- zoeken ---------- */
const Q = { q: '', hits: [], cur: -1, tok: 0 };
function itemPoly(vp, it, i0, n) {
  const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
  const ang = Math.atan2(tx[1], tx[0]);
  const fh = Math.hypot(tx[2], tx[3]) || 10;
  const w = it.width * vp.scale, len = it.str.length || 1;
  const dx = Math.cos(ang), dy = Math.sin(ang), ux = dy, uy = -dx;
  const a0 = w * i0 / len, a1 = w * (i0 + n) / len, lo = -0.25 * fh, hi = 0.85 * fh;
  const P = (a, b) => [tx[4] + dx * a + ux * b, tx[5] + dy * a + uy * b];
  return [P(a0, lo), P(a1, lo), P(a1, hi), P(a0, hi)];
}
async function textIndex(p) {
  const tc = await getText(S.sources[p.src], p.idx);
  if (!tc._ix) {
    let s = ''; const map = [];
    for (const it of tc.items) {
      if (it.str) { map.push({ it, at: s.length }); s += it.str; }
      if (it.hasEOL && s && !/\s$/.test(s)) s += ' ';
    }
    tc._ix = { s: s.toLowerCase(), raw: s, map };
  }
  return tc._ix;
}
/* Zoekt een stuk tekst op een pagina, ook als het over meerdere tekstblokjes loopt. */
async function findInPage(p, lq) {
  const ix = await textIndex(p), out = [];
  if (!lq) return out;
  const pg = await getPg(S.sources[p.src], p.idx);
  const vp = pg.getViewport({ scale: 1, rotation: (pg.rotate + p.rot) % 360 });
  let from = 0, k;
  while ((k = ix.s.indexOf(lq, from)) >= 0) {
    const end = k + lq.length, polys = [];
    for (const m of ix.map) {
      const a = m.at, b = m.at + m.it.str.length;
      if (b <= k) continue;
      if (a >= end) break;
      const lo = Math.max(k, a), n = Math.min(end, b) - lo;
      if (n > 0) polys.push(itemPoly(vp, m.it, lo - a, n));
    }
    if (polys.length) out.push(polys);
    from = end;
  }
  return out;
}
async function runSearch(q) {
  const tok = ++Q.tok;
  Q.q = q; Q.hits = []; Q.cur = -1;
  const lq = q.trim().toLowerCase();
  if (lq) {
    const hits = [];
    for (let pi = 0; pi < S.pages.length; pi++) {
      const p = S.pages[pi];
      const found = await findInPage(p, lq);
      if (tok !== Q.tok) return;
      for (const polys of found) hits.push({ page: p.id, pi, polys });
    }
    Q.hits = hits;
    if (hits.length) {
      const ci = curIndex();
      Q.cur = Math.max(0, hits.findIndex(hh => hh.pi >= ci));
    }
  }
  showHits(true);
}
function showHits(jump) {
  $('#searchCount').textContent = Q.q.trim() ? (Q.hits.length ? (Q.cur + 1) + ' van ' + Q.hits.length : 'Niets gevonden') : '';
  for (const p of S.pages) if (typeof drawAnnots === 'function') drawAnnots(p);
  if (jump && Q.cur >= 0) {
    const hh = Q.hits[Q.cur], p = pageById(hh.page);
    if (p) goToPage(S.pages.indexOf(p), hh.polys[0][0][1] / viewH(p));
  }
}
function stepHit(d) {
  if (!Q.hits.length) return;
  Q.cur = (Q.cur + d + Q.hits.length) % Q.hits.length;
  showHits(true);
}
