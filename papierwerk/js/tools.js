'use strict';
/* Papierwerk — aantekeningen: tekenen op het scherm, selecteren, gereedschap, handtekening */

/* ---------- lettertypen (maten komen uit pdf-lib, zodat scherm en PDF gelijk lopen) ---------- */
const FONTS = {};
async function initFonts() {
  const d = await PDFLib.PDFDocument.create(), SF = PDFLib.StandardFonts;
  const def = {
    helv: [SF.Helvetica, 'Helvetica, Arial, sans-serif', 400], helvB: [SF.HelveticaBold, 'Helvetica, Arial, sans-serif', 700],
    times: [SF.TimesRoman, '"Times New Roman", Times, serif', 400], timesB: [SF.TimesRomanBold, '"Times New Roman", Times, serif', 700],
    cour: [SF.Courier, '"Courier New", Courier, monospace', 400], courB: [SF.CourierBold, '"Courier New", Courier, monospace', 700],
  };
  for (const k in def) FONTS[k] = { std: def[k][0], css: def[k][1], weight: def[k][2], f: d.embedStandardFont(def[k][0]) };
}
const fontKey = a => (a.font || 'helv') + (a.bold ? 'B' : '');
const encOk = new Map();
/* Standaard-PDF-letters kennen alleen West-Europese tekens; de rest wordt een vraagteken. */
function safeText(str) {
  let out = '';
  for (const ch of String(str)) {
    if (ch === '\n') { out += ch; continue; }
    if (ch === '\t') { out += '    '; continue; }
    if (ch === '\r') continue;
    let ok = encOk.get(ch);
    if (ok === undefined) { try { FONTS.helv.f.encodeText(ch); ok = true; } catch (e) { ok = false; } encOk.set(ch, ok); }
    out += ok ? ch : '?';
  }
  return out;
}
const widthOf = (s, key, size) => (s ? FONTS[key].f.widthOfTextAtSize(s, size) : 0);

/* ---------- meetkunde ---------- */
function L2V(a, lx, ly) { const r = (a.rot || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [a.cx + lx * c - ly * s, a.cy + lx * s + ly * c]; }
function V2L(a, x, y) { const r = (a.rot || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), dx = x - a.cx, dy = y - a.cy; return [dx * c + dy * s, -dx * s + dy * c]; }
const r2 = v => Math.round(v * 100) / 100;
const clone = o => JSON.parse(JSON.stringify(o));
const isBox = a => !['ink', 'line', 'arrow', 'note'].includes(a.t);

function boxSegs(a) {
  const w = a.w / 2, hh = a.h / 2;
  return [['M', ...L2V(a, -w, -hh)], ['L', ...L2V(a, w, -hh)], ['L', ...L2V(a, w, hh)], ['L', ...L2V(a, -w, hh)], ['Z']];
}
function ellipseSegs(a, rx, ry) {
  const k = 0.5523, P = (x, y) => L2V(a, x, y);
  return [['M', ...P(rx, 0)],
    ['C', ...P(rx, k * ry), ...P(k * rx, ry), ...P(0, ry)], ['C', ...P(-k * rx, ry), ...P(-rx, k * ry), ...P(-rx, 0)],
    ['C', ...P(-rx, -k * ry), ...P(-k * rx, -ry), ...P(0, -ry)], ['C', ...P(k * rx, -ry), ...P(rx, -k * ry), ...P(rx, 0)], ['Z']];
}
function roundBoxSegs(a, r) {
  const w = a.w / 2, hh = a.h / 2, k = 0.5523 * r, P = (x, y) => L2V(a, x, y);
  r = Math.min(r, w, hh);
  return [['M', ...P(-w + r, -hh)], ['L', ...P(w - r, -hh)], ['C', ...P(w - r + k, -hh), ...P(w, -hh + r - k), ...P(w, -hh + r)],
    ['L', ...P(w, hh - r)], ['C', ...P(w, hh - r + k), ...P(w - r + k, hh), ...P(w - r, hh)],
    ['L', ...P(-w + r, hh)], ['C', ...P(-w + r - k, hh), ...P(-w, hh - r + k), ...P(-w, hh - r)],
    ['L', ...P(-w, -hh + r)], ['C', ...P(-w, -hh + r - k), ...P(-w + r - k, -hh), ...P(-w + r, -hh)], ['Z']];
}
function inkSegs(pts) {
  const n = pts.length / 2;
  if (n === 1) return [['M', pts[0], pts[1]], ['L', pts[0] + 0.01, pts[1]]];
  if (n === 2) return [['M', pts[0], pts[1]], ['L', pts[2], pts[3]]];
  const segs = [['M', pts[0], pts[1]], ['L', (pts[0] + pts[2]) / 2, (pts[1] + pts[3]) / 2]];
  for (let i = 1; i < n - 1; i++) segs.push(['Q', pts[2 * i], pts[2 * i + 1], (pts[2 * i] + pts[2 * i + 2]) / 2, (pts[2 * i + 1] + pts[2 * i + 3]) / 2]);
  segs.push(['L', pts[2 * n - 2], pts[2 * n - 1]]);
  return segs;
}
const segsD = segs => segs.map(s => s[0] + s.slice(1).map(r2).join(' ')).join('');

/* Eén beschrijving per aantekening; het scherm (SVG) en de PDF tekenen allebei hieruit. */
function annotItems(a) {
  switch (a.t) {
    case 'ink': return [{ k: 'path', segs: inkSegs(a.pts), stroke: a.c, sw: a.w, o: a.o == null ? 1 : a.o, blend: a.o != null && a.o < 1 }];
    case 'line': return [{ k: 'path', segs: [['M', a.x1, a.y1], ['L', a.x2, a.y2]], stroke: a.c, sw: a.w }];
    case 'arrow': {
      const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1), hs = Math.max(9, a.w * 4.5);
      const P = d => [a.x2 - hs * Math.cos(ang + d), a.y2 - hs * Math.sin(ang + d)];
      return [{ k: 'path', segs: [['M', a.x1, a.y1], ['L', a.x2, a.y2]], stroke: a.c, sw: a.w },
        { k: 'path', segs: [['M', ...P(0.45)], ['L', a.x2, a.y2], ['L', ...P(-0.45)]], stroke: a.c, sw: a.w }];
    }
    case 'rect': return [{ k: 'path', segs: boxSegs(a), stroke: a.c, sw: a.sw, fill: a.fill ? a.c : null, miter: true }];
    case 'ellipse': return [{ k: 'path', segs: ellipseSegs(a, a.w / 2, a.h / 2), stroke: a.c, sw: a.sw, fill: a.fill ? a.c : null }];
    case 'hl':
      if (a.mode === 'under' || a.mode === 'strike') {
        const y = a.mode === 'under' ? a.h / 2 - 1 : 0.5;
        return [{ k: 'path', segs: [['M', ...L2V(a, -a.w / 2, y)], ['L', ...L2V(a, a.w / 2, y)]], stroke: a.c, sw: clamp(a.h * 0.08, 0.9, 2) }];
      }
      return [{ k: 'path', segs: boxSegs(a), fill: a.c, o: 0.42, blend: true, miter: true }];
    case 'cover': return [{ k: 'path', segs: boxSegs(a), fill: a.c, miter: true }];
    case 'redact': return [{ k: 'path', segs: boxSegs(a), fill: '#000000', miter: true }];
    case 'sym': {
      const m = Math.min(a.w, a.h), sw = Math.max(1, m * 0.13), P = (x, y) => L2V(a, x * a.w, y * a.h);
      if (a.kind === 'dot') return [{ k: 'path', segs: ellipseSegs(a, m * 0.3, m * 0.3), fill: a.c }];
      if (a.kind === 'cross') return [{ k: 'path', segs: [['M', ...P(-0.34, -0.34)], ['L', ...P(0.34, 0.34)], ['M', ...P(0.34, -0.34)], ['L', ...P(-0.34, 0.34)]], stroke: a.c, sw }];
      return [{ k: 'path', segs: [['M', ...P(-0.36, 0.04)], ['L', ...P(-0.1, 0.3)], ['L', ...P(0.38, -0.32)]], stroke: a.c, sw }];
    }
    case 'stamp': {
      const label = safeText(a.label), unit = widthOf(label, 'helvB', 1) || 1;
      const fs = Math.max(4, Math.min(a.h * 0.5, (a.w - 14) / unit)), tw = unit * fs;
      const [x, y] = L2V(a, -tw / 2, fs * 0.36);
      return [{ k: 'path', segs: roundBoxSegs(a, 5), stroke: a.c, sw: Math.max(1.2, a.h * 0.06) },
        { k: 'text', str: label, x, y, size: fs, font: 'helvB', c: a.c, rot: a.rot || 0, w: tw }];
    }
    case 'text': {
      const key = fontKey(a), lh = a.fs * 1.25, out = [];
      (a.lines || []).forEach((ln, i) => {
        if (!ln.s) return;
        const [x, y] = L2V(a, -a.w / 2 + 2, -a.h / 2 + 2 + i * lh + a.fs * 0.95);
        out.push({ k: 'text', str: ln.s, x, y, size: a.fs, font: key, c: a.c, rot: a.rot || 0, w: ln.w });
      });
      return out;
    }
    case 'note': {
      const x = a.x, y = a.y;
      return [{ k: 'path', segs: [['M', x, y], ['L', x + 18, y], ['L', x + 18, y + 12], ['L', x + 12, y + 18], ['L', x, y + 18], ['Z']], fill: a.c, stroke: '#6B5600', sw: 0.8 },
        { k: 'path', segs: [['M', x + 18, y + 12], ['L', x + 12, y + 12], ['L', x + 12, y + 18], ['M', x + 4, y + 5.5], ['L', x + 14, y + 5.5], ['M', x + 4, y + 9], ['L', x + 14, y + 9]], stroke: '#6B5600', sw: 0.8 }];
    }
    case 'img': return [{ k: 'img', asset: a.asset, box: a }];
  }
  return [];
}
/* Watermerk, paginanummers en koptekst: gelden voor het hele document. */
function fxItems(p, i, total) {
  const out = [], W = viewW(p), H = viewH(p), fx = S.fx;
  if (fx.wm && fx.wm.text) {
    const str = safeText(fx.wm.text), r = fx.wm.ang;
    const unit = widthOf(str, 'helvB', 1) || 1;
    const size = fx.wm.size > 0 ? fx.wm.size : clamp(0.72 * Math.hypot(W, H) / unit, 12, 160);
    const tw = unit * size, a = r * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a);
    out.push({ k: 'text', str, x: W / 2 - dx * tw / 2 - dy * size * 0.35, y: H / 2 - dy * tw / 2 + dx * size * 0.35, size, font: 'helvB', c: fx.wm.c, rot: r, o: fx.wm.o, w: tw });
  }
  const place = (str, pos, size) => {
    str = safeText(str);
    const tw = widthOf(str, 'helv', size), m = 28;
    const x = pos[1] === 'l' ? m : pos[1] === 'r' ? W - m - tw : (W - tw) / 2;
    const y = pos[0] === 't' ? m + size * 0.75 : H - m;
    out.push({ k: 'text', str, x, y, size, font: 'helv', c: '#333A44', rot: 0, w: tw });
  };
  if (fx.num && !(fx.num.skipFirst && i === 0)) {
    const n = i + (fx.num.start || 1) - (fx.num.skipFirst ? 1 : 0), N = total - (fx.num.skipFirst ? 1 : 0) + (fx.num.start || 1) - 1;
    const str = { n: '' + n, 'n/N': n + ' / ' + N, pn: 'Pagina ' + n, pnN: 'Pagina ' + n + ' van ' + N, dash: '- ' + n + ' -' }[fx.num.fmt] || '' + n;
    place(str, fx.num.pos, fx.num.size || 10);
  }
  if (fx.head && fx.head.text) place(fx.head.text, fx.head.pos, fx.head.size || 10);
  return out;
}

