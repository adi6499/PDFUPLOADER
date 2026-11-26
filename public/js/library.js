// The team's screen: upload PDFs, see each one's permanent QR code, replace files, archive.
// Every QR carries the Jinharsh logo in the middle.
import { icon } from '/vendor/icons.js?v=2';
import * as API from './api.js';
import { qrSvg, qrSvgFile, qrPng, saveBlob } from './qr.js';
import { inspectPdf, fmtSize, makeThumb } from './pdfkit.js';
import * as M from './motion.js';
import { blankCover } from './site.js';
import { collapseFrom, assemble, enableHoverScatter, enableButtonParticles, swallow, formPage, morphQR, pourInto, stream } from './particles.js';
import { takeFiles } from './handoff.js';
import { cardSheet } from './card.js';
import { openInsights } from './insights.js';
import { copyText, showCopied, flashLink } from './copy.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ui = (fn) => { try { fn(); } catch (e) { /* cosmetic: never stop the page */ } };
const toast = (t) => ui(() => JUI.toast(t));
const QR = (link, title) => qrSvg(link, { logo: true, title });

const S = {
  docs: [], publicUrl: '', printable: true, maxUploadMB: 150, auth: null,
  filter: 'live', query: '', open: null, busy: false, replaceFor: null, sheetGen: 0,
};

// ---------- dates and numbers in plain words ----------
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
function ago(iso) {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) { const h = Math.floor(s / 3600); return h + (h === 1 ? ' hour ago' : ' hours ago'); }
  if (s < 172800) return 'yesterday';
  if (s < 30 * 86400) return Math.floor(s / 86400) + ' days ago';
  return fmtDate(iso);
}
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const nf = (n) => Number(n || 0).toLocaleString('en-IN');
function dayKeys(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(Date.now() - i * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));
  return out;
}
const opensIn = (d, days) => dayKeys(days).reduce((a, k) => a + ((d.scanDays || {})[k] || 0), 0);
const shortLink = (l) => l.replace(/^https?:\/\//, '');
const rollNum = (n) => `<span class="rollbox"><span class="n">${n}</span></span>`;

// ---------- start ----------
async function start() {
  enableHoverScatter();    // big QR codes: the grains scatter away from the mouse or finger
  enableButtonParticles(); // every button press sprays a few grains; download buttons pour them in
  ui(() => {
    $('#searchIcon').outerHTML = icon('search');
    $('#dropIcon').outerHTML = icon('upload', 'bob');
    $('#uploadBtn').innerHTML = icon('upload') + 'Upload PDF';
    $('#insightsBtn').innerHTML = icon('chart-column') + 'Visitors & queries';
    $('#settingsBtn').innerHTML = icon('settings');
    $('#siteBtn').innerHTML = icon('globe');
    paintThemeBtn();
  });
  wire();
  try {
    const inf = await API.info();
    if (!inf || !inf.publicUrl) throw new Error('no program');
    S.publicUrl = inf.publicUrl; S.printable = inf.printable; S.maxUploadMB = inf.maxUploadMB; S.version = inf.version; S.auth = inf.auth; S.site = inf.site || {};
    S.trial = !!inf.trial; S.storage = inf.storage; S.countsScans = inf.countsScans !== false;
    API.setMode(inf.storage);
    if (inf.storageReady === false) return offline('storage');
  } catch (e) { return offline(); }
  await reload();
  if (location.hash === '#upload') {
    history.replaceState(null, '', location.pathname);
    const files = await takeFiles();
    S.uploadFrom = rectOf($('#uploadBtn'));
    if (files.length) startUpload(files);
    else { toast('Choose the PDF with Upload PDF'); ui(() => M.bump($('#uploadBtn'), 1.08)); }
  }
}

// The page was opened from somewhere that only shows the files (a plain web host, or a copy of the folder),
// not from the Jinharsh Docs program. Say so plainly instead of letting an upload fail at the end.
function offline(why) {
  S.offline = true;
  const here = location.origin.startsWith('http') ? location.host : 'a file on this computer';
  $('#previewWarn').hidden = true;
  const text = why === 'storage'
    ? `<b>This trial copy has no file storage yet, so nothing can be uploaded here.</b>
    <p>In Vercel, open the project <span class="mono">pdf</span> → <b>Storage</b> → <b>Create</b> → <b>Blob</b> → connect it to this project, then redeploy. After that, uploads work here.</p>`
    : `<b>This page is not connected to the Jinharsh Docs program, so nothing can be uploaded here.</b>
    <p>It was opened from <span class="mono">${esc(here)}</span>, which only shows the page. Open <span class="mono">http://localhost:8180</span> on this computer
    (start it with <span class="mono">npm start</span> in the JINHARSH-DOCS folder), or <span class="mono">https://catalog.jinharsh.com</span> once it is online.</p>`;
  $('#answer').outerHTML = `<section class="ju-card notice-card"><div class="notice warn" style="margin:0">${icon('circle-alert')}<div>${text}</div></div></section>`;
  $('#tiles').innerHTML = '';
  $('#list').innerHTML = `<div class="empty"><div class="art">${icon('circle-alert')}</div><h3>Not connected</h3><p>Your documents and their QR codes show up here when the page is opened from the program.</p></div>`;
}

async function reload() {
  try {
    const j = await API.listDocs();
    S.docs = j.docs; S.publicUrl = j.publicUrl; S.printable = j.printable;
  } catch (e) { toast(e.message); }
  render();
  fillThumbs();
}

// Covers saved before small copies existed: make them here (in this browser, from the cover itself) and send them up.
// Quiet and one at a time; anything that fails is simply tried again the next time the team screen opens.
let filling = false;
async function fillThumbs() {
  if (filling) return;
  filling = true;
  try {
    // first: catalogues brought in with a PDF but no cover yet (for example by the hub import)
    const bare = (S.docs || []).filter((d) => d.live && !d.live.waiting && !d.live.cover && d.live.file && d.live.version).slice(0, 20);
    for (const d of bare) {
      try {
        const blob = await (await fetch(d.live.file)).blob();
        const info = await inspectPdf(new File([blob], d.live.name || 'catalogue.pdf', { type: 'application/pdf' }));
        let got = await API.putCover(d.code, d.live.version, info.cover, info.coverW, info.coverH);
        try { const t = await makeThumb(info.canvas); got = await API.putThumb(d.code, d.live.version, t.blob, t.w, t.h); } catch {}
        putDoc(got);
      } catch { /* next time */ }
    }
    const todo = (S.docs || []).filter((d) => d.live && d.live.cover && !d.live.thumb && d.live.version).slice(0, 60);
    for (const d of todo) {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = d.live.cover;
        await img.decode();
        const t = await makeThumb(img);
        putDoc(await API.putThumb(d.code, d.live.version, t.blob, t.w, t.h));
      } catch { /* next time */ }
      await new Promise((r) => setTimeout(r, 120));
    }
  } finally { filling = false; }
}

