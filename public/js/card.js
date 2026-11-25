// The visiting card: 89 x 51 mm (the usual Indian card size), ready for the print shop.
// Left: the Jinharsh logo, the company, the contact details. Right: the catalogue's own QR code.
//
//   cardSheet({ link, title, site, printable, from })   the window with the card, its downloads and Print
//   cardFile(...) -> a stand-alone SVG (logo and Geist font inside, so it prints the same anywhere)
//   cardPng(...)  -> a 300 dpi picture (1051 x 602 px)
import { icon } from '/vendor/icons.js';
import { qrSvg, saveBlob } from './qr.js';
import * as M from './motion.js';
import { bindImage, swallow } from './particles.js';

const W = 89, H = 51;                     // millimetres
const ORANGE = '#ea580c', INK = '#141416', GREY = '#5f5f67';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (t) => { try { JUI.toast(t); } catch {} };

// split text into lines of at most `max` letters, at spaces
function wrap(text, max, lines = 2) {
  const words = String(text || '').split(/\s+/).filter(Boolean), out = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
    if (out.length === lines) break;
  }
  if (out.length < lines && cur) out.push(cur);
  if (out.length === lines && words.join(' ').length > out.join(' ').length) out[lines - 1] = out[lines - 1].replace(/.{0,1}$/, '…');
  return out.slice(0, lines);
}

