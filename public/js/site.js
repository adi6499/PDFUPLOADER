// Pieces shared by the two public pages (the front page of all catalogues, and each catalogue's page).
import { icon } from '/vendor/icons.js?v=2';
import { qrSvg, qrSvgFile, qrPng, saveBlob } from './qr.js';
import * as M from './motion.js';
import { assemble, enableHoverScatter, enableButtonParticles, swallow, sparkle } from './particles.js';
// the visiting card code is only needed when someone opens a card: fetched quietly once the page is idle
const loadCard = () => import('./card.js');
export const idle = (fn, wait = 1500) => { try { setTimeout(() => (window.requestIdleCallback || ((f) => setTimeout(f, 1)))(() => { try { fn(); } catch {} }, { timeout: 4000 }), wait); } catch {} };
// fetch a script ahead of time without running it (it runs only when it is first used)
export const warmModule = (href) => { try { if (document.querySelector(`link[rel="modulepreload"][href="${href}"]`)) return; const l = document.createElement('link'); l.rel = 'modulepreload'; l.href = href; document.head.appendChild(l); } catch {} };
idle(() => warmModule('/js/card.js'), 2500);
import { copyText, showCopied, flashLink } from './copy.js';
import { querySheet, setSite, track } from './visitor.js';

enableHoverScatter();    // big QR codes: the grains scatter away from the mouse or finger
enableButtonParticles(); // every button press sprays a few grains; download buttons pour them in

// closing a window: it floats away as soft grains from where you pressed X, while the veil clears
// light / dark: the sun or moon in the top bar; the new look spreads out in a circle from it.
// Until it is pressed the page follows the phone's own setting; afterwards the choice is kept on this device.
function wireTheme() {
  const b = document.getElementById('themeTop');
  if (!b) return;
  const paint = () => {
    const dark = document.documentElement.classList.contains('dark');
    b.innerHTML = icon(dark ? 'sun' : 'moon');
    b.setAttribute('aria-label', dark ? 'Switch to light' : 'Switch to dark');
    b.title = dark ? 'Light mode' : 'Dark mode';
  };
  paint();
  b.addEventListener('click', () => {
    const r = b.getBoundingClientRect();
    M.themeSwitch(r.left + r.width / 2, r.top + r.height / 2, () => {
      try { JUI.setDark(!document.documentElement.classList.contains('dark')); } catch {}
      paint();
    });
  });
}
try { wireTheme(); } catch { /* cosmetic */ }

export const centreOf = (el) => { const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; };
const swallowOut = (sheet, ov, at) => { swallow(sheet, { at }); return M.play(ov, [{ opacity: 1 }, { opacity: 0 }], { duration: 480, easing: 'ease-in' }); };

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const ui = (fn) => { try { fn(); } catch (e) {} };
export const toast = (t) => ui(() => JUI.toast(t));
export const shortLink = (l) => String(l).replace(/^https?:\/\//, '').replace(/\/$/, '');

// a calm colour per brand, for catalogues that have no cover picture yet
export function brandHue(name) {
  let h = 0; for (const ch of String(name || 'Jinharsh')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
export function blankCover(doc, extraClass = '') {
  const b = doc.brand || 'Jinharsh';
  return `<div class="blank-cover ${extraClass}" style="--h:${brandHue(b)}"><span class="bc-brand">${esc(b)}</span><span class="bc-title">${esc(doc.title)}</span></div>`;
}

const GO = `<span class="c-go" aria-hidden="true">${icon('chevron-down')}</span>`;
// the mouse coming over a contact button sprays a few grains off its round icon (not more than once a moment)
function wireContactHover() {
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const it = e.target.closest && e.target.closest('.c-item');
    if (!it || (e.relatedTarget && it.contains(e.relatedTarget))) return;
    const now = Date.now();
    if (now - (it.__sp || 0) < 700) return;
    it.__sp = now;
    try { sparkle(it.querySelector('.c-ic')); } catch {}
  }, { passive: true });
}
try { wireContactHover(); } catch { /* cosmetic */ }

// any button marked data-ask opens "Send a query" (about the catalogue in data-code, if any)
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-ask]');
  if (!b) return;
  e.preventDefault();
  querySheet({ code: b.dataset.code || '', title: b.dataset.title || '', message: b.dataset.message || '', from: b, onTop: !!b.closest('.reader-ov') });
});