// ---------- drawing ----------
function render() {
  renderWarn();
  renderAnswer();
  renderTiles();
  renderList();
}

function renderWarn() {
  const w = $('#previewWarn');
  if (S.printable) { w.hidden = true; return; }
  w.hidden = false;
  w.innerHTML = icon('circle-alert') + (S.trial
    ? `<div><b>Trial copy: do not print these QR codes.</b><p>They point to <span class="mono">${esc(S.publicUrl)}</span>, this trial copy. The real codes will use <span class="mono">catalog.jinharsh.com</span> once it is online. In the trial, anyone with this address can upload or delete, and opens are not counted.</p></div>`
    : `<div><b>Preview only: do not print these QR codes yet.</b><p>They point to <span class="mono">${esc(S.publicUrl)}</span>, which works only ${/^https?:\/\/(localhost|127\.)/.test(S.publicUrl) ? 'on this computer' : 'for phones and computers on the same Wi-Fi as this computer'}. Once the site is online at catalog.jinharsh.com, every code becomes final and you can print it.</p></div>`);
}

function renderAnswer() {
  const live = S.docs.filter((d) => d.status === 'live');
  const waitingN = live.filter((d) => d.live.waiting).length;
  const total = S.docs.reduce((a, d) => a + (d.scans || 0), 0);
  const last = S.docs.map((d) => d.lastScanAt).filter(Boolean).sort().pop();
  const big = $('#bigFigure');
  if (!S.docs.length) { big.innerHTML = `Nothing yet<small>Upload a PDF to make your first QR code</small>`; return; }
  const sub = (waitingN ? `${waitingN} waiting for a PDF · ` : '') + (!S.countsScans ? 'Opens are not counted in the trial' : total ? `Opened ${plural(total, 'time', 'times')} · last ${ago(last)}` : 'No one has scanned a code yet');
  const n = big.querySelector('.n');
  if (n) {
    M.roll(n, String(live.length));
    big.querySelector('.word').textContent = live.length === 1 ? 'catalogue' : 'catalogues';
    big.querySelector('small').textContent = sub;
  } else {
    big.innerHTML = `${rollNum(live.length)} <span class="word">${live.length === 1 ? 'catalogue' : 'catalogues'}</span> live<small>${sub}</small>`;
  }
}

function renderTiles() {
  const live = S.docs.filter((d) => d.status === 'live');
  const arch = S.docs.filter((d) => d.status === 'archived');
  const month = S.docs.reduce((a, d) => a + opensIn(d, 30), 0);
  const waiting = live.filter((d) => d.live.waiting);
  const tiles = [
    ['live', live.length, 'Catalogues', 'live on the site'],
    ['waiting', waiting.length, 'Waiting for PDF', 'link works, PDF missing'],
    ['opens', month, 'Opens', S.countsScans ? 'last 30 days, most first' : 'not counted in the trial'],
    ['archived', arch.length, 'Archived', 'hidden from scans'],
  ];
  const box = $('#tiles');
  if (box.children.length === tiles.length) {
    // already drawn: roll the numbers that changed, move the "chosen" ring
    tiles.forEach(([k, n], i) => {
      const t = box.children[i];
      M.roll(t.querySelector('.n'), nf(n));
      t.classList.toggle('on', S.filter === k); t.setAttribute('aria-pressed', S.filter === k);
    });
    return;
  }
  box.innerHTML = tiles.map(([k, n, label, sub]) =>
    `<button type="button" class="ju-tile${S.filter === k ? ' on' : ''}" data-filter="${k}" aria-pressed="${S.filter === k}"><b>${rollNum(nf(n))}</b><span>${label}</span><small>${sub}</small></button>`).join('');
}

function visibleDocs() {
  let list = S.docs.slice();
  if (S.filter === 'archived') list = list.filter((d) => d.status === 'archived');
  else list = list.filter((d) => d.status === 'live');
  if (S.filter === 'waiting') list = list.filter((d) => d.live.waiting);
  if (S.filter === 'opens') list.sort((a, b) => opensIn(b, 30) - opensIn(a, 30) || (b.scans || 0) - (a.scans || 0));
  else list.sort((a, b) => (a.live.waiting === b.live.waiting ? 0 : a.live.waiting ? 1 : -1)); // with a PDF first
  const q = S.query.trim().toLowerCase();
  if (q) list = list.filter((d) => [d.title, d.code, d.brand, d.category, d.note].join(' ').toLowerCase().includes(q) || d.versions.some((v) => v.name.toLowerCase().includes(q)));
  return list;
}

function renderList() {
  const titles = { live: 'Catalogues', archived: 'Archived', opens: 'Most opened', waiting: 'Waiting for a PDF' };
  $('#listTitle').textContent = titles[S.filter] || 'Documents';
  const box = $('#list');
  const list = visibleDocs();
  let done = () => {};
  ui(() => { done = JUI.flip(box); });
  if (!S.docs.length) {
    box.innerHTML = `<div class="empty"><div class="art">${icon('qr-code')}</div><h3>No documents yet</h3><p>Upload a catalogue, a flyer or a price list. It gets a QR code straight away, ready for visiting cards.</p><button class="ju-btn primary" data-act="upload" type="button">${icon('upload')}Upload your first PDF</button></div>`;
  } else if (!list.length) {
    const msg = S.query ? `No document matches “${esc(S.query)}”.` : S.filter === 'archived' ? 'Nothing is archived.' : 'Nothing here yet.';
    box.innerHTML = `<div class="empty"><div class="art">${icon('search')}</div><h3>${msg}</h3><p>&nbsp;</p><button class="ju-btn" data-act="show-live" type="button">Show live documents</button></div>`;
  } else {
    box.innerHTML = list.map(rowHtml).join('');
  }
  done();
}