function itemNode(it) {
  if (it.k === 'path') {
    const e = sv('path', { d: segsD(it.segs), fill: it.fill || 'none', stroke: it.stroke || 'none', 'stroke-width': it.sw || 0,
      'stroke-linecap': 'round', 'stroke-linejoin': it.miter ? 'miter' : 'round', opacity: it.o == null ? 1 : it.o,
      'pointer-events': it.fill ? 'all' : 'stroke' });
    if (it.blend) e.style.mixBlendMode = 'multiply';
    return e;
  }
  if (it.k === 'text') {
    const f = FONTS[it.font];
    const e = sv('text', { x: r2(it.x), y: r2(it.y), 'font-size': it.size, 'font-family': f.css, 'font-weight': f.weight, fill: it.c,
      opacity: it.o == null ? 1 : it.o, transform: it.rot ? 'rotate(' + it.rot + ' ' + r2(it.x) + ' ' + r2(it.y) + ')' : null,
      textLength: it.w > 0.5 ? r2(it.w) : null, lengthAdjust: 'spacingAndGlyphs', 'pointer-events': 'none' }, it.str);
    e.style.whiteSpace = 'pre';
    return e;
  }
  if (it.k === 'img') {
    const b = it.box, as = S.assets[it.asset];
    return sv('image', { href: as ? as.url : '', width: b.w, height: b.h, preserveAspectRatio: 'none', 'pointer-events': 'all',
      transform: 'translate(' + r2(b.cx) + ' ' + r2(b.cy) + ') rotate(' + (b.rot || 0) + ') translate(' + r2(-b.w / 2) + ' ' + r2(-b.h / 2) + ')' });
  }
  return sv('g');
}
function annotBox(a) {
  if (isBox(a)) return a;
  if (a.t === 'note') return { cx: a.x + 9, cy: a.y + 9, w: 18, h: 18, rot: 0 };
  const xs = a.t === 'ink' ? a.pts.filter((_, i) => i % 2 === 0) : [a.x1, a.x2];
  const ys = a.t === 'ink' ? a.pts.filter((_, i) => i % 2 === 1) : [a.y1, a.y2];
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), pad = (a.w || 2) / 2 + 2;
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2, rot: 0 };
}
function annotNode(a) {
  const g = sv('g', { class: 'a', 'data-id': a.id });
  const hitW = Math.max(14, IS_TOUCH ? 22 : 14) / S.scale;
  const editing = editor && editor.a === a;
  for (const it of annotItems(a)) {
    if (editing && it.k === 'text') continue;
    g.append(itemNode(it));
    if (it.k === 'path' && !it.fill) g.append(sv('path', { d: segsD(it.segs), fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(hitW, it.sw || 0), 'stroke-linecap': 'round', 'pointer-events': 'stroke' }));
  }
  if (['text', 'stamp', 'sym', 'note'].includes(a.t) || (a.t === 'hl' && a.mode !== 'mark')) {
    g.append(sv('path', { d: segsD(boxSegs(annotBox(a))), fill: 'transparent', stroke: 'none', 'pointer-events': 'all' }));
  }
  return g;
}
function selNode(a) {
  const g = sv('g', { class: 'sel' });
  const k = 1 / S.scale, hr = (IS_TOUCH ? 9 : 5.5) * k;
  const handle = (id, x, y) => g.append(sv('circle', { class: 'handle', 'data-h': id, cx: r2(x), cy: r2(y), r: hr, 'stroke-width': 1.6 * k }));
  if (a.t === 'line' || a.t === 'arrow') {
    handle('p1', a.x1, a.y1); handle('p2', a.x2, a.y2);
    return g;
  }
  const b = annotBox(a), pad = isBox(a) ? 2 * k : 0;
  const bb = { cx: b.cx, cy: b.cy, w: b.w + pad * 2, h: b.h + pad * 2, rot: b.rot || 0 };
  g.append(sv('path', { class: 'selbox', d: segsD(boxSegs(bb)), 'stroke-width': 1.3 * k, 'stroke-dasharray': (4 * k) + ' ' + (3 * k) }));
  if (a.t === 'text') handle('e', ...L2V(bb, bb.w / 2, 0));
  else if (isBox(a)) for (const [id, sx, sy] of [['nw', -1, -1], ['ne', 1, -1], ['se', 1, 1], ['sw', -1, 1]]) handle(id, ...L2V(bb, sx * bb.w / 2, sy * bb.h / 2));
  return g;
}
/* keep = de greep die je vasthoudt tijdens vergroten: die mag niet uit de pagina verdwijnen,
   anders breekt de browser het slepen met je vinger af. */
function drawAnnots(p, keep) {
  const rt = RT.get(p.id);
  if (!rt) return;
  const svg = rt.svg;
  const keepSel = keep && keep.isConnected && keep.parentNode && keep.parentNode.parentNode === svg ? keep.parentNode : null;
  if (keepSel) { for (const ch of Array.from(svg.childNodes)) if (ch !== keepSel) ch.remove(); }
  else svg.textContent = '';
  const add = node => (keepSel ? svg.insertBefore(node, keepSel) : svg.append(node));
  const hits = Q.hits.length ? Q.hits.filter(hh => hh.page === p.id) : [];
  if (hits.length) {
    const g = sv('g', { class: 'hits' });
    for (const hh of hits) for (const poly of hh.polys) {
      const e = sv('polygon', { points: poly.map(pt => r2(pt[0]) + ',' + r2(pt[1])).join(' '), fill: hh === Q.hits[Q.cur] ? '#FF8A00' : '#FFDD3C', opacity: 0.5 });
      e.style.mixBlendMode = 'multiply';
      g.append(e);
    }
    add(g);
  }
  if (S.fx.wm || S.fx.num || S.fx.head) {
    const g = sv('g', { class: 'fx' });
    for (const it of fxItems(p, S.pages.indexOf(p), S.pages.length)) g.append(itemNode(it));
    add(g);
  }
  let selA = null;
  for (const a of p.annots) { add(annotNode(a)); if (a.id === S.sel) selA = a; }
  if (keepSel) {
    for (const ch of Array.from(keepSel.childNodes)) if (ch !== keep) ch.remove();
    if (selA) for (const ch of Array.from(selNode(selA).childNodes)) {
      if (ch.dataset && ch.dataset.h === keep.dataset.h) { keep.setAttribute('cx', ch.getAttribute('cx')); keep.setAttribute('cy', ch.getAttribute('cy')); }
      else keepSel.insertBefore(ch, keep);
    }
  } else if (selA && !(editor && editor.a === selA)) svg.append(selNode(selA));
}
function drawAll() { for (const p of S.pages) drawAnnots(p); }
function findAnnot(id) {
  for (const p of S.pages) { const a = p.annots.find(z => z.id === id); if (a) return { a, p }; }
  return null;
}
/* Selecteren tekent alleen het kader erbij. De aantekening zelf blijft staan: wie hem met een vinger
   vasthoudt, mag het aangeraakte element niet kwijtraken, anders gaat de pagina schuiven. */
