// The QR code as particles: every square breaks into tiny grains that collapse into a swirling cluster, then fly
// out and land as the finished code; and a mouse or a finger moving over a code pushes the grains apart.
//
//   const p = collapseFrom(tileEl, link);   // the grains of an existing QR collapse into a cluster (it keeps swirling)
//   p.into(newTileEl, newLink);             // ...then burst out and become another QR
//   assemble(tileEl, link);                 // scattered grains collapse and come together as this QR
//   enableHoverScatter();                   // mouse / finger over any .qr-tile[data-link] pushes its grains apart
//
// Rules kept: the real QR is always in the page underneath (only hidden while the grains fly) and a timer always
// brings it back, so a paused or slow browser still ends with the finished, scannable code. "Reduce motion" = none of this.
import { makeQR } from './qr.js';
import { calm } from './motion.js';

const ORANGE = [234, 88, 12], INK = [17, 17, 19];
const MAX_IDLE_MS = 60000;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
// lands with a small overshoot, like a spring
const easeOutBack = (t) => { const c1 = 1.25, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
// one formula for the collapse and the swirl after it, so the cluster never jumps
const swirlAngle = (p, el, e) => p.ang + p.spin * (1.4 * e + (el / 900) * e);
const colour = (t) => `rgb(${Math.round(lerp(ORANGE[0], INK[0], t))},${Math.round(lerp(ORANGE[1], INK[1], t))},${Math.round(lerp(ORANGE[2], INK[2], t))})`;
// how many grains along each side of one QR square: 2 x 2 on phones, 3 x 3 when the squares are big
const grainsPer = (k) => (k >= 7 ? 3 : 2);
const GRAIN = 1.8; // size of a loose grain while it flies

// where every grain of the QR inside `tile` sits on screen (each dark square split into grainsPer x grainsPer)
function cellsOf(tile, link) {
  const svg = tile && tile.querySelector('svg');
  if (!svg) return null;
  const r = svg.getBoundingClientRect();
  if (!r.width) return null;
  const q = makeQR(link, true), margin = 4, k = r.width / (q.n + margin * 2);
  const g = grainsPer(k), ks = k / g;
  const cells = [];
  for (let y = 0; y < q.n; y++) for (let x = 0; x < q.n; x++) if (q.dark(y, x)) {
    for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) cells.push({ x: r.left + (x + margin) * k + i * ks, y: r.top + (y + margin) * k + j * ks });
  }
  return { cells, k, ks, cx: r.left + r.width / 2, cy: r.top + r.height / 2, size: r.width, svg };
}

function makeCanvas() {
  const cv = document.createElement('canvas');
  cv.setAttribute('aria-hidden', 'true');
  Object.assign(cv.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', zIndex: '95', pointerEvents: 'none' });
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr);
  const g = cv.getContext('2d');
  document.body.appendChild(cv);
  return { cv, g, dpr };
}

// draws a grain on whole screen pixels, so neighbouring grains meet without light seams
function grain(g, dpr, x, y, s) {
  const X = Math.round(x * dpr), Y = Math.round(y * dpr);
  g.fillRect(X, Y, Math.max(1, Math.round((x + s) * dpr) - X), Math.max(1, Math.round((y + s) * dpr) - Y));
}

function hide(svg) { if (svg) svg.style.visibility = 'hidden'; }
function show(svg) { if (svg) svg.style.visibility = ''; }

