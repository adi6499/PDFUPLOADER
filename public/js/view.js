// The scan page. The server puts the document's details into the page itself (id="boot"),
// so the cover and title show at once; the PDF pages are then drawn one by one as they come near the screen.
import { icon } from '/vendor/icons.js';
import { pdfjs, PDF_OPTS, fmtSize } from './pdfkit.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ui = (fn) => { try { fn(); } catch (e) {} };
const toast = (t) => ui(() => JUI.toast(t));

let BOOT = {};
try { BOOT = JSON.parse($('#boot').textContent); } catch {}
const SITE = BOOT.site || {};
const C = SITE.contact || {};
const D = BOOT.doc;
const app = $('#app');
const preview = new URLSearchParams(location.search).has('preview');

ui(() => {
  if (C.website) { $('#brand').href = C.website; $('#brand').target = '_blank'; }
  if (SITE.company?.short) $('#brand b').textContent = SITE.company.short;
});

function contactHtml(title) {
  const items = [];
  const subj = title ? `About: ${title}` : 'Enquiry';
  (C.phones || []).slice(0, 1).forEach((p) => items.push(`<a class="c-item" href="tel:${esc(p.dial)}"><span class="c-ic">${icon('phone')}</span><span><b>Call</b><small>${esc(p.display)}</small></span></a>`));
  if (C.whatsapp) items.push(`<a class="c-item" href="https://wa.me/${esc(C.whatsapp)}?text=${encodeURIComponent('Hello Jinharsh, ' + (title ? 'I have a question about “' + title + '”.' : 'I have a question.'))}" target="_blank" rel="noopener"><span class="c-ic">${icon('message-circle')}</span><span><b>WhatsApp</b><small>Chat with us</small></span></a>`);
  if (C.email) items.push(`<a class="c-item" href="mailto:${esc(C.email)}?subject=${encodeURIComponent(subj)}"><span class="c-ic">${icon('mail')}</span><span><b>Email</b><small>${esc(C.email)}</small></span></a>`);
  if (C.website) items.push(`<a class="c-item" href="${esc(C.website)}" target="_blank" rel="noopener"><span class="c-ic">${icon('globe')}</span><span><b>Website</b><small>${esc(C.website.replace(/^https?:\/\//, ''))}</small></span></a>`);
  const phones = (C.phones || []).map((p) => `<a href="tel:${esc(p.dial)}">${esc(p.display)}</a>`).join(' · ');
  return `<section class="ju-card contact">
    <h2>Questions? Talk to us.</h2>
    <p>${esc(SITE.company?.name || '')}${SITE.company?.tagline ? ' · ' + esc(SITE.company.tagline) : ''}</p>
    <div class="c-grid">${items.join('')}</div>
    <p class="addr">${C.address ? esc(C.address) + '<br>' : ''}${phones}</p>
  </section>
  <footer class="v-foot">© ${new Date().getFullYear()} ${esc(SITE.company?.name || '')}</footer>`;
}