function setSel(id) {
  const prev = S.sel && findAnnot(S.sel);
  S.sel = id;
  if (prev) { const rt = RT.get(prev.p.id), sg = rt && rt.svg.querySelector('.sel'); if (sg) sg.remove(); }
  const cur = id && findAnnot(id);
  if (cur) { const rt = RT.get(cur.p.id); if (rt && !(editor && editor.a === cur.a)) rt.svg.append(selNode(cur.a)); }
  updateStrip();
}
function onScaleChanged() {
  const f = S.sel && findAnnot(S.sel);
  if (f) drawAnnots(f.p);
  if (editor) positionEditor();
  hideSelPop();
}

/* ---------- tekstvakken ---------- */
function layoutText(a, p) {
  const key = fontKey(a), fs = a.fs, pad = 2;
  const tl = L2V(a, -a.w / 2, -a.h / 2);
  const avail = a.fixed ? a.w : Math.max(40, a.rot ? 400 : viewW(p) - tl[0] - 6);
  const maxw = Math.max(10, avail - pad * 2), W = s => widthOf(s, key, fs);
  const lines = [];
  for (const para of safeText(a.text).split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      if (!line || W((line + word).replace(/\s+$/, '')) <= maxw) line += word;
      else { lines.push(line.replace(/\s+$/, '')); line = word.replace(/^\s+/, ''); }
      while (line.length > 1 && W(line) > maxw) {
        let n = line.length - 1;
        while (n > 1 && W(line.slice(0, n)) > maxw) n--;
        lines.push(line.slice(0, n)); line = line.slice(n);
      }
    }
    lines.push(line.replace(/\s+$/, ''));
  }
  a.lines = lines.map(s => ({ s, w: r2(W(s)) }));
  const nw = a.fixed ? a.w : Math.max(24, Math.max(...a.lines.map(l => l.w)) + pad * 2 + 1);
  const nh = Math.max(1, lines.length) * fs * 1.25 + pad * 2;
  const r = (a.rot || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  a.w = r2(nw); a.h = r2(nh);
  a.cx = r2(tl[0] + (nw / 2) * c - (nh / 2) * s);
  a.cy = r2(tl[1] + (nw / 2) * s + (nh / 2) * c);
}
let editor = null;
function startTextEdit(a, p, isNew) {
  endTextEdit();
  const rt = RT.get(p.id);
  if (!rt) return;
  const ta = h('textarea', { class: 'text-edit', spellcheck: 'false', 'aria-label': 'Tekst op de pagina', autocapitalize: 'sentences' });
  ta.value = a.text;
  editor = { a, p, ta, isNew, before: a.text };
  rt.el.append(ta);
  positionEditor();
  drawAnnots(p);
  ta.addEventListener('input', () => { a.text = ta.value; layoutText(a, p); positionEditor(); });
  ta.addEventListener('blur', () => setTimeout(() => { if (editor && editor.ta === ta) endTextEdit(); }, 0));
  ta.addEventListener('keydown', e => { if (e.key === 'Escape') ta.blur(); e.stopPropagation(); });
  ta.addEventListener('pointerdown', e => e.stopPropagation());
  ta.focus({ preventScroll: true });
  ta.setSelectionRange(ta.value.length, ta.value.length);
  updateStrip();
}
function positionEditor() {
  if (!editor) return;
  const { a, p, ta } = editor, sc = S.scale, f = FONTS[fontKey(a)];
  const tl = L2V(a, -a.w / 2, -a.h / 2);
  const avail = a.fixed ? a.w : Math.max(40, a.rot ? 400 : viewW(p) - tl[0] - 6);
  Object.assign(ta.style, {
    left: (a.cx - a.w / 2 + 2) * sc + 'px', top: (a.cy - a.h / 2 + 2) * sc + 'px',
    width: Math.max(20, avail - 4) * sc + 'px', height: Math.max(a.fs * 1.25, a.h - 4) * sc + 'px',
    fontSize: a.fs * sc + 'px', fontFamily: f.css, fontWeight: f.weight, color: a.c,
    transform: a.rot ? 'rotate(' + a.rot + 'deg)' : '',
  });
}
function endTextEdit(silent) {
  if (!editor) return;
  const { a, p, ta, isNew, before } = editor;
  editor = null;
  ta.remove();
  if (silent) return;
  a.text = a.text.replace(/\s+$/, '');
  if (isNew && a.paired && a.text === before.replace(/\s+$/, '')) {
    // niets veranderd aan bestaande tekst: afdekking en tekstvak weer weghalen
    p.annots = p.annots.filter(z => z !== a && z.id !== a.pairId);
    if (S.sel === a.id) S.sel = null;
  } else if (!a.text) {
    const i = p.annots.indexOf(a);
    if (i >= 0) p.annots.splice(i, 1);
    if (S.sel === a.id) S.sel = null;
    if (!isNew || a.paired) commit();
  } else {
    layoutText(a, p);
    if (isNew || a.text !== before) commit();
  }
  drawAnnots(p);
  updateStrip();
}
function newTextAt(p, x, y) {
  const st = S.style.text;
  const a = { id: uid(), t: 'text', text: '', fs: st.fs, c: st.c, font: st.font, bold: st.bold, rot: 0, fixed: false, w: 24, h: st.fs * 1.25 + 4, cx: 0, cy: 0, lines: [] };
  a.cx = x - 2 + a.w / 2; a.cy = y - st.fs * 0.7 + a.h / 2;
  p.annots.push(a);
  setTool('select', true);
  S.sel = a.id;
  startTextEdit(a, p, true);
}
/* Bestaande tekst "bewerken": de regel wordt afgedekt in de papierkleur en als nieuw tekstvak teruggezet. */
async function editTextAt(p, x, y) {
  const src = S.sources[p.src], rt = RT.get(p.id);
  const pg = await getPg(src, p.idx), tc = await getText(src, p.idx);
  const vp = pg.getViewport({ scale: 1, rotation: (pg.rotate + p.rot) % 360 });
  const runs = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
    if (Math.abs(Math.atan2(tx[1], tx[0])) > 0.03) continue;
    runs.push({ str: it.str, x0: tx[4], yb: tx[5], fh: Math.hypot(tx[2], tx[3]) || 10, w: it.width, font: it.fontName });
  }
  const hit = runs.find(r => x >= r.x0 - 2 && x <= r.x0 + r.w + 2 && y >= r.yb - r.fh && y <= r.yb + r.fh * 0.3);
  if (!hit) { toast('Tik precies op een regel tekst. Staat de tekst in een scan? Dek hem dan af en typ eroverheen.'); return; }
  // de rest van dezelfde regel erbij zoeken
  const same = runs.filter(r => Math.abs(r.yb - hit.yb) < hit.fh * 0.3 && Math.abs(r.fh - hit.fh) < hit.fh * 0.25).sort((u, v) => u.x0 - v.x0);
  let lo = same.indexOf(hit), hi = lo;
  const gapOk = (u, v) => v.x0 - (u.x0 + u.w) < hit.fh * 1.6;
  while (lo > 0 && gapOk(same[lo - 1], same[lo])) lo--;
  while (hi < same.length - 1 && gapOk(same[hi], same[hi + 1])) hi++;
  const line = same.slice(lo, hi + 1);
  let str = '';
  line.forEach((r, i) => {
    if (i && r.x0 - (line[i - 1].x0 + line[i - 1].w) > hit.fh * 0.18 && !/\s$/.test(str) && !/^\s/.test(r.str)) str += ' ';
    str += r.str;
  });
  const x0 = line[0].x0, x1 = line[line.length - 1].x0 + line[line.length - 1].w, fh = hit.fh, yb = hit.yb;
  // papier- en inktkleur uit de weergave halen
  let bg = '#FFFFFF', fg = '#111111';
  try {
    const c = rt.canvas, k = c.width / viewW(p), ctx = c.getContext('2d');
    const px = (vx, vy) => ctx.getImageData(clamp(Math.round(vx * k), 0, c.width - 1), clamp(Math.round(vy * k), 0, c.height - 1), 1, 1).data;
    const b = px(x0 - 3, yb - fh * 0.5);
    const hex = d => '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    bg = hex(b);
    const rx = Math.round(x0 * k), ry = Math.round((yb - fh * 0.8) * k), rw = Math.max(1, Math.min(Math.round((x1 - x0) * k), 600)), rh = Math.max(1, Math.round(fh * k));
    const data = ctx.getImageData(clamp(rx, 0, c.width - 1), clamp(ry, 0, c.height - 1), rw, rh).data;
    let best = 0, bi = -1;
    for (let i = 0; i < data.length; i += 16) { const d = Math.abs(data[i] - b[0]) + Math.abs(data[i + 1] - b[1]) + Math.abs(data[i + 2] - b[2]); if (d > best) { best = d; bi = i; } }
    if (bi >= 0 && best > 90) fg = hex([data[bi], data[bi + 1], data[bi + 2]]);
  } catch (e) { /* weergave niet beschikbaar: wit papier, zwarte inkt */ }
  const fam = ((tc.styles && tc.styles[hit.font] && tc.styles[hit.font].fontFamily) || '').toLowerCase();
  let font = fam.includes('mono') ? 'cour' : fam.includes('serif') && !fam.includes('sans') ? 'times' : 'helv', bold = false;
  try {
    // het echte lettertype van de pagina zegt of de regel vet, met schreef of typemachine is
    const fo = pg.commonObjs.get(hit.font);
    if (fo) { bold = !!fo.bold || /bold|black|heavy|semibold|demi/i.test(fo.name || ''); if (fo.isMonospace) font = 'cour'; else if (fo.isSerifFont) font = 'times'; }
  } catch (e) {}
  const fs = Math.round(fh * 10) / 10;
  const cover = { id: uid(), t: 'cover', c: bg, rot: 0, cx: (x0 + x1) / 2, cy: yb - fh * 0.34, w: x1 - x0 + 3, h: fh * 1.32 };
  const a = { id: uid(), t: 'text', text: str, fs, c: fg, font, bold, rot: 0, fixed: false, paired: true, pairId: cover.id, w: 24, h: fs * 1.25 + 4, cx: 0, cy: 0, lines: [] };
  a.cx = x0 - 2 + a.w / 2; a.cy = yb - fs * 0.95 - 2 + a.h / 2;
  layoutText(a, p);
  p.annots.push(cover, a);
  setTool('select', true);
  S.sel = a.id;
  startTextEdit(a, p, true);
}