// The card as SVG. `logo` and `qrLogo` are picture addresses (data: addresses make a stand-alone file).
export function cardSvg({ link, title, site = {}, logo = '/assets/mark.png', qrLogo = '/assets/qr-logo.png', fontCss = '' }) {
  const C = site.contact || {}, co = site.company || {};
  const name = (co.name || 'Jinharsh Industrial Solutions Private Limited').replace(/Private Limited$/i, 'Pvt. Ltd.');
  const nameLines = wrap(name, 20, 2);
  const tagline = co.tagline ? co.tagline.charAt(0).toUpperCase() + co.tagline.slice(1) : '';
  const phones = (C.phones || []).map((p) => p.display).join('  ·  ');
  const web = String(C.website || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const all = /^jinharsh catalogues$/i.test(title || '');
  const tLines = all ? [] : wrap(title, 30, 2);
  // the QR, placed as a picture inside the card
  const q = qrSvg(link, { logo: true, logoHref: qrLogo, title }).replace('<svg ', '<svg x="55" y="5.2" width="28.6" height="28.6" ');
  const line = (y, txt, size, weight = 400, fill = INK, extra = '') => `<text x="6" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}"${extra}>${esc(txt)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="Geist, 'Helvetica Neue', Arial, sans-serif" role="img" aria-label="Visiting card">
  ${fontCss ? `<style>${fontCss}</style>` : ''}
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <rect width="2.2" height="${H}" fill="${ORANGE}"/>
  <image href="${logo}" x="5.6" y="4.6" width="12.6" height="12.6"/>
  ${nameLines.map((t, i) => line(22.2 + i * 4, t, 3.5, 800, INK, ' letter-spacing="-0.05"')).join('\n  ')}
  ${tagline ? line(22.2 + nameLines.length * 4 - 0.6, tagline, 1.9, 500, GREY) : ''}
  <rect x="6" y="${22.2 + nameLines.length * 4 + 1.3}" width="12" height="0.55" rx="0.27" fill="${ORANGE}"/>
  ${phones ? line(36.6, phones, 2.1, 650) : ''}
  ${C.email ? line(39.7, C.email, 2.1) : ''}
  ${web ? line(42.8, web, 2.1) : ''}
  ${C.address ? line(45.9, C.address, 1.75, 400, GREY) : ''}
  ${q}
  <text x="69.3" y="37.6" font-size="2.15" font-weight="750" text-anchor="middle" fill="${INK}">${all ? 'Scan for all our catalogues' : 'Scan for our catalogue'}</text>
  ${tLines.map((t, i) => `<text x="69.3" y="${40.6 + i * 2.6}" font-size="1.8" text-anchor="middle" fill="${GREY}">${esc(t)}</text>`).join('\n  ')}
</svg>`;
}

// ---------- files ----------
const asDataUrl = async (url) => {
  const b = await (await fetch(url)).blob();
  return new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(b); });
};
let packed = null; // logo, QR logo and font, read once
async function pack() {
  if (packed) return packed;
  const [logo, qrLogo, font] = await Promise.all([asDataUrl('/assets/mark.png'), asDataUrl('/assets/qr-logo.png'), asDataUrl('/vendor/fonts/Geist-Variable.woff2')]);
  packed = { logo, qrLogo, fontCss: `@font-face{font-family:'Geist';src:url(${font}) format('woff2');font-weight:100 900;font-style:normal}` };
  return packed;
}
export async function cardFile(opts) {
  const p = await pack();
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + cardSvg({ ...opts, ...p });
}
export async function cardPng(opts) {
  const svg = await cardFile(opts);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image(); img.src = url; await img.decode();
    await new Promise((r) => setTimeout(r, 60)); // let the font inside the picture settle
    const px = 300 / 25.4, cv = document.createElement('canvas');
    cv.width = Math.round(W * px); cv.height = Math.round(H * px);
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    g.drawImage(img, 0, 0, cv.width, cv.height);
    return await new Promise((ok) => cv.toBlob(ok, 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}
// Prints the card alone, at its real size (89 x 51 mm), on white paper whatever the theme.
export function printCard(opts) {
  let area = document.getElementById('printArea'), made = false;
  if (!area) { area = document.createElement('div'); area.id = 'printArea'; document.body.appendChild(area); made = true; }
  const before = area.innerHTML;
  area.innerHTML = cardSvg(opts);
  const st = document.createElement('style');
  st.textContent = `@page { size: ${W}mm ${H}mm; margin: 0 }
    @media print {
      html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
      body > *:not(#printArea) { display: none !important; }
      #printArea { display: block !important; margin: 0 !important; padding: 0 !important; text-align: left !important; }
      #printArea svg { display: block; width: ${W}mm; height: ${H}mm; }
    }`;
  document.head.appendChild(st);
  const tidy = () => { st.remove(); if (made) area.remove(); else area.innerHTML = before; window.removeEventListener('afterprint', tidy); };
  window.addEventListener('afterprint', tidy);
  setTimeout(() => window.print(), 80);
  setTimeout(tidy, 60000);
}

// ---------- the window ----------
export function cardSheet({ link, title, site = {}, printable = true, from = null }) {
  const opts = { link, title, site };
  const safe = String(title || 'Jinharsh').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80);
  const ov = document.createElement('div');
  ov.className = 'ju-overlay';
  ov.innerHTML = `<div class="ju-sheet card-sheet" role="dialog" aria-modal="true" aria-label="Visiting card">
    <button class="ju-icon close-x" type="button" data-x aria-label="Close">${icon('x')}</button>
    <div class="ju-eyebrow">Visiting card</div>
    <h2>Ready to print</h2>
    <p class="ju-muted card-sub">89 × 51 mm. The QR on it opens ${/^jinharsh catalogues$/i.test(title || '') ? 'all our catalogues' : '“' + esc(title) + '”'}, and keeps working after the PDF is replaced.</p>
    ${printable ? '' : `<div class="notice warn card-warn">${icon('circle-alert')}<div><b>Preview card: do not print yet.</b><p>Its QR points to <span class="mono">${esc(link.replace(/^https?:\/\//, ''))}</span>. Print it once the site is online at catalog.jinharsh.com.</p></div></div>`}
    <div class="card-preview">${cardSvg(opts)}</div>
    <div class="btns card-btns">
      <button class="ju-btn primary" type="button" data-card-svg>${icon('download')}For the print shop (SVG)</button>
      <button class="ju-btn" type="button" data-card-png>${icon('image')}Picture (PNG)</button>
      <button class="ju-btn" type="button" data-card-print>${icon('printer')}Print</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';
  const sheet = ov.querySelector('.card-sheet');
  let closing = false;
  const close = (at) => {
    if (closing) return; closing = true;
    document.removeEventListener('keydown', onKey);
    swallow(sheet, { at });
    M.play(ov, [{ opacity: 1 }, { opacity: 0 }], { duration: 480, easing: 'ease-in' }).then(() => { ov.remove(); document.body.style.overflow = ''; });
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('click', async (e) => {
    if (e.target === ov) return close();
    const x = e.target.closest('[data-x]');
    if (x) { const b = x.getBoundingClientRect(); return close({ x: b.left + b.width / 2, y: b.top + b.height / 2 }); }
    const b = e.target.closest('button'); if (!b) return;
    try {
      if (b.matches('[data-card-svg]')) { saveBlob(new Blob([await cardFile(opts)], { type: 'image/svg+xml' }), `Visiting card ${safe}.svg`); toast('Card saved: send this file to the print shop'); }
      if (b.matches('[data-card-png]')) { saveBlob(await cardPng(opts), `Visiting card ${safe}.png`); toast('Card picture saved (300 dpi)'); }
      if (b.matches('[data-card-print]')) printCard(opts);
    } catch { toast('Could not make the file. Please try again.'); }
  });
  // the card comes together out of grains (in the card's own colours) from the button that opened it
  const preview = ov.querySelector('.card-preview');
  if (from) {
    preview.style.visibility = 'hidden';
    const pic = new Image();
    pic.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(cardSvg(opts));
    pic.decode().catch(() => {}).then(() => bindImage(from, preview, { cols: 44, sample: pic }));
    setTimeout(() => { if (preview.style.visibility === 'hidden' && !document.querySelector('canvas[aria-hidden]')) preview.style.visibility = ''; }, 2600);
  }
}