function rowHtml(d) {
  const L = d.live, open = S.open === d.code;
  const cover = L.cover ? `<img src="${esc(L.thumb || L.cover)}" alt="" width="${L.coverW || 720}" height="${L.coverH || 1018}" loading="lazy" decoding="async">` : L.waiting ? blankCover(d) : icon('file-text');
  const bits = [d.brand ? esc(d.brand) : null, `<span class="code">/c/${esc(d.code)}</span>`,
    L.waiting ? '<span class="wait-tag">Waiting for the PDF</span>' : null, L.pages ? plural(L.pages, 'page', 'pages') : null, L.waiting ? null : fmtSize(L.size)].filter(Boolean).join(' · ');
  return `<div class="doc${open ? ' open' : ''}" data-key="${esc(d.code)}" data-code="${esc(d.code)}">
    <div class="ju-row" role="button" tabindex="0" aria-expanded="${open}" data-act="toggle">
      <div class="thumb">${cover}</div>
      <div class="grow"><b>${esc(d.title)}</b><small>${bits}</small></div>
      <span class="ju-pill opens-pill opens">${plural(d.scans || 0, 'open', 'opens')}</span>
      <div class="mini-qr">${QR(d.link)}</div>
      <span class="chev">${icon('chevron-down')}</span>
    </div>
    <div class="more"><div class="more-in">${detailHtml(d)}</div></div>
  </div>`;
}

function detailHtml(d) {
  const archived = d.status === 'archived';
  const days = dayKeys(14), counts = days.map((k) => (d.scanDays || {})[k] || 0), max = Math.max(1, ...counts);
  const bars = counts.map((c, i) => `<i class="${c ? 'on' : ''}" style="height:${Math.max(6, Math.round((c / max) * 100))}%" title="${days[i]}: ${c}"></i>`).join('');
  const vers = d.versions.slice().reverse().map((v) => `
    <div class="ver">
      <span class="vno">v${v.v}</span>
      <div class="grow"><div>${esc(v.name)}</div><small>${fmtDate(v.uploadedAt)} · ${fmtSize(v.size)}${v.pages ? ' · ' + plural(v.pages, 'page', 'pages') : ''}</small></div>
      <a class="ju-icon" href="/f/${esc(d.code)}/${v.v}/${encodeURIComponent(v.name)}" target="_blank" rel="noopener" aria-label="Look at version ${v.v}" title="Look at this version">${icon('external-link')}</a>
      ${v.v === d.current ? '<span class="ju-pill ok">Showing</span>' : `<button class="ju-btn sm" type="button" data-act="use-version" data-v="${v.v}">Show this one</button>`}
    </div>`).join('');
  return `<div class="detail">
    <div class="qr-col">
      <div class="qr-tile big-qr" data-link="${esc(d.link)}">${QR(d.link, d.title)}</div>
      <div class="lock"${S.printable ? '' : ' style="color:var(--warn)"'}>${icon(S.printable ? 'lock' : 'circle-alert')}${S.printable ? 'Permanent. This QR never changes.' : S.trial ? 'Trial code. Do not print.' : 'Preview code. Final once catalog.jinharsh.com is online.'}</div>
    </div>
    <div class="info-col">
      ${archived ? `<div class="notice warn" style="margin:0">${icon('archive')}<div><b>Archived.</b><p>Anyone who scans this QR sees “no longer available” and your contact details. Bring it back any time.</p></div></div>` : ''}
      ${d.live.waiting && !archived ? `<div class="notice warn" style="margin:0">${icon('circle-alert')}<div><b>No PDF yet.</b><p>The link and QR already work: people see ${d.sourceUrl ? 'a button to the maker’s own copy' : '“coming soon” and your contact details'}. Upload the PDF and it shows here instead, same QR.</p>
        <p style="margin-top:10px"><button class="ju-btn primary sm" type="button" data-act="replace">${icon('upload')}Upload the PDF</button></p></div></div>` : ''}
      <div class="linkline"><a href="/c/${esc(d.code)}?preview=1" target="_blank" rel="noopener">${esc(shortLink(d.link))}</a><button class="ju-icon" type="button" data-act="copy" aria-label="Copy link" title="Copy link">${icon('copy')}</button></div>
      <div class="btns">
        <button class="ju-btn primary sm" type="button" data-act="svg">${icon('download')}QR for printing (SVG)</button>
        <button class="ju-btn sm" type="button" data-act="png">${icon('image')}PNG</button>
        <button class="ju-btn sm" type="button" data-act="print">${icon('printer')}Print</button>
        <button class="ju-btn sm" type="button" data-act="card">${icon('id-card')}Visiting card</button>
      </div>
      <div class="btns">
        <a class="ju-btn sm" href="/c/${esc(d.code)}?preview=1" target="_blank" rel="noopener">${icon('eye')}Open page</a>
        ${d.live.waiting ? '' : `<button class="ju-btn sm" type="button" data-act="replace">${icon('refresh-cw')}Replace PDF</button>`}
        <button class="ju-btn sm" type="button" data-act="details">${icon('pencil')}Edit details</button>
        ${archived
          ? `<button class="ju-btn sm" type="button" data-act="restore">${icon('archive-restore')}Bring back</button><button class="ju-btn sm ghost" type="button" data-act="delete">${icon('trash-2')}Delete</button>`
          : `<button class="ju-btn sm ghost" type="button" data-act="archive">${icon('archive')}Archive</button>`}
      </div>
      <div class="stats">
        <div class="num"><b>${nf(d.scans || 0)}</b><small>opens in all</small></div>
        <div class="num"><b>${nf(counts.reduce((a, b) => a + b, 0))}</b><small>last 14 days</small></div>
        <div class="spark" aria-hidden="true">${bars}</div>
      </div>
      ${d.versions.length ? `<div class="section-label">Versions · the QR always opens the one marked “Showing”</div>
      <div class="vers">${vers}</div>` : ''}
    </div>
  </div>`;
}

const docOf = (code) => S.docs.find((d) => d.code === code);
const rowEl = (code) => document.querySelector(`#list .doc[data-code="${CSS.escape(code)}"]`);
function putDoc(doc) {
  const i = S.docs.findIndex((d) => d.code === doc.code);
  if (i >= 0) S.docs[i] = doc; else S.docs.unshift(doc);
}

// ---------- opening a row in place: the small QR grows into the big one ----------
function toggle(code) {
  const was = S.open;
  S.open = was === code ? null : code;
  document.querySelectorAll('#list .doc').forEach((el) => {
    const on = el.dataset.code === S.open;
    const opening = on && !el.classList.contains('open');
    const from = opening ? el.querySelector('.mini-qr')?.getBoundingClientRect() : null;
    if (opening) { el.classList.add('opening'); setTimeout(() => el.classList.remove('opening'), 700); }
    el.classList.toggle('open', on);
    el.querySelector('.ju-row')?.setAttribute('aria-expanded', on);
    if (opening && from && from.width) M.fly(from, el.querySelector('.big-qr'), { spring: 'gentle', radiusFrom: 8 });
  });
}