/* ---------- gereedschap ---------- */
const TOOLS = [
  { id: 'select', label: 'Selecteer', icon: 'cursor' },
  { id: 'text', label: 'Tekst', icon: 'text' },
  { id: 'edit', label: 'Bewerk tekst', icon: 'edittext' },
  { id: 'hl', label: 'Markeer', icon: 'highlight' },
  { id: 'ink', label: 'Teken', icon: 'pen' },
  { id: 'shape', label: 'Vorm', icon: 'shapes' },
  { id: 'note', label: 'Notitie', icon: 'note' },
  { id: 'sign', label: 'Onderteken', icon: 'sign' },
  { id: 'img', label: 'Afbeelding', icon: 'image' },
  { id: 'stamp', label: 'Stempel', icon: 'stamp' },
  { id: 'sym', label: 'Vinkje', icon: 'check' },
  { id: 'cover', label: 'Afdekken', icon: 'cover' },
  { id: 'eraser', label: 'Gum', icon: 'eraser' },
];
const COLORS = ['#17202B', '#1F4FD1', '#D7263D', '#1B7446', '#F08A00', '#8E44AD', '#FFFFFF'];
const HL_COLORS = ['#FFE14A', '#9BE37A', '#7FD4FF', '#FFA6C9', '#FFB347', '#E5383B'];
const STAMPS = ['Goedgekeurd', 'Akkoord', 'Concept', 'Vertrouwelijk', 'Betaald', 'Ontvangen', 'Afgewezen', 'Kopie'];

function renderDock() {
  const dock = $('#dock');
  dock.textContent = '';
  for (const t of TOOLS) {
    dock.append(h('button', { class: 'tool', 'data-tool': t.id, 'aria-pressed': S.tool === t.id ? 'true' : 'false', title: t.label, html: ico(t.icon) + '<span>' + t.label + '</span>', onclick: () => setTool(t.id) }));
  }
}
function setTool(id, keepSel) {
  endTextEdit();
  hideSelPop();
  if (id === 'sign') { openSign(); return; }
  if (id === 'img') { $('#fileImg').click(); return; }
  S.tool = id;
  document.body.classList.toggle('drawing', id !== 'select');
  document.body.classList.toggle('tool-eraser', id === 'eraser');
  $$('#dock .tool').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === id ? 'true' : 'false'));
  if (!keepSel && S.sel) setSel(null); else updateStrip();
  if (id !== 'select') { const s = getSelection(); if (s) s.removeAllRanges(); }
}