// One swarm of grains living on a see-through layer over the page.
function swarm() {
  let canvas = null, raf = 0, parts = [], mode = 'idle', t0 = 0, cluster = { x: 0, y: 0 }, ended = false, onDone = null;
  const hidden = new Set();
  const safety = setTimeout(() => finish(), MAX_IDLE_MS);

  function finish() {
    if (ended) return; ended = true;
    cancelAnimationFrame(raf); clearTimeout(safety);
    hidden.forEach(show); hidden.clear();
    if (canvas) canvas.cv.remove();
    if (onDone) onDone();
  }

  function frame(now) {
    if (ended) return;
    const g = canvas.g, dpr = canvas.dpr;
    g.clearRect(0, 0, canvas.cv.width, canvas.cv.height);
    const el = now - t0;
    let busy = false;
    for (const p of parts) {
      let x, y, s, c, a = 1;
      if (mode === 'collapse' || mode === 'swirl') {
        // towards the cluster, then a slow swirl around it
        const t = clamp01((el - p.delay) / 520);
        const e = easeInOut(t);
        const ang = swirlAngle(p, el, e);
        const cxp = cluster.x + Math.cos(ang) * p.orbit, cyp = cluster.y + Math.sin(ang) * p.orbit * 0.82;
        x = lerp(p.sx, cxp, e); y = lerp(p.sy, cyp, e);
        s = lerp(p.s0, GRAIN, e); c = colour(lerp(p.c0, 0, e));
        if (t < 1) busy = true;
      } else if (mode === 'burst') {
        const t = clamp01((el - p.delay) / p.dur);
        const e = easeOutBack(t);
        x = lerp(p.sx, p.tx, e); y = lerp(p.sy, p.ty, e);
        s = lerp(GRAIN, p.ts, clamp01(t * 1.3)); c = colour(clamp01(t * 1.4));
        if (p.extra) { a = 1 - clamp01(t * 1.5); s = GRAIN * a; }
        if (t < 1) busy = true;
      }
      if (a <= 0 || s <= 0) continue;
      g.globalAlpha = a; g.fillStyle = c;
      grain(g, dpr, x, y, s);
    }
    g.globalAlpha = 1;
    if (mode === 'collapse' && !busy) { mode = 'swirl'; }
    if (mode === 'burst' && !busy) { finish(); return; }
    raf = requestAnimationFrame(frame);
  }

  function start(m) { mode = m; t0 = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); }

  // current on-screen position of each grain (so the next move starts exactly where it is)
  function snapshot() {
    const el = performance.now() - t0;
    for (const p of parts) {
      if (mode === 'collapse' || mode === 'swirl') {
        const e = easeInOut(clamp01((el - p.delay) / 520));
        const ang = swirlAngle(p, el, e);
        p.sx = lerp(p.sx, cluster.x + Math.cos(ang) * p.orbit, e); p.sy = lerp(p.sy, cluster.y + Math.sin(ang) * p.orbit * 0.82, e);
      }
    }
  }

  return {
    // grains of an existing QR (or scattered points) collapse into a cluster at (cx, cy)
    collapse(points, cx, cy, size, svg) {
      if (calm()) { finish(); return this; }
      try {
        canvas = makeCanvas();
        if (svg) { hide(svg); hidden.add(svg); }
        cluster = { x: cx, y: cy };
        const radius = Math.max(16, size * 0.14);
        parts = points.map((pt) => ({
          sx: pt.x, sy: pt.y, s0: pt.s, c0: pt.c0 ?? 1,
          ang: Math.random() * Math.PI * 2, orbit: Math.sqrt(Math.random()) * radius,
          spin: (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.9),
          delay: Math.random() * 160,
        }));
        start('collapse');
      } catch { finish(); }
      return this;
    },
    // fly out of the cluster and land on the grains of the QR in `tile`
    into(tile, link, done) {
      onDone = done || null;
      if (ended) { if (done) done(); return; }
      try {
        const c = cellsOf(tile, link);
        if (!c) { finish(); return; }
        snapshot();
        hide(c.svg); hidden.add(c.svg);
        // more grains needed than there are: new ones are born in the cluster; too many: the spare ones shrink away
        const targets = c.cells.slice().sort(() => Math.random() - 0.5);
        while (parts.length < targets.length) {
          const b = parts[Math.floor(Math.random() * parts.length)] || { sx: cluster.x, sy: cluster.y };
          parts.push({ sx: b.sx + (Math.random() - 0.5) * 8, sy: b.sy + (Math.random() - 0.5) * 8 });
        }
        const maxD = c.size * 0.75;
        parts.forEach((p, i) => {
          const t = targets[i];
          if (!t) { p.extra = true; p.tx = p.sx; p.ty = p.sy; p.ts = 0; p.delay = 0; p.dur = 300; return; }
          p.tx = t.x; p.ty = t.y; p.ts = c.ks;
          const d = Math.hypot(t.x - c.cx, t.y - c.cy);
          p.delay = (d / maxD) * 260 + Math.random() * 140; // the middle lands first, the edges last
          p.dur = 620 + Math.random() * 240;
        });
        start('burst');
        setTimeout(() => finish(), 1700); // the safety timer: the real QR always comes back
      } catch { finish(); }
    },
    cancel: finish,
    get ended() { return ended; },
  };
}