export function contactHtml(SITE, title, code = '') {
  setSite(SITE);
  const C = SITE.contact || {};
  const items = [];
  const subj = title ? `About: ${title}` : 'Enquiry';
  (C.phones || []).slice(0, 1).forEach((p) => items.push(`<a class="c-item" data-k="call" href="tel:${esc(p.dial)}"><span class="c-ic">${icon('phone')}</span><span><b>Call</b><small>${esc(p.display)}</small></span>${GO}</a>`));
  if (C.whatsapp) items.push(`<a class="c-item" data-k="wa" href="https://wa.me/${esc(C.whatsapp)}?text=${encodeURIComponent('Hello Jinharsh, ' + (title ? 'I have a question about “' + title + '”.' : 'I have a question.'))}" target="_blank" rel="noopener"><span class="c-ic">${icon('message-circle')}</span><span><b>WhatsApp</b><small>Chat with us</small></span>${GO}</a>`);
  if (C.email) items.push(`<a class="c-item" data-k="mail" href="mailto:${esc(C.email)}?subject=${encodeURIComponent(subj)}"><span class="c-ic">${icon('mail')}</span><span><b>Email</b><small>${esc(C.email)}</small></span>${GO}</a>`);
  if (C.website) items.push(`<a class="c-item" data-k="web" href="${esc(C.website)}" target="_blank" rel="noopener"><span class="c-ic">${icon('globe')}</span><span><b>Website</b><small>${esc(C.website.replace(/^https?:\/\//, ''))}</small></span>${GO}</a>`);
  const phones = (C.phones || []).map((p) => `<a href="tel:${esc(p.dial)}">${esc(p.display)}</a>`).join(' · ');
  return `<section class="ju-card contact">
    <div class="contact-head">
      <div><h2>Questions? Talk to us.</h2>
      <p>${esc(SITE.company?.name || '')}${SITE.company?.tagline ? ' · ' + esc(SITE.company.tagline) : ''}</p></div>
      <button class="ju-btn accent" type="button" data-ask data-code="${esc(code)}" data-title="${esc(title || '')}">${icon('message-square-text')}Send a query</button>
    </div>
    <div class="c-grid">${items.join('')}</div>
    <p class="addr">${C.address ? esc(C.address) + '<br>' : ''}${phones}</p>
  </section>
  <footer class="v-foot">© ${new Date().getFullYear()} ${esc(SITE.company?.name || '')} · <a class="team-link" href="/team">${icon('upload')}Team: upload catalogues</a></footer>`;
}

