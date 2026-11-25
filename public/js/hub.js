// The front page: every live catalogue, with brand filters and search.
// Links from the old catalog.jinharsh.com hub keep working: /?cat=<name> opens that catalogue.
import { icon } from '/vendor/icons.js';
import { fmtSize } from './pdfkit.js';
import * as M from './motion.js';
import { esc, ui, contactHtml, share, qrSheet, blankCover } from './site.js';

const $ = (s, el = document) => el.querySelector(s);
const params = new URLSearchParams(location.search);
const cat = params.get('cat');
if (cat && /^[A-Za-z0-9-]{1,40}$/.test(cat)) location.replace('/c/' + cat.toLowerCase());

const S = { all: [], brand: '', q: '', publicUrl: location.origin, site: {} };

ui(() => {
  $('#searchIcon').outerHTML = icon('search');
  $('#hubQr').innerHTML = icon('qr-code');
  $('#hubShare').innerHTML = icon('share-2');
});
$('#hubQr').addEventListener('click', () => qrSheet({ link: S.publicUrl + '/', title: 'Jinharsh Catalogues' }));
$('#hubShare').addEventListener('click', () => share('Jinharsh Catalogues', S.publicUrl + '/'));

// waiting shapes while the list arrives (plain, nothing moves or shines)
$('#cards').innerHTML = Array.from({ length: 6 }, () => '<div class="cat-card ghost-card"><div class="cc-cover"></div><div class="cc-body"><i></i><i></i></div></div>').join('');

async function load() {
  try {
    const r = await fetch('/api/catalogs');
    const j = await r.json();
    S.all = j.catalogs || []; S.publicUrl = (j.publicUrl || location.origin).replace(/\/$/, ''); S.site = j.site || {};
  } catch {
    $('#cards').innerHTML = `<div class="ju-card empty-hub"><h3>The catalogues could not be loaded</h3><p class="ju-muted">Please check the internet connection and try again.</p><button class="ju-btn primary" type="button" data-reload>Try again</button></div>`;
    return;
  }
  // catalogues with a PDF first (newest first), then those still waiting
  S.all.sort((a, b) => (a.waiting === b.waiting ? String(b.updatedAt).localeCompare(String(a.updatedAt)) : a.waiting ? 1 : -1));
  const brands = [...new Set(S.all.map((d) => d.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const ready = S.all.filter((d) => !d.waiting).length;
  $('#hubEyebrow').textContent = `${S.all.length} catalogue${S.all.length === 1 ? '' : 's'}${brands.length ? ` · ${brands.length} brand${brands.length === 1 ? '' : 's'}` : ''} · ${ready} ready to read`;
  $('#chips').innerHTML = ['', ...brands].map((b) => `<button type="button" class="ju-chip${b === S.brand ? ' on' : ''}" data-brand="${esc(b)}">${b ? esc(b) : 'All'}</button>`).join('');
  $('#contact').innerHTML = contactHtml(S.site, '');
  draw(true);
}

function visible() {
  const q = S.q.trim().toLowerCase();
  return S.all.filter((d) => (!S.brand || d.brand === S.brand) &&
    (!q || [d.title, d.brand, d.category, d.note].join(' ').toLowerCase().includes(q)));
}

function card(d) {
  const meta = d.waiting ? (d.sourceUrl ? 'On the maker’s website' : 'Coming soon')
    : [d.pages ? `${d.pages} pages` : null, fmtSize(d.size)].filter(Boolean).join(' · ');
  return `<article class="cat-card${d.waiting ? ' is-waiting' : ''}" data-key="${esc(d.code)}">
    <a class="cc-link" href="/c/${esc(d.code)}" aria-label="${esc(d.title)}">
      <div class="cc-cover">${d.cover ? `<img src="${esc(d.cover)}" alt="" loading="lazy" decoding="async" style="view-transition-name:cover-${esc(d.code)}">` : blankCover(d)}</div>
      <div class="cc-body">
        <div class="cc-top">${d.brand ? `<span class="brand-pill">${esc(d.brand)}</span>` : ''}${d.category ? `<span class="cc-cat">${esc(d.category)}</span>` : ''}</div>
        <h3>${esc(d.title)}</h3>
        ${d.note ? `<p>${esc(d.note)}</p>` : ''}
        <div class="cc-foot"><span class="${d.waiting ? 'ju-pill warn' : 'cc-meta'}">${esc(meta)}</span><span class="cc-go">${icon(d.waiting ? 'external-link' : 'book-open')}</span></div>
      </div>
    </a>
    <button class="ju-icon cc-qr" type="button" data-qr="${esc(d.code)}" aria-label="QR code for ${esc(d.title)}" title="QR code">${icon('qr-code')}</button>
  </article>`;
}

function draw(first) {
  const box = $('#cards');
  const list = visible();
  let done = () => {};
  if (!first) ui(() => { done = JUI.flip(box); });
  box.classList.toggle('ju-enter', !!first);
  box.innerHTML = list.length ? list.map(card).join('')
    : `<div class="ju-card empty-hub"><h3>No catalogue matches “${esc(S.q || S.brand)}”</h3><p class="ju-muted">Try another word, or ask us: we will send you the right catalogue.</p><button class="ju-btn" type="button" data-clear>Show all catalogues</button></div>`;
  done();
}

$('#chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-brand]'); if (!b) return;
  S.brand = b.dataset.brand;
  document.querySelectorAll('#chips .ju-chip').forEach((c) => c.classList.toggle('on', c === b));
  M.bump(b, 1.06);
  draw();
});
let t = 0;
$('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { S.q = e.target.value; draw(); }, 120); });
$('#cards').addEventListener('click', (e) => {
  const q = e.target.closest('[data-qr]');
  if (q) { const d = S.all.find((x) => x.code === q.dataset.qr); if (d) qrSheet({ link: `${S.publicUrl}/c/${d.code}`, title: d.title }); return; }
  if (e.target.closest('[data-reload]')) { location.reload(); return; }
  if (e.target.closest('[data-clear]')) { S.q = ''; S.brand = ''; $('#q').value = ''; document.querySelectorAll('#chips .ju-chip').forEach((c, i) => c.classList.toggle('on', i === 0)); draw(); }
});

load();