// The QR already on screen in `tile` breaks into grains that collapse and keep swirling until .into() is called.
export function collapseFrom(tile, link) {
  const s = swarm();
  const c = cellsOf(tile, link);
  if (!c) { s.cancel(); return s; }
  return s.collapse(c.cells.map((p) => ({ x: p.x, y: p.y, s: c.ks + 0.3, c0: 1 })), c.cx, c.cy, c.size, c.svg);
}

// Scattered grains collapse into the middle of `tile`, then come together as its QR.
// With { from: element }, the grains burst out of that element (for example the Share button) instead.
export function assemble(tile, link, { from = null } = {}) {
  const c = cellsOf(tile, link);
  if (!c || calm()) return;
  const s = swarm();
  const R = Math.max(innerWidth, innerHeight) * 0.42;
  const n = Math.min(c.cells.length, 1800);
  const fr = from && from.getBoundingClientRect ? from.getBoundingClientRect() : null;
  const pts = Array.from({ length: n }, () => {
    if (fr && fr.width) {
      // out of the button: start inside it, already flung a little outward
      const a = Math.random() * Math.PI * 2, d = Math.random() * 46;
      return { x: fr.left + Math.random() * fr.width + Math.cos(a) * d, y: fr.top + Math.random() * fr.height + Math.sin(a) * d, s: 1 + Math.random() * 2, c0: 0 };
    }
    const a = Math.random() * Math.PI * 2, d = R * (0.4 + Math.random() * 0.6);
    return { x: c.cx + Math.cos(a) * d, y: c.cy + Math.sin(a) * d, s: 1 + Math.random() * 2.2, c0: 0 };
  });
  s.collapse(pts, c.cx, c.cy, c.size, c.svg);
  setTimeout(() => s.into(tile, link), 720);
}

// ---------- a mouse or a finger pushes the grains apart ----------
// On any big QR that carries data-link="...", the grains near a moving mouse (or a finger touching the code)
// scatter away and spring back home. The QR tiles have touch-action: none, so a finger that starts on the code
// moves the grains instead of scrolling the page; elsewhere the page scrolls as always.
// The grains always settle back exactly, so the code still scans once the mouse or finger has gone.
let hoverInstalled = false;
export function enableHoverScatter() {
  if (hoverInstalled) return;
  hoverInstalled = true;
  const begin = (e) => {
    if (calm()) return;
    const tile = e.target && e.target.closest && e.target.closest('.qr-tile[data-link]');
    if (!tile) return;
    if (tile.__scatter) { tile.__scatter.poke(e); return; }
    const svg = tile.querySelector('svg');
    if (!svg || svg.style.visibility === 'hidden') return; // still being assembled by the grains above
    try { tile.__scatter = scatter(tile, svg, tile.dataset.link, e); }
    catch {
      tile.__scatter = null;
      tile.querySelectorAll(':scope > canvas').forEach((c) => c.remove());
      const path = svg.querySelector('path'); if (path) path.style.visibility = '';
    }
  };
  document.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') begin(e); }, { passive: true });
  document.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && !e.target?.closest?.('.qr-tile[data-link]')?.__scatter) begin(e); }, { passive: true });
}

