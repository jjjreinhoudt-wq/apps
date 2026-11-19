/* Papierwerk: vergelijken, QR-code, voorlezen, foto rechttrekken */
'use strict';

Object.assign(ICONS, {
  compare: 'M10 4H4v16h6M14 4h6v16h-6M12 2v20M6.5 9h1.5M6.5 13h1.5M16 9h1.5M16 13h1.5',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2.5v2.5H14zM20 14v2.5M14 20h2.5M20 20h.01M17.5 17.5H20',
  speaker: 'M4 10v4h3l5 4V6L7 10zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
  camera: 'M4 8h3l2-2.5h6L17 8h3v11H4zM12 16.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  play: 'M8 5l11 7-11 7z',
  pause: 'M8 5v14M16 5v14',
});

(function () {
  const css = `
.cmp-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 13.5px; color: var(--muted); margin: 0 0 10px; }
.cmp-legend b { font-weight: 600; padding: 1px 6px; border-radius: 5px; color: var(--ink); }
.cmp-ins { background: #C9F2B4; color: #123D1E; border-radius: 4px; padding: 0 3px; text-decoration: none; }
.cmp-del { background: #FFD3D6; color: #7A1220; border-radius: 4px; padding: 0 3px; text-decoration: line-through; text-decoration-thickness: 1.5px; }
.cmp-list { display: grid; gap: 6px; }
.cmp-row { display: grid; grid-template-columns: 46px 1fr; gap: 10px; align-items: baseline; width: 100%; text-align: left; border: 1px solid var(--line); background: var(--raised); color: var(--ink); border-radius: var(--r-m, 10px); padding: 9px 11px; cursor: pointer; font: inherit; line-height: 1.5; }
.cmp-row:hover { border-color: var(--accent); }
.cmp-row small { color: var(--muted); font-size: 12.5px; white-space: nowrap; }
.cmp-row span { overflow-wrap: anywhere; }
.cmp-row i { font-style: normal; color: var(--muted); }
.cmp-sum { font-family: var(--font-display, inherit); font-size: 22px; font-weight: 650; line-height: 1.2; margin: 0 0 6px; }
.qr-wrap { display: grid; grid-template-columns: 1fr; gap: 14px; }
.qr-prev { justify-self: center; width: min(220px, 60vw); aspect-ratio: 1; background: #fff; border: 1px solid var(--line); border-radius: 12px; display: grid; place-items: center; padding: 10px; }
.qr-prev canvas { width: 100%; height: 100%; image-rendering: pixelated; }
.qr-prev p { margin: 0; color: #5A6472; font-size: 13.5px; text-align: center; }
@media (min-width: 640px) { .qr-wrap { grid-template-columns: 1fr 220px; align-items: start; } .qr-prev { width: 220px; } }
.leesbalk { position: fixed; left: 50%; bottom: calc(86px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); z-index: 60; display: flex; align-items: center; gap: 4px; padding: 6px 8px; background: var(--ink); color: var(--panel); border-radius: 999px; box-shadow: 0 10px 30px rgba(10, 20, 40, .28); max-width: calc(100vw - 16px); }
.leesbalk button { border: 0; background: transparent; color: inherit; min-width: 44px; height: 44px; border-radius: 999px; display: grid; place-items: center; cursor: pointer; font: inherit; font-weight: 600; font-size: 14px; padding: 0 8px; }
.leesbalk button:hover { background: rgba(255, 255, 255, .14); }
.leesbalk button:focus-visible { outline: 2px solid var(--mark); outline-offset: 2px; }
.leesbalk button svg { width: 22px; height: 22px; }
.leesbalk .lees-play { background: var(--mark); color: #17202B; }
.leesbalk .lees-play:hover { background: var(--mark); filter: brightness(1.06); }
.leesbalk .lees-waar { font-size: 13px; padding: 0 6px; white-space: nowrap; opacity: .8; font-variant-numeric: tabular-nums; }
.leesmark { position: absolute; background: var(--mark); mix-blend-mode: multiply; border-radius: 3px; pointer-events: none; z-index: 3; transition: opacity .15s; }
body.night .leesmark { mix-blend-mode: screen; opacity: .45; }
`;
  document.head.append(h('style', { text: css }));
})();