// ---------- the sheet (a card over a blurred veil) ----------
function openSheet(html, { wide = false, locked = false } = {}) {
  S.sheetGen++;
  const sh = $('#sheet');
  sh.className = 'ju-sheet' + (wide ? ' wide' : '');
  sh.style.visibility = '';
  sh.onclick = null;
  sh.innerHTML = html;
  $('#overlay').hidden = false;
  S.sheetLocked = locked;
  document.body.style.overflow = 'hidden';
  setTimeout(() => { const f = sh.querySelector('[autofocus]'); if (f && matchMedia('(pointer:fine)').matches) f.focus(); }, 60);
  return sh;
}
// quiet = the sheet's content has just flown away somewhere; only the veil clears
function closeSheet(force, { quiet = false, at = null } = {}) {
  if (S.sheetLocked && !force) return;
  const gen = ++S.sheetGen;
  const sh = $('#sheet'), ov = $('#overlay');
  S.sheetLocked = false;
  document.body.style.overflow = '';
  if (S.sheetResolve) { const r = S.sheetResolve; S.sheetResolve = null; r('closed'); }
  if (quiet) sh.style.visibility = 'hidden';
  // closing: the window floats away as soft grains, starting where X was pressed, while the veil clears
  const anim = M.play(ov, [{ opacity: 1 }, { opacity: 0 }], { duration: quiet ? 240 : 480, easing: 'ease-in' });
  if (!quiet) swallow(sh, { at });
  ov.style.pointerEvents = 'none';
  anim.then(() => {
    ov.style.pointerEvents = '';
    if (gen !== S.sheetGen) return; // a new sheet opened meanwhile
    ov.hidden = true; sh.innerHTML = ''; sh.style.visibility = '';
  });
}
const closeBtn = () => `<button class="ju-icon close-x" type="button" data-sheet="close" aria-label="Close">${icon('x')}</button>`;

// ---------- upload: new document ----------
function pickFiles(from) { S.uploadFrom = rectOf(from); $('#fileInput').value = ''; $('#fileInput').click(); }
function rectOf(el) { try { const r = el && el.getBoundingClientRect(); return r && r.width ? { left: r.left, top: r.top, width: r.width, height: r.height } : null; } catch { return null; } }
// the window opens with grains pouring into it from where the upload started
function pourFromStart(sh) { const f = S.uploadFrom; S.uploadFrom = null; if (f) ui(() => pourInto(f, sh)); }
// the progress bar's moving end (where the stream of grains goes)
const barEnd = (sh) => () => { const i = $('#pBar', sh); if (!i) return null; const r = i.getBoundingClientRect(); return { x: r.right, y: r.top + r.height / 2 }; };

async function startUpload(files) {
  if (S.offline || !S.publicUrl) { toast('Not connected: open the page from the Jinharsh Docs program first.'); return; }
  const pdfs = [...files].filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (!pdfs.length) { toast('Only PDF files can be uploaded.'); return; }
  if (S.busy) { toast('Please wait for the current upload to finish.'); return; }
  for (let i = 0; i < pdfs.length; i++) {
    const r = await uploadOne(pdfs[i], i, pdfs.length);
    if (r === 'stop') break;
  }
}