function scatter(tile, svg, link, firstEvent) {
  const path = svg.querySelector('path');
  const r = svg.getBoundingClientRect();
  const q = makeQR(link, true), margin = 4, k = r.width / (q.n + margin * 2);
  const gp = grainsPer(k), ks = k / gp;
  const parts = [];
  for (let y = 0; y < q.n; y++) for (let x = 0; x < q.n; x++) if (q.dark(y, x)) {
    for (let j = 0; j < gp; j++) for (let i = 0; i < gp; i++) {
      const hx = (x + margin) * k + i * ks, hy = (y + margin) * k + j * ks;
      // each grain is a little lighter or heavier, so they spread like dust rather than in a neat ring
      parts.push({ hx, hy, x: hx, y: hy, vx: 0, vy: 0, m: 0.65 + Math.random() * 0.7 });
    }
  }
  // a see-through layer exactly over the code; the logo and white card underneath stay as they are
  if (getComputedStyle(tile).position === 'static') tile.style.position = 'relative';
  const cv = document.createElement('canvas');
  cv.setAttribute('aria-hidden', 'true');
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  // (an SVG picture has no offsetLeft/offsetTop, so measure it against the tile it sits in)
  const tb = tile.getBoundingClientRect();
  const left = r.left - tb.left - tile.clientLeft, top = r.top - tb.top - tile.clientTop;
  Object.assign(cv.style, { position: 'absolute', left: left + 'px', top: top + 'px', width: r.width + 'px', height: r.height + 'px', pointerEvents: 'none' });
  tile.appendChild(cv);
  const g = cv.getContext('2d');
  if (path) path.style.visibility = 'hidden';

  const R = Math.max(46, k * 8.5);             // how far the mouse or finger reaches
  const HOLD = 550;                             // after the movement stops (or the finger lifts), the grains go home
  const P = { x: -9999, y: -9999, last: 0, down: false };
  // followed on the whole page, so leaving the code never goes unnoticed
  const onMove = (ev) => {
    const b = svg.getBoundingClientRect();
    if (ev.type === 'pointerup' || ev.type === 'pointercancel') { if (ev.pointerType !== 'mouse') { P.down = false; P.last = 0; wake(); settleSoon(); } return; }
    if (ev.pointerType !== 'mouse' && ev.type === 'pointermove' && !P.down) return; // a finger only counts while it touches
    if (ev.type === 'pointerdown' && ev.pointerType !== 'mouse') P.down = true;
    const over = ev.clientX >= b.left - 8 && ev.clientX <= b.right + 8 && ev.clientY >= b.top - 8 && ev.clientY <= b.bottom + 8;
    if (!over) { if (P.last) { P.last = 0; wake(); settleSoon(); } return; }
    P.x = ev.clientX - b.left; P.y = ev.clientY - b.top; P.last = performance.now();
    wake();
    clearTimeout(idle); idle = setTimeout(wake, HOLD + 30); // wake once more so the grains start home after a pause
    settleSoon();
  };
  // the timer that always brings the real code back, even if the browser pauses the animation
  const settleSoon = () => { clearTimeout(hard); hard = setTimeout(() => { if (!stopped && !P.down && (!P.last || performance.now() - P.last >= HOLD)) stop(); }, HOLD + 1200); };
  let idle = 0, hard = 0, raf = 0, stopped = false;
  for (const t of ['pointermove', 'pointerup', 'pointercancel']) document.addEventListener(t, onMove, { passive: true });
  function stop() {
    if (stopped) return; stopped = true;
    cancelAnimationFrame(raf); clearTimeout(idle); clearTimeout(hard);
    for (const t of ['pointermove', 'pointerup', 'pointercancel']) document.removeEventListener(t, onMove);
    cv.remove();
    if (path) path.style.visibility = '';
    tile.__scatter = null;
  }
  function wake() { if (!raf && !stopped) raf = requestAnimationFrame(step); }
  function step() {
    raf = 0;
    if (!tile.isConnected) { stop(); return; }
    const pushing = P.down || (P.last && performance.now() - P.last < HOLD);
    g.clearRect(0, 0, cv.width, cv.height);
    let moving = false;
    const s = ks;
    for (const p of parts) {
      if (pushing) {
        const dx = p.x - P.x, dy = p.y - P.y, d = Math.hypot(dx, dy) || 0.001;
        if (d < R) { const f = Math.pow(1 - d / R, 2) * k * 0.95 / p.m; p.vx += (dx / d) * f; p.vy += (dy / d) * f; }
      }
      p.vx += (p.hx - p.x) * 0.07; p.vy += (p.hy - p.y) * 0.07;   // the spring that pulls it home
      p.vx *= 0.8; p.vy *= 0.8;                                  // calm it down
      p.x += p.vx; p.y += p.vy;
      let off = Math.hypot(p.x - p.hx, p.y - p.hy);
      const fast = Math.abs(p.vx) + Math.abs(p.vy) > 0.05;
      if (fast || (!pushing && off > 0.08)) moving = true;
      else if (!pushing || off < 0.08) { p.x = p.hx; p.y = p.hy; p.vx = p.vy = 0; off = 0; }
      const t = Math.min(1, off / (k * 3));                      // pushed grains turn orange, grains at home are black
      g.fillStyle = t > 0.02 ? colour(1 - t) : 'rgb(17,17,19)';
      grain(g, dpr, p.x, p.y, s);
    }
    if (!moving) {
      if (!pushing) stop();       // everything home and nothing touching: the real code takes over again
      return;                     // pushed but settled: wait for the next movement
    }
    raf = requestAnimationFrame(step);
  }
  setTimeout(() => stop(), 120000); // never left running
  onMove(firstEvent);
  return { stop, poke: onMove };
}