/* ---------- optiestrook ---------- */
function swatches(colors, cur, set) {
  const row = h('div', { class: 'sw-row', role: 'group', 'aria-label': 'Kleur' });
  for (const c of colors) row.append(h('button', { class: 'sw', style: { background: c }, 'aria-pressed': String(cur && cur.toUpperCase() === c), 'aria-label': 'Kleur ' + c, onclick: () => set(c) }));
  const custom = h('input', { class: 'sw-custom', type: 'color', value: /^#[0-9a-f]{6}$/i.test(cur || '') ? cur : '#000000', 'aria-label': 'Eigen kleur', title: 'Eigen kleur' });
  custom.addEventListener('change', () => set(custom.value.toUpperCase()));
  row.append(custom);
  return row;
}
function chips(options, cur, set) {
  return h('div', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } }, options.map(o => h('button', { class: 'chip', 'aria-pressed': String(cur === o[0]), text: o[1], onclick: () => set(o[0]) })));
}
function rangeCtl(label, min, max, step, cur, set) {
  const inp = h('input', { type: 'range', min, max, step, value: cur, 'aria-label': label });
  inp.addEventListener('change', () => set(parseFloat(inp.value)));
  return h('label', { class: 'mini' }, label, inp);
}
function styleControls(kind, o, ch) {
  const out = [];
  const widthKey = 'sw' in o ? 'sw' : 'w';
  switch (kind) {
    case 'text':
      out.push(swatches(COLORS.slice(0, 6), o.c, c => ch(() => { o.c = c; })));
      {
        const sz = h('input', { type: 'number', min: 4, max: 200, step: 1, value: o.fs, id: 'optSize', 'aria-label': 'Lettergrootte' });
        sz.addEventListener('change', () => ch(() => { o.fs = clamp(parseFloat(sz.value) || 12, 4, 200); }));
        const ff = h('select', { id: 'optFont', 'aria-label': 'Lettertype' }, [['helv', 'Schreefloos'], ['times', 'Schreef'], ['cour', 'Typemachine']].map(f => h('option', { value: f[0], text: f[1] })));
        ff.value = o.font || 'helv';
        ff.addEventListener('change', () => ch(() => { o.font = ff.value; }));
        out.push(h('label', { class: 'mini' }, 'Grootte', sz), h('label', { class: 'mini' }, ff),
          h('button', { class: 'chip', 'aria-pressed': String(!!o.bold), text: 'Vet', onclick: () => ch(() => { o.bold = !o.bold; }) }));
      }
      break;
    case 'hl':
      out.push(chips([['mark', 'Markeren'], ['under', 'Onderstrepen'], ['strike', 'Doorhalen']], o.mode, m => ch(() => {
        o.mode = m;
        if (m !== 'mark' && o.c === '#FFE14A') o.c = '#E5383B';
        if (m === 'mark' && o.c === '#E5383B') o.c = '#FFE14A';
      })), swatches(HL_COLORS, o.c, c => ch(() => { o.c = c; })));
      break;
    case 'ink':
      out.push(swatches(COLORS.slice(0, 6), o.c, c => ch(() => { o.c = c; })), rangeCtl('Dikte', 0.5, 14, 0.5, o.w, v => ch(() => { o.w = v; })));
      if ('marker' in o) out.push(h('button', { class: 'chip', 'aria-pressed': String(!!o.marker), text: 'Markeerstift', onclick: () => ch(() => { o.marker = !o.marker; }) }));
      break;
    case 'shape':
      if ('kind' in o) out.push(chips([['rect', 'Rechthoek'], ['ellipse', 'Ellips'], ['line', 'Lijn'], ['arrow', 'Pijl']], o.kind, k => ch(() => { o.kind = k; })));
      out.push(swatches(COLORS.slice(0, 6), o.c, c => ch(() => { o.c = c; })), rangeCtl('Dikte', 0.5, 12, 0.5, o[widthKey], v => ch(() => { o[widthKey] = v; })));
      if ('fill' in o) out.push(h('button', { class: 'chip', 'aria-pressed': String(!!o.fill), text: 'Gevuld', onclick: () => ch(() => { o.fill = !o.fill; }) }));
      break;
    case 'note': case 'sym': case 'stampc':
      out.push(swatches(kind === 'note' ? ['#FFD84A', '#9BE37A', '#7FD4FF', '#FFA6C9'] : COLORS.slice(0, 6), o.c, c => ch(() => { o.c = c; })));
      break;
    case 'cover':
      out.push(swatches(['#FFFFFF', '#F4F1EA', '#17202B'], o.c, c => ch(() => { o.c = c; })));
      break;
  }
  return out;
}
function updateStrip() {
  const strip = $('#strip');
  strip.textContent = '';
  const f = S.sel && findAnnot(S.sel);
  const parts = [];
  if (f) {
    const { a, p } = f;
    const ch = fn => { fn(); if (a.t === 'text') layoutText(a, p); if (editor && editor.a === a) positionEditor(); drawAnnots(p); commit(); updateStrip(); };
    const kind = { text: 'text', hl: 'hl', ink: 'ink', line: 'shape', arrow: 'shape', rect: 'shape', ellipse: 'shape', note: 'note', sym: 'sym', stamp: 'stampc', cover: 'cover' }[a.t];
    if (a.t === 'text' || a.t === 'note') parts.push(h('button', { class: 'btn', html: ico('edit') + '<span>Bewerk</span>', onpointerdown: e => e.preventDefault(), onclick: () => (a.t === 'text' ? startTextEdit(a, p, false) : openNote(a, p)) }));
    if (kind) parts.push(...styleControls(kind, a, ch));
    if (a.t === 'redact') parts.push(h('span', { class: 'hint', text: 'Zwartlakken haalt de inhoud echt weg; deze pagina wordt bij opslaan een afbeelding.' }));
    if (a.t === 'img') parts.push(rangeCtl('Dekking', 0.1, 1, 0.05, a.o == null ? 1 : a.o, v => ch(() => { a.o = v; })));
    parts.push(h('span', { class: 'sep' }),
      h('button', { class: 'icon-btn', title: 'Dupliceer (Ctrl+D)', 'aria-label': 'Dupliceer', html: ico('copy'), onclick: () => dupSel() }),
      h('button', { class: 'icon-btn', title: 'Naar voren', 'aria-label': 'Naar voren', html: ico('front'), onclick: () => { const i = p.annots.indexOf(a); p.annots.splice(i, 1); p.annots.push(a); drawAnnots(p); commit(); } }),
      h('button', { class: 'icon-btn', title: 'Verwijder (Delete)', 'aria-label': 'Verwijder', html: ico('trash'), onclick: () => delSel() }));
  } else if (S.tool !== 'select') {
    const st = S.style[S.tool], ch = fn => { fn(); updateStrip(); };
    const hint = t => h('span', { class: 'hint', text: t });
    switch (S.tool) {
      case 'text': parts.push(hint('Tik waar de tekst moet komen'), ...styleControls('text', st, ch)); break;
      case 'edit': parts.push(hint('Tik op een regel om de tekst te herschrijven')); break;
      case 'hl': parts.push(...styleControls('hl', st, ch), hint(IS_TOUCH ? 'Sleep over de tekst' : 'Sleep over de tekst, of selecteer eerst tekst met Selecteer')); break;
      case 'ink': parts.push(...styleControls('ink', st, ch)); if (IS_TOUCH) parts.push(hint('Schuiven doe je met twee vingers')); break;
      case 'shape': parts.push(...styleControls('shape', st, ch)); break;
      case 'note': parts.push(hint('Tik waar de notitie moet komen'), ...styleControls('note', st, ch)); break;
      case 'stamp': {
        const sel = h('select', { id: 'optStamp', 'aria-label': 'Stempel' }, STAMPS.map(s => h('option', { value: s, text: s })), h('option', { value: '@date', text: 'Datum van vandaag' }), h('option', { value: '@own', text: 'Eigen tekst' }));
        sel.value = st.own != null ? '@own' : st.label;
        sel.addEventListener('change', () => ch(() => { if (sel.value === '@own') st.own = st.own || ''; else { st.own = null; st.label = sel.value; } }));
        parts.push(h('label', { class: 'mini' }, sel));
        if (st.own != null) {
          const own = h('input', { type: 'text', id: 'optStampOwn', placeholder: 'Jouw tekst', value: st.own, 'aria-label': 'Eigen stempeltekst', style: { width: '150px' } });
          own.addEventListener('input', () => { st.own = own.value; });
          parts.push(h('label', { class: 'mini' }, own));
        }
        parts.push(...styleControls('stampc', st, ch), hint('Tik op de pagina'));
        break;
      }
      case 'sym': parts.push(chips([['check', 'Vinkje'], ['cross', 'Kruisje'], ['dot', 'Stip']], st.kind, k => ch(() => { st.kind = k; })), ...styleControls('sym', st, ch), hint('Tik in een hokje')); break;
      case 'cover':
        parts.push(chips([['white', 'Afdekken'], ['redact', 'Zwartlakken']], st.kind, k => ch(() => { st.kind = k; })));
        if (st.kind === 'white') parts.push(...styleControls('cover', st, ch), hint('Sleep over wat uit beeld moet'));
        else parts.push(hint('Sleep over wat echt weg moet. De pagina wordt bij opslaan een afbeelding, zodat de tekst eronder niet terug te halen is.'));
        break;
      case 'eraser': parts.push(hint('Tik op een aantekening om die te wissen. De PDF zelf blijft heel.')); break;
    }
  }
  // op desktop blijft de strook staan, anders verspringt de pagina onder je muis
  if (!parts.length && !isNarrow()) parts.push(h('span', { class: 'hint', text: 'Kies gereedschap links, of selecteer tekst in het document om die te markeren, te onderstrepen of te kopiëren.' }));
  strip.hidden = !parts.length;
  for (const el of parts) strip.append(el);
}
function delSel() {
  const f = S.sel && findAnnot(S.sel);
  if (!f) return;
  endTextEdit(true);
  f.p.annots.splice(f.p.annots.indexOf(f.a), 1);
  S.sel = null;
  drawAnnots(f.p); commit(); updateStrip();
}
function dupSel() {
  const f = S.sel && findAnnot(S.sel);
  if (!f) return;
  const b = clone(f.a);
  b.id = uid();
  moveAnnot(b, clone(b), 12, 12, f.p);
  f.p.annots.push(b);
  S.sel = b.id;
  drawAnnots(f.p); commit(); updateStrip();
}
function moveAnnot(a, o, dx, dy, p) {
  if (a.t === 'ink') { for (let i = 0; i < a.pts.length; i += 2) { a.pts[i] = r2(o.pts[i] + dx); a.pts[i + 1] = r2(o.pts[i + 1] + dy); } }
  else if (a.t === 'line' || a.t === 'arrow') { a.x1 = o.x1 + dx; a.y1 = o.y1 + dy; a.x2 = o.x2 + dx; a.y2 = o.y2 + dy; }
  else if (a.t === 'note') { a.x = clamp(o.x + dx, 0, viewW(p) - 18); a.y = clamp(o.y + dy, 0, viewH(p) - 18); }
  else { a.cx = clamp(o.cx + dx, 0, viewW(p)); a.cy = clamp(o.cy + dy, 0, viewH(p)); }
}
function resizeAnnot(d, x, y) {
  const a = d.a, o = d.orig;
  if (a.t === 'line' || a.t === 'arrow') { if (d.hid === 'p1') { a.x1 = x; a.y1 = y; } else { a.x2 = x; a.y2 = y; } return; }
  const [lx, ly] = V2L(o, x, y);
  if (a.t === 'text') {
    const tl = L2V(o, -o.w / 2, -o.h / 2), r = (o.rot || 0) * Math.PI / 180;
    a.fixed = true; a.w = Math.max(30, lx + o.w / 2);
    a.cx = tl[0] + (a.w / 2) * Math.cos(r) - (a.h / 2) * Math.sin(r);
    a.cy = tl[1] + (a.w / 2) * Math.sin(r) + (a.h / 2) * Math.cos(r);
    layoutText(a, d.p);
    return;
  }
  const sx = d.hid.includes('e') ? 1 : -1, sy = d.hid.includes('s') ? 1 : -1;
  const fx = -sx * o.w / 2, fy = -sy * o.h / 2;
  let nw = Math.max(6, (lx - fx) * sx), nh = Math.max(6, (ly - fy) * sy);
  if (['img', 'stamp', 'sym'].includes(a.t)) { const ar = o.w / o.h; if (nw / nh > ar) nh = nw / ar; else nw = nh * ar; }
  [a.cx, a.cy] = L2V(o, fx + sx * nw / 2, fy + sy * nh / 2);
  a.w = nw; a.h = nh;
}
/* Pagina een kwartslag draaien: de aantekeningen draaien mee. */
function rotatePage(p, dir) {
  const W = viewW(p), H = viewH(p);
  const map = dir > 0 ? (x, y) => [H - y, x] : (x, y) => [y, W - x];
  for (const a of p.annots) {
    if (a.t === 'ink') { for (let i = 0; i < a.pts.length; i += 2) { const q = map(a.pts[i], a.pts[i + 1]); a.pts[i] = q[0]; a.pts[i + 1] = q[1]; } }
    else if (a.t === 'line' || a.t === 'arrow') { [a.x1, a.y1] = map(a.x1, a.y1); [a.x2, a.y2] = map(a.x2, a.y2); }
    else if (a.t === 'note') { const q = map(a.x + 9, a.y + 9); a.x = q[0] - 9; a.y = q[1] - 9; }
    else { [a.cx, a.cy] = map(a.cx, a.cy); a.rot = ((a.rot || 0) + dir * 90 + 360) % 360; }
  }
  p.rot = (p.rot + dir * 90 + 360) % 360;
}

/* ---------- aanwijzer: tekenen, verplaatsen, vergroten ---------- */
let drag = null;
const touchIds = new Set();
function evPt(e, p) {
  const r = RT.get(p.id).svg.getBoundingClientRect();
  return [(e.clientX - r.left) / r.width * viewW(p), (e.clientY - r.top) / r.height * viewH(p)];
}
function cancelDrag() {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.mode === 'draw' && d.a) { const i = d.p.annots.indexOf(d.a); if (i >= 0) d.p.annots.splice(i, 1); drawAnnots(d.p); }
  else if (d.mode === 'move' || d.mode === 'resize') { Object.assign(d.a, d.orig); drawAnnots(d.p); }
}
function capture(p, e) { try { RT.get(p.id).svg.setPointerCapture(e.pointerId); } catch (err) {} }

