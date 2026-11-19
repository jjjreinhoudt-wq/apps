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
.qr-prev { justify-self: center; width: min(220px, 60vw); min-height: 120px; background: #fff; border: 1px solid var(--line); border-radius: 12px; display: grid; place-items: center; padding: 10px; }
.qr-prev canvas { width: 100%; height: auto; display: block; }
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
/* ---- betaal-QR (EPC/SEPA): naam, IBAN, bedrag en omschrijving in één code die een bank-app kan scannen ---- */
const PAY_KEY = 'papierwerk.betaal';
function loadPay() { try { return JSON.parse(localStorage.getItem(PAY_KEY) || 'null') || {}; } catch (e) { return {}; } }
function storePay(o) { try { if (o) localStorage.setItem(PAY_KEY, JSON.stringify(o)); else localStorage.removeItem(PAY_KEY); } catch (e) {} }
function ibanClean(v) { return String(v || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase(); }
function ibanOk(v) {
  const s = ibanClean(v);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const t = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
  let r = 0;
  for (const ch of t) r = (r * 10 + +ch) % 97;
  return r === 1;
}
function parseAmount(v) {
  let s = String(v || '').replace(/[^\d.,-]/g, '');
  if (!s) return NaN;
  const c = s.lastIndexOf(','), d = s.lastIndexOf('.');
  if (c >= 0 && d >= 0) s = c > d ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (c >= 0) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  else if (d >= 0 && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '');
  return Math.round(parseFloat(s) * 100) / 100;
}
const fmtEuro = n => '€ ' + n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
/* Zoekt in de tekst van het document het te betalen bedrag en het factuurnummer. */
async function guessInvoice() {
  let text = '';
  for (const p of S.pages) text += (await textIndex(p)).raw + ' ';
  const AM = '(-?\\d{1,3}(?:[.\\s]\\d{3})+(?:,\\d{2})?|-?\\d+(?:[.,]\\d{2})?)', out = {};
  const after = kw => { const re = new RegExp('(?:' + kw + ')[^0-9€]{0,45}(?:€|EUR)?\\s*' + AM, 'ig'); let m, last = null; while ((m = re.exec(text))) last = m[1]; return last; };
  let a = after('te betalen|totaal te voldoen|te voldoen|totaal incl(?:usief|\\.)?\\s*btw|totaalbedrag|eindtotaal|factuurbedrag|amount due|total due') || after('totaal|total');
  if (!a) { let m, best = 0; const re = new RegExp('(?:€|EUR)\\s*' + AM, 'g'); while ((m = re.exec(text))) { const v = parseAmount(m[1]); if (v > best) { best = v; a = m[1]; } } }
  const amt = parseAmount(a);
  if (amt > 0) out.amount = amt;
  const f = /(?:factuur|invoice)\s*(?:nummer|nr\.?|no\.?|number)?\s*[:#]?\s*([A-Z]{0,5}[-\/]?\d[\w\-\/.]{1,18})/i.exec(text);
  if (f) out.ref = 'Factuur ' + f[1].replace(/[.,]$/, '');
  return out;
}
function epcPayload(o) {
  const amt = Math.round(o.amount * 100) / 100;
  return ['BCD', '002', '1', 'SCT', '', o.name.trim().slice(0, 70), ibanClean(o.iban), 'EUR' + amt.toFixed(2), '', '', (o.ref || '').trim().slice(0, 140)].join('\n');
}
function payCanvas(o) {
  const q = qrCanvas(epcPayload(o), 620), W = q.width, pad = 26, lh = 40;
  const lines = [['bold 34px', 'Scan en betaal met je bank-app'], ['600 30px', fmtEuro(o.amount) + (o.ref ? '  ·  ' + o.ref.trim() : '')],
    ['26px', ibanClean(o.iban).replace(/(.{4})/g, '$1 ').trim()], ['26px', 't.n.v. ' + o.name.trim()]];
  const c = document.createElement('canvas'), fam = ' Figtree, Arial, sans-serif';
  const x0 = c.getContext('2d');
  let tw = 0;
  for (const [f, t] of lines) { x0.font = f + fam; tw = Math.max(tw, x0.measureText(t).width); }
  c.width = Math.ceil(Math.max(W, tw + pad * 2)); c.height = W + lines.length * lh + pad;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(q, Math.round((c.width - W) / 2), 0);
  x.fillStyle = '#17202B'; x.textAlign = 'center'; x.textBaseline = 'middle';
  lines.forEach(([f, t], i) => { x.font = f + fam; x.fillText(t, c.width / 2, W + i * lh + lh / 2 - 4); });
  return c;
}
function openQr() {
  if (typeof qrcode !== 'function') { toast('De QR-maker is niet geladen.', true); return; }
  try { qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8']; } catch (e) {}
  const saved = loadPay();
  const st = { kind: 'link', link: '', ssid: '', pass: '', open: false, name: saved.name || '', iban: (saved.iban || '').replace(/(.{4})/g, '$1 ').trim(), amount: '', ref: '', keep: true, guessed: false };
  const esc = s => s.replace(/([\\;,:"])/g, '\\$1');
  const payOk = () => st.name.trim() && ibanOk(st.iban) && parseAmount(st.amount) > 0 && parseAmount(st.amount) < 1e9;
  const value = () => st.kind === 'pay' ? (payOk() ? 'pay' : '') : st.kind === 'link' ? st.link.trim()
    : st.ssid.trim() ? 'WIFI:T:' + (st.open ? 'nopass' : 'WPA') + ';S:' + esc(st.ssid.trim()) + ';' + (st.open ? '' : 'P:' + esc(st.pass) + ';') + ';' : '';
  const prev = h('div', { class: 'qr-prev' });
  const form = h('div', { style: { display: 'grid', gap: '12px' } });
  const btnPlace = h('button', { class: 'btn btn-primary', html: ico('qr') + '<span>Zet op de pagina</span>' });
  const btnSave = h('button', { class: 'btn', html: ico('save') + '<span>Sla op als afbeelding</span>' });
  let canvas = null;
  const refresh = () => {
    const v = value();
    prev.textContent = ''; canvas = null;
    if (!v) prev.append(h('p', { text: st.kind === 'pay' ? (st.iban.trim() && !ibanOk(st.iban) ? 'Dit rekeningnummer klopt niet. Kijk het nog even na.' : 'Vul naam, rekeningnummer en bedrag in.') : st.kind === 'link' ? 'Typ een link of tekst, dan verschijnt de code hier.' : 'Vul de naam van het netwerk in.' }));
    else {
      try { canvas = st.kind === 'pay' ? payCanvas({ name: st.name, iban: st.iban, amount: parseAmount(st.amount), ref: st.ref }) : qrCanvas(v, 720); prev.append(canvas); }
      catch (e) { prev.append(h('p', { text: 'Dit is te veel tekst voor één QR-code. Maak het korter.' })); }
    }
    btnPlace.disabled = btnSave.disabled = !canvas;
  };
  const field = (id, label, key, attrs) => {
    const inp = h(attrs && attrs.area ? 'textarea' : 'input', Object.assign({ class: 'input', id, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' }, attrs && attrs.area ? { rows: 3 } : { type: (attrs && attrs.type) || 'text' }, attrs && attrs.ph ? { placeholder: attrs.ph } : null, attrs && attrs.mode ? { inputmode: attrs.mode } : null));
    inp.value = st[key];
    inp.addEventListener('input', () => { st[key] = inp.value; refresh(); });
    return h('div', { class: 'field' }, h('label', { for: id, text: label }), inp);
  };
  const draw = () => {
    form.textContent = '';
    form.append(h('div', { class: 'field' }, h('span', { text: 'Wat zit erin?' }), chips([['pay', 'Betalen'], ['link', 'Link of tekst'], ['wifi', 'Wifi']], st.kind, v => { st.kind = v; draw(); })));
    if (st.kind === 'pay') {
      const keep = h('input', { type: 'checkbox', id: 'qrKeep', checked: st.keep });
      keep.addEventListener('change', () => { st.keep = keep.checked; });
      form.append(field('qrAmount', 'Bedrag in euro', 'amount', { ph: '0,00', mode: 'decimal' }), field('qrRef', 'Omschrijving', 'ref', { ph: 'Factuur 2026-001' }),
        field('qrName', 'Naam van de rekeninghouder', 'name'), field('qrIban', 'Rekeningnummer (IBAN)', 'iban', { ph: 'NL00 BANK 0000 0000 00' }),
        h('label', { class: 'check', for: 'qrKeep' }, keep, h('span', null, 'Bewaar naam en rekeningnummer op dit apparaat', h('br'), h('span', { class: 'hint', text: 'Ze blijven in deze app op dit apparaat en gaan nergens heen.' }))),
        h('p', { class: 'hint', text: (st.guessed ? 'Bedrag en omschrijving heb ik uit het document gehaald. Kijk ze na. ' : '') + 'Wie de code scant met zijn bank-app krijgt de overschrijving kant-en-klaar. Dat werkt bij onder meer ING, maar nog niet bij elke bank; daarom staan de gegevens er ook leesbaar onder.' }));
    } else if (st.kind === 'link') form.append(field('qrLink', 'Link of tekst', 'link', { area: true, ph: 'https://…' }));
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
    if (st.kind === 'pay') storePay(st.keep ? { name: st.name.trim(), iban: ibanClean(st.iban) } : null);
    placeAsset(canvas.toDataURL('image/png'), canvas.width, canvas.height, st.kind === 'pay' ? 150 : 110);
    sh.close();
    toast(st.kind === 'pay' ? 'Betaal-QR geplaatst. Sleep hem naar een lege plek op de factuur.' : 'QR-code geplaatst. Sleep hem op zijn plek en maak hem groter of kleiner aan de hoeken.');
  });
  btnSave.addEventListener('click', async () => {
    if (!canvas) return;
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    if (await saveFile('qr-code.png', new Uint8Array(await blob.arrayBuffer()))) toast('QR-code opgeslagen');
  });
  draw();
  const sh = sheet('QR-code maken', [h('div', { class: 'qr-wrap' }, form, prev)], [btnSave, btnPlace]);
  // staat er een bedrag in het document, dan is het waarschijnlijk een factuur: meteen de betaalcode klaarzetten
  guessInvoice().then(g => {
    if (!sh.el.isConnected || !(g.amount > 0) || st.amount || st.link || st.ssid) return;
    st.amount = g.amount.toFixed(2).replace('.', ','); st.ref = g.ref || ''; st.guessed = true;
    if (st.kind === 'link') st.kind = 'pay';
    draw();
  }).catch(() => {});
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

/* ================================================================
   Afdrukken, bijsnijden, invulvelden, links, bladwijzers
   ================================================================ */
Object.assign(ICONS, {
  print: 'M7 8V4h10v4M7 17H4v-7h16v7h-3M7 14h10v6H7z',
  crop: 'M7 3v14h14M3 7h14v14',
  field: 'M3 7h18v10H3zM7 10v4',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  bookmark: 'M7 4h10v16l-5-4-5 4z',
});
document.head.append(h('style', { text: `
#printHost { display: none; }
@media print {
  html, body { background: #fff !important; margin: 0 !important; height: auto !important; overflow: visible !important; }
  body > *:not(#printHost) { display: none !important; }
  #printHost { display: block !important; }
  #printHost img { display: block; width: 100%; height: 100vh; object-fit: contain; break-after: page; page-break-after: always; }
  #printHost img:last-child { break-after: auto; page-break-after: auto; }
  #printHost img.liggend { page: liggend; }
  @page { margin: 0; }
  @page liggend { size: landscape; margin: 0; }
}
.crop-stage { position: relative; justify-self: center; max-width: 100%; touch-action: none; user-select: none; background: #fff; box-shadow: 0 1px 6px rgba(10,20,40,.25); }
.crop-stage img { display: block; max-width: 100%; max-height: min(52vh, 520px); }
.crop-box { position: absolute; border: 2px solid var(--accent); box-shadow: 0 0 0 4000px rgba(15,20,27,.45); cursor: move; }
.crop-clip { position: absolute; inset: 0; overflow: hidden; }
.crop-h { position: absolute; width: 44px; height: 44px; margin: -22px; touch-action: none; display: grid; place-items: center; }
.crop-h::after { content: ''; width: 16px; height: 16px; border-radius: 50%; background: #fff; border: 2px solid var(--accent); }
.bm-row { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; align-items: center; }
.bm-row small { color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
` }));

/* ---------- afdrukken ---------- */
async function openPrint() {
  if (inClaude()) { toast('Afdrukken kan in deze weergave niet. Sla de PDF op en druk hem daarna af, of gebruik de geïnstalleerde app.', true); return; }
  endTextEdit();
  const imgs = await run('Afdruk voorbereiden', async prog => {
    const bytes = await buildPdf(S.pages, { progress: f => prog(f * 0.3) });
    const doc = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise, out = [];
    try {
      for (let i = 1; i <= doc.numPages; i++) {
        const pg = await doc.getPage(i), v1 = pg.getViewport({ scale: 1 });
        const vp = pg.getViewport({ scale: Math.min(3, 1750 / Math.max(v1.width, v1.height)) });
        const c = document.createElement('canvas');
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        const x = c.getContext('2d', { alpha: false });
        x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
        await pg.render({ canvasContext: x, viewport: vp }).promise;
        const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
        out.push({ url: URL.createObjectURL(blob), land: c.width > c.height });
        c.width = c.height = 0;
        prog(0.3 + 0.7 * i / doc.numPages);
      }
    } finally { try { doc.destroy(); } catch (e) {} }
    return out;
  });
  if (!imgs) return;
  const old = $('#printHost');
  if (old) old.remove();
  const host = h('div', { id: 'printHost' }, imgs.map(im => h('img', { src: im.url, alt: '', class: im.land ? 'liggend' : null })));
  document.body.append(host);
  await Promise.all(Array.from(host.children).map(im => im.decode().catch(() => {})));
  const clean = () => { for (const im of imgs) URL.revokeObjectURL(im.url); host.remove(); };
  window.addEventListener('afterprint', clean, { once: true });
  try { window.print(); } catch (e) { clean(); toast('Afdrukken lukte niet in deze browser. Sla de PDF op en druk hem daarna af.', true); }
}

/* ---------- document opnieuw laden na een bewerking die in het bestand zelf gebeurt ---------- */
async function rebake(label, edit, done) {
  endTextEdit();
  const keepOutline = S.outline, keepMeta = S.meta, name = S.name;
  const src = await run(label, async prog => {
    const bytes = await buildPdf(S.pages, { progress: f => prog(f * 0.3) });
    const out = await edit(bytes, f => prog(0.3 + f * 0.65));
    if (!out) return null;
    return await makeSource(out, name);
  });
  if (!src) return false;
  // bladwijzers verwijzen naar pagina's; die krijgen nieuwe nummers, in dezelfde volgorde
  const oldIds = S.pages.map(p => p.id), pages = await pagesOf(src);
  replaceDoc([{ src, pages }], name, { meta: keepMeta, assets: {} });
  if (Array.isArray(keepOutline)) S.outline = keepOutline.map(o => ({ title: o.title, page: (pages[oldIds.indexOf(o.page)] || {}).id })).filter(o => o.page);
  setDirty(true);
  scheduleSessionSave();
  if (done) done();
  return true;
}
const hasMarks = () => S.pages.some(p => p.annots.length) || !!(S.fx && (S.fx.wm || S.fx.num || S.fx.head));

/* ---------- bijsnijden ---------- */
async function openCrop() {
  endTextEdit();
  const pi = curIndex(), p = S.pages[pi];
  if (!p) return;
  busy('Pagina laden');
  let url, cw, ch2;
  try {
    const pg = await getPg(S.sources[p.src], p.idx), rot = (pg.rotate + p.rot) % 360, v1 = pg.getViewport({ scale: 1, rotation: rot });
    const vp = pg.getViewport({ scale: Math.min(2, 900 / Math.max(v1.width, v1.height)), rotation: rot }), c = document.createElement('canvas');
    c.width = cw = Math.round(vp.width); c.height = ch2 = Math.round(vp.height);
    const x = c.getContext('2d', { alpha: false });
    x.fillStyle = '#fff'; x.fillRect(0, 0, cw, ch2);
    await pg.render({ canvasContext: x, viewport: vp }).promise;
    var pix = x.getImageData(0, 0, cw, ch2).data;
    url = c.toDataURL('image/jpeg', 0.85);
  } catch (e) { busyOff(); toast('Deze pagina kon niet worden geladen.', true); return; }
  busyOff();
  const R = { l: 0.06, t: 0.06, r: 0.94, b: 0.94 };
  let all = false;
  const box = h('div', { class: 'crop-box' }), img = h('img', { src: url, alt: 'Pagina ' + (pi + 1), draggable: 'false' });
  const hs = ['lt', 'rt', 'lb', 'rb'].map(k => h('div', { class: 'crop-h', 'data-k': k, role: 'slider', 'aria-label': 'Hoek van de uitsnede' }));
  const stage = h('div', { class: 'crop-stage' }, img, h('div', { class: 'crop-clip' }, box), hs);
  const place = () => {
    Object.assign(box.style, { left: R.l * 100 + '%', top: R.t * 100 + '%', width: (R.r - R.l) * 100 + '%', height: (R.b - R.t) * 100 + '%' });
    for (const e of hs) { const k = e.dataset.k; e.style.left = (k[0] === 'l' ? R.l : R.r) * 100 + '%'; e.style.top = (k[1] === 't' ? R.t : R.b) * 100 + '%'; }
  };
  let drag = null;
  const pos = e => { const b = stage.getBoundingClientRect(); return [(e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height]; };
  const down = (e, k) => { e.preventDefault(); e.stopPropagation(); drag = { k, p0: pos(e), R0: Object.assign({}, R) }; e.currentTarget.setPointerCapture(e.pointerId); };
  const move = e => {
    if (!drag) return;
    const [x, y] = pos(e), MIN = 0.06;
    if (drag.k === 'box') {
      const w = drag.R0.r - drag.R0.l, hh = drag.R0.b - drag.R0.t;
      R.l = clamp(drag.R0.l + x - drag.p0[0], 0, 1 - w); R.t = clamp(drag.R0.t + y - drag.p0[1], 0, 1 - hh); R.r = R.l + w; R.b = R.t + hh;
    } else {
      if (drag.k[0] === 'l') R.l = clamp(x, 0, R.r - MIN); else R.r = clamp(x, R.l + MIN, 1);
      if (drag.k[1] === 't') R.t = clamp(y, 0, R.b - MIN); else R.b = clamp(y, R.t + MIN, 1);
    }
    place();
  };
  const up = () => { drag = null; };
  for (const e of hs) { e.addEventListener('pointerdown', ev => down(ev, e.dataset.k)); e.addEventListener('pointermove', move); e.addEventListener('pointerup', up); e.addEventListener('pointercancel', up); }
  box.addEventListener('pointerdown', ev => down(ev, 'box')); box.addEventListener('pointermove', move); box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  const autoFit = () => {
    let x0 = cw, y0 = ch2, x1 = -1, y1 = -1;
    for (let y = 0; y < ch2; y += 2) for (let x = 0; x < cw; x += 2) {
      const i = (y * cw + x) * 4;
      if (pix[i] * 0.299 + pix[i + 1] * 0.587 + pix[i + 2] * 0.114 < 238) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    // wat je zelf op de pagina hebt gezet telt ook mee
    for (const a of p.annots) { const bx = annotBox(a), hw = bx.w / 2 + 2, hh2 = bx.h / 2 + 2, k = cw / viewW(p);
      x0 = Math.min(x0, (bx.cx - hw) * k); x1 = Math.max(x1, (bx.cx + hw) * k); y0 = Math.min(y0, (bx.cy - hh2) * k); y1 = Math.max(y1, (bx.cy + hh2) * k); }
    if (x1 < 0) { toast('Deze pagina is leeg.'); return; }
    const m = 0.02;
    R.l = clamp(x0 / cw - m, 0, 1); R.t = clamp(y0 / ch2 - m, 0, 1); R.r = clamp(x1 / cw + m, 0, 1); R.b = clamp(y1 / ch2 + m, 0, 1);
    place();
  };
  const scope = h('div');
  const drawScope = () => { scope.textContent = ''; scope.append(chips([[false, 'Alleen pagina ' + (pi + 1)], [true, "Alle pagina's"]], all, v => { all = v; drawScope(); })); };
  drawScope(); place();
  const sh = sheet('Pagina bijsnijden', [stage,
    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } }, h('button', { class: 'btn', text: 'Witte randen eraf', onclick: autoFit }), h('button', { class: 'btn', text: 'Hele pagina', onclick: () => { R.l = R.t = 0; R.r = R.b = 1; place(); } })),
    S.pages.length > 1 ? h('div', { class: 'field' }, h('span', { text: 'Toepassen op' }), scope) : null,
    h('p', { class: 'hint', text: (hasMarks() ? 'Je aantekeningen worden hierbij vastgezet in de pagina en zijn daarna niet meer los te verplaatsen. ' : '') + 'Wat je wegsnijdt is niet meer te zien, maar zit nog wel in het bestand. Gebruik voor gevoelige gegevens het zwartlakken.' })],
  [h('button', { class: 'btn btn-primary', html: ico('crop') + '<span>Snijd bij</span>', onclick: async () => {
    sh.close();
    const ok = await rebake('Bijsnijden', async bytes => {
      const d = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false }), js = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
      try {
        for (let i = 0; i < d.getPageCount(); i++) {
          if (!all && i !== pi) continue;
          const vp = (await js.getPage(i + 1)).getViewport({ scale: 1 });
          const a = vp.convertToPdfPoint(R.l * vp.width, R.t * vp.height), b = vp.convertToPdfPoint(R.r * vp.width, R.b * vp.height);
          const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), w = Math.abs(a[0] - b[0]), hh = Math.abs(a[1] - b[1]), pg = d.getPage(i);
          for (const k of ['TrimBox', 'BleedBox', 'ArtBox']) pg.node.delete(PDFLib.PDFName.of(k));
          pg.setMediaBox(x, y, w, hh); pg.setCropBox(x, y, w, hh);
        }
      } finally { try { js.destroy(); } catch (e) {} }
      return await d.save();
    }, () => goToPage(pi));
    if (ok) toast(all ? "Alle pagina's zijn bijgesneden." : 'Pagina ' + (pi + 1) + ' is bijgesneden.');
  } })], { wide: true });
}

/* ---------- invulvelden en links: vakken op de pagina, die bij opslaan echt worden ---------- */
function extraAnnotItems(a) {
  const col = a.t === 'field' ? '#1F4FD1' : '#8E44AD', its = [
    { k: 'path', segs: boxSegs(a), fill: col, o: 0.13, screenOnly: true },
    { k: 'path', segs: boxSegs(a), stroke: col, sw: 1, miter: true, screenOnly: true }];
  const label = a.quiet ? '' : a.t === 'field' ? (a.kind === 'check' ? '' : a.name) : (a.url ? a.url.replace(/^https?:\/\//, '') : 'naar p. ' + (S.pages.findIndex(p => p.id === a.page) + 1));
  const fs = Math.min(9, a.h * 0.62);
  if (label && fs >= 5 && a.w > 30) {
    const str = safeText(label), maxW = a.w - 8, wFull = widthOf(str, 'helv', fs);
    const [x, y] = L2V(a, -a.w / 2 + 4, Math.min(a.h / 2 - 3, -a.h / 2 + fs + 2));
    its.push({ k: 'text', x, y, size: fs, font: 'helv', c: col, str, w: Math.min(wFull, maxW), rot: a.rot || 0, screenOnly: true });
  }
  return its;
}
function placeBox(a, w, hh) {
  const i = curIndex(), p = S.pages[i];
  if (!p) return null;
  const rt = RT.get(p.id), pr = rt.el.getBoundingClientRect(), vr = viewer.getBoundingClientRect();
  const cxp = (Math.max(pr.left, vr.left) + Math.min(pr.right, vr.right)) / 2, cyp = (Math.max(pr.top, vr.top) + Math.min(pr.bottom, vr.bottom)) / 2;
  Object.assign(a, { id: uid(), rot: 0, w: Math.min(w, viewW(p) * 0.8), h: hh,
    cx: clamp((cxp - pr.left) / pr.width * viewW(p), 20, viewW(p) - 20), cy: clamp((cyp - pr.top) / pr.height * viewH(p), 20, viewH(p) - 20) });
  p.annots.push(a);
  setTool('select', true);
  drawAnnots(p);
  setSel(a.id);
  commit();
  return a;
}
function openFieldAdd() {
  let kind = 'text';
  const n = S.pages.reduce((s, p) => s + p.annots.filter(a => a.t === 'field').length, 0) + 1;
  const name = h('input', { class: 'input', id: 'fldName', type: 'text', value: 'Veld ' + n, autocomplete: 'off' });
  const row = h('div');
  const draw = () => { row.textContent = ''; row.append(chips([['text', 'Tekstregel'], ['multi', 'Groot tekstvak'], ['check', 'Aankruisvakje']], kind, v => { kind = v; draw(); })); };
  draw();
  const sh = sheet('Invulveld toevoegen', [
    h('div', { class: 'field' }, h('span', { text: 'Soort veld' }), row),
    h('div', { class: 'field' }, h('label', { for: 'fldName', text: 'Naam van het veld' }), name),
    h('p', { class: 'hint', text: 'Het veld komt als blauw vak op de pagina. Sleep het op zijn plek en maak het op maat. Na het opslaan kan iedereen het invullen in zijn eigen pdf-lezer.' })],
  [h('button', { class: 'btn btn-primary', html: ico('field') + '<span>Zet op de pagina</span>', onclick: () => {
    const nm = name.value.trim() || 'Veld ' + n;
    sh.close();
    placeBox({ t: 'field', kind, name: nm }, kind === 'check' ? 16 : kind === 'multi' ? 260 : 190, kind === 'check' ? 16 : kind === 'multi' ? 72 : 22);
    toast('Veld geplaatst. Sleep het op zijn plek.');
  } })]);
  setTimeout(() => { name.focus(); name.select(); }, 60);
}
function openLinkAdd() {
  let kind = 'url';
  const url = h('input', { class: 'input', id: 'lnkUrl', type: 'url', placeholder: 'https://…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const pageNo = h('input', { class: 'input', id: 'lnkPage', type: 'number', min: 1, max: S.pages.length, value: Math.min(S.pages.length, curIndex() + 2) });
  const body = h('div', { style: { display: 'grid', gap: '12px' } });
  const draw = () => {
    body.textContent = '';
    body.append(h('div', { class: 'field' }, h('span', { text: 'Waar gaat de link heen?' }), chips([['url', 'Website of e-mail'], ['page', 'Pagina in dit document']], kind, v => { kind = v; draw(); })),
      kind === 'url' ? h('div', { class: 'field' }, h('label', { for: 'lnkUrl', text: 'Adres' }), url) : h('div', { class: 'field' }, h('label', { for: 'lnkPage', text: 'Paginanummer (1 tot ' + S.pages.length + ')' }), pageNo));
  };
  draw();
  const sh = sheet('Link toevoegen', [body, h('p', { class: 'hint', text: 'De link komt als paars vak op de pagina. Leg het over de tekst of het plaatje dat moet werken als link. In de opgeslagen PDF is het vak onzichtbaar.' })],
  [h('button', { class: 'btn btn-primary', html: ico('link') + '<span>Zet op de pagina</span>', onclick: () => {
    const a = { t: 'link' };
    if (kind === 'url') {
      let u = url.value.trim();
      if (!u) { toast('Vul eerst een adres in.', true); return; }
      if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(u)) u = 'mailto:' + u;
      else if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
      a.url = u;
    } else {
      const k = parseInt(pageNo.value, 10);
      if (!(k >= 1 && k <= S.pages.length)) { toast('Kies een paginanummer van 1 tot ' + S.pages.length + '.', true); return; }
      a.page = S.pages[k - 1].id;
    }
    sh.close();
    placeBox(a, 150, 20);
    toast('Link geplaatst. Leg het vak over de tekst die moet werken als link.');
  } })]);
}
/* Wordt door buildPdf aangeroepen als alle pagina's staan: maakt van de vakken echte velden en links, en schrijft de bladwijzers. */
function finishExtras(out, built) {
  const L = PDFLib, cx = out.context, byId = new Map();
  for (const b of built) if (!byId.has(b.p.id)) byId.set(b.p.id, b);
  const rectOf = (a, T) => {
    const xs = [], ys = [];
    for (const [lx, ly] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const [vx, vy] = L2V(a, lx * a.w / 2, ly * a.h / 2); xs.push(T[0] * vx + T[2] * vy + T[4]); ys.push(T[1] * vx + T[3] * vy + T[5]); }
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };
  let form = null;
  const names = new Set();
  for (const b of built) for (const a of b.p.annots) {
    if (a.t === 'field') {
      try {
        form = form || out.getForm();
        const base = (a.name || 'Veld').replace(/[.\s]+/g, ' ').trim() || 'Veld';
        let nm = base, k = 2;
        while (names.has(nm) || form.getFieldMaybe(nm)) nm = base + ' ' + k++;
        names.add(nm);
        const r = rectOf(a, b.T), opt = { x: r[0], y: r[1], width: r[2] - r[0], height: r[3] - r[1], borderWidth: 0.75, borderColor: L.rgb(0.42, 0.47, 0.56), backgroundColor: L.rgb(0.97, 0.98, 1) };
        if (a.kind === 'check') form.createCheckBox(nm).addToPage(b.page, opt);
        else {
          const tf = form.createTextField(nm);
          if (a.kind === 'multi') tf.enableMultiline();
          tf.addToPage(b.page, opt);
          tf.setFontSize(a.kind === 'multi' ? 10 : clamp(Math.round(Math.min(opt.width, opt.height) * 0.55), 7, 12));
        }
      } catch (e) { console.warn('veld overgeslagen', e); }
    } else if (a.t === 'link') {
      const r = rectOf(a, b.T), d = { Type: 'Annot', Subtype: 'Link', Rect: r, Border: [0, 0, 0] };
      if (a.url) d.A = { Type: 'Action', S: 'URI', URI: L.PDFString.of(a.url) };
      else { const t = byId.get(a.page); if (!t) continue; d.Dest = [t.page.ref, 'Fit']; }
      b.page.node.addAnnot(cx.register(cx.obj(d)));
    }
  }
  if (Array.isArray(S.outline)) {
    const items = S.outline.filter(o => byId.has(o.page) && o.title);
    items.sort((p, q) => built.indexOf(byId.get(p.page)) - built.indexOf(byId.get(q.page)));
    if (!items.length) out.catalog.delete(L.PDFName.of('Outlines'));
    else {
      const root = cx.nextRef(), refs = items.map(() => cx.nextRef());
      items.forEach((o, i) => {
        const d = { Title: L.PDFHexString.fromText(o.title), Parent: root, Dest: [byId.get(o.page).page.ref, 'Fit'] };
        if (i > 0) d.Prev = refs[i - 1];
        if (i < items.length - 1) d.Next = refs[i + 1];
        cx.assign(refs[i], cx.obj(d));
      });
      cx.assign(root, cx.obj({ Type: 'Outlines', First: refs[0], Last: refs[refs.length - 1], Count: items.length }));
      out.catalog.set(L.PDFName.of('Outlines'), root);
    }
  }
}

/* ---------- bladwijzers en inhoudsopgave ---------- */
async function loadOutline() {
  if (Array.isArray(S.outline)) return;
  S.outline = [];
  const seen = new Set();
  for (const p of S.pages) {
    if (seen.has(p.src)) continue;
    seen.add(p.src);
    const src = S.sources[p.src];
    try {
      const walk = async list => {
        for (const o of list || []) {
          let dest = o.dest;
          if (typeof dest === 'string') dest = await src.pdf.getDestination(dest);
          if (Array.isArray(dest) && dest[0]) {
            const idx = typeof dest[0] === 'number' ? dest[0] : await src.pdf.getPageIndex(dest[0]);
            const pg = S.pages.find(q => q.src === src.id && q.idx === idx);
            if (pg && o.title) S.outline.push({ title: o.title.trim(), page: pg.id });
          }
          await walk(o.items);
        }
      };
      await walk(await src.pdf.getOutline());
    } catch (e) {}
  }
}
async function pageTitleGuess(p) {
  const ix = await textIndex(p), s = ix.raw.trim().replace(/\s+/g, ' ');
  if (!s) return 'Pagina ' + (S.pages.indexOf(p) + 1);
  // de eerste regel van de pagina is meestal de kop
  const tc = await getText(S.sources[p.src], p.idx);
  let first = '';
  for (const it of tc.items) { first += it.str; if (it.hasEOL && first.trim()) break; }
  first = first.trim().replace(/\s+/g, ' ');
  if (first.length >= 3 && first.length <= 60) return first;
  const cut = s.slice(0, 48), end = cut.search(/[.!?:]\s/);
  return (end > 8 ? cut.slice(0, end) : s.length > 48 ? cut.replace(/\s\S*$/, '') : cut).trim();
}
async function openBookmarks() {
  endTextEdit();
  await loadOutline();
  const list = h('div', { style: { display: 'grid', gap: '8px' } });
  const pno = o => S.pages.findIndex(p => p.id === o.page) + 1;
  const tocBtn = h('button', { class: 'btn', html: ico('textfile') + '<span>Maak een inhoudsopgave-pagina</span>' });
  const draw = () => {
    S.outline = S.outline.filter(o => pno(o) > 0).sort((a, b) => pno(a) - pno(b));
    list.textContent = '';
    if (!S.outline.length) list.append(h('p', { class: 'hint', text: 'Nog geen bladwijzers. Blader naar een pagina en voeg hem toe.' }));
    S.outline.forEach((o, i) => {
      const inp = h('input', { class: 'input', type: 'text', value: o.title, 'aria-label': 'Titel van bladwijzer ' + (i + 1) });
      inp.addEventListener('input', () => { o.title = inp.value; setDirty(true); });
      list.append(h('div', { class: 'bm-row' }, inp, h('small', { text: 'p. ' + pno(o) }),
        h('button', { class: 'icon-btn', 'aria-label': 'Verwijder bladwijzer', html: ico('trash'), onclick: () => { S.outline.splice(i, 1); setDirty(true); draw(); } })));
    });
    tocBtn.disabled = !S.outline.length;
  };
  const addBtn = h('button', { class: 'btn btn-primary', html: ico('bookmark') + '<span>Voeg pagina ' + (curIndex() + 1) + ' toe</span>', onclick: async () => {
    const p = S.pages[curIndex()];
    S.outline.push({ title: await pageTitleGuess(p), page: p.id });
    setDirty(true); draw();
  } });
  tocBtn.addEventListener('click', async () => {
    const items = S.outline.filter(o => o.title.trim()).slice(0, 28);
    sh.close();
    busy('Inhoudsopgave maken');
    try {
      const src = await blankSource(), pages = await pagesOf(src), tp = pages[0];
      S.sources[src.id] = src;
      S.pages.unshift(tp);
      const font = S.style.text.font, mk = (text, x, y, fs, bold) => {
        const a = { id: uid(), t: 'text', text, fs, c: '#17202B', font, bold: !!bold, rot: 0, fixed: false, w: 24, h: fs * 1.25 + 4, cx: 0, cy: 0 };
        layoutText(a, tp);
        a.cx = x + a.w / 2; a.cy = y;
        tp.annots.push(a);
        return a;
      };
      mk('Inhoud', 64, 86, 24, true);
      items.forEach((o, i) => {
        const y = 140 + i * 23, n = String(pno(o));
        const t = mk(o.title.trim().slice(0, 70), 64, y, 12, false), nr = mk(n, 0, y, 12, false);
        nr.cx = viewW(tp) - 64 - nr.w / 2;
        const x0 = 64 + t.w + 6, x1 = viewW(tp) - 64 - nr.w - 6;
        if (x1 - x0 > 12) tp.annots.push({ id: uid(), t: 'line', x1: x0, y1: y + 3, x2: x1, y2: y + 3, c: '#B8C0CC', w: 0.6 });
        tp.annots.push({ id: uid(), t: 'link', quiet: true, page: o.page, rot: 0, cx: viewW(tp) / 2, cy: y, w: viewW(tp) - 120, h: 20 });
      });
      commit();
      buildPages(false);
      goToPage(0);
      toast('Inhoudsopgave staat vooraan. De regels werken als link in de opgeslagen PDF.');
    } catch (e) { toast((e && e.message) || 'De inhoudsopgave kon niet worden gemaakt.', true); }
    finally { busyOff(); }
  });
  draw();
  const sh = sheet('Bladwijzers en inhoudsopgave', [
    h('p', { text: 'Bladwijzers staan in het zijpaneel van een pdf-lezer, zodat je snel naar een hoofdstuk springt.' }), list],
  [tocBtn, addBtn], { wide: true });
}

/* ---------- scans doorzoekbaar maken (tekstherkenning) ---------- */
const canOcr = () => !!(window.Leesmachine && Leesmachine.available());
async function openOcr() {
  if (!canOcr()) { toast(inClaude() ? 'Tekstherkenning werkt in de geïnstalleerde app. Hier kan de Assistent een scan voor je lezen.' : 'Tekstherkenning werkt niet in deze browser.', true); return; }
  endTextEdit();
  const todo = [];
  busy('Pagina\'s nakijken');
  try { for (let i = 0; i < S.pages.length; i++) { const ix = await textIndex(S.pages[i]); if (ix.raw.replace(/\s/g, '').length < 12) todo.push(i); } }
  finally { busyOff(); }
  if (!todo.length) { toast("Alle pagina's hebben al echte tekst. Er valt niets te herkennen."); return; }
  const n = todo.length, tot = S.pages.length;
  const sh = sheet('Maak scan doorzoekbaar', [
    h('p', { text: (n === tot ? (n === 1 ? 'Deze pagina is' : 'Alle ' + n + " pagina's zijn") : n + ' van de ' + tot + " pagina's " + (n === 1 ? 'is' : 'zijn')) + ' een scan zonder echte tekst. Ik lees de tekst en leg die onzichtbaar onder de pagina. Daarna kun je zoeken, selecteren, kopiëren, laten voorlezen en persoonsgegevens laten zwartlakken.' }),
    h('p', { class: 'hint', text: 'Het lezen gebeurt op je eigen apparaat, er wordt niets verstuurd. Reken op een paar seconden tot een halve minuut per pagina. De eerste keer wordt de leesmachine opgehaald (ongeveer 9 MB); daarna werkt het ook zonder internet. Gedrukte tekst gaat goed, handschrift meestal niet. Staat een pagina op zijn kant, draai hem dan eerst rechtop.' + (hasMarks() ? ' Je aantekeningen worden hierbij vastgezet in de pagina.' : '') })],
  [h('button', { class: 'btn btn-primary', html: ico('search') + '<span>Lees ' + (n === 1 ? 'de pagina' : n + " pagina's") + '</span>', onclick: async () => {
    sh.close();
    let words = 0, read = 0;
    const first = todo[0];
    const ok = await rebake('Tekst herkennen', async (bytes, prog) => {
      const d = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false }), js = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
      const font = await d.embedFont(PDFLib.StandardFonts.Helvetica);
      try {
        for (let k = 0; k < todo.length; k++) {
          const i = todo[k], pg = await js.getPage(i + 1), v1 = pg.getViewport({ scale: 1 });
          const sc = Math.min(3.2, 2100 / Math.max(v1.width, v1.height)), vp = pg.getViewport({ scale: sc }), c = document.createElement('canvas');
          c.width = Math.round(vp.width); c.height = Math.round(vp.height);
          const x = c.getContext('2d', { alpha: false });
          x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
          await pg.render({ canvasContext: x, viewport: vp }).promise;
          busy('Tekst herkennen: pagina ' + (k + 1) + ' van ' + todo.length, (k + 0.05) / todo.length);
          const res = await Leesmachine.recognize(c, { progress: f => busy('Tekst herkennen: pagina ' + (k + 1) + ' van ' + todo.length, (k + clamp(f, 0, 1)) / todo.length) });
          c.width = c.height = 0;
          const page = d.getPage(i);
          let here = 0;
          for (const w of res.words || []) {
            const str = safeText(w.text || '').trim();
            if (!str) continue;
            const hPx = w.y1 - w.y0, w1 = font.widthOfTextAtSize(str, 1);
            if (!(w1 > 0) || hPx <= 0) continue;
            const [px, py] = vp.convertToPdfPoint(w.x0, w.y1 - hPx * 0.18);
            page.drawText(str, { x: px, y: py, size: clamp((w.x1 - w.x0) / sc / w1, 2, 72), font, opacity: 0, rotate: PDFLib.degrees(pg.rotate || 0) });
            here++;
          }
          words += here; if (here) read++;
        }
      } finally { try { js.destroy(); } catch (e) {} try { Leesmachine.stop(); } catch (e) {} }
      if (!words) throw new Error(n === 1 ? 'Op deze pagina vond ik geen leesbare tekst.' : "Op deze pagina's vond ik geen leesbare tekst.");
      return await d.save();
    }, () => goToPage(first));
    if (ok) toast(read + (read === 1 ? ' pagina is' : " pagina's zijn") + ' nu doorzoekbaar (' + words + ' woorden herkend). Probeer het zoeken of Lees voor.');
  } })]);
}