// ---------- a picture breaks into coloured grains that bind together somewhere else ----------
// Used by "Read now": the cover on the page dissolves into grains (each keeps its colour), they scatter,
// then bind together as the first page of the reader. `toEl` stays hidden until they have landed;
// a timer always shows it, and "reduce motion" just shows it.
export function bindImage(fromEl, toEl, { cols = 46, sample = null } = {}) {
  return new Promise((resolve) => {
    const reveal = () => { try { toEl.style.visibility = ''; } catch {} resolve(); };
    try {
      if (calm() || !fromEl || !toEl) { reveal(); return; }
      const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
      if (!a.width || !b.width) { reveal(); return; }
      const rows = Math.max(8, Math.round(cols * (b.height / b.width)));
      // the grain colours, read from the cover picture (falls back to Jinharsh colours if the picture can't be read)
      let px = null;
      try {
        const src = sample || fromEl;
        if (src.tagName === 'CANVAS' || (src.tagName === 'IMG' && src.complete && src.naturalWidth)) {
          const oc = document.createElement('canvas'); oc.width = cols; oc.height = rows;
          const og = oc.getContext('2d', { willReadFrequently: true });
          og.drawImage(src, 0, 0, cols, rows);
          px = og.getImageData(0, 0, cols, rows).data;
        }
      } catch { px = null; }
      const { cv, g, dpr } = makeCanvas();
      toEl.style.visibility = 'hidden';
      const cwA = a.width / cols, chA = a.height / rows, cwB = b.width / cols, chB = b.height / rows;
      const parts = [];
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const k = (j * cols + i) * 4;
        const col = px ? `rgb(${px[k]},${px[k + 1]},${px[k + 2]})` : ((i + j) % 5 ? 'rgb(17,17,19)' : 'rgb(234,88,12)');
        const sx = a.left + i * cwA, sy = a.top + j * chA;
        const ang = Math.random() * Math.PI * 2, d = 30 + Math.random() * Math.max(80, a.width * 0.6);
        const tx = b.left + i * cwB, ty = b.top + j * chB;
        const dist = Math.hypot(tx - (b.left + b.width / 2), ty - (b.top + b.height / 2)) / (Math.hypot(b.width, b.height) / 2);
        parts.push({ sx, sy, mx: sx + Math.cos(ang) * d, my: sy + Math.sin(ang) * d, tx, ty, col,
          d1: Math.random() * 120, d2: 380 + dist * 260 + Math.random() * 160 });
      }
      const t0 = performance.now();
      let done = false;
      const finish = () => { if (done) return; done = true; cv.remove(); reveal(); };
      setTimeout(finish, 2400); // the timer that always shows the page
      const frame = (now) => {
        if (done) return;
        const el = now - t0;
        g.clearRect(0, 0, cv.width, cv.height);
        let busy = false;
        for (const p of parts) {
          let x, y, w, h;
          const t2 = clamp01((el - p.d2) / 700);
          if (t2 <= 0) {
            // 1. the cover dissolves: grains drift apart and shrink
            const t1 = easeInOut(clamp01((el - p.d1) / 420));
            x = lerp(p.sx, p.mx, t1); y = lerp(p.sy, p.my, t1);
            w = lerp(cwA, GRAIN, t1); h = lerp(chA, GRAIN, t1);
            busy = true;
          } else {
            // 2. they bind together as the page, landing with a small spring
            const e = easeOutBack(t2), f = clamp01(t2 * 1.25);
            const fx = lerp(p.sx, p.mx, 1), fy = lerp(p.sy, p.my, 1);
            x = lerp(fx, p.tx, e); y = lerp(fy, p.ty, e);
            w = lerp(GRAIN, cwB, f); h = lerp(GRAIN, chB, f);
            if (t2 < 1) busy = true;
          }
          g.fillStyle = p.col;
          const X = Math.round(x * dpr), Y = Math.round(y * dpr);
          g.fillRect(X, Y, Math.max(1, Math.round((x + w) * dpr) - X + 1), Math.max(1, Math.round((y + h) * dpr) - Y + 1));
        }
        if (!busy) { finish(); return; }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    } catch { reveal(); }
  });
}

