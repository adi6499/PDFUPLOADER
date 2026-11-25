// The team's screen: upload PDFs, see each one's permanent QR code, replace files, archive.
import { icon } from '/vendor/icons.js';
import * as API from './api.js';
import { qrSvg, qrSvgFile, qrPng, saveBlob } from './qr.js';
import { inspectPdf, fmtSize } from './pdfkit.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ui = (fn) => { try { fn(); } catch (e) { /* cosmetic: never stop the page */ } };
const toast = (t) => ui(() => JUI.toast(t));

const S = {
  docs: [], publicUrl: '', printable: true, maxUploadMB: 150,
  filter: 'live', query: '', open: null, logo: {}, busy: false, replaceFor: null,
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

// ---------- start ----------
async function start() {
  ui(() => {
    $('#searchIcon').outerHTML = icon('search');
    $('#dropIcon').outerHTML = icon('upload');
    $('#uploadBtn').innerHTML = icon('upload') + 'Upload PDF';
    $('#settingsBtn').innerHTML = icon('settings');
    paintThemeBtn();
  });
  wire();
  try {
    const inf = await API.info();
    S.publicUrl = inf.publicUrl; S.printable = inf.printable; S.maxUploadMB = inf.maxUploadMB; S.version = inf.version;
  } catch (e) { toast(e.message); }
  await reload();
}

async function reload() {
  try {
    const j = await API.listDocs();
    S.docs = j.docs; S.publicUrl = j.publicUrl; S.printable = j.printable;
  } catch (e) { toast(e.message); }
  render();
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
  w.innerHTML = icon('circle-alert') + `<div><b>Preview only: do not print these QR codes yet.</b><p>They point to <span class="mono">${esc(S.publicUrl)}</span>, which works only on this computer. Once the site is online at its real address, every code becomes final and you can print it.</p></div>`;
}

function renderAnswer() {
  const live = S.docs.filter((d) => d.status === 'live');
  const total = S.docs.reduce((a, d) => a + (d.scans || 0), 0);
  const last = S.docs.map((d) => d.lastScanAt).filter(Boolean).sort().pop();
  const big = $('#bigFigure');
  if (!S.docs.length) {
    big.innerHTML = `Nothing yet<small>Upload a PDF to make your first QR code</small>`;
  } else {
    big.innerHTML = `${plural(live.length, 'document', 'documents')} live<small>${total ? `Opened ${plural(total, 'time', 'times')} · last ${ago(last)}` : 'No one has scanned a code yet'}</small>`;
  }
}

function renderTiles() {
  const live = S.docs.filter((d) => d.status === 'live');
  const arch = S.docs.filter((d) => d.status === 'archived');
  const month = S.docs.reduce((a, d) => a + opensIn(d, 30), 0);
  const fresh = live.filter((d) => Date.now() - new Date(d.updatedAt) < 30 * 86400000);
  const tiles = [
    ['live', live.length, 'Live', 'people can open these'],
    ['opens', month, 'Opens', 'last 30 days, most first'],
    ['fresh', fresh.length, 'Updated', 'in the last 30 days'],
    ['archived', arch.length, 'Archived', 'hidden from scans'],
  ];
  $('#tiles').innerHTML = tiles.map(([k, n, label, sub]) =>
    `<button type="button" class="ju-tile${S.filter === k ? ' on' : ''}" data-filter="${k}" aria-pressed="${S.filter === k}"><b>${nf(n)}</b><span>${label}</span><small>${sub}</small></button>`).join('');
}

function visibleDocs() {
  let list = S.docs.slice();
  if (S.filter === 'archived') list = list.filter((d) => d.status === 'archived');
  else list = list.filter((d) => d.status === 'live');
  if (S.filter === 'fresh') list = list.filter((d) => Date.now() - new Date(d.updatedAt) < 30 * 86400000);
  if (S.filter === 'opens') list.sort((a, b) => opensIn(b, 30) - opensIn(a, 30) || (b.scans || 0) - (a.scans || 0));
  const q = S.query.trim().toLowerCase();
  if (q) list = list.filter((d) => d.title.toLowerCase().includes(q) || d.code.includes(q) || d.versions.some((v) => v.name.toLowerCase().includes(q)));
  return list;
}

function renderList() {
  const titles = { live: 'Live documents', archived: 'Archived', opens: 'Most opened', fresh: 'Updated lately' };
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
  const cover = L.cover ? `<img src="${L.cover}" alt="" loading="lazy" decoding="async">` : icon('file-text');
  const bits = [`<span class="code">/c/${esc(d.code)}</span>`, L.pages ? plural(L.pages, 'page', 'pages') : null, fmtSize(L.size)].filter(Boolean).join(' · ');
  return `<div class="doc${open ? ' open' : ''}" data-key="${esc(d.code)}" data-code="${esc(d.code)}">
    <div class="ju-row" role="button" tabindex="0" aria-expanded="${open}" data-act="toggle">
      <div class="thumb">${cover}</div>
      <div class="grow"><b>${esc(d.title)}</b><small>${bits}</small></div>
      <span class="ju-pill opens-pill opens">${plural(d.scans || 0, 'open', 'opens')}</span>
      <div class="mini-qr">${qrSvg(d.link)}</div>
      <span class="chev">${icon('chevron-down')}</span>
    </div>
    <div class="more"><div class="more-in">${detailHtml(d)}</div></div>
  </div>`;
}

function detailHtml(d) {
  const logo = !!S.logo[d.code];
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
      <div class="qr-tile">${qrSvg(d.link, { logo, title: d.title })}</div>
      <div class="ju-seg" role="group" aria-label="QR style" style="align-self:center">
        <button type="button" class="${logo ? '' : 'on'}" data-act="logo" data-v="0">Plain</button>
        <button type="button" class="${logo ? 'on' : ''}" data-act="logo" data-v="1">With logo</button>
      </div>
      <div class="lock"${S.printable ? '' : ' style="color:var(--warn)"'}>${icon(S.printable ? 'lock' : 'circle-alert')}${S.printable ? 'Permanent. This QR never changes.' : 'Preview code. Final once the site is online.'}</div>
    </div>
    <div class="info-col">
      ${archived ? `<div class="notice warn" style="margin:0">${icon('archive')}<div><b>Archived.</b><p>Anyone who scans this QR sees “no longer available” and your contact details. Bring it back any time.</p></div></div>` : ''}
      <div class="linkline"><a href="/c/${esc(d.code)}?preview=1" target="_blank" rel="noopener">${esc(shortLink(d.link))}</a><button class="ju-icon" type="button" data-act="copy" aria-label="Copy link" title="Copy link">${icon('copy')}</button></div>
      <div class="btns">
        <button class="ju-btn primary sm" type="button" data-act="svg">${icon('download')}QR for printing (SVG)</button>
        <button class="ju-btn sm" type="button" data-act="png">${icon('image')}PNG</button>
        <button class="ju-btn sm" type="button" data-act="print">${icon('printer')}Print</button>
      </div>
      <div class="btns">
        <a class="ju-btn sm" href="/c/${esc(d.code)}?preview=1" target="_blank" rel="noopener">${icon('eye')}Open page</a>
        <button class="ju-btn sm" type="button" data-act="replace">${icon('refresh-cw')}Replace PDF</button>
        <button class="ju-btn sm" type="button" data-act="rename">${icon('pencil')}Rename</button>
        ${archived
          ? `<button class="ju-btn sm" type="button" data-act="restore">${icon('archive-restore')}Bring back</button><button class="ju-btn sm ghost" type="button" data-act="delete">${icon('trash-2')}Delete</button>`
          : `<button class="ju-btn sm ghost" type="button" data-act="archive">${icon('archive')}Archive</button>`}
      </div>
      <div class="stats">
        <div class="num"><b>${nf(d.scans || 0)}</b><small>opens in all</small></div>
        <div class="num"><b>${nf(counts.reduce((a, b) => a + b, 0))}</b><small>last 14 days</small></div>
        <div class="spark" aria-hidden="true">${bars}</div>
      </div>
      <div class="section-label">Versions · the QR always opens the one marked “Showing”</div>
      <div class="vers">${vers}</div>
    </div>
  </div>`;
}

const docOf = (code) => S.docs.find((d) => d.code === code);
function putDoc(doc) {
  const i = S.docs.findIndex((d) => d.code === doc.code);
  if (i >= 0) S.docs[i] = doc; else S.docs.unshift(doc);
}

// ---------- opening a row in place ----------
function toggle(code) {
  const was = S.open;
  S.open = was === code ? null : code;
  document.querySelectorAll('#list .doc').forEach((el) => {
    const on = el.dataset.code === S.open;
    if (on && !el.classList.contains('open')) { el.classList.add('opening'); setTimeout(() => el.classList.remove('opening'), 600); }
    el.classList.toggle('open', on);
    el.querySelector('.ju-row')?.setAttribute('aria-expanded', on);
  });
}

// ---------- the sheet (pop-up card over a blurred veil) ----------
function openSheet(html, { wide = false, locked = false } = {}) {
  const sh = $('#sheet');
  sh.className = 'ju-sheet' + (wide ? ' wide' : '');
  sh.onclick = null;
  sh.innerHTML = html;
  $('#overlay').hidden = false;
  S.sheetLocked = locked;
  document.body.style.overflow = 'hidden';
  setTimeout(() => { const f = sh.querySelector('[autofocus]'); if (f && matchMedia('(pointer:fine)').matches) f.focus(); }, 60);
  return sh;
}
function closeSheet(force) {
  if (S.sheetLocked && !force) return;
  $('#overlay').hidden = true; $('#sheet').innerHTML = '';
  document.body.style.overflow = '';
  S.sheetLocked = false;
  if (S.sheetResolve) { const r = S.sheetResolve; S.sheetResolve = null; r('closed'); }
}
const closeBtn = () => `<button class="ju-icon close-x" type="button" data-sheet="close" aria-label="Close">${icon('x')}</button>`;

// ---------- upload: new document ----------
function pickFiles() { $('#fileInput').value = ''; $('#fileInput').click(); }

async function startUpload(files) {
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

    const fTitle = $('#fTitle', sh), fCode = $('#fCode', sh), msg = $('#fCodeMsg', sh);
    let titleTouched = false, codeOk = true, chosen = '';
    fTitle.value = file.name.replace(/\.pdf$/i, '');
    fTitle.addEventListener('input', () => { titleTouched = true; });

    const paintQR = () => { $('#qrPrev', sh).innerHTML = qrSvg(S.publicUrl + '/c/' + (chosen || suggested)); };
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
        } catch {}
      }, 250);
    });

    // read the PDF: page count, title, cover picture
    let info = null;
    const inspecting = inspectPdf(file).then((r) => {
      info = r;
      const box = $('#coverBox', sh);
      if (box) {
        box.innerHTML = '';
        r.canvas.setAttribute('aria-label', 'First page');
        box.appendChild(r.canvas);
        box.insertAdjacentHTML('beforeend', `<span class="pages">${plural(r.pages, 'page', 'pages')}</span>`);
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
      if (!codeOk) { fCode.focus(); return; }
      const title = fTitle.value.trim();
      if (!title) { fTitle.focus(); return; }
      S.busy = true; S.sheetLocked = true;
      fTitle.disabled = fCode.disabled = true;
      const stage = $('#stage', sh);
      stage.innerHTML = `<div class="progress"><div class="ju-bar"><i id="pBar" style="width:0%"></i></div><div class="row"><span id="pWhat">Reading the PDF…</span><span id="pNum"></span></div></div>`;
      try {
        await inspecting;
        $('#pWhat', sh).textContent = 'Uploading…';
        const doc = await API.createDoc(file, { title, code: chosen || suggested, pages: info?.pages }, (p, a, b) => {
          $('#pBar', sh).style.width = Math.round(p * 96) + '%';
          $('#pNum', sh).textContent = `${fmtSize(a)} of ${fmtSize(b)}`;
        });
        $('#pWhat', sh).textContent = 'Saving the cover…';
        let final = doc;
        if (info?.cover) { try { final = await API.putCover(doc.code, 1, info.cover, info.coverW, info.coverH); } catch {} }
        $('#pBar', sh).style.width = '100%';
        putDoc(final); S.filter = S.filter === 'archived' ? 'live' : S.filter; S.open = final.code;
        render();
        showDone(sh, final, idx, count, resolveAll);
      } catch (err) {
        S.sheetLocked = false;
        fTitle.disabled = fCode.disabled = false;
        stage.innerHTML = `<p class="field"><small class="bad">${esc(err.message)}</small></p><div class="sheet-foot"><button class="ju-btn ghost" type="button" data-sheet="close">Cancel</button><button class="ju-btn accent" type="button" id="goBtn2">${icon('refresh-cw')}Try again</button></div>`;
        $('#goBtn2', sh).addEventListener('click', () => { S.sheetResolve = null; closeSheet(true); uploadOne(file, idx, count).then(resolveAll); });
      } finally { S.busy = false; }
    });
  });
}

function showDone(sh, doc, idx, count, resolveAll) {
  S.sheetLocked = false;
  const more = count > 1 && idx < count - 1;
  sh.innerHTML = `${closeBtn()}
    <div class="done">
      <div class="tick">${icon('circle-check')}Uploaded</div>
      <h2>Your QR code is ready</h2>
      <p class="sub">${esc(doc.title)}${S.printable ? '' : ' · preview code, print it once the site is online'}</p>
      <div class="qr-tile">${qrSvg(doc.link, { title: doc.title })}</div>
      <div class="linkline"><a href="/c/${esc(doc.code)}?preview=1" target="_blank" rel="noopener">${esc(shortLink(doc.link))}</a><button class="ju-icon" type="button" data-copy="${esc(doc.link)}" aria-label="Copy link">${icon('copy')}</button></div>
      <div class="btns">
        <button class="ju-btn primary" type="button" data-dl="svg">${icon('download')}QR for printing (SVG)</button>
        <button class="ju-btn" type="button" data-dl="png">${icon('image')}PNG</button>
        <button class="ju-btn" type="button" data-sheet="${more ? 'next' : 'close'}">${more ? 'Next file' : 'Done'}</button>
      </div>
    </div>`;
  sh.onclick = (e) => {
    const dl = e.target.closest('[data-dl]');
    if (dl) downloadQR(doc, dl.dataset.dl, false);
    const cp = e.target.closest('[data-copy]');
    if (cp) copyLink(cp.dataset.copy);
    if (e.target.closest('[data-sheet="next"]')) { sh.onclick = null; S.sheetResolve = null; closeSheet(true); resolveAll('next'); }
  };
  S.sheetResolve = () => { sh.onclick = null; resolveAll('next'); };
}

// ---------- replace the PDF (same QR) ----------
async function startReplace(file) {
  const d = docOf(S.replaceFor);
  if (!d || !file) return;
  if (!(file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) { toast('Only PDF files can be uploaded.'); return; }
  if (file.size > S.maxUploadMB * 1048576) { toast(`This file is too big. The limit is ${S.maxUploadMB} MB.`); return; }
  const sh = openSheet(`${closeBtn()}
    <div class="sheet-head"><div class="grow"><h2>Replace the PDF</h2><p>${esc(d.title)}</p></div></div>
    <div class="swap">
      <div><div class="cover-box">${d.live.cover ? `<img src="${d.live.cover}" alt="">` : icon('file-text')}</div><div class="cap">Now · v${d.current}</div></div>
      <div class="arrow">${icon('arrow-left')}</div>
      <div><div class="cover-box" id="newCover">${icon('file-text')}</div><div class="cap">New · ${esc(file.name)}</div></div>
    </div>
    <div class="notice" style="background:var(--ok-soft);color:var(--ok);margin:14px 0 0">${icon('lock')}<div><b>The QR code and link stay exactly the same.</b><p>Everyone who scans it will see the new file. The current one is kept under Versions, so you can switch back.</p></div></div>
    <div id="stage"><div class="sheet-foot"><button class="ju-btn ghost" type="button" data-sheet="close">Cancel</button><button class="ju-btn accent" type="button" id="goBtn">${icon('refresh-cw')}Replace PDF</button></div></div>`, { wide: true });
  ui(() => { $('.swap .arrow', sh).style.transform = 'scaleX(-1)'; });
  let info = null;
  const inspecting = inspectPdf(file).then((r) => {
    info = r; const box = $('#newCover', sh);
    if (box) { box.innerHTML = ''; box.appendChild(r.canvas); box.insertAdjacentHTML('beforeend', `<span class="pages">${plural(r.pages, 'page', 'pages')}</span>`); }
  }).catch(() => {});
  $('#goBtn', sh).addEventListener('click', async () => {
    S.busy = true; S.sheetLocked = true;
    const stage = $('#stage', sh);
    stage.innerHTML = `<div class="progress"><div class="ju-bar"><i id="pBar" style="width:0%"></i></div><div class="row"><span id="pWhat">Uploading…</span><span id="pNum"></span></div></div>`;
    try {
      await inspecting;
      let doc = await API.addVersion(d.code, file, { pages: info?.pages }, (p, a, b) => {
        $('#pBar', sh).style.width = Math.round(p * 96) + '%';
        $('#pNum', sh).textContent = `${fmtSize(a)} of ${fmtSize(b)}`;
      });
      if (info?.cover) { try { doc = await API.putCover(doc.code, doc.current, info.cover, info.coverW, info.coverH); } catch {} }
      putDoc(doc); S.open = doc.code;
      closeSheet(true); render();
      toast('Replaced. Same QR, new PDF.');
    } catch (err) {
      S.sheetLocked = false;
      stage.innerHTML = `<p class="field"><small class="bad">${esc(err.message)}</small></p><div class="sheet-foot"><button class="ju-btn ghost" type="button" data-sheet="close">Close</button></div>`;
    } finally { S.busy = false; }
  });
}

// ---------- small actions ----------
async function copyLink(link) {
  try { await navigator.clipboard.writeText(link); toast('Link copied'); }
  catch { window.prompt('Copy this link:', link); }
}

function fileBase(d) { return `QR ${d.title} (${d.code})`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100); }

async function downloadQR(d, kind, logo) {
  try {
    if (kind === 'svg') saveBlob(new Blob([await qrSvgFile(d.link, logo)], { type: 'image/svg+xml' }), fileBase(d) + '.svg');
    else saveBlob(await qrPng(d.link, logo, 2000), fileBase(d) + '.png');
    toast(kind === 'svg' ? 'SVG saved: best for printing' : 'PNG saved');
  } catch { toast('Could not make the file. Please try again.'); }
}

function printQR(d, logo) {
  $('#printArea').innerHTML = `<div class="qr">${qrSvg(d.link, { logo, title: d.title })}</div><h1>${esc(d.title)}</h1><p>${esc(shortLink(d.link))}</p>`;
  setTimeout(() => window.print(), 80);
}

function renameSheet(d) {
  const sh = openSheet(`${closeBtn()}
    <div class="sheet-head"><div class="grow"><h2>Rename</h2><p>Only the name changes. The QR code stays the same.</p></div></div>
    <label class="field"><span>Name people will see</span><input class="ju-inp" id="rnTitle" maxlength="140" value="${esc(d.title)}" autofocus autocomplete="off"></label>
    <div class="sheet-foot"><button class="ju-btn ghost" type="button" data-sheet="close">Cancel</button><button class="ju-btn primary" type="button" id="rnSave">Save</button></div>`);
  const go = async () => {
    const t = $('#rnTitle', sh).value.trim(); if (!t) return;
    try { putDoc(await API.updateDoc(d.code, { title: t })); closeSheet(true); render(); toast('Renamed'); }
    catch (e) { toast(e.message); }
  };
  $('#rnSave', sh).addEventListener('click', go);
  $('#rnTitle', sh).addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

function confirmSheet({ title, text, yes, onYes }) {
  const sh = openSheet(`${closeBtn()}
    <div class="sheet-head"><div class="grow"><h2>${title}</h2><p>${text}</p></div></div>
    <div class="sheet-foot"><button class="ju-btn ghost" type="button" data-sheet="close">Cancel</button><button class="ju-btn primary" type="button" id="cfYes">${yes}</button></div>`);
  $('#cfYes', sh).addEventListener('click', async () => {
    $('#cfYes', sh).disabled = true;
    try { await onYes(); closeSheet(true); render(); } catch (e) { toast(e.message); $('#cfYes', sh).disabled = false; }
  });
}

function settingsSheet() {
  let mode = 'auto'; try { mode = localStorage.getItem('jui_dark') || 'auto'; } catch {}
  if (mode === '1') mode = 'dark'; else if (mode === '0') mode = 'light';
  const glass = (() => { try { return +(localStorage.getItem('jui_glass') ?? 100); } catch { return 100; } })();
  const sh = openSheet(`${closeBtn()}
    <div class="sheet-head"><div class="grow"><h2>Settings</h2><p>These choices are kept on this device.</p></div></div>
    <div class="setting"><div class="grow"><b>Appearance</b><small>Auto follows this device</small></div>
      <div class="ju-seg" id="setMode">${['auto', 'light', 'dark'].map((m) => `<button type="button" data-m="${m}" class="${mode === m ? 'on' : ''}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div></div>
    <div class="setting"><div class="grow"><b>Glass</b><small>0 solid · 30 frosted · 100 clear</small></div><input type="range" min="0" max="100" value="${glass}" id="setGlass" aria-label="Glass"></div>
    <div class="setting"><div class="grow"><b>Address inside every QR code</b><small class="mono">${esc(S.publicUrl)}</small><br><small>${S.printable ? 'This is the real address. Codes are final.' : 'Preview address. Codes become final once the site is online.'}</small></div></div>
    <div class="setting"><div class="grow"><b>Jinharsh Docs</b><small>Version ${esc(S.version || '')} · up to ${S.maxUploadMB} MB per PDF</small></div></div>`);
  $('#setMode', sh).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-m]'); if (!b) return;
    const m = b.dataset.m;
    ui(() => JUI.setDark(m === 'auto' ? 'auto' : m === 'dark'));
    sh.querySelectorAll('#setMode button').forEach((x) => x.classList.toggle('on', x === b));
    paintThemeBtn();
  });
  $('#setGlass', sh).addEventListener('input', (e) => ui(() => JUI.setGlass(e.target.value)));
}

