// Pieces shared by the two public pages (the front page of all catalogues, and each catalogue's page).
import { icon } from '/vendor/icons.js';
import { qrSvg, qrSvgFile, qrPng, saveBlob } from './qr.js';
import * as M from './motion.js';

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

export function contactHtml(SITE, title) {
  const C = SITE.contact || {};
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

export async function share(title, url) {
  if (navigator.share) {
    try { await navigator.share({ title, text: title, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { window.prompt('Copy this link:', url); }
}

// The public "QR code" window: the catalogue's own QR (with the Jinharsh logo), ready for posters and stands.
export function qrSheet({ link, title }) {
  const ov = document.createElement('div');
  ov.className = 'ju-overlay';
  const safe = String(title || 'Jinharsh catalogues').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 90);
  ov.innerHTML = `<div class="ju-sheet qr-sheet" role="dialog" aria-modal="true" aria-label="QR code">
    <button class="ju-icon close-x" type="button" data-x aria-label="Close">${icon('x')}</button>
    <div class="qr-tile qr-big">${qrSvg(link, { logo: true, title })}</div>
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
  const close = async () => {
    if (closing) return; closing = true;
    document.removeEventListener('keydown', onKey);
    await M.leave(sheet, ov);
    ov.remove(); document.body.style.overflow = '';
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('click', async (e) => {
    if (e.target === ov || e.target.closest('[data-x]')) return close();
    const b = e.target.closest('button'); if (!b) return;
    if (b.matches('[data-png]')) { M.nudgeDown(b.querySelector('.i')); saveBlob(await qrPng(link, true, 2000), `QR ${safe}.png`); toast('QR picture saved'); }
    if (b.matches('[data-svg]')) { saveBlob(new Blob([await qrSvgFile(link, true)], { type: 'image/svg+xml' }), `QR ${safe}.svg`); toast('Saved: best for printing'); }
    if (b.matches('[data-copy]')) {
      try { await navigator.clipboard.writeText(link); toast('Link copied'); b.innerHTML = icon('check') + 'Copied'; M.bump(b.querySelector('.i'), 1.25); } catch { window.prompt('Copy this link:', link); }
    }
  });
  M.bump(ov.querySelector('.qr-big'), 1.04);
}