/* Een aantekening verslepen met je vinger mag de pagina niet laten meeschuiven. */
pagesEl.addEventListener('touchstart', e => {
  if (e.touches.length === 1 && S.tool === 'select' && e.target.closest && (e.target.closest('.a') || e.target.closest('.handle'))) e.preventDefault();
}, { passive: false });
pagesEl.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (e.target.closest('.text-edit')) return;
  if (e.pointerType === 'touch') { touchIds.add(e.pointerId); if (touchIds.size > 1) { cancelDrag(); return; } }
  if (e.target.closest('.formLayer .ff')) { if (S.sel) setSel(null); return; }
  const pel = e.target.closest('.page');
  if (!pel) { if (S.tool === 'select' && S.sel) setSel(null); return; }
  const p = pageById(pel.dataset.id);
  if (!p) return;
  const [x, y] = evPt(e, p);
  if (S.tool === 'select') {
    const hEl = e.target.closest('.handle'), gEl = e.target.closest('.a');
    if (hEl && S.sel) {
      const f = findAnnot(S.sel);
      if (!f) return;
      drag = { mode: 'resize', pid: e.pointerId, p: f.p, a: f.a, hid: hEl.dataset.h, orig: clone(f.a), handle: hEl };
      capture(f.p, e); e.preventDefault();
      return;
    }
    if (gEl) {
      const a = p.annots.find(z => z.id === gEl.dataset.id);
      if (!a) return;
      const was = S.sel === a.id;
      if (editor && editor.a !== a) endTextEdit();
      if (!was) setSel(a.id);
      drag = { mode: 'move', pid: e.pointerId, p, a, orig: clone(a), sx: x, sy: y, cx: e.clientX, cy: e.clientY, moved: false, was };
      capture(p, e); e.preventDefault();
      return;
    }
    if (S.sel) setSel(null);
    return;
  }
  e.preventDefault();
  if (S.tool === 'eraser') { drag = { mode: 'erase', pid: e.pointerId, n: 0 }; capture(p, e); eraseAt(e); return; }
  drag = { mode: 'draw', pid: e.pointerId, tool: S.tool, p, sx: x, sy: y, cx: e.clientX, cy: e.clientY, a: null, moved: false, node: null };
  capture(p, e);
  if (S.tool === 'ink') {
    const st = S.style.ink;
    drag.a = { id: uid(), t: 'ink', pts: [r2(x), r2(y)], c: st.c, w: st.marker ? Math.max(st.w * 4, 10) : st.w, o: st.marker ? 0.4 : 1 };
    p.annots.push(drag.a);
    drawAnnots(p);
    drag.node = RT.get(p.id).svg.querySelector('[data-id="' + drag.a.id + '"] path');
  }
});
window.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.pid) return;
  if (drag.mode === 'erase') { eraseAt(e); return; }
  const p = drag.p;
  let [x, y] = evPt(e, p);
  if (drag.mode === 'move') {
    if (!drag.moved && Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) < 4) return;
    drag.moved = true;
    moveAnnot(drag.a, drag.orig, x - drag.sx, y - drag.sy, p);
    const a = drag.a, o = drag.orig;
    const dx = a.t === 'ink' ? a.pts[0] - o.pts[0] : a.t === 'note' ? a.x - o.x : 'x1' in a ? a.x1 - o.x1 : a.cx - o.cx;
    const dy = a.t === 'ink' ? a.pts[1] - o.pts[1] : a.t === 'note' ? a.y - o.y : 'y1' in a ? a.y1 - o.y1 : a.cy - o.cy;
    const tr = 'translate(' + r2(dx) + ' ' + r2(dy) + ')', svg = RT.get(p.id).svg;
    const g = svg.querySelector('.a[data-id="' + a.id + '"]'), sg = svg.querySelector('.sel');
    if (g) g.setAttribute('transform', tr);
    if (sg) sg.setAttribute('transform', tr);
    return;
  }
  if (drag.mode === 'resize') { resizeAnnot(drag, x, y); drawAnnots(p, drag.handle); return; }
  x = clamp(x, 0, viewW(p)); y = clamp(y, 0, viewH(p));
  if (drag.tool === 'ink') {
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e], pts = drag.a.pts;
    for (const ce of (evs.length ? evs : [e])) {
      let [qx, qy] = evPt(ce, p);
      qx = clamp(qx, 0, viewW(p)); qy = clamp(qy, 0, viewH(p));
      if (Math.hypot(qx - pts[pts.length - 2], qy - pts[pts.length - 1]) >= 0.8 / Math.max(S.scale, 0.6)) pts.push(r2(qx), r2(qy));
    }
    if (drag.node) drag.node.setAttribute('d', segsD(inkSegs(pts)));
    return;
  }
  if (!drag.moved && Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) < 5) return;
  const kind = drag.tool === 'hl' ? 'hl' : drag.tool === 'cover' ? (S.style.cover.kind === 'redact' ? 'redact' : 'cover') : drag.tool === 'shape' ? S.style.shape.kind : null;
  if (!kind) return;
  drag.moved = true;
  if (!drag.a) { drag.a = makeDragAnnot(kind); p.annots.push(drag.a); }
  const a = drag.a;
  if (kind === 'line' || kind === 'arrow') { a.x1 = drag.sx; a.y1 = drag.sy; a.x2 = x; a.y2 = y; }
  else { a.cx = (drag.sx + x) / 2; a.cy = (drag.sy + y) / 2; a.w = Math.max(1, Math.abs(x - drag.sx)); a.h = Math.max(1, Math.abs(y - drag.sy)); }
  drawAnnots(p);
}, { passive: true });
function makeDragAnnot(kind) {
  const id = uid();
  if (kind === 'hl') return { id, t: 'hl', c: S.style.hl.c, mode: S.style.hl.mode, rot: 0, cx: 0, cy: 0, w: 1, h: 1 };
  if (kind === 'cover') return { id, t: 'cover', c: S.style.cover.c, rot: 0, cx: 0, cy: 0, w: 1, h: 1 };
  if (kind === 'redact') return { id, t: 'redact', rot: 0, cx: 0, cy: 0, w: 1, h: 1 };
  const st = S.style.shape;
  if (kind === 'line' || kind === 'arrow') return { id, t: kind, c: st.c, w: st.w, x1: 0, y1: 0, x2: 0, y2: 0 };
  return { id, t: kind, c: st.c, sw: st.w, fill: st.fill, rot: 0, cx: 0, cy: 0, w: 1, h: 1 };
}
function pointerEnd(e, cancelled) {
  touchIds.delete(e.pointerId);
  if (!drag || e.pointerId !== drag.pid) return;
  if (cancelled) { cancelDrag(); return; }
  const d = drag; drag = null;
  if (d.mode === 'erase') { if (d.n) commit(); return; }
  if (d.mode === 'move') {
    if (d.moved) { drawAnnots(d.p); commit(); }
    else if (d.was) { if (d.a.t === 'text') startTextEdit(d.a, d.p, false); else if (d.a.t === 'note') openNote(d.a, d.p); }
    return;
  }
  if (d.mode === 'resize') { commit(); return; }
  const p = d.p;
  switch (d.tool) {
    case 'ink': commit(); break;
    case 'hl': case 'cover':
      if (d.a) { if (d.a.w < 3 && d.a.h < 3) { p.annots.splice(p.annots.indexOf(d.a), 1); drawAnnots(p); } else commit(); }
      break;
    case 'shape': {
      let a = d.a;
      if (!a) {
        a = makeDragAnnot(S.style.shape.kind);
        if (a.t === 'line' || a.t === 'arrow') { a.x1 = d.sx; a.y1 = d.sy; a.x2 = Math.min(d.sx + 110, viewW(p) - 4); a.y2 = d.sy; }
        else { a.cx = d.sx; a.cy = d.sy; a.w = 120; a.h = 80; }
        p.annots.push(a);
      }
      commit(); setTool('select', true); setSel(a.id);
      break;
    }
    case 'text': newTextAt(p, d.sx, d.sy); break;
    case 'edit': editTextAt(p, d.sx, d.sy); break;
    case 'note': {
      const a = { id: uid(), t: 'note', x: clamp(d.sx - 9, 0, viewW(p) - 18), y: clamp(d.sy - 9, 0, viewH(p) - 18), text: '', c: S.style.note.c };
      p.annots.push(a); setTool('select', true); setSel(a.id); openNote(a, p, true);
      break;
    }
    case 'stamp': {
      const st = S.style.stamp;
      const raw = st.own != null ? (st.own.trim() || 'Stempel') : st.label === '@date' ? new Date().toLocaleDateString('nl-NL') : st.label;
      const label = raw.toUpperCase();
      const a = { id: uid(), t: 'stamp', label, c: st.c, rot: 0, cx: d.sx, cy: d.sy, w: widthOf(safeText(label), 'helvB', 15) + 24, h: 30 };
      p.annots.push(a); commit(); setTool('select', true); setSel(a.id);
      break;
    }
    case 'sym': {
      const st = S.style.sym;
      p.annots.push({ id: uid(), t: 'sym', kind: st.kind, c: st.c, rot: 0, cx: d.sx, cy: d.sy, w: 15, h: 15 });
      drawAnnots(p); commit();
      break;
    }
  }
}
window.addEventListener('pointerup', e => pointerEnd(e, false));
window.addEventListener('pointercancel', e => pointerEnd(e, true));
function eraseAt(e) {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const g = el && el.closest ? el.closest('.a') : null;
  if (!g) return;
  const f = findAnnot(g.dataset.id);
  if (!f) return;
  f.p.annots.splice(f.p.annots.indexOf(f.a), 1);
  drawAnnots(f.p);
  drag.n++;
}
pagesEl.addEventListener('dblclick', e => {
  if (S.tool !== 'select') return;
  const g = e.target.closest('.a');
  if (!g) return;
  const f = findAnnot(g.dataset.id);
  if (f && f.a.t === 'text') startTextEdit(f.a, f.p, false);
  else if (f && f.a.t === 'note') openNote(f.a, f.p);
});