// ---------- small effects on one shared layer: a burst, a pour, a dissolve ----------
let fx = null;
function fxAdd(item) {
  if (!fx) {
    const L = makeCanvas();
    L.cv.style.zIndex = '96';
    fx = { ...L, items: [], raf: 0, guard: 0 };
  }
  fx.items.push(item);
  clearTimeout(fx.guard);
  fx.guard = setTimeout(fxClear, 4000); // never left on screen, even if the browser pauses drawing
  if (!fx.raf) fx.raf = requestAnimationFrame(fxFrame);
}
function fxClear() { if (!fx) return; cancelAnimationFrame(fx.raf); fx.items.forEach((it) => it.end && it.end()); fx.cv.remove(); fx = null; }
function fxFrame(now) {
  if (!fx) return;
  fx.raf = 0;
  const { g, cv, dpr } = fx;
  g.clearRect(0, 0, cv.width, cv.height);
  fx.items = fx.items.filter((it) => {
    const alive = it.draw(g, dpr, now);
    if (!alive && it.end) it.end();
    return alive;
  });
  if (fx.items.length) fx.raf = requestAnimationFrame(fxFrame); else fxClear();
}
const dot = (g, dpr, x, y, s, col, a) => {
  if (s <= 0 || a <= 0) return;
  g.globalAlpha = a; g.fillStyle = col;
  const X = Math.round(x * dpr), Y = Math.round(y * dpr);
  g.fillRect(X, Y, Math.max(1, Math.round((x + s) * dpr) - X), Math.max(1, Math.round((y + s) * dpr) - Y));
  g.globalAlpha = 1;
};
function colourOf(el) {
  try {
    const st = getComputedStyle(el);
    const bg = st.backgroundColor;
    if (bg && bg !== 'transparent' && !/rgba\(0, 0, 0, 0\)/.test(bg)) return bg;
    return st.color || 'rgb(17,17,19)';
  } catch { return 'rgb(17,17,19)'; }
}