/* ================= vergelijken ================= */
/* Myers-diff op twee rijen getallen. Geeft runs [soort, aIndex, bIndex, lengte] of null als ze te veel verschillen. */
function diffSeq(a, b, maxD) {
  const n0 = a.length, m0 = b.length;
  let pre = 0;
  while (pre < n0 && pre < m0 && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < n0 - pre && suf < m0 - pre && a[n0 - 1 - suf] === b[m0 - 1 - suf]) suf++;
  const N = n0 - pre - suf, M = m0 - pre - suf;
  const steps = [];                       // losse stappen van het middenstuk, achterstevoren
  if (N || M) {
    const max = Math.min(N + M, maxD), off = max + 1, V = new Int32Array(2 * max + 3), trace = [];
    let found = -1;
    for (let d = 0; d <= max && found < 0; d++) {
      trace.push(V.slice(off - d, off + d + 1));
      for (let k = -d; k <= d; k += 2) {
        let x = (k === -d || (k !== d && V[off + k - 1] < V[off + k + 1])) ? V[off + k + 1] : V[off + k - 1] + 1;
        let y = x - k;
        while (x < N && y < M && a[pre + x] === b[pre + y]) { x++; y++; }
        V[off + k] = x;
        if (x >= N && y >= M) { found = d; break; }
      }
    }
    if (found < 0) return null;
    let x = N, y = M;
    for (let d = found; d > 0; d--) {
      const Vp = trace[d], k = x - y, at = kk => Vp[kk + d];
      const pk = (k === -d || (k !== d && at(k - 1) < at(k + 1))) ? k + 1 : k - 1;
      const px = at(pk), py = px - pk;
      while (x > px && y > py) { x--; y--; steps.push(0); }
      if (x === px) { y--; steps.push(1); } else { x--; steps.push(-1); }
    }
    while (x > 0 && y > 0) { x--; y--; steps.push(0); }
  }
  const runs = [];
  let ai = 0, bi = 0;
  const push = (t, n) => { if (!n) return; const l = runs[runs.length - 1]; if (l && l[0] === t) l[3] += n; else runs.push([t, ai, bi, n]); if (t !== '+') ai += n; if (t !== '-') bi += n; };
  push('=', pre);
  for (let i = steps.length - 1; i >= 0; i--) push(steps[i] === 0 ? '=' : steps[i] < 0 ? '-' : '+', 1);
  push('=', suf);
  return runs;
}
async function tokensOfOpenDoc() {
  const out = [];
  for (let i = 0; i < S.pages.length; i++) {
    const ix = await textIndex(S.pages[i]), re = /\S+/g;
    let m;
    while ((m = re.exec(ix.raw))) out.push({ w: m[0], pi: i, k: m.index, end: m.index + m[0].length });
  }
  return out;
}
async function tokensOfPdf(pdf, prog) {
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i), tc = await pg.getTextContent();
    let s = '';
    for (const it of tc.items) { if (it.str) s += it.str; if (it.hasEOL && s && !/\s$/.test(s)) s += ' '; }
    for (const w of s.match(/\S+/g) || []) out.push({ w, pi: i - 1 });
    if (prog) prog(i / pdf.numPages);
  }
  return out;
}
function hunksOf(runs) {
  const hs = [];
  let cur = null;
  for (let i = 0; i < runs.length; i++) {
    const [t, ai, bi, n] = runs[i];
    if (t === '=') {
      // één gelijk woord tussen twee wijzigingen: bij elkaar houden, dat leest prettiger
      if (cur && n <= 1 && i < runs.length - 1) { cur.aEnd += n; cur.bEnd += n; continue; }
      cur = null; continue;
    }
    if (!cur) { cur = { aStart: ai, aEnd: ai, bStart: bi, bEnd: bi }; hs.push(cur); }
    if (t === '-') cur.aEnd = ai + n; else cur.bEnd = bi + n;
  }
  return hs;
}
function rectsOfPolys(polys) {
  const list = [];
  for (const poly of polys) {
    const xs = poly.map(v => v[0]), ys = poly.map(v => v[1]);
    const b = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    const m = list.find(o => Math.min(o.y1, b.y1) - Math.max(o.y0, b.y0) > 0.6 * Math.min(o.y1 - o.y0, b.y1 - b.y0) && b.x0 <= o.x1 + (b.y1 - b.y0) && b.x1 >= o.x0 - (b.y1 - b.y0));
    if (m) { m.x0 = Math.min(m.x0, b.x0); m.x1 = Math.max(m.x1, b.x1); m.y0 = Math.min(m.y0, b.y0); m.y1 = Math.max(m.y1, b.y1); }
    else list.push(b);
  }
  return list;
}
function pickFile(accept, multiple) {
  return new Promise(resolve => {
    const inp = h('input', { type: 'file', accept, hidden: true });
    if (multiple) inp.multiple = true;
    document.body.append(inp);
    let done = false;
    const fin = v => { if (done) return; done = true; inp.remove(); resolve(v); };
    inp.addEventListener('change', () => fin(Array.from(inp.files || [])));
    inp.addEventListener('cancel', () => fin([]));
    inp.click();
  });
}
function openCompare() {
  const sh = sheet('Vergelijk met een andere versie', [
    h('p', { text: 'Kies de andere versie van dit document. Je ziet woord voor woord wat alleen hier staat en wat alleen daar staat.' }),
    h('p', { class: 'hint', text: 'Het gaat om de tekst. Plaatjes, opmaak en gescande pagina\'s worden niet vergeleken.' })],
  [h('button', { class: 'btn btn-primary', html: ico('open') + '<span>Kies de andere PDF</span>', onclick: async () => {
    const f = (await pickFile('application/pdf,.pdf'))[0];
    if (!f) return;
    sh.close();
    compareWith(f);
  } })]);
}
async function compareWith(file) {
  const res = await run('Vergelijken', async prog => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isPdfBytes(bytes)) throw new Error('“' + file.name + '” is geen PDF.');
    const pdf = await openPdfJs(bytes, file.name);
    const B = await tokensOfOpenDoc();
    prog(0.3);
    const A = await tokensOfPdf(pdf, f => prog(0.3 + f * 0.4));
    const otherPages = pdf.numPages;
    try { pdf.destroy(); } catch (e) {}
    const ids = new Map(), idOf = w => { let v = ids.get(w); if (v == null) { v = ids.size; ids.set(w, v); } return v; };
    const a = Int32Array.from(A, t => idOf(t.w)), b = Int32Array.from(B, t => idOf(t.w));
    await tick();
    const runs = diffSeq(a, b, 2000);
    return { A, B, runs, otherPages };
  });
  if (!res) return;
  const { A, B, runs, otherPages } = res, other = file.name;
  if (!A.length && !B.length) { toast('In geen van beide documenten zit leesbare tekst. Het zijn waarschijnlijk scans.', true); return; }
  const tooDifferent = () => sheet('Vergelijken', [h('p', { class: 'cmp-sum', text: 'Deze twee lijken te weinig op elkaar' }),
    h('p', { text: 'Er zijn zoveel verschillen dat woord voor woord vergelijken niets oplevert. Dit document heeft ' + S.pages.length + (S.pages.length === 1 ? ' pagina' : ' pagina\'s') + ' en ' + B.length + ' woorden, “' + other + '” heeft er ' + otherPages + ' en ' + A.length + '.' })]);
  if (!runs) { tooDifferent(); return; }
  const same = runs.reduce((n, r) => n + (r[0] === '=' ? r[3] : 0), 0);
  if (same < 0.25 * Math.max(A.length, B.length)) { tooDifferent(); return; }
  const hs = hunksOf(runs);
  const txt = (T, i0, i1) => T.slice(i0, i1).map(t => t.w).join(' ');
  if (!hs.length) {
    sheet('Vergelijken', [h('p', { class: 'cmp-sum', text: 'De tekst is precies gelijk' }),
      h('p', { text: 'Alle ' + B.length + ' woorden in dit document staan ook zo in “' + other + '”' + (otherPages !== S.pages.length ? ', al heeft dat ' + otherPages + ' pagina\'s en dit ' + S.pages.length : '') + '.' })]);
    return;
  }
  let nIns = 0, nDel = 0, nChg = 0;
  for (const x of hs) { if (x.aEnd > x.aStart && x.bEnd > x.bStart) nChg++; else if (x.bEnd > x.bStart) nIns++; else nDel++; }
  const pageOf = x => (B[x.bStart] || B[B.length - 1] || { pi: 0 }).pi;
  const jump = async x => {
    const t = B[Math.min(x.bStart, B.length - 1)];
    if (!t) return;
    const p = S.pages[t.pi], polys = await rangePolys(p, t.k, t.end);
    goToPage(t.pi, polys.length ? polys[0][0][1] / viewH(p) : 0);
  };
  const row = x => {
    const before = txt(B, Math.max(0, x.bStart - 4), x.bStart), after = txt(B, x.bEnd, x.bEnd + 4);
    const line = h('span', null, before ? h('i', { text: '…' + before + ' ' }) : null,
      x.aEnd > x.aStart ? h('del', { class: 'cmp-del', text: txt(A, x.aStart, x.aEnd) }) : null,
      x.aEnd > x.aStart && x.bEnd > x.bStart ? ' ' : null,
      x.bEnd > x.bStart ? h('ins', { class: 'cmp-ins', text: txt(B, x.bStart, x.bEnd) }) : null,
      after ? h('i', { text: ' ' + after + '…' }) : null);
    return h('button', { class: 'cmp-row', onclick: () => { sh.close(); jump(x); } }, h('small', { text: 'p. ' + (pageOf(x) + 1) }), line);
  };
  const MAX = 250;
  const parts = [];
  if (nChg) parts.push(nChg + ' aangepast');
  if (nIns) parts.push(nIns + ' alleen hier');
  if (nDel) parts.push(nDel + ' alleen daar');
  const sh = sheet('Vergelijken', [
    h('p', { class: 'cmp-sum', text: hs.length + (hs.length === 1 ? ' verschil' : ' verschillen') }),
    h('p', { text: parts.join(', ') + '. Tik op een regel om ernaartoe te gaan.' }),
    h('p', { class: 'cmp-legend' }, h('span', null, h('b', { class: 'cmp-ins', text: 'groen' }), ' staat alleen in dit document'), h('span', null, h('b', { class: 'cmp-del', text: 'rood' }), ' staat alleen in “' + other + '”')),
    h('div', { class: 'cmp-list' }, hs.slice(0, MAX).map(row)),
    hs.length > MAX ? h('p', { class: 'hint', text: 'En nog ' + (hs.length - MAX) + ' verschillen. Markeer ze in het document om ze allemaal te zien.' }) : null,
  ], [h('button', { class: 'btn btn-primary', html: ico('highlight') + '<span>Markeer in het document</span>', onclick: async () => {
    sh.close();
    const touched = new Set();
    busy('Markeren');
    await tick();
    try {
      for (const x of hs) {
        if (x.bEnd > x.bStart) {
          const c = x.aEnd > x.aStart ? '#FFB347' : '#9BE37A';
          let i = x.bStart;
          while (i < x.bEnd) {                       // per pagina een aaneengesloten stuk
            let j = i;
            while (j + 1 < x.bEnd && B[j + 1].pi === B[i].pi) j++;
            const p = S.pages[B[i].pi];
            for (const r of rectsOfPolys(await rangePolys(p, B[i].k, B[j].end)))
              p.annots.push({ id: uid(), t: 'hl', c, mode: 'mark', rot: 0, cx: r2((r.x0 + r.x1) / 2), cy: r2((r.y0 + r.y1) / 2), w: r2(r.x1 - r.x0), h: r2(r.y1 - r.y0) });
            touched.add(p);
            i = j + 1;
          }
        } else {
          const t = B[Math.min(x.bStart, B.length - 1)];
          if (!t) continue;
          const p = S.pages[t.pi], polys = await rangePolys(p, t.k, t.end);
          const px = polys.length ? polys[0][0][0] : 20, py = polys.length ? polys[0][3][1] : 20;
          p.annots.push({ id: uid(), t: 'note', x: r2(clamp(px - 20, 0, viewW(p) - 18)), y: r2(clamp(py - 20, 0, viewH(p) - 18)), c: '#FFA6C9', text: 'Staat alleen in “' + other + '”: ' + txt(A, x.aStart, x.aEnd) });
          touched.add(p);
        }
      }
      for (const p of touched) drawAnnots(p);
      commit();
    } finally { busyOff(); }
    jump(hs[0]);
    toast('Gemarkeerd: groen is nieuw hier, oranje is aangepast, een roze notitie staat waar iets is verdwenen.');
  } })], { wide: true });
}