/* ---------- notitie ---------- */
function openNote(a, p, isNew) {
  const ta = h('textarea', { class: 'input', id: 'noteText', rows: 5, placeholder: 'Schrijf je notitie' });
  ta.value = a.text;
  let saved = false;
  const sh = sheet('Notitie', [h('div', { class: 'field' }, h('label', { for: 'noteText', text: 'Tekst van de notitie' }), ta),
    h('p', { class: 'hint', text: 'In de opgeslagen PDF staat een geel briefje; de tekst verschijnt als je erop klikt.' })],
  [h('button', { class: 'btn btn-danger', text: 'Verwijder', onclick: () => { saved = true; const i = p.annots.indexOf(a); if (i >= 0) p.annots.splice(i, 1); S.sel = null; drawAnnots(p); if (!isNew) commit(); updateStrip(); sh.close(); } }),
    h('button', { class: 'btn btn-primary', text: 'Bewaar notitie', onclick: () => { saved = true; a.text = ta.value.trim(); drawAnnots(p); commit(); sh.close(); } })],
  { onClose: () => { if (!saved && isNew) { const i = p.annots.indexOf(a); if (i >= 0) p.annots.splice(i, 1); S.sel = null; drawAnnots(p); updateStrip(); } } });
  setTimeout(() => ta.focus(), 60);
}

/* ---------- afbeelding of handtekening plaatsen ---------- */
function placeAsset(url, w, h2, targetW) {
  const i = curIndex(), p = S.pages[i];
  if (!p) return;
  const rt = RT.get(p.id), pr = rt.el.getBoundingClientRect(), vr = viewer.getBoundingClientRect();
  const cxp = (Math.max(pr.left, vr.left) + Math.min(pr.right, vr.right)) / 2, cyp = (Math.max(pr.top, vr.top) + Math.min(pr.bottom, vr.bottom)) / 2;
  const cx = clamp((cxp - pr.left) / pr.width * viewW(p), 20, viewW(p) - 20), cy = clamp((cyp - pr.top) / pr.height * viewH(p), 20, viewH(p) - 20);
  const id = uid();
  S.assets[id] = { url, w, h: h2 };
  const tw = Math.min(targetW, viewW(p) * 0.8);
  const a = { id: uid(), t: 'img', asset: id, rot: 0, cx, cy, w: tw, h: tw * h2 / w };
  p.annots.push(a);
  setTool('select', true);
  drawAnnots(p);
  setSel(a.id);
  commit();
  return a;
}
async function loadBitmap(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) {
    return await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Deze afbeelding kan je browser niet lezen. Zet hem eerst om naar JPG of PNG.')); im.src = URL.createObjectURL(file); });
  }
}
async function fileToAsset(file, maxSide, keepAlpha) {
  const bm = await loadBitmap(file);
  const k = Math.min(1, maxSide / Math.max(bm.width, bm.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bm.width * k)); c.height = Math.max(1, Math.round(bm.height * k));
  const ctx = c.getContext('2d');
  const png = keepAlpha && /png|webp|gif|svg/i.test(file.type);
  if (!png) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.drawImage(bm, 0, 0, c.width, c.height);
  return { url: c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.9), w: c.width, h: c.height, canvas: c };
}
$('#fileImg').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try { const as = await fileToAsset(f, 1800, true); placeAsset(as.url, as.w, as.h, 220); toast('Afbeelding geplaatst. Sleep hem op zijn plek.'); }
  catch (err) { toast(err.message || 'De afbeelding kon niet worden geladen.', true); }
});