// `el` is swallowed by a black hole: it breaks into grains that spiral into a small dark hole at `at`
// (the X that was pressed; the middle of `el` if not given), faster and faster, and the hole closes behind them.
// `el` is hidden at once; the promise ends when the hole has closed. `sample` (a canvas or picture) gives the grains
// their colours; otherwise they take the colour of the panel itself.
export function swallow(el, { sample = null, cols = 48, at = null } = {}) {
  return new Promise((resolve) => {
    try {
      if (calm() || !el) { resolve(); return; }
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) { resolve(); return; }
      const rows = Math.max(6, Math.round(cols * r.height / r.width));
      let px = null;
      try {
        if (sample && (sample.tagName === 'CANVAS' || (sample.tagName === 'IMG' && sample.complete && sample.naturalWidth))) {
          const oc = document.createElement('canvas'); oc.width = cols; oc.height = rows;
          const og = oc.getContext('2d', { willReadFrequently: true });
          og.drawImage(sample, 0, 0, cols, rows);
          px = og.getImageData(0, 0, cols, rows).data;
        }
      } catch { px = null; }
      const surface = colourOf(el);
      let ink = 'rgb(17,17,19)';
      try { ink = getComputedStyle(el).color || ink; } catch {}
      const cx = at && isFinite(at.x) ? at.x : r.left + r.width / 2;
      const cy = at && isFinite(at.y) ? at.y : r.top + r.height / 2;
      const cw = r.width / cols, ch = r.height / rows, gs = Math.max(cw, ch);
      const rmax = Math.max(Math.hypot(r.left - cx, r.top - cy), Math.hypot(r.right - cx, r.top - cy), Math.hypot(r.left - cx, r.bottom - cy), Math.hypot(r.right - cx, r.bottom - cy)) || 1;
      const dir = Math.random() < 0.5 ? 1 : -1; // the whole swirl turns one way
      const ps = [];
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const k = (j * cols + i) * 4;
        const col = px ? `rgb(${px[k]},${px[k + 1]},${px[k + 2]})` : (Math.random() < 0.04 ? ink : surface);
        const x0 = r.left + i * cw, y0 = r.top + j * ch;
        const dx = x0 + cw / 2 - cx, dy = y0 + ch / 2 - cy, r0 = Math.hypot(dx, dy);
        ps.push({ x0, y0, col, r0, th0: Math.atan2(dy, dx),
          delay: (r0 / rmax) * 300 + Math.random() * 110,      // the nearest grains fall in first
          dur: 520 + Math.random() * 260,
          spin: dir * (2.4 + Math.random() * 1.6) });           // how far each one turns on its way in
      }
      el.style.visibility = 'hidden';
      const coreMax = Math.max(10, Math.min(26, Math.min(r.width, r.height) * 0.07));
      const total = 300 + 110 + 780 + 140;
      const t0 = performance.now();
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      setTimeout(finish, 1900);
      fxAdd({
        draw(g, dpr, now) {
          const el2 = now - t0;
          let alive = false;
          for (const p of ps) {
            const t = clamp01((el2 - p.delay) / p.dur);
            if (t >= 1) continue;
            alive = true;
            if (el2 < p.delay) { dot(g, dpr, p.x0, p.y0, gs + 0.6, p.col, 1); continue; } // still part of the panel
            const e = t * t;                                     // speeds up as it falls in
            const rr = p.r0 * (1 - e), th = p.th0 + p.spin * e * e;
            const s = Math.max(0.8, gs * (1 - 0.85 * e));
            dot(g, dpr, cx + Math.cos(th) * rr - s / 2, cy + Math.sin(th) * rr - s / 2, s, p.col, t > 0.9 ? (1 - t) / 0.1 : 1);
          }
          // the hole: opens, holds while the grains fall in, then closes
          const hp = clamp01(el2 / total);
          const open = hp < 0.18 ? easeInOut(hp / 0.18) : hp > 0.82 ? 1 - easeInOut((hp - 0.82) / 0.18) : 1;
          const hr = coreMax * open;
          if (hr > 0.4) {
            g.beginPath(); g.arc(cx * dpr, cy * dpr, hr * dpr, 0, Math.PI * 2);
            g.fillStyle = 'rgb(5,5,6)'; g.fill();
            g.beginPath(); g.arc(cx * dpr, cy * dpr, (hr + 2.2) * dpr, 0, Math.PI * 2);
            g.lineWidth = 1.6 * dpr; g.strokeStyle = 'rgba(234,88,12,.75)'; g.stroke();   // its thin orange edge
            alive = alive || hp < 1;
          }
          if (!alive) finish();
          return alive;
        },
        end: finish,
      });
    } catch { resolve(); }
  });
}
// (the earlier name; closing used to scatter the panel)
export const dissolve = swallow;