function linkPrefix() { return shortLink(S.publicUrl) + '/c/'; }
function normCode(s) { return s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-').slice(0, 32); }

function uploadOne(file, idx, count) {
  return new Promise(async (resolveAll) => {
    S.sheetResolve = (why) => resolveAll(why === 'closed' ? 'stop' : why);
    const tooBig = file.size > S.maxUploadMB * 1048576;
    let suggested = '';
    try { suggested = await API.suggestCode(); } catch {}
    const sh = openSheet(`
      ${closeBtn()}
      <div class="sheet-head"><div class="grow"><h2>New QR code</h2><p>${count > 1 ? `File ${idx + 1} of ${count} · ` : ''}${esc(file.name)} · ${fmtSize(file.size)}</p></div></div>
      <div class="make">
        <div><div class="cover-box" id="coverBox">${icon('file-text')}</div></div>
        <div>
          <label class="field"><span>Name people will see</span><input class="ju-inp" id="fTitle" value="" maxlength="140" autofocus autocomplete="off"></label>
          ${brandLists()}
          <div class="two">
            <label class="field"><span>Brand</span><input class="ju-inp" id="fBrand" maxlength="60" list="dlBrands" placeholder="e.g. Jinharsh" autocomplete="off"></label>
            <label class="field"><span>Category</span><input class="ju-inp" id="fCat" maxlength="60" list="dlCats" placeholder="e.g. Bearings" autocomplete="off"></label>
          </div>
          <label class="field"><span>Link</span>
            <div class="prefixed"><span class="pre"><bdi>${esc(linkPrefix())}</bdi></span><input id="fCode" placeholder="${esc(suggested)}" maxlength="32" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
            <small id="fCodeMsg">Leave it as it is, or type a short word like <span class="mono">catalogue</span>. Short links make QR codes that scan more easily. This can't be changed later.</small>
          </label>
          <div class="qr-preview"><div class="qr-tile" id="qrPrev"></div><p><b>This QR never changes</b>Print it anywhere. Later you can upload a newer PDF and the same QR opens it.</p></div>
        </div>
      </div>
      <div id="stage">
        ${tooBig ? `<p class="field"><small class="bad">This file is ${fmtSize(file.size)}. The limit is ${S.maxUploadMB} MB. Please make the PDF smaller first (for example with iLovePDF “Compress”).</small></p>` : ''}
        <div class="sheet-foot">
          <button class="ju-btn ghost" type="button" data-sheet="${count > 1 && idx < count - 1 ? 'skip' : 'close'}">${count > 1 && idx < count - 1 ? 'Skip this file' : 'Cancel'}</button>
          <button class="ju-btn accent" type="button" id="goBtn" ${tooBig ? 'disabled' : ''}>${icon('qr-code')}Create QR code</button>
        </div>
      </div>`, { wide: true });
    if (idx === 0) pourFromStart(sh);

    const fTitle = $('#fTitle', sh), fCode = $('#fCode', sh), msg = $('#fCodeMsg', sh);
    let titleTouched = false, codeOk = true, chosen = '';
    fTitle.value = file.name.replace(/\.pdf$/i, '');
    fTitle.addEventListener('input', () => { titleTouched = true; });

    const paintQR = () => {
      const tile = $('#qrPrev', sh), link = S.publicUrl + '/c/' + (chosen || suggested), was = tile.dataset.shows;
      const put = () => { tile.innerHTML = QR(link); tile.dataset.shows = link; };
      if (was && was !== link) morphQR(tile, was, link, put); else put();
    };
    paintQR();
    let t = 0, seq = 0;
    fCode.addEventListener('input', () => {
      const v = normCode(fCode.value);
      if (v !== fCode.value) fCode.value = v;
      chosen = v; paintQR();
      clearTimeout(t);
      if (!v) { codeOk = true; msg.className = ''; msg.innerHTML = 'An automatic short code will be used. This can’t be changed later.'; return; }
      const my = ++seq;
      t = setTimeout(async () => {
        try {
          const r = await API.checkCode(v);
          if (my !== seq) return;
          codeOk = r.ok;
          msg.className = r.ok ? 'good' : 'bad';
          msg.textContent = r.ok ? 'Free to use. It can’t be changed later.' : r.reason;
          if (!r.ok) M.shake(fCode.closest('.prefixed'));
        } catch {}
      }, 250);
    });

    // read the PDF: page count, title, cover picture (the cover settles into its frame)
    let info = null;
    const inspecting = inspectPdf(file).then((r) => {
      info = r;
      const box = $('#coverBox', sh);
      if (box) {
        box.innerHTML = '';
        r.canvas.setAttribute('aria-label', 'First page');
        box.appendChild(r.canvas);
        box.insertAdjacentHTML('beforeend', `<span class="pages">${plural(r.pages, 'page', 'pages')}</span>`);
        formPage(box, r.canvas, { cols: 36 }); // the first page forms out of its own grains
      }
      if (!titleTouched) fTitle.value = r.title;
    }).catch(() => {
      const box = $('#coverBox', sh);
      if (box) box.insertAdjacentHTML('beforeend', '<span class="pages">no preview</span>');
    });

    sh.onclick = (e) => {
      if (e.target.closest('[data-sheet="skip"]')) { S.sheetResolve = null; closeSheet(true); resolveAll('skip'); }
    };

    $('#goBtn', sh).addEventListener('click', async () => {
      if (!codeOk) { fCode.focus(); M.shake(fCode.closest('.prefixed')); return; }
      const title = fTitle.value.trim();
      if (!title) { fTitle.focus(); M.shake(fTitle); return; }
      S.busy = true; S.sheetLocked = true;
      fTitle.disabled = fCode.disabled = true; $('#fBrand', sh).disabled = $('#fCat', sh).disabled = true;
      const swirl = collapseFrom($('#qrPrev', sh), S.publicUrl + '/c/' + (chosen || suggested));
      const stage = $('#stage', sh);
      M.resize(sh, () => {
        stage.innerHTML = `<div class="progress"><div class="ju-bar"><i id="pBar" style="width:0%"></i></div><div class="row"><span id="pWhat">Reading the PDF…</span><span id="pNum"></span></div></div>`;
      });
      const flow = stream($('#coverBox', sh), barEnd(sh));
      try {
        await inspecting;
        $('#pWhat', sh).textContent = 'Uploading…';
        const doc = await API.createDoc(file, { title, code: chosen || suggested, pages: info?.pages, brand: $('#fBrand', sh).value, category: $('#fCat', sh).value }, (p, a, b) => {
          $('#pBar', sh).style.width = Math.round(p * 96) + '%';
          $('#pNum', sh).textContent = `${fmtSize(a)} of ${fmtSize(b)}`;
        });
        flow();
        $('#pWhat', sh).textContent = 'Saving the cover…';
        let final = doc;
        if (info?.cover) {
          try { final = await API.putCover(doc.code, 1, info.cover, info.coverW, info.coverH); } catch {}
          try { const t = await makeThumb(info.canvas); final = await API.putThumb(doc.code, 1, t.blob, t.w, t.h); } catch {}
        }
        $('#pBar', sh).style.width = '100%';
        putDoc(final); S.filter = S.filter === 'archived' || S.filter === 'waiting' ? 'live' : S.filter; S.open = final.code;
        render();
        showDone(sh, final, idx, count, resolveAll, swirl);
      } catch (err) {
        flow();
        swirl.cancel();
        S.sheetLocked = false;
        fTitle.disabled = fCode.disabled = false;
        M.resize(sh, () => {
          stage.innerHTML = `<p class="field"><small class="bad">${esc(err.message)}</small></p><div class="sheet-foot"><button class="ju-btn ghost" type="button" data-sheet="close">Cancel</button><button class="ju-btn accent" type="button" id="goBtn2">${icon('refresh-cw')}Try again</button></div>`;
        });
        $('#goBtn2', sh).addEventListener('click', () => { S.sheetResolve = null; closeSheet(true); uploadOne(file, idx, count).then(resolveAll); });
      } finally { S.busy = false; }
    });
  });
}

// The finished QR: the small preview grows into the big one, then (on "Done") flies into its row.
function showDone(sh, doc, idx, count, resolveAll, swirl) {
  S.sheetLocked = false;
  const more = count > 1 && idx < count - 1;
  const settled = M.resize(sh, () => {
    sh.innerHTML = `${closeBtn()}
      <div class="done">
        <div class="tick">${icon('circle-check')}Uploaded</div>
        <h2>Your QR code is ready</h2>
        <p class="sub">${esc(doc.title)}${S.printable ? '' : S.trial ? ' · trial code, do not print' : ' · preview code, print it once the site is online'}</p>
        <div class="qr-tile" id="doneQr" data-link="${esc(doc.link)}">${QR(doc.link, doc.title)}</div>
        <div class="linkline"><a href="/c/${esc(doc.code)}?preview=1" target="_blank" rel="noopener">${esc(shortLink(doc.link))}</a><button class="ju-icon" type="button" data-copy="${esc(doc.link)}" aria-label="Copy link">${icon('copy')}</button></div>
        <div class="btns">
          <button class="ju-btn primary" type="button" data-dl="svg">${icon('download')}QR for printing (SVG)</button>
          <button class="ju-btn" type="button" data-dl="png">${icon('image')}PNG</button>
          <button class="ju-btn" type="button" data-sheet="done">${more ? 'Next file' : 'Done'}</button>
        </div>
      </div>`;
  }, 'gentle');
  const tile = $('#doneQr', sh);
  const svg = tile.querySelector('svg');
  if (swirl && !swirl.ended) {
    // keep the finished code hidden until the particles have landed on it (they bring it back, or the timer does)
    svg.style.visibility = 'hidden';
    const reveal = () => { svg.style.visibility = ''; M.bump(tile, 1.03); };
    setTimeout(() => { if (svg.style.visibility === 'hidden' && swirl.ended) reveal(); }, 4000);
    settled.then(() => swirl.into(tile, doc.link, reveal));
  } else assemble(tile, doc.link);
  ui(() => M.bump($('.done .tick', sh), 1.12));

  const finish = (next, at) => {
    // the window floats away from the button as soft grains, while the new QR flies into its row in the list
    const r = $('#doneQr', sh)?.getBoundingClientRect();
    sh.onclick = null; S.sheetResolve = null;
    closeSheet(true, { at });
    const row = rowEl(doc.code);
    const target = row?.querySelector('.big-qr');
    if (row && target && r) {
      target.scrollIntoView({ block: 'center' });
      M.fly(r, target, { spring: 'gentle', radiusFrom: 22 });
    }
    resolveAll(next);
  };
  sh.onclick = (e) => {
    const dl = e.target.closest('[data-dl]');
    if (dl) { ui(() => M.nudgeDown(dl.querySelector('.i'))); downloadQR(doc, dl.dataset.dl); }
    const cp = e.target.closest('[data-copy]');
    if (cp) copyLink(cp.dataset.copy, cp);
    const doneBtn = e.target.closest('[data-sheet="done"]');
    if (doneBtn) { const b = doneBtn.getBoundingClientRect(); finish('next', { x: b.left + b.width / 2, y: b.top + b.height / 2 }); }
  };
  S.sheetResolve = () => { sh.onclick = null; resolveAll('next'); };
}

// ---------- replace the PDF (same QR) ----------
async function startReplace(file) {
  const d = docOf(S.replaceFor);
  if (!d || !file) return;
  if (!(file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) { toast('Only PDF files can be uploaded.'); return; }
  if (file.size > S.maxUploadMB * 1048576) { toast(`This file is too big. The limit is ${S.maxUploadMB} MB.`); return; }
  const first = !!d.live.waiting;
  const sh = openSheet(`${closeBtn()}
    <div class="sheet-head"><div class="grow"><h2>${first ? 'Upload the PDF' : 'Replace the PDF'}</h2><p>${esc(d.title)}</p></div></div>
    <div class="swap">
      <div><div class="cover-box" id="oldCover">${d.live.cover ? `<img src="${esc(d.live.cover)}" alt="">` : first ? blankCover(d) : icon('file-text')}</div><div class="cap">${first ? 'Now · no PDF yet' : 'Now · v' + d.current}</div></div>
      <div class="arrow">${icon('arrow-left')}</div>
      <div><div class="cover-box" id="newCover">${icon('file-text')}</div><div class="cap">New · ${esc(file.name)}</div></div>
    </div>
    <div class="notice" style="background:var(--ok-soft);color:var(--ok);margin:14px 0 0">${icon('lock')}<div><b>The QR code and link stay exactly the same.</b><p>Everyone who scans it will see the new file. The current one is kept under Versions, so you can switch back.</p></div></div>
    <div id="stage"><div class="sheet-foot"><button class="ju-btn ghost" type="button" data-sheet="close">Cancel</button><button class="ju-btn accent" type="button" id="goBtn">${icon(first ? 'upload' : 'refresh-cw')}${first ? 'Upload PDF' : 'Replace PDF'}</button></div></div>`, { wide: true });
  ui(() => { $('.swap .arrow', sh).style.transform = 'scaleX(-1)'; });
  pourFromStart(sh);
  let info = null;
  const inspecting = inspectPdf(file).then((r) => {
    info = r; const box = $('#newCover', sh);
    if (box) {
      box.innerHTML = ''; box.appendChild(r.canvas); box.insertAdjacentHTML('beforeend', `<span class="pages">${plural(r.pages, 'page', 'pages')}</span>`);
      formPage(box, r.canvas, { cols: 32 });
    }
  }).catch(() => {});
  $('#goBtn', sh).addEventListener('click', async () => {
    S.busy = true; S.sheetLocked = true;
    const stage = $('#stage', sh);
    M.resize(sh, () => {
      stage.innerHTML = `<div class="progress"><div class="ju-bar"><i id="pBar" style="width:0%"></i></div><div class="row"><span id="pWhat">Uploading…</span><span id="pNum"></span></div></div>`;
    });
    const flow = stream($('#newCover', sh), barEnd(sh));
    try {
      await inspecting;
      let doc = await API.addVersion(d.code, file, { pages: info?.pages, nextV: d.versions.length ? Math.max(...d.versions.map((x) => x.v)) + 1 : 1 }, (p, a, b) => {
        $('#pBar', sh).style.width = Math.round(p * 96) + '%';
        $('#pNum', sh).textContent = `${fmtSize(a)} of ${fmtSize(b)}`;
      });
      flow();
      if (info?.cover) {
        try { doc = await API.putCover(doc.code, doc.current, info.cover, info.coverW, info.coverH); } catch {}
        try { const t = await makeThumb(info.canvas); doc = await API.putThumb(doc.code, doc.current, t.blob, t.w, t.h); } catch {}
      }
      // the new cover slides over the old one, then everything settles
      const nb = $('#newCover', sh), ob = $('#oldCover', sh);
      if (nb && ob) await M.play(nb, [{ transform: 'none' }, { transform: `translateX(${ob.getBoundingClientRect().left - nb.getBoundingClientRect().left}px)` }], { duration: 420, easing: 'cubic-bezier(.5,0,.2,1)', fill: 'forwards' });
      putDoc(doc); S.open = doc.code;
      closeSheet(true); render();
      ui(() => M.bump(rowEl(doc.code)?.querySelector('.thumb'), 1.12));
      toast(first ? 'Uploaded. The QR now opens this PDF.' : 'Replaced. Same QR, new PDF.');
    } catch (err) {
      flow();
      S.sheetLocked = false;
      M.resize(sh, () => {
        stage.innerHTML = `<p class="field"><small class="bad">${esc(err.message)}</small></p><div class="sheet-foot"><button class="ju-btn ghost" type="button" data-sheet="close">Close</button></div>`;
      });
    } finally { S.busy = false; }
  });
}

// ---------- small actions ----------
async function copyLink(link, btn) {
  if (!(await copyText(link))) { window.prompt('Copy this link:', link); return; }
  toast('Link copied');
  if (btn) { showCopied(btn, { ms: 1500 }); flashLink(btn.closest('.linkline')?.querySelector('a')); }
}

function fileBase(d) { return `QR ${d.title} (${d.code})`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100); }

async function downloadQR(d, kind) {
  try {
    if (kind === 'svg') saveBlob(new Blob([await qrSvgFile(d.link, true)], { type: 'image/svg+xml' }), fileBase(d) + '.svg');
    else saveBlob(await qrPng(d.link, true, 2000), fileBase(d) + '.png');
    toast(kind === 'svg' ? 'SVG saved: best for printing' : 'PNG saved');
  } catch { toast('Could not make the file. Please try again.'); }
}

function printQR(d) {
  $('#printArea').innerHTML = `<div class="qr">${QR(d.link, d.title)}</div><h1>${esc(d.title)}</h1><p>${esc(shortLink(d.link))}</p>`;
  setTimeout(() => window.print(), 80);
}

function brandLists() {
  const uniq = (k) => [...new Set(S.docs.map((d) => d[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return `<datalist id="dlBrands">${uniq('brand').map((b) => `<option value="${esc(b)}">`).join('')}</datalist>
    <datalist id="dlCats">${uniq('category').map((b) => `<option value="${esc(b)}">`).join('')}</datalist>`;
}

function detailsSheet(d) {
  const sh = openSheet(`${closeBtn()}
    <div class="sheet-head"><div class="grow"><h2>Edit details</h2><p>What people see on the catalogue site. The QR code stays the same.</p></div></div>
    ${brandLists()}
    <label class="field"><span>Name</span><input class="ju-inp" id="edTitle" maxlength="140" value="${esc(d.title)}" autofocus autocomplete="off"></label>
    <div class="two">
      <label class="field"><span>Brand</span><input class="ju-inp" id="edBrand" maxlength="60" value="${esc(d.brand || '')}" list="dlBrands" placeholder="e.g. Timken" autocomplete="off"></label>
      <label class="field"><span>Category</span><input class="ju-inp" id="edCat" maxlength="60" value="${esc(d.category || '')}" list="dlCats" placeholder="e.g. Bearings" autocomplete="off"></label>
    </div>
    <label class="field"><span>Short description</span><textarea class="ju-inp ta" id="edNote" maxlength="300" rows="3" placeholder="One or two lines shown on the catalogue card">${esc(d.note || '')}</textarea></label>
    <label class="field"><span>Maker’s own copy or interactive guide (optional)</span><input class="ju-inp" id="edSrc" maxlength="500" value="${esc(d.sourceUrl || '')}" placeholder="https://… (used only while there is no PDF here)" autocomplete="off"></label>
    <div class="media-edit">
      <div class="me-head"><b>Videos & proof</b><small>Shown on the catalogue's page: product videos, installation videos, trials & recommendations. Paste a YouTube or Vimeo link (it plays on the page), or any web page or PDF.</small></div>
      <div class="me-rows" id="edMedia">${(d.media || []).map(mediaRow).join('')}</div>
      <button class="ju-btn sm" type="button" id="edAddMedia">${icon('plus')}Add a video or proof</button>
    </div>
    <div class="sheet-foot"><button class="ju-btn ghost" type="button" data-sheet="close">Cancel</button><button class="ju-btn primary" type="button" id="edSave">Save</button></div>`, { wide: true });
  const rows = $('#edMedia', sh);
  $('#edAddMedia', sh).addEventListener('click', () => {
    rows.insertAdjacentHTML('beforeend', mediaRow({ kind: 'video', title: '', url: '' }));
    const r = rows.lastElementChild; M.rise([r], { y: 8 }); r.querySelector('[data-f="url"]').focus();
  });
  rows.addEventListener('click', (e) => { const x = e.target.closest('[data-del]'); if (x) { const r = x.closest('.me-row'); M.slideAway ? M.slideAway(r).then(() => r.remove()) : r.remove(); } });
  const readMedia = () => [...rows.querySelectorAll('.me-row')].map((r) => ({ kind: r.querySelector('[data-f="kind"]').value, title: r.querySelector('[data-f="title"]').value.trim(), url: r.querySelector('[data-f="url"]').value.trim() })).filter((m) => m.url);
  const go = async () => {
    const t = $('#edTitle', sh).value.trim(); if (!t) { M.shake($('#edTitle', sh)); return; }
    try {
      const media = readMedia();
      const bad = media.find((m) => !/^https?:\/\/\S+\.\S+/i.test(m.url));
      if (bad) { toast('A link must start with https://'); M.shake(rows); return; }
      putDoc(await API.updateDoc(d.code, { title: t, brand: $('#edBrand', sh).value, category: $('#edCat', sh).value, note: $('#edNote', sh).value, sourceUrl: $('#edSrc', sh).value, media }));
      closeSheet(true); render(); toast('Saved');
    } catch (e) { toast(e.message); }
  };
  $('#edSave', sh).addEventListener('click', go);
  $('#edTitle', sh).addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

// one line in "Videos & proof": what it is, its name, its link
function mediaRow(m) {
  const kinds = [['video', 'Product video'], ['install', 'Installation video'], ['trial', 'Trial / proof']];
  return `<div class="me-row">
    <select class="ju-inp" data-f="kind" aria-label="What it is">${kinds.map(([k, l]) => `<option value="${k}"${m.kind === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
    <input class="ju-inp" data-f="title" maxlength="120" placeholder="Name, e.g. Mounting a spherical bearing" value="${esc(m.title || '')}" aria-label="Name">
    <input class="ju-inp" data-f="url" maxlength="500" placeholder="https://youtu.be/…" value="${esc(m.url || '')}" aria-label="Link" inputmode="url">
    <button class="ju-icon" type="button" data-del aria-label="Remove">${icon('trash-2')}</button>
  </div>`;
}

// leaving = the code of a row that will disappear from this list (it slides away first)
function confirmSheet({ title, text, yes, onYes, leaving = null }) {
  const sh = openSheet(`${closeBtn()}
    <div class="sheet-head"><div class="grow"><h2>${title}</h2><p>${text}</p></div></div>
    <div class="sheet-foot"><button class="ju-btn ghost" type="button" data-sheet="close">Cancel</button><button class="ju-btn primary" type="button" id="cfYes">${yes}</button></div>`);
  $('#cfYes', sh).addEventListener('click', async () => {
    $('#cfYes', sh).disabled = true;
    try {
      await onYes();
      closeSheet(true);
      if (leaving && rowEl(leaving)) await M.slideAway(rowEl(leaving));
      render();
    } catch (e) { toast(e.message); $('#cfYes', sh).disabled = false; M.shake(sh); }
  });
}

function settingsSheet() {
  let mode = 'auto'; try { mode = localStorage.getItem('jui_dark') || 'auto'; } catch {}
  if (mode === '1') mode = 'dark'; else if (mode === '0') mode = 'light';
  const glass = (() => { try { return +(localStorage.getItem('jui_glass') ?? 100); } catch { return 100; } })();
  const signedIn = S.auth && S.auth.passwordSet;
  const sh = openSheet(`${closeBtn()}
    <div class="sheet-head"><div class="grow"><h2>Settings</h2><p>These choices are kept on this device.</p></div></div>
    <div class="setting"><div class="grow"><b>Appearance</b><small>Auto follows this device</small></div>
      <div class="ju-seg" id="setMode">${['auto', 'light', 'dark'].map((m) => `<button type="button" data-m="${m}" class="${mode === m ? 'on' : ''}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div></div>
    <div class="setting"><div class="grow"><b>Glass</b><small>0 solid · 30 frosted · 100 clear</small></div><input type="range" min="0" max="100" value="${glass}" id="setGlass" aria-label="Glass"></div>
    <div class="setting"><div class="grow"><b>Address inside every QR code</b><small class="mono">${esc(S.publicUrl)}</small><br><small>${S.printable ? 'This is the real address. Codes are final.' : 'Preview address. Codes become final once the site is online.'}</small></div></div>
    <div class="setting"><div class="grow"><b>Team sign-in</b><small>${signedIn ? 'Signed in on this device for 30 days.' : 'No team password yet: open only on this computer.'}</small></div>${signedIn ? '<button class="ju-btn sm" type="button" id="signOut">Sign out</button>' : ''}</div>
    <div class="setting"><div class="grow"><b>Jinharsh Docs</b><small>Version ${esc(S.version || '')} · up to ${S.maxUploadMB} MB per PDF</small></div></div>`);
  $('#setMode', sh).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-m]'); if (!b) return;
    const m = b.dataset.m, r = b.getBoundingClientRect();
    M.themeSwitch(r.left + r.width / 2, r.top + r.height / 2, () => { ui(() => JUI.setDark(m === 'auto' ? 'auto' : m === 'dark')); paintThemeBtn(); });
    sh.querySelectorAll('#setMode button').forEach((x) => x.classList.toggle('on', x === b));
  });
  $('#setGlass', sh).addEventListener('input', (e) => ui(() => JUI.setGlass(e.target.value)));
  $('#signOut', sh)?.addEventListener('click', async () => {
    try { await fetch('/api/logout', { method: 'POST' }); } catch {}
    location.replace('/');
  });
}

function paintThemeBtn() {
  const dark = document.documentElement.classList.contains('dark');
  $('#themeBtn').innerHTML = icon(dark ? 'sun' : 'moon');
  $('#themeBtn').setAttribute('aria-label', dark ? 'Switch to light' : 'Switch to dark');
}

// ---------- wiring ----------
function wire() {
  $('#uploadBtn').addEventListener('click', (e) => pickFiles(e.currentTarget));
  $('#insightsBtn').addEventListener('click', (e) => openInsights({ from: e.currentTarget }));
  $('#fileInput').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; startUpload(f); });
  $('#replaceInput').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; startReplace(f); });
  $('#settingsBtn').addEventListener('click', settingsSheet);
  $('#themeBtn').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    M.themeSwitch(r.left + r.width / 2, r.top + r.height / 2, () => {
      ui(() => JUI.setDark(!document.documentElement.classList.contains('dark')));
      paintThemeBtn();
    });
  });
  $('#search').addEventListener('input', (e) => { S.query = e.target.value; renderList(); });
  $('#tiles').addEventListener('click', (e) => {
    const t = e.target.closest('[data-filter]'); if (!t) return;
    const k = t.dataset.filter;
    S.filter = S.filter === k && k !== 'live' ? 'live' : k;
    renderTiles(); renderList();
  });

  // A touch that moves is a scroll, never a press.
  let down = null;
  const list = $('#list');
  list.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; }, { passive: true });
  list.addEventListener('click', (e) => {
    if (down && e.detail > 0 && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) { down = null; return; }
    down = null;
    const el = e.target.closest('[data-act]'); if (!el) return;
    const act = el.dataset.act;
    if (act === 'upload') return pickFiles(el);
    if (act === 'show-live') { S.filter = 'live'; S.query = ''; $('#search').value = ''; renderTiles(); renderList(); return; }
    const code = el.closest('.doc')?.dataset.code; const d = docOf(code); if (!d) return;
    if (act === 'toggle') return toggle(code);
    if (act === 'copy') return copyLink(d.link, el);
    if (act === 'svg' || act === 'png') { ui(() => M.nudgeDown(el.querySelector('.i'))); return downloadQR(d, act); }
    if (act === 'print') return printQR(d);
    if (act === 'card') return cardSheet({ link: d.link, title: d.title, site: S.site, printable: S.printable, from: el });
    if (act === 'replace') { S.replaceFor = code; S.uploadFrom = rectOf(el); $('#replaceInput').click(); return; }
    if (act === 'details') return detailsSheet(d);
    if (act === 'use-version') {
      const v = Number(el.dataset.v);
      return confirmSheet({
        title: `Show version ${v}?`, text: 'Everyone who scans the QR will see this version again. Nothing is deleted.', yes: 'Show this version',
        onYes: async () => putDoc(await API.updateDoc(code, { current: v })),
      });
    }
    if (act === 'archive') return confirmSheet({
      title: `Archive “${esc(d.title)}”?`, text: 'Anyone who scans its QR will see “no longer available” with your contact details. Nothing is deleted, and you can bring it back any time.', yes: 'Archive',
      leaving: code, onYes: async () => { putDoc(await API.updateDoc(code, { status: 'archived' })); S.open = null; },
    });
    if (act === 'restore') return (async () => {
      try {
        putDoc(await API.updateDoc(code, { status: 'live' }));
        await M.slideAway(rowEl(code));
        S.filter = 'live'; render(); toast('Back on. The QR works again.');
      } catch (er) { toast(er.message); }
    })();
    if (act === 'delete') return confirmSheet({
      title: `Delete “${esc(d.title)}” for good?`, text: 'The PDF and all its versions are removed from the server and cannot be brought back. Its QR will show “no longer available”. The code is never given to another document.', yes: 'Delete for good',
      leaving: code, onYes: async () => { await API.deleteDoc(code); S.docs = S.docs.filter((x) => x.code !== code); S.open = null; },
    });
  });
  list.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.ju-row[data-act="toggle"]')) { e.preventDefault(); toggle(e.target.closest('.doc').dataset.code); }
  });

  // sheet: close by the X, Cancel, the veil, or Esc
  $('#overlay').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sheet="close"]');
    if (e.target.id === 'overlay' || btn) {
      let at = null;
      if (btn) { const b = btn.getBoundingClientRect(); at = { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }
      closeSheet(btn && !S.busy, { at });
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#overlay').hidden) closeSheet(); });

  // drop PDFs anywhere
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; $('#dropVeil').hidden = false; });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) $('#dropVeil').hidden = true; });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth = 0; $('#dropVeil').hidden = true;
    if (!$('#overlay').hidden) { toast('Finish the open window first.'); return; }
    S.uploadFrom = { left: e.clientX - 24, top: e.clientY - 24, width: 48, height: 48 };
    startUpload(e.dataTransfer.files);
  });
}

// for testing on this computer: window.__docs.upload(fileObjects)
window.__docs = { upload: startUpload, reload };
start();