function shareUrl() { return location.origin + location.pathname; }
async function share(title) {
  const url = shareUrl();
  if (navigator.share) {
    try { await navigator.share({ title, text: title, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { window.prompt('Copy this link:', url); }
}

// ---------- not available ----------
if (BOOT.status !== 'live' || !D) {
  const t = {
    archived: ['This document is no longer available', 'It may have been replaced by a newer one. Contact us and we will send you the latest.'],
    retired: ['This document is no longer available', 'It may have been replaced by a newer one. Contact us and we will send you the latest.'],
    missing: ['Nothing is linked to this code', 'Please check the link, or contact us and we will help you find what you were looking for.'],
  }[BOOT.status] || ['Something went wrong', 'Please try again in a moment.'];
  app.innerHTML = `<div class="ju-enter"><section class="ju-card gone"><div class="art">${icon('circle-alert')}</div><h1>${t[0]}</h1><p>${t[1]}</p></section>${contactHtml(BOOT.doc?.title)}</div>`;
} else {
  showDoc();
}

// ---------- the document ----------
function showDoc() {
  const updated = new Date(D.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const ratio = D.coverW && D.coverH ? D.coverW / D.coverH : 210 / 297;
  const cover = D.cover
    ? `<img src="${D.cover}" alt="Cover of ${esc(D.title)}" width="${D.coverW || 720}" height="${D.coverH || 1018}" fetchpriority="high">`
    : `<div class="blank">${icon('file-text')}</div>`;
  const dl = D.file + '?dl=1';
  app.innerHTML = `
    <section class="v-hero">
      <div class="v-cover">${cover}</div>
      <div class="v-text">
        <div class="ju-eyebrow">PDF${D.pages ? ' · ' + D.pages + (D.pages === 1 ? ' page' : ' pages') : ''} · ${fmtSize(D.size)}</div>
        <h1>${esc(D.title)}</h1>
        <p class="sub">${D.note ? esc(D.note) + ' · ' : ''}Updated ${updated}</p>
        <div class="v-actions">
          <button class="ju-btn accent" type="button" id="readBtn">${icon('book-open')}Read now</button>
          <a class="ju-btn primary" href="${dl}" download="${esc(D.name)}" id="dlBtn">${icon('arrow-down-to-line')}Download</a>
          <button class="ju-btn" type="button" id="shareBtn">${icon('share-2')}Share</button>
        </div>
      </div>
    </section>
    <section class="reader" id="reader" aria-label="Pages">
      <div class="rbar ju-glass">
        <span class="pos" id="pos">${D.pages ? `Page 1 of ${D.pages}` : 'Opening…'}</span>
        <span class="sep"></span>
        <button class="ju-icon" type="button" id="zOut" aria-label="Smaller">${icon('zoom-out')}</button>
        <span class="zoom-val" id="zVal">100%</span>
        <button class="ju-icon" type="button" id="zIn" aria-label="Bigger">${icon('zoom-in')}</button>
        <span class="sep"></span>
        <a class="ju-icon" href="${dl}" download="${esc(D.name)}" aria-label="Download">${icon('download')}</a>
        <button class="ju-icon" type="button" id="topBtn" aria-label="Back to top">${icon('arrow-up')}</button>
      </div>
      <div class="pages-scroll"><div class="pages" id="pages"></div></div>
    </section>
    ${contactHtml(D.title)}`;

  // placeholders straight away, so the page doesn't jump while the PDF loads
  const pagesEl = $('#pages');
  const n0 = D.pages || 1;
  let html = '';
  for (let i = 1; i <= n0; i++) {
    html += `<div class="page" data-n="${i}" style="aspect-ratio:${ratio}">${i === 1 && D.cover ? `<img class="ph" src="${D.cover}" alt="">` : ''}<span class="pno">${i}</span></div>`;
  }
  pagesEl.innerHTML = html;

  $('#readBtn').addEventListener('click', () => $('#reader').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
  $('#shareBtn').addEventListener('click', () => share(D.title));
  $('#topBtn').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  ui(() => { const s = $('#shareTop'); s.hidden = false; s.innerHTML = icon('share-2'); s.addEventListener('click', () => share(D.title)); });

  // one count per visit (the team's own "Open page" adds ?preview=1 and is not counted)
  if (!preview) ui(() => {
    const k = 'seen_' + D.code;
    if (sessionStorage.getItem(k)) return;
    sessionStorage.setItem(k, '1');
    navigator.sendBeacon ? navigator.sendBeacon(`/api/p/${encodeURIComponent(D.code)}/scan`) : fetch(`/api/p/${encodeURIComponent(D.code)}/scan`, { method: 'POST', keepalive: true });
  });

  startReader(pagesEl).catch((e) => {
    console.error(e);
    $('#pos').textContent = 'Could not open the pages';
    pagesEl.insertAdjacentHTML('beforebegin', `<p class="reader-note">The pages could not be shown here. Use <b>Download</b> to open the PDF.</p>`);
  });
}

// ---------- drawing pages near the screen ----------
async function startReader(pagesEl) {
  const L = await pdfjs();
  const pdf = await L.getDocument({ url: D.file, rangeChunkSize: 256 * 1024, disableAutoFetch: true, ...PDF_OPTS }).promise;
  const n = pdf.numPages;
  // the server's page count can be missing for very old uploads: fix the placeholders
  const have = pagesEl.children.length;
  if (have !== n) {
    const ratio = pagesEl.firstElementChild?.style.aspectRatio || String(210 / 297);
    let extra = '';
    for (let i = have + 1; i <= n; i++) extra += `<div class="page" data-n="${i}" style="aspect-ratio:${ratio}"><span class="pno">${i}</span></div>`;
    pagesEl.insertAdjacentHTML('beforeend', extra);
    while (pagesEl.children.length > n) pagesEl.lastElementChild.remove();
  }
  $('#pos').textContent = `Page 1 of ${n}`;

  const state = new Map(); // page number -> { canvas, width, task }
  const near = new Set();
  let busy = false;
  const quality = () => Math.min(3, (window.devicePixelRatio || 1) * 1.35);

  async function draw(el) {
    const num = Number(el.dataset.n);
    const w = el.clientWidth;
    const st = state.get(num);
    if (st && Math.abs(st.width - w) < 2) return;
    const page = await pdf.getPage(num);
    const base = page.getViewport({ scale: 1 });
    el.style.aspectRatio = `${base.width} / ${base.height}`;
    const vp = page.getViewport({ scale: (el.clientWidth * quality()) / base.width });
    const cv = document.createElement('canvas');
    cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
    const g = cv.getContext('2d', { alpha: false });
    g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    const task = page.render({ canvasContext: g, canvas: cv, viewport: vp, background: '#ffffff' });
    state.set(num, { canvas: null, width: w, task });
    try { await task.promise; } catch { state.delete(num); return; }
    if (!near.has(num)) { cv.width = cv.height = 0; state.delete(num); return; }
    const old = el.querySelector('canvas'); if (old) { old.width = old.height = 0; old.remove(); }
    el.insertBefore(cv, el.querySelector('.pno'));
    const ph = el.querySelector('img.ph'); if (ph) ph.remove();
    state.set(num, { canvas: cv, width: w, task: null });
    page.cleanup();
  }

  async function pump() {
    if (busy) return;
    busy = true;
    try {
      // nearest pages to the middle of the screen first
      const mid = window.innerHeight / 2;
      const order = [...near].map((num) => pagesEl.children[num - 1]).filter(Boolean)
        .map((el) => ({ el, d: Math.abs(el.getBoundingClientRect().top + el.clientHeight / 2 - mid) })).sort((a, b) => a.d - b.d);
      for (const { el } of order) {
        if (!near.has(Number(el.dataset.n))) continue;
        await draw(el);
      }
    } finally { busy = false; }
    // something new came near while we were drawing
    const todo = [...near].some((num) => { const s = state.get(num); return !s || Math.abs(s.width - pagesEl.children[num - 1].clientWidth) >= 2; });
    if (todo) setTimeout(pump, 0);
  }

  function release(num) {
    const s = state.get(num); const el = pagesEl.children[num - 1];
    if (s?.task) { try { s.task.cancel(); } catch {} }
    const cv = el?.querySelector('canvas'); if (cv) { cv.width = cv.height = 0; cv.remove(); }
    state.delete(num);
  }

  // pages within about two screens are drawn; pages far away let go of their memory
  const nearObs = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const num = Number(e.target.dataset.n);
      if (e.isIntersecting) near.add(num); else { near.delete(num); release(num); }
    }
    pump();
  }, { rootMargin: '200% 0px 200% 0px' });
  // which page is in the middle of the screen
  const posObs = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) $('#pos').textContent = `Page ${e.target.dataset.n} of ${n}`;
  }, { rootMargin: '-45% 0px -45% 0px' });
  for (const el of pagesEl.children) { nearObs.observe(el); posObs.observe(el); }

  // zoom: wider pages (sideways scroll), redrawn sharp
  const steps = [1, 1.25, 1.5, 2, 2.5];
  let z = 0;
  const setZoom = (k) => {
    z = Math.max(0, Math.min(steps.length - 1, k));
    pagesEl.style.setProperty('--zoom', steps[z]);
    $('#zVal').textContent = Math.round(steps[z] * 100) + '%';
    $('#zOut').disabled = z === 0; $('#zIn').disabled = z === steps.length - 1;
    clearTimeout(setZoom.t); setZoom.t = setTimeout(pump, 120);
  };
  $('#zIn').addEventListener('click', () => setZoom(z + 1));
  $('#zOut').addEventListener('click', () => setZoom(z - 1));
  setZoom(0);
  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(pump, 200); }, { passive: true });
}