/* ================= QR-code ================= */
function qrCanvas(text, px) {
  const q = qrcode(0, 'M');
  q.addData(text, 'Byte');
  q.make();
  const n = q.getModuleCount(), quiet = 4, cell = Math.max(2, Math.floor(px / (n + quiet * 2)));
  const c = document.createElement('canvas');
  c.width = c.height = cell * (n + quiet * 2);
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (q.isDark(r, col)) x.fillRect((col + quiet) * cell, (r + quiet) * cell, cell, cell);
  return c;
}
function openQr() {
  if (typeof qrcode !== 'function') { toast('De QR-maker is niet geladen.', true); return; }
  try { qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8']; } catch (e) {}
  const st = { kind: 'link', link: '', ssid: '', pass: '', open: false };
  const esc = s => s.replace(/([\\;,:"])/g, '\\$1');
  const value = () => st.kind === 'link' ? st.link.trim()
    : st.ssid.trim() ? 'WIFI:T:' + (st.open ? 'nopass' : 'WPA') + ';S:' + esc(st.ssid.trim()) + ';' + (st.open ? '' : 'P:' + esc(st.pass) + ';') + ';' : '';
  const prev = h('div', { class: 'qr-prev' });
  const form = h('div', { style: { display: 'grid', gap: '12px' } });
  const btnPlace = h('button', { class: 'btn btn-primary', html: ico('qr') + '<span>Zet op de pagina</span>' });
  const btnSave = h('button', { class: 'btn', html: ico('save') + '<span>Sla op als afbeelding</span>' });
  let canvas = null;
  const refresh = () => {
    const v = value();
    prev.textContent = ''; canvas = null;
    if (!v) prev.append(h('p', { text: st.kind === 'link' ? 'Typ een link of tekst, dan verschijnt de code hier.' : 'Vul de naam van het netwerk in.' }));
    else {
      try { canvas = qrCanvas(v, 720); prev.append(canvas); }
      catch (e) { prev.append(h('p', { text: 'Dit is te veel tekst voor één QR-code. Maak het korter.' })); }
    }
    btnPlace.disabled = btnSave.disabled = !canvas;
  };
  const field = (id, label, key, attrs) => {
    const inp = h(attrs && attrs.area ? 'textarea' : 'input', Object.assign({ class: 'input', id, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' }, attrs && attrs.area ? { rows: 3 } : { type: (attrs && attrs.type) || 'text' }, attrs && attrs.ph ? { placeholder: attrs.ph } : null));
    inp.value = st[key];
    inp.addEventListener('input', () => { st[key] = inp.value; refresh(); });
    return h('div', { class: 'field' }, h('label', { for: id, text: label }), inp);
  };
  const draw = () => {
    form.textContent = '';
    form.append(h('div', { class: 'field' }, h('span', { text: 'Wat zit erin?' }), chips([['link', 'Link of tekst'], ['wifi', 'Wifi-toegang']], st.kind, v => { st.kind = v; draw(); })));
    if (st.kind === 'link') form.append(field('qrLink', 'Link of tekst', 'link', { area: true, ph: 'https://…' }));
    else {
      form.append(field('qrSsid', 'Naam van het netwerk', 'ssid'),
        h('div', { class: 'field' }, h('span', { text: 'Beveiliging' }), chips([[false, 'Met wachtwoord'], [true, 'Open netwerk']], st.open, v => { st.open = v; draw(); })));
      if (!st.open) form.append(field('qrPass', 'Wachtwoord', 'pass'));
      form.append(h('p', { class: 'hint', text: 'Wie de code scant, zit meteen op het netwerk. Het wachtwoord staat leesbaar in de code, deel hem dus alleen met gasten.' }));
    }
    refresh();
  };
  btnPlace.addEventListener('click', () => {
    if (!canvas) return;
    placeAsset(canvas.toDataURL('image/png'), canvas.width, canvas.height, 110);
    sh.close();
    toast('QR-code geplaatst. Sleep hem op zijn plek en maak hem groter of kleiner aan de hoeken.');
  });
  btnSave.addEventListener('click', async () => {
    if (!canvas) return;
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    if (await saveFile('qr-code.png', new Uint8Array(await blob.arrayBuffer()))) toast('QR-code opgeslagen');
  });
  draw();
  const sh = sheet('QR-code maken', [h('div', { class: 'qr-wrap' }, form, prev)], [btnSave, btnPlace]);
}

/* ================= voorlezen ================= */
const LEES = { on: false, playing: false, pi: 0, si: 0, list: [], rate: 1, bar: null, marks: [], token: 0, started: false, watchdog: 0 };
function canSpeak() { return 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function'; }
function guessLang(s) {
  const t = ' ' + s.toLowerCase().slice(0, 4000).replace(/[^a-zà-ÿ]+/g, ' ') + ' ';
  const count = ws => ws.reduce((n, w) => n + (t.split(' ' + w + ' ').length - 1), 0);
  const nl = count(['de', 'het', 'een', 'van', 'en', 'voor', 'niet', 'met', 'zijn', 'op']);
  const en = count(['the', 'and', 'of', 'to', 'is', 'for', 'with', 'that', 'this', 'on']);
  const de = count(['der', 'die', 'und', 'das', 'nicht', 'mit', 'für', 'ist', 'ein', 'auf']);
  return en > nl && en >= de ? 'en-US' : de > nl && de > en ? 'de-DE' : 'nl-NL';
}
const AFK = new Set('bv nr nrs o.a d.w.z etc incl excl art blz max min ca t.a.v dhr mevr mw mr dr drs ir ing prof st tel fax vs resp evt z.s.m a.u.b m.b.t i.v.m t.o.v o.b.v p.p t.w no inc ltd co'.split(' '));
async function sentencesOf(pi) {
  const ix = await textIndex(S.pages[pi]), raw = ix.raw, out = [], re = /[.!?…]+["'”’)\]]*(?=\s|$)/g;
  const add = (k, end) => {
    while (k < end && /\s/.test(raw[k])) k++;
    while (end > k && /\s/.test(raw[end - 1])) end--;
    if (end - k < 2 || !/[A-Za-zÀ-ÿ0-9]/.test(raw.slice(k, end))) return;
    while (end - k > 240) {                 // lange lappen in stukken, anders haakt de stem af
      let cut = raw.lastIndexOf(', ', k + 240);
      if (cut <= k + 60) cut = raw.lastIndexOf(' ', k + 240);
      if (cut <= k + 60) cut = k + 239;
      out.push({ k, end: cut + 1, text: raw.slice(k, cut + 1) });
      k = cut + 1;
    }
    out.push({ k, end, text: raw.slice(k, end) });
  };
  let from = 0, m;
  while ((m = re.exec(raw))) {
    const end = m.index + m[0].length;
    if (m[0][0] === '.') {
      // afkortingen (B.V., bv., nr.) en een kleine letter erna: geen zinseinde
      const word = (raw.slice(Math.max(from, m.index - 12), m.index).match(/[^\s(]+$/) || [''])[0].toLowerCase();
      const last = word.split('.').pop(), next = (raw.slice(end).match(/\S/) || [''])[0];
      if (word && (last.length === 1 && /[a-z]/.test(last) || AFK.has(word))) continue;
      if (next && /[a-zà-ÿ]/.test(next)) continue;
    }
    add(from, end);
    from = end;
  }
  add(from, raw.length);
  return out;
}
function clearLeesMarks() { for (const m of LEES.marks) m.remove(); LEES.marks = []; }
async function showLeesMark() {
  clearLeesMarks();
  const p = S.pages[LEES.pi], s = LEES.list[LEES.si], rt = p && RT.get(p.id);
  if (!p || !s || !rt) return;
  const rects = rectsOfPolys(await rangePolys(p, s.k, s.end)), W = viewW(p), H = viewH(p);
  for (const r of rects) {
    const d = h('div', { class: 'leesmark', style: { left: r.x0 / W * 100 + '%', top: r.y0 / H * 100 + '%', width: (r.x1 - r.x0) / W * 100 + '%', height: (r.y1 - r.y0) / H * 100 + '%' } });
    rt.el.append(d); LEES.marks.push(d);
  }
  if (rects.length) {
    const er = rt.el.getBoundingClientRect(), vr = viewer.getBoundingClientRect(), y = er.top + rects[0].y0 / H * er.height;
    if (y < vr.top + 60 || y > vr.bottom - 190) goToPage(LEES.pi, rects[0].y0 / H);
  } else goToPage(LEES.pi);
}
function leesFail(msg) {
  stopReading();
  toast(msg || 'Voorlezen lukt niet in deze weergave. Open Papierwerk in je browser of als app, daar werkt het wel.', true);
}
function speakCurrent() {
  const s = LEES.list[LEES.si];
  if (!s || !LEES.on) return;
  const token = ++LEES.token;
  try { speechSynthesis.cancel(); } catch (e) {}
  const u = new SpeechSynthesisUtterance(s.text.replace(/\s+/g, ' '));
  u.lang = LEES.lang; u.rate = LEES.rate;
  try {
    const vs = speechSynthesis.getVoices() || [], pre = LEES.lang.slice(0, 2);
    const v = vs.find(x => x.lang === LEES.lang) || vs.find(x => (x.lang || '').toLowerCase().startsWith(pre));
    if (v) u.voice = v;
  } catch (e) {}
  u.onstart = () => { if (token === LEES.token) { LEES.started = true; clearTimeout(LEES.watchdog); } };
  u.onend = () => { if (token !== LEES.token || !LEES.playing) return; LEES.started = true; nextSentence(1, true); };
  u.onerror = e => {
    if (token !== LEES.token) return;
    if (e && (e.error === 'interrupted' || e.error === 'canceled')) return;
    leesFail(e && e.error === 'language-unavailable' ? 'Op dit apparaat staat geen stem voor deze taal. Installeer er een bij de spraakinstellingen.' : null);
  };
  LEES.playing = true;
  updateLeesBar();
  showLeesMark();
  clearTimeout(LEES.watchdog);
  if (!LEES.started) LEES.watchdog = setTimeout(() => { if (token === LEES.token && !LEES.started && LEES.playing) leesFail(); }, 5000);
  // kleine pauze na cancel(): Android slikt anders de eerste zin in
  setTimeout(() => { if (token === LEES.token && LEES.playing) { try { speechSynthesis.speak(u); } catch (e) { leesFail(); } } }, 60);
}
async function nextSentence(d, auto) {
  let si = LEES.si + d, pi = LEES.pi, list = LEES.list;
  while (si >= list.length || si < 0) {
    pi += si < 0 ? -1 : 1;
    if (pi < 0) { pi = 0; si = 0; list = await sentencesOf(0); break; }
    if (pi >= S.pages.length) {
      if (auto) { stopReading(); toast('Uitgelezen.'); }
      return;
    }
    list = await sentencesOf(pi);
    si = d < 0 ? list.length - 1 : 0;
  }
  if (!LEES.on) return;
  LEES.pi = pi; LEES.si = si; LEES.list = list;
  if (LEES.playing || auto) speakCurrent(); else { updateLeesBar(); showLeesMark(); }
}
function pauseReading() {
  LEES.playing = false; LEES.token++;
  clearTimeout(LEES.watchdog);
  try { speechSynthesis.cancel(); } catch (e) {}
  updateLeesBar();
}
function stopReading() {
  LEES.on = false; LEES.playing = false; LEES.token++;
  clearTimeout(LEES.watchdog);
  try { speechSynthesis.cancel(); } catch (e) {}
  clearLeesMarks();
  if (LEES.bar) { LEES.bar.remove(); LEES.bar = null; }
}
function updateLeesBar() {
  if (!LEES.bar) return;
  const pb = $('.lees-play', LEES.bar);
  pb.innerHTML = ico(LEES.playing ? 'pause' : 'play');
  pb.setAttribute('aria-label', LEES.playing ? 'Pauze' : 'Lees verder');
  $('.lees-waar', LEES.bar).textContent = 'p. ' + (LEES.pi + 1) + ' van ' + S.pages.length;
  $('.lees-snel', LEES.bar).textContent = String(LEES.rate).replace('.', ',') + '×';
}
async function openReadAloud() {
  if (!canSpeak()) { toast('Je browser kan niet voorlezen.', true); return; }
  if (LEES.on) stopReading();
  let pi = curIndex(), list = [];
  for (let n = 0; n < S.pages.length; n++, pi++) {
    if (pi >= S.pages.length) break;
    list = await sentencesOf(pi);
    if (list.length) break;
  }
  if (!list.length) { toast('Vanaf hier zit er geen leesbare tekst in dit document. Is het een scan? Laat de Assistent hem dan eerst lezen.', true); return; }
  Object.assign(LEES, { on: true, pi, si: 0, list, started: false, lang: guessLang(list.map(s => s.text).join(' ')) });
  const RATES = [0.8, 1, 1.25, 1.5];
  LEES.bar = h('div', { class: 'leesbalk', role: 'group', 'aria-label': 'Voorlezen' },
    h('button', { 'aria-label': 'Vorige zin', html: ico('left'), onclick: () => nextSentence(-1) }),
    h('button', { class: 'lees-play', onclick: () => { if (LEES.playing) pauseReading(); else speakCurrent(); } }),
    h('button', { 'aria-label': 'Volgende zin', html: ico('right'), onclick: () => nextSentence(1) }),
    h('span', { class: 'lees-waar' }),
    h('button', { class: 'lees-snel', 'aria-label': 'Snelheid', onclick: () => { LEES.rate = RATES[(RATES.indexOf(LEES.rate) + 1) % RATES.length]; if (LEES.playing) speakCurrent(); else updateLeesBar(); } }),
    h('button', { 'aria-label': 'Stop met voorlezen', html: ico('close'), onclick: stopReading }));
  document.body.append(LEES.bar);
  speakCurrent();
}
window.addEventListener('pagehide', () => { try { speechSynthesis.cancel(); } catch (e) {} });

/* ================= foto rechttrekken ================= */
async function openStraighten() {
  if (!window.Rechtzetter) { toast('De fotoscanner is niet geladen.', true); return; }
  const pages = await Rechtzetter.open([], { maxSide: 2200 });
  if (!pages || !pages.length) return;
  busy('Pagina\'s maken');
  await tick();
  try {
    // elke scan wordt een pagina in zijn eigen verhouding: een brief op A4, een bon lang en smal
    const d = await PDFLib.PDFDocument.create();
    for (let i = 0; i < pages.length; i++) {
      const c = pages[i].canvas;
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.86));
      const im = await d.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const land = c.width > c.height, ar = land ? c.height / c.width : c.width / c.height;
      const long = 841.89, short = Math.abs(ar - 595.28 / 841.89) < 0.045 ? 595.28 : Math.max(120, long * ar);
      const W = land ? long : short, H = land ? short : long;
      d.addPage([W, H]).drawImage(im, { x: 0, y: 0, width: W, height: H });
      c.width = c.height = 0;
    }
    const base = (pages[0].name || 'scan').replace(/\.[a-z0-9]+$/i, '');
    const files = [new File([await d.save()], base + ' (scan).pdf', { type: 'application/pdf' })];
    busyOff();
    const empty = !S.pages.length || S.isExample;
    if (empty) await openDoc(files); else await addFiles(files, null);
  } catch (e) { toast((e && e.message) || 'De scan kon niet worden toegevoegd.', true); }
  finally { busyOff(); }
}