export async function share(title, url) {
  if (navigator.share) {
    try { await navigator.share({ title, text: title, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  if (await copyText(url)) toast('Link copied'); else window.prompt('Copy this link:', url);
}

// The Share window: grains burst out of the Share button and bind together as the QR code,
// with the ways to send it underneath (WhatsApp, email, copy link, the QR picture, and the phone's own share menu).
export function shareSheet({ link, title, from = null, site = {}, printable = true, code = '' }) {
  track('share', code);
  const ov = document.createElement('div');
  ov.className = 'ju-overlay';
  const safe = String(title || 'Jinharsh catalogues').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 90);
  const msg = `${title} ${link}`;
  ov.innerHTML = `<div class="ju-sheet qr-sheet share-sheet" role="dialog" aria-modal="true" aria-label="Share">
    <button class="ju-icon close-x" type="button" data-x aria-label="Close">${icon('x')}</button>
    <div class="ju-eyebrow">Share</div>
    <h2>${esc(title)}</h2>
    <div class="qr-tile qr-big" data-link="${esc(link)}">${qrSvg(link, { logo: true, title })}</div>
    <p class="qr-link mono">${esc(shortLink(link))}</p>
    <div class="share-grid">
      <a class="share-opt" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener"><span class="so-ic wa">${icon('message-circle')}</span><span>WhatsApp</span></a>
      <a class="share-opt" href="mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(title + '\n' + link)}"><span class="so-ic">${icon('mail')}</span><span>Email</span></a>
      <button class="share-opt" type="button" data-copy><span class="so-ic">${icon('copy')}</span><span>Copy link</span></button>
      <button class="share-opt" type="button" data-png><span class="so-ic">${icon('download')}</span><span>QR picture</span></button>
      <button class="share-opt" type="button" data-card><span class="so-ic">${icon('id-card')}</span><span>Visiting card</span></button>
      ${navigator.share ? `<button class="share-opt" type="button" data-more><span class="so-ic">${icon('share-2')}</span><span>More…</span></button>` : ''}
    </div>
  </div>`;
  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';
  const sheet = ov.querySelector('.share-sheet');
  // even rows: up to five side by side, six as two rows of three
  const grid = ov.querySelector('.share-grid'), n = grid.children.length;
  grid.style.gridTemplateColumns = `repeat(${n <= 5 ? n : Math.ceil(n / 2)}, minmax(0, 1fr))`;
  let closing = false;
  const close = async (at) => {
    if (closing) return; closing = true;
    document.removeEventListener('keydown', onKey);
    await swallowOut(sheet, ov, at);
    ov.remove(); document.body.style.overflow = '';
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('click', async (e) => {
    if (e.target === ov) return close();
    if (e.target.closest('[data-x]')) return close(centreOf(e.target.closest('[data-x]')));
    const b = e.target.closest('.share-opt'); if (!b) return;
    M.bump(b.querySelector('.so-ic'), 1.15);
    if (b.matches('[data-copy]')) {
      if (await copyText(link)) { toast('Link copied'); showCopied(b); flashLink(ov.querySelector('.qr-link')); } else window.prompt('Copy this link:', link);
    }
    if (b.matches('[data-png]')) { saveBlob(await qrPng(link, true, 2000), `QR ${safe}.png`); toast('QR picture saved'); }
    if (b.matches('[data-more]')) { try { await navigator.share({ title, text: title, url: link }); } catch {} }
    if (b.matches('[data-card]')) {
      loadCard().then((m) => m.cardSheet({ link, title, site, printable, from: b })).catch(() => toast('Could not open the card. Please try again.'));
      close(centreOf(b));
    }
  });
  // the grains come out of the button that was pressed (or from all around)
  setTimeout(() => assemble(ov.querySelector('.qr-big'), link, { from }), 60);
}

// The public "QR code" window: the catalogue's own QR (with the Jinharsh logo), ready for posters and stands.
export function qrSheet({ link, title }) {
  const ov = document.createElement('div');
  ov.className = 'ju-overlay';
  const safe = String(title || 'Jinharsh catalogues').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 90);
  ov.innerHTML = `<div class="ju-sheet qr-sheet" role="dialog" aria-modal="true" aria-label="QR code">
    <button class="ju-icon close-x" type="button" data-x aria-label="Close">${icon('x')}</button>
    <div class="qr-tile qr-big" data-link="${esc(link)}">${qrSvg(link, { logo: true, title })}</div>
    <h2>${esc(title)}</h2>
    <p class="qr-link mono">${esc(shortLink(link))}</p>
    <div class="btns">
      <button class="ju-btn primary" type="button" data-png>${icon('download')}Download QR</button>
      <button class="ju-btn" type="button" data-svg>${icon('printer')}For printing (SVG)</button>
      <button class="ju-btn" type="button" data-copy>${icon('copy')}Copy link</button>
    </div>
    <p class="ju-small ju-muted qr-hint">Point a phone camera at it: it opens ${title ? 'this catalogue' : 'all catalogues'}.</p>
  </div>`;
  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';
  const sheet = ov.querySelector('.qr-sheet');
  let closing = false;
  const close = async (at) => {
    if (closing) return; closing = true;
    document.removeEventListener('keydown', onKey);
    await swallowOut(sheet, ov, at);
    ov.remove(); document.body.style.overflow = '';
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('click', async (e) => {
    if (e.target === ov) return close();
    if (e.target.closest('[data-x]')) return close(centreOf(e.target.closest('[data-x]')));
    const b = e.target.closest('button'); if (!b) return;
    if (b.matches('[data-png]')) { M.nudgeDown(b.querySelector('.i')); saveBlob(await qrPng(link, true, 2000), `QR ${safe}.png`); toast('QR picture saved'); }
    if (b.matches('[data-svg]')) { saveBlob(new Blob([await qrSvgFile(link, true)], { type: 'image/svg+xml' }), `QR ${safe}.svg`); toast('Saved: best for printing'); }
    if (b.matches('[data-copy]')) {
      if (await copyText(link)) { toast('Link copied'); showCopied(b); flashLink(ov.querySelector('.qr-link')); } else window.prompt('Copy this link:', link);
    }
  });
  assemble(ov.querySelector('.qr-big'), link);
  M.rise(sheet.querySelectorAll('h2, .qr-link, .btns > .ju-btn, .qr-hint'), { delay: 160, step: 55 });
}