/* ---------- handtekening ---------- */
const SIG_KEY = 'papierwerk.handtekeningen';
function loadSigs() { try { return JSON.parse(localStorage.getItem(SIG_KEY) || '[]'); } catch (e) { return []; } }
function storeSigs(list) { try { localStorage.setItem(SIG_KEY, JSON.stringify(list.slice(0, 4))); return true; } catch (e) { return false; } }
function trimCanvas(c) {
  const ctx = c.getContext('2d'), d = ctx.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (d[(y * c.width + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const pad = 6; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(c.width - 1, x1 + pad); y1 = Math.min(c.height - 1, y1 + pad);
  const o = document.createElement('canvas');
  o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
  o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return o;
}
function openSign() {
  let mode = 'draw', ink = '#14213D', strokes = [], cur = null, typedFont = 'Caveat', upload = null;
  const saved = loadSigs();
  const pad = h('canvas', { class: 'sigpad', width: 1000, height: 400, 'aria-label': 'Tekenvlak voor je handtekening' });
  const pctx = pad.getContext('2d');
  const redraw = () => {
    pctx.clearRect(0, 0, pad.width, pad.height);
    pctx.strokeStyle = ink; pctx.lineWidth = 5.5; pctx.lineCap = 'round'; pctx.lineJoin = 'round';
    for (const s of strokes) {
      pctx.beginPath();
      if (s.length === 1) { pctx.arc(s[0][0], s[0][1], 0.5, 0, 7); pctx.stroke(); continue; }
      pctx.moveTo(s[0][0], s[0][1]);
      for (let i = 1; i < s.length - 1; i++) pctx.quadraticCurveTo(s[i][0], s[i][1], (s[i][0] + s[i + 1][0]) / 2, (s[i][1] + s[i + 1][1]) / 2);
      pctx.lineTo(s[s.length - 1][0], s[s.length - 1][1]);
      pctx.stroke();
    }
  };
  const pp = e => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * pad.width, (e.clientY - r.top) / r.height * pad.height]; };
  pad.addEventListener('pointerdown', e => { e.preventDefault(); try { pad.setPointerCapture(e.pointerId); } catch (err) {} cur = [pp(e)]; strokes.push(cur); redraw(); });
  pad.addEventListener('pointermove', e => { if (!cur) return; cur.push(pp(e)); redraw(); });
  const stop = () => { cur = null; };
  pad.addEventListener('pointerup', stop); pad.addEventListener('pointercancel', stop);

  const typed = h('input', { class: 'input', id: 'sigTyped', type: 'text', placeholder: 'Typ je naam', autocomplete: 'name' });
  const preview = h('div', { class: 'typed-preview' });
  const syncTyped = () => { preview.textContent = typed.value || 'Jouw naam'; preview.style.fontFamily = '"' + typedFont + '", "Segoe Script", "Bradley Hand", cursive'; preview.style.opacity = typed.value ? 1 : 0.35; preview.style.color = ink; };
  typed.addEventListener('input', syncTyped);

  const upBox = h('div', { class: 'typed-preview', style: { fontSize: '15px', color: '#5B6675' } }, 'Nog geen afbeelding gekozen');
  const upInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const upClean = h('input', { type: 'checkbox', id: 'sigClean', checked: true });
  const renderUpload = async () => {
    if (!upload) return;
    const c = document.createElement('canvas');
    c.width = upload.canvas.width; c.height = upload.canvas.height;
    const x = c.getContext('2d');
    x.drawImage(upload.canvas, 0, 0);
    if (upClean.checked) {
      // papier wegpoetsen: licht wordt doorzichtig, inkt blijft
      const im = x.getImageData(0, 0, c.width, c.height), d = im.data;
      for (let i = 0; i < d.length; i += 4) {
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        d[i + 3] = Math.min(d[i + 3], clamp((205 - lum) * 3.2, 0, 255));
      }
      x.putImageData(im, 0, 0);
    }
    upload.out = c;
    upBox.textContent = '';
    upBox.append(h('img', { src: c.toDataURL('image/png'), alt: 'Gekozen handtekening', style: { maxHeight: '110px', maxWidth: '100%' } }));
  };
  upInput.addEventListener('change', async () => {
    const f = upInput.files[0];
    if (!f) return;
    try { upload = await fileToAsset(f, 1200, true); await renderUpload(); } catch (err) { toast(err.message || 'De afbeelding kon niet worden geladen.', true); }
  });
  upClean.addEventListener('change', renderUpload);

  const panes = {
    draw: h('div', { style: { display: 'grid', gap: '10px' } }, h('div', { class: 'sigline' }, pad),
      h('div', { class: 'row' }, h('button', { class: 'btn', text: 'Wis', onclick: () => { strokes = []; redraw(); } }), h('span', { class: 'hint grow', text: 'Teken met je vinger, pen of muis.' }))),
    type: h('div', { style: { display: 'grid', gap: '10px' } }, h('div', { class: 'field' }, h('label', { for: 'sigTyped', text: 'Je naam' }), typed), preview,
      chips([['Caveat', 'Vlot'], ['Dancing Script', 'Sierlijk']], typedFont, () => {})),
    upload: h('div', { style: { display: 'grid', gap: '10px' } }, upBox, upInput,
      h('div', { class: 'row' }, h('button', { class: 'btn', text: 'Kies een foto van je handtekening', onclick: () => upInput.click() })),
      h('label', { class: 'check', for: 'sigClean' }, upClean, h('span', null, 'Maak het papier doorzichtig'))),
  };
  // lettertypekeuze opnieuw opbouwen zodat de actieve chip klopt
  const fontRow = panes.type.lastChild;
  const drawFontRow = () => { fontRow.textContent = ''; for (const [f, l] of [['Caveat', 'Vlot'], ['Dancing Script', 'Sierlijk']]) fontRow.append(h('button', { class: 'chip', 'aria-pressed': String(typedFont === f), text: l, style: { fontFamily: '"' + f + '", cursive', fontSize: '17px' }, onclick: () => { typedFont = f; drawFontRow(); syncTyped(); } })); };
  drawFontRow(); syncTyped();

  const tabs = h('div', { class: 'row', style: { gap: '6px' } });
  const body = h('div');
  const inkRow = h('div', { class: 'row' });
  const setMode = m => {
    mode = m;
    tabs.textContent = '';
    for (const [id, l] of [['draw', 'Tekenen'], ['type', 'Typen'], ['upload', 'Foto']]) tabs.append(h('button', { class: 'chip', 'aria-pressed': String(mode === id), text: l, onclick: () => setMode(id) }));
    body.textContent = ''; body.append(panes[m]);
    inkRow.hidden = m === 'upload';
  };
  const drawInk = () => { inkRow.textContent = ''; inkRow.append(h('span', { class: 'hint', text: 'Inkt' }), ...[['#14213D', 'Zwartblauw'], ['#111111', 'Zwart'], ['#1B3FA0', 'Blauw']].map(([c, l]) => h('button', { class: 'sw', style: { background: c }, 'aria-pressed': String(ink === c), 'aria-label': l, title: l, onclick: () => { ink = c; drawInk(); redraw(); syncTyped(); } }))); };
  drawInk(); setMode('draw');

  const savedBox = h('div', { class: 'saved-sigs' });
  const drawSaved = () => {
    savedBox.textContent = '';
    saved.forEach((s, i) => savedBox.append(h('div', { class: 'saved-sig', role: 'button', tabindex: 0, title: 'Plaats deze handtekening', onclick: () => { sh.close(); placeAsset(s.url, s.w, s.h, 150); toast('Handtekening geplaatst. Sleep hem op zijn plek.'); } },
      h('img', { src: s.url, alt: 'Bewaarde handtekening ' + (i + 1) }),
      h('button', { class: 'x', 'aria-label': 'Verwijder bewaarde handtekening', html: ico('close'), onclick: ev => { ev.stopPropagation(); saved.splice(i, 1); storeSigs(saved); drawSaved(); } }))));
    savedWrap.hidden = !saved.length;
  };
  const savedWrap = h('div', { class: 'field' }, h('span', { text: 'Bewaard op dit apparaat' }), savedBox);
  const keep = h('input', { type: 'checkbox', id: 'sigKeep' });

  const finish = async () => {
    let c = null;
    if (mode === 'draw') c = trimCanvas(pad);
    else if (mode === 'type') {
      const name = typed.value.trim();
      if (name) {
        try { await document.fonts.load('500 120px "' + typedFont + '"'); } catch (e) {}
        const t = document.createElement('canvas'), x = t.getContext('2d');
        const font = '500 120px "' + typedFont + '", "Segoe Script", "Bradley Hand", cursive';
        x.font = font;
        t.width = Math.ceil(x.measureText(name).width + 80); t.height = 240;
        const y = t.getContext('2d');
        y.font = font; y.fillStyle = ink; y.textBaseline = 'middle';
        y.fillText(name, 40, 120);
        c = trimCanvas(t);
      }
    } else if (upload && upload.out) c = trimCanvas(upload.out);
    if (!c) { toast(mode === 'draw' ? 'Teken eerst je handtekening in het vak.' : mode === 'type' ? 'Typ eerst je naam.' : 'Kies eerst een foto.', true); return; }
    const url = c.toDataURL('image/png');
    if (keep.checked) { saved.unshift({ url, w: c.width, h: c.height }); if (!storeSigs(saved)) toast('Bewaren lukte niet op dit apparaat; de handtekening is wel geplaatst.'); }
    sh.close();
    placeAsset(url, c.width, c.height, 150);
    toast('Handtekening geplaatst. Sleep hem op zijn plek.');
  };
  const sh = sheet('Onderteken', [savedWrap, tabs, body, inkRow, h('label', { class: 'check', for: 'sigKeep' }, keep, h('span', null, 'Bewaar deze handtekening op dit apparaat', h('br'), h('span', { class: 'hint', text: 'Hij blijft in deze browser en gaat nergens heen.' })))],
    [h('button', { class: 'btn btn-primary', text: 'Plaats handtekening', onclick: finish })]);
  drawSaved();
}

/* ---------- tekst selecteren en direct markeren ---------- */
let selPop = null, selTimer = 0;
/* Laat je de muis los in de witruimte tussen twee regels, dan selecteert de browser soms alles tot het
   einde van de pagina. We onthouden waar je sleepte en houden alleen de regels daartussen over. */
let selDrag = null;
pagesEl.addEventListener('pointerdown', e => { selDrag = e.pointerType === 'mouse' ? { y0: e.clientY + viewer.scrollTop, y1: null } : null; }, true);
window.addEventListener('pointerup', e => { if (selDrag && selDrag.y1 == null && e.pointerType === 'mouse') selDrag.y1 = e.clientY + viewer.scrollTop; }, true);
document.addEventListener('keydown', () => { selDrag = null; }, true);
function hideSelPop() { if (selPop) { selPop.remove(); selPop = null; } }
function selectionRects() {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return [];
  const range = sel.getRangeAt(0);
  const root = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  if (!root || !root.closest || !(root.closest('#pages') || root.id === 'pages')) return [];
  const out = [];
  const walker = document.createTreeWalker(root.nodeType === 1 ? root : root.parentElement, NodeFilter.SHOW_TEXT);
  let n = walker.currentNode.nodeType === 3 ? walker.currentNode : walker.nextNode();
  for (; n; n = walker.nextNode()) {
    if (!range.intersectsNode(n) || !n.parentElement || !n.parentElement.closest('.textLayer')) continue;
    const r = document.createRange();
    r.selectNodeContents(n);
    if (n === range.startContainer) r.setStart(n, range.startOffset);
    if (n === range.endContainer) r.setEnd(n, range.endOffset);
    for (const cr of r.getClientRects()) if (cr.width > 1 && cr.height > 1) out.push({ rect: cr, page: n.parentElement.closest('.page') });
  }
  if (selDrag && selDrag.y1 != null) {
    const st = viewer.scrollTop, lo = Math.min(selDrag.y0, selDrag.y1) - 3, hi = Math.max(selDrag.y0, selDrag.y1) + 3;
    const kept = out.filter(o => o.rect.top + st <= hi && o.rect.bottom + st >= lo);
    if (kept.length) return kept;
  }
  return out;
}
function markSelection(mode) {
  const rects = selectionRects();
  if (!rects.length) return;
  const byPage = new Map();
  for (const { rect, page } of rects) {
    const p = page && pageById(page.dataset.id);
    if (!p) continue;
    const pr = RT.get(p.id).svg.getBoundingClientRect(), kx = viewW(p) / pr.width, ky = viewH(p) / pr.height;
    const b = { x0: (rect.left - pr.left) * kx, x1: (rect.right - pr.left) * kx, y0: (rect.top - pr.top) * ky, y1: (rect.bottom - pr.top) * ky };
    if (!byPage.has(p)) byPage.set(p, []);
    const list = byPage.get(p);
    // stukjes op dezelfde regel aan elkaar rijgen
    const m = list.find(o => Math.min(o.y1, b.y1) - Math.max(o.y0, b.y0) > 0.6 * Math.min(o.y1 - o.y0, b.y1 - b.y0) && b.x0 <= o.x1 + (b.y1 - b.y0) && b.x1 >= o.x0 - (b.y1 - b.y0));
    if (m) { m.x0 = Math.min(m.x0, b.x0); m.x1 = Math.max(m.x1, b.x1); m.y0 = Math.min(m.y0, b.y0); m.y1 = Math.max(m.y1, b.y1); }
    else list.push(b);
  }
  const c = mode === 'mark' ? (S.style.hl.c === '#E5383B' ? '#FFE14A' : S.style.hl.c) : '#E5383B';
  for (const [p, list] of byPage) {
    for (const b of list) p.annots.push({ id: uid(), t: 'hl', c, mode, rot: 0, cx: r2((b.x0 + b.x1) / 2), cy: r2((b.y0 + b.y1) / 2), w: r2(b.x1 - b.x0), h: r2(b.y1 - b.y0) });
    drawAnnots(p);
  }
  getSelection().removeAllRanges();
  hideSelPop();
  commit();
}
document.addEventListener('selectionchange', () => {
  clearTimeout(selTimer);
  selTimer = setTimeout(() => {
    hideSelPop();
    if (S.tool !== 'select' || editor) return;
    const rects = selectionRects();
    if (!rects.length) return;
    const last = rects[rects.length - 1].rect;
    const act = (label, fn) => h('button', { class: 'btn btn-quiet', text: label, onpointerdown: e => e.preventDefault(), onclick: fn });
    selPop = h('div', { class: 'selpop' },
      act('Markeer', () => markSelection('mark')), act('Onderstreep', () => markSelection('under')), act('Streep door', () => markSelection('strike')),
      act('Kopieer', async () => { try { await navigator.clipboard.writeText(getSelection().toString()); toast('Gekopieerd'); } catch (e) { toast('Kopiëren lukte niet. Gebruik Ctrl+C.', true); } hideSelPop(); }));
    document.body.append(selPop);
    const w = selPop.offsetWidth, hh = selPop.offsetHeight;
    let top = last.bottom + 10;
    if (top + hh > innerHeight - 8) top = rects[0].rect.top - hh - 10;
    selPop.style.left = clamp(last.right - w / 2, 8, innerWidth - w - 8) + 'px';
    selPop.style.top = clamp(top, 8, innerHeight - hh - 8) + 'px';
  }, 260);
});
viewer.addEventListener('scroll', hideSelPop, { passive: true });