// A button fills up like a jar under a tap: grains rain into it from above (or pour out of `fromRect`, for
// example the QR in the same window), and where they land an orange "water" level rises with a gentle wave,
// then drains away. Drawn on top of the button; the button itself is never changed.
function radiusOf(el) { try { return parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0; } catch { return 0; } }
export function fillButton(btn, { fromRect = null, n = 56, onDone } = {}) {
  if (calm() || !btn) { if (onDone) onDone(); return; }
  const b = btn.getBoundingClientRect();
  if (!b.width) { if (onDone) onDone(); return; }
  const rad = Math.min(radiusOf(btn), b.height / 2, b.width / 2);
  const inset = Math.max(4, rad * 0.6);
  const t0 = performance.now();
  const ps = Array.from({ length: n }, () => {
    let sx, sy;
    if (fromRect && fromRect.width) { sx = fromRect.left + Math.random() * fromRect.width; sy = fromRect.top + Math.random() * fromRect.height; }
    else { sx = b.left + b.width * (0.1 + Math.random() * 0.8) + (Math.random() - 0.5) * b.width * 0.5; sy = b.top - 24 - Math.random() * 110; }
    return { sx, sy, tx: b.left + inset + Math.random() * (b.width - inset * 2), delay: Math.random() * 300, dur: 330 + Math.random() * 230,
      s: 1.4 + Math.random() * 1.8, col: Math.random() < 0.7 ? 'rgb(234,88,12)' : 'rgb(17,17,19)' };
  });
  const levelMax = 0.66;
  let level = 0, allIn = 0, called = false;
  const done = () => { if (!called) { called = true; if (onDone) onDone(); } };
  fxAdd({
    draw(g, dpr, now) {
      const el = now - t0;
      let arrived = 0;
      for (const p of ps) {
        const t = clamp01((el - p.delay) / p.dur);
        if (t >= 1) { arrived++; continue; }
        if (el < p.delay) continue;
        const surface = b.bottom - level * b.height;
        const e = t * t; // falls faster and faster, like a drop
        dot(g, dpr, lerp(p.sx, p.tx, t), lerp(p.sy, surface, e), p.s, p.col, 1);
      }
      // the water level follows the grains that have landed
      level += (levelMax * (arrived / n) - level) * 0.22;
      if (arrived === n && !allIn) { allIn = el; done(); }
      let draw = level, alpha = 1;
      if (allIn && el > allIn + 160) { const d = clamp01((el - allIn - 160) / 420); draw = level * (1 - easeInOut(d)); alpha = 1 - d * 0.5; }
      if (draw > 0.005) {
        g.save();
        g.beginPath();
        if (g.roundRect) g.roundRect(b.left * dpr, b.top * dpr, b.width * dpr, b.height * dpr, rad * dpr); else g.rect(b.left * dpr, b.top * dpr, b.width * dpr, b.height * dpr);
        g.clip();
        const top = b.bottom - draw * b.height, amp = Math.min(2.4, draw * b.height * 0.18);
        g.beginPath();
        g.moveTo(b.left * dpr, b.bottom * dpr);
        for (let x = b.left; x <= b.right + 4; x += 4) g.lineTo(x * dpr, (top + Math.sin(x * 0.09 + el * 0.012) * amp) * dpr);
        g.lineTo(b.right * dpr, b.bottom * dpr);
        g.closePath();
        g.fillStyle = `rgba(234,88,12,${0.34 * alpha})`;
        g.fill();
        g.restore();
      }
      const alive = !allIn || el < allIn + 160 + 440;
      if (!alive) done();
      return alive;
    },
    end: done,
  });
}

// Every button press fills it with grains like water in a jar; download buttons are filled from the QR in the
// same window. Closing buttons are left to the black hole.
let buttonsInstalled = false;
const DOWNLOAD = 'a[download], [data-dl], [data-png], [data-svg], [data-act="svg"], [data-act="png"], [data-card-svg], [data-card-png]';
const CLOSING = '[data-x], [data-sheet="close"], #rClose, .close-x';
export function enableButtonParticles() {
  if (buttonsInstalled) return;
  buttonsInstalled = true;
  document.addEventListener('click', (e) => {
    if (calm()) return;
    const btn = e.target && e.target.closest && e.target.closest('button, .ju-btn, .ju-icon, .share-opt, .c-item, .ju-chip, .ju-tile');
    if (!btn || btn.disabled || btn.matches(CLOSING)) return;
    try {
      if (btn.matches(DOWNLOAD)) {
        const holder = btn.closest('.ju-sheet, .detail, .done');
        const qr = holder ? holder.querySelector('.qr-tile svg, .card-preview svg') : null;
        fillButton(btn, { fromRect: qr ? qr.getBoundingClientRect() : null, n: 70, onDone: () => bumpEl(btn) });
        return;
      }
      fillButton(btn);
    } catch {}
  }, { capture: true, passive: true });
}
function bumpEl(el) {
  try { el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.07)', offset: 0.35 }, { transform: 'scale(1)' }], { duration: 360, easing: 'cubic-bezier(.2,.9,.25,1.1)' }); } catch {}
}
