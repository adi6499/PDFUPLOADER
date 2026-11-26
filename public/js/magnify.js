// The top bar as a clear magnifying glass: what scrolls under it is shown a little bigger, the SAME shape (never
// stretched), sharp (no blur), and bent gently only right at its upper and lower edge, like the rim of a lens.
// It replaces the kit's "liquid glass" bend for this site's bars (that one stretched text up to 11 times at the rim).
//
// Only Chrome and Edge can bend what is behind an element; other browsers, slower phones and the Solid / Frosted
// glass settings keep the kit's plain glass. The kit file itself is not changed.
import { perf } from './particles.js';

const ZOOM = 1.12;       // how much bigger things look under the bar
const RIM = 10;          // px: the soft bend along the edges
const RIM_PULL = 5;      // px: how far the rim pulls inward

let svg = null, made = '', bars = [];

// where each pixel of the bar looks instead ("show what is dx, dy away"), as a picture: red = across, green = down
function mapOf(w, h) {
  const cx = w / 2, cy = h / 2, k = 1 - 1 / ZOOM;
  const scale = 2 * Math.max(cx * k, cy * k + RIM_PULL) + 2;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) {
    let dy = (cy - (y + 0.5)) * k;                          // towards the middle line: bigger
    const edge = Math.min(y + 0.5, h - y - 0.5);
    if (edge < RIM) { const t = 1 - edge / RIM; dy += (y < cy ? 1 : -1) * RIM_PULL * t * t; } // the rim bends a little more
    const G = Math.round(128 + (dy / scale) * 255);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      d[i] = Math.round(128 + (((cx - (x + 0.5)) * k) / scale) * 255);
      d[i + 1] = G; d[i + 2] = 128; d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return { url: c.toDataURL('image/png'), scale: Math.round(scale * 100) / 100 };
}

function apply() {
  try {
    const H = document.documentElement;
    const chrome = /Chrome\/\d+/.test(navigator.userAgent || '');
    const clear = H.dataset.juGlass !== 'solid' && H.dataset.juGlass !== 'frosted';
    const on = chrome && clear && !perf.lite;
    if (!on) { bars.forEach((b) => { b.style.backdropFilter = ''; b.style.webkitBackdropFilter = ''; }); return; }
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true');
      svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
      document.body.appendChild(svg);
    }
    const key = bars.map((b) => Math.round(b.offsetWidth) + 'x' + Math.round(b.offsetHeight)).join('|');
    if (key !== made) {
      svg.innerHTML = '<defs>' + bars.map((b, i) => {
        const w = Math.round(b.offsetWidth), h = Math.round(b.offsetHeight);
        if (!w || !h) return '';
        const m = mapOf(w, h);
        return `<filter id="jdMag${i}" x="0" y="0" width="${w}" height="${h}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">` +
          `<feImage href="${m.url}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="m"/>` +
          `<feDisplacementMap in="SourceGraphic" in2="m" scale="${m.scale}" xChannelSelector="R" yChannelSelector="G"/></filter>`;
      }).join('') + '</defs>';
      made = key;
    }
    bars.forEach((b, i) => {
      const f = `url(#jdMag${i}) saturate(1.35) brightness(var(--mag-bright, 1))`;
      b.style.webkitBackdropFilter = f; b.style.backdropFilter = f;
    });
  } catch { /* the plain glass stays */ }
}

export function enableMagnifier(selector = '.ju-top') {
  bars = [...document.querySelectorAll(selector)];
  if (!bars.length) return;
  apply();
  let t = 0;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(apply, 180); }, { passive: true });
  // the Glass setting (Solid / Frosted / Clear) and the slower-phone mode switch it off and on
  new MutationObserver(() => apply()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-ju-glass', 'class'] });
}