function paintThemeBtn() {
  const dark = document.documentElement.classList.contains('dark');
  $('#themeBtn').innerHTML = icon(dark ? 'sun' : 'moon');
  $('#themeBtn').setAttribute('aria-label', dark ? 'Switch to light' : 'Switch to dark');
}

// ---------- wiring ----------
function wire() {
  $('#uploadBtn').addEventListener('click', pickFiles);
  $('#fileInput').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; startUpload(f); });
  $('#replaceInput').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; startReplace(f); });
  $('#settingsBtn').addEventListener('click', settingsSheet);
  $('#themeBtn').addEventListener('click', () => {
    ui(() => JUI.setDark(!document.documentElement.classList.contains('dark')));
    paintThemeBtn();
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
    if (act === 'upload') return pickFiles();
    if (act === 'show-live') { S.filter = 'live'; S.query = ''; $('#search').value = ''; renderTiles(); renderList(); return; }
    const code = el.closest('.doc')?.dataset.code; const d = docOf(code); if (!d) return;
    if (act === 'toggle') return toggle(code);
    if (act === 'logo') {
      S.logo[code] = el.dataset.v === '1';
      const box = el.closest('.qr-col');
      box.querySelector('.qr-tile').innerHTML = qrSvg(d.link, { logo: S.logo[code], title: d.title });
      box.querySelectorAll('[data-act="logo"]').forEach((b) => b.classList.toggle('on', b === el));
      return;
    }
    if (act === 'copy') return copyLink(d.link);
    if (act === 'svg' || act === 'png') return downloadQR(d, act, !!S.logo[code]);
    if (act === 'print') return printQR(d, !!S.logo[code]);
    if (act === 'replace') { S.replaceFor = code; $('#replaceInput').click(); return; }
    if (act === 'rename') return renameSheet(d);
    if (act === 'use-version') {
      const v = Number(el.dataset.v);
      return confirmSheet({
        title: `Show version ${v}?`, text: 'Everyone who scans the QR will see this version again. Nothing is deleted.', yes: 'Show this version',
        onYes: async () => putDoc(await API.updateDoc(code, { current: v })),
      });
    }
    if (act === 'archive') return confirmSheet({
      title: `Archive “${esc(d.title)}”?`, text: 'Anyone who scans its QR will see “no longer available” with your contact details. Nothing is deleted, and you can bring it back any time.', yes: 'Archive',
      onYes: async () => { putDoc(await API.updateDoc(code, { status: 'archived' })); S.open = null; },
    });
    if (act === 'restore') return (async () => { try { putDoc(await API.updateDoc(code, { status: 'live' })); S.filter = 'live'; render(); toast('Back on. The QR works again.'); } catch (er) { toast(er.message); } })();
    if (act === 'delete') return confirmSheet({
      title: `Delete “${esc(d.title)}” for good?`, text: 'The PDF and all its versions are removed from the server and cannot be brought back. Its QR will show “no longer available”. The code is never given to another document.', yes: 'Delete for good',
      onYes: async () => { await API.deleteDoc(code); S.docs = S.docs.filter((x) => x.code !== code); S.open = null; },
    });
  });
  list.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.ju-row[data-act="toggle"]')) { e.preventDefault(); toggle(e.target.closest('.doc').dataset.code); }
  });

  // sheet: close by the X, Cancel, the veil, or Esc
  $('#overlay').addEventListener('click', (e) => {
    if (e.target.id === 'overlay' || e.target.closest('[data-sheet="close"]')) closeSheet(e.target.closest('[data-sheet="close"]') && !S.busy);
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
    startUpload(e.dataTransfer.files);
  });
}

// for testing on this computer: window.__docs.upload(fileObjects)
window.__docs = { upload: startUpload, reload };
start();
