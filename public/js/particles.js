// The QR code as particles: its little squares break loose, collapse into a swirling cluster, then fly out
// and land square by square as the finished code.
//
//   const p = collapseFrom(tileEl, link);   // the squares of an existing QR collapse into a cluster (it keeps swirling)
//   p.into(newTileEl, newLink);             // ...then burst out and become another QR
//   assemble(tileEl, link);                 // scattered particles collapse and come together as this QR
//
// Rules kept: the real QR is always in the page underneath (only hidden while the particles fly) and a timer
// always brings it back, so a paused or slow browser still ends with the finished code. "Reduce motion" = no particles.
import { makeQR } from './qr.js';
import { calm } from './motion.js';

const ORANGE = [234, 88, 12], INK = [17, 17, 19];
const MAX_IDLE_MS = 60000;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeIn = (t) => t * t * t;
// lands with a small overshoot, like a spring
const easeOutBack = (t) => { const c1 = 1.25, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
// one formula for the collapse and the swirl after it, so the cluster never jumps
const swirlAngle = (p, el, e) => p.ang + p.spin * (1.4 * e + (el / 900) * e);
const colour = (t) => `rgb(${Math.round(lerp(ORANGE[0], INK[0], t))},${Math.round(lerp(ORANGE[1], INK[1], t))},${Math.round(lerp(ORANGE[2], INK[2], t))})`;

// where every dark square of the QR inside `tile` sits on screen
function cellsOf(tile, link) {
  const svg = tile && tile.querySelector('svg');
  if (!svg) return null;
  const r = svg.getBoundingClientRect();
  if (!r.width) return null;
  const q = makeQR(link, true), margin = 4, k = r.width / (q.n + margin * 2);
  const cells = [];
  for (let y = 0; y < q.n; y++) for (let x = 0; x < q.n; x++) if (q.dark(y, x)) cells.push({ x: r.left + (x + margin) * k, y: r.top + (y + margin) * k });
  return { cells, k, cx: r.left + r.width / 2, cy: r.top + r.height / 2, size: r.width, svg };
}

function makeCanvas() {
  const cv = document.createElement('canvas');
  cv.setAttribute('aria-hidden', 'true');
  Object.assign(cv.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', zIndex: '95', pointerEvents: 'none' });
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr);
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  document.body.appendChild(cv);
  return { cv, g };
}

function hide(svg) { if (svg) svg.style.visibility = 'hidden'; }
function show(svg) { if (svg) svg.style.visibility = ''; }

// One swarm of particles living on a see-through layer over the page.
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
    const g = canvas.g;
    g.clearRect(0, 0, innerWidth, innerHeight);
    const el = now - t0;
    let busy = false;
    for (const p of parts) {
      let x, y, s, rot, c, a = 1;
      if (mode === 'collapse' || mode === 'swirl') {
        // towards the cluster, then a slow swirl around it
        const t = clamp01((el - p.delay) / 520);
        const e = easeInOut(t);
        const ang = swirlAngle(p, el, e);
        const cxp = cluster.x + Math.cos(ang) * p.orbit, cyp = cluster.y + Math.sin(ang) * p.orbit * 0.82;
        x = lerp(p.sx, cxp, e); y = lerp(p.sy, cyp, e);
        s = lerp(p.s0, 3.2, e); rot = lerp(0, p.r, e); c = colour(lerp(p.c0, 0, e));
        if (t < 1) busy = true;
      } else if (mode === 'burst') {
        const t = clamp01((el - p.delay) / p.dur);
        const e = easeOutBack(t);
        x = lerp(p.sx, p.tx, e); y = lerp(p.sy, p.ty, e);
        s = lerp(3.2, p.ts, clamp01(t * 1.3)); rot = lerp(p.r, 0, clamp01(t * 1.2)); c = colour(clamp01(t * 1.4));
        if (p.extra) { a = 1 - clamp01(t * 1.5); s = 3.2 * a; }
        if (t < 1) busy = true;
      }
      if (a <= 0 || s <= 0) continue;
      g.globalAlpha = a; g.fillStyle = c;
      if (rot) { g.save(); g.translate(x + s / 2, y + s / 2); g.rotate(rot); g.fillRect(-s / 2, -s / 2, s, s); g.restore(); }
      else g.fillRect(x, y, s, s);
    }
    g.globalAlpha = 1;
    if (mode === 'collapse' && !busy) { mode = 'swirl'; }
    if (mode === 'burst' && !busy) { finish(); return; }
    raf = requestAnimationFrame(frame);
  }

  function start(m) { mode = m; t0 = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); }

  // current on-screen position of each particle (so the next move starts exactly where it is)
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
    // squares of an existing QR (or scattered points) collapse into a cluster at (cx, cy)
    collapse(points, cx, cy, size, svg) {
      if (calm()) { finish(); return this; }
      try {
        canvas = makeCanvas();
        if (svg) { hide(svg); hidden.add(svg); }
        cluster = { x: cx, y: cy };
        const radius = Math.max(14, size * 0.12);
        parts = points.map((pt) => ({
          sx: pt.x, sy: pt.y, s0: pt.s, c0: pt.c0 ?? 1,
          ang: Math.random() * Math.PI * 2, orbit: Math.sqrt(Math.random()) * radius,
          spin: (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.9),
          r: (Math.random() - 0.5) * 2.4, delay: Math.random() * 140,
        }));
        start('collapse');
      } catch { finish(); }
      return this;
    },
    // fly out of the cluster and land on the squares of the QR in `tile`
    into(tile, link, done) {
      onDone = done || null;
      if (ended) { if (done) done(); return; }
      try {
        const c = cellsOf(tile, link);
        if (!c) { finish(); return; }
        snapshot();
        hide(c.svg); hidden.add(c.svg);
        // more squares than particles: new ones are born in the cluster; fewer: the spare ones shrink away
        const targets = c.cells.slice().sort(() => Math.random() - 0.5);
        while (parts.length < targets.length) {
          const b = parts[Math.floor(Math.random() * parts.length)] || { sx: cluster.x, sy: cluster.y, r: 0 };
          parts.push({ sx: b.sx + (Math.random() - 0.5) * 8, sy: b.sy + (Math.random() - 0.5) * 8, r: (Math.random() - 0.5) * 2 });
        }
        const maxD = c.size * 0.75;
        parts.forEach((p, i) => {
          const t = targets[i];
          if (!t) { p.extra = true; p.tx = p.sx; p.ty = p.sy; p.ts = 0; p.delay = 0; p.dur = 300; return; }
          p.tx = t.x; p.ty = t.y; p.ts = c.k + 0.35; // a hair larger so neighbouring squares join without gaps
          const d = Math.hypot(t.x - c.cx, t.y - c.cy);
          p.delay = (d / maxD) * 260 + Math.random() * 120; // the middle lands first, the edges last
          p.dur = 620 + Math.random() * 220;
        });
        start('burst');
        setTimeout(() => finish(), 1600); // the safety timer: the real QR always comes back
      } catch { finish(); }
    },
    cancel: finish,
    get ended() { return ended; },
  };
}

// The QR already on screen in `tile` breaks into particles that collapse and keep swirling until .into() is called.
export function collapseFrom(tile, link) {
  const s = swarm();
  const c = cellsOf(tile, link);
  if (!c) { s.cancel(); return s; }
  return s.collapse(c.cells.map((p) => ({ x: p.x, y: p.y, s: c.k + 0.35, c0: 1 })), c.cx, c.cy, c.size, c.svg);
}

// Scattered particles collapse into the middle of `tile`, then come together as its QR.
export function assemble(tile, link) {
  const c = cellsOf(tile, link);
  if (!c || calm()) return;
  const s = swarm();
  const R = Math.max(innerWidth, innerHeight) * 0.42;
  const n = Math.min(c.cells.length, 420);
  const pts = Array.from({ length: n }, () => {
    const a = Math.random() * Math.PI * 2, d = R * (0.45 + Math.random() * 0.55);
    return { x: c.cx + Math.cos(a) * d, y: c.cy + Math.sin(a) * d, s: 2 + Math.random() * 4, c0: 0 };
  });
  s.collapse(pts, c.cx, c.cy, c.size, c.svg);
  setTimeout(() => s.into(tile, link), 720);
}

// ---------- the mouse pushes the squares apart ----------
// On any big QR that carries data-link="...", the squares near the mouse scatter away from it and spring back home
// as it moves on or leaves. Only for a mouse (a finger on a phone scrolls the page), never with "reduce motion".
// The squares always settle back exactly, so the code still scans once the mouse is off it.
let hoverInstalled = false;
export function enableHoverScatter() {
  if (hoverInstalled) return;
  hoverInstalled = true;
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || calm()) return;
    const tile = e.target && e.target.closest && e.target.closest('.qr-tile[data-link]');
    if (!tile || tile.__scatter) return;
    const svg = tile.querySelector('svg');
    if (!svg || svg.style.visibility === 'hidden') return; // still being assembled by the particles above
    try { tile.__scatter = scatter(tile, svg, tile.dataset.link, e); }
    catch {
      tile.__scatter = null;
      tile.querySelectorAll(':scope > canvas').forEach((c) => c.remove());
      const path = svg.querySelector('path'); if (path) path.style.visibility = '';
    }
  }, { passive: true });
}

function scatter(tile, svg, link, firstEvent) {
  const path = svg.querySelector('path');
  const r = svg.getBoundingClientRect();
  const q = makeQR(link, true), margin = 4, k = r.width / (q.n + margin * 2);
  const parts = [];
  for (let y = 0; y < q.n; y++) for (let x = 0; x < q.n; x++) if (q.dark(y, x)) {
    const hx = (x + margin) * k, hy = (y + margin) * k;
    parts.push({ hx, hy, x: hx, y: hy, vx: 0, vy: 0 });
  }
  // a see-through layer exactly over the code; the logo and white card underneath stay as they are
  if (getComputedStyle(tile).position === 'static') tile.style.position = 'relative';
  const cv = document.createElement('canvas');
  cv.setAttribute('aria-hidden', 'true');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  // (an SVG picture has no offsetLeft/offsetTop, so measure it against the tile it sits in)
  const tb = tile.getBoundingClientRect();
  const left = r.left - tb.left - tile.clientLeft, top = r.top - tb.top - tile.clientTop;
  Object.assign(cv.style, { position: 'absolute', left: left + 'px', top: top + 'px', width: r.width + 'px', height: r.height + 'px', pointerEvents: 'none' });
  tile.appendChild(cv);
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (path) path.style.visibility = 'hidden';

  const R = Math.max(46, k * 8.5);             // how far the mouse reaches
  const HOLD = 550;                             // after the mouse stops (or leaves), the squares go home
  const P = { x: -9999, y: -9999, last: 0 };
  // the mouse is followed on the whole page, so leaving the code never goes unnoticed
  const onMove = (ev) => {
    if (ev.pointerType && ev.pointerType !== 'mouse') return;
    const b = svg.getBoundingClientRect();
    const over = ev.clientX >= b.left - 8 && ev.clientX <= b.right + 8 && ev.clientY >= b.top - 8 && ev.clientY <= b.bottom + 8;
    if (!over) { if (P.last) { P.last = 0; wake(); settleSoon(); } return; }
    P.x = ev.clientX - b.left; P.y = ev.clientY - b.top; P.last = performance.now();
    wake();
    clearTimeout(idle); idle = setTimeout(wake, HOLD + 30); // wake once more so the squares start home after a pause
    settleSoon();
  };
  // the timer that always brings the real code back, even if the browser pauses the animation
  const settleSoon = () => { clearTimeout(hard); hard = setTimeout(() => { if (!stopped && (!P.last || performance.now() - P.last >= HOLD)) stop(); }, HOLD + 1200); };
  let idle = 0, hard = 0, raf = 0, stopped = false;
  document.addEventListener('pointermove', onMove, { passive: true });
  function stop() {
    if (stopped) return; stopped = true;
    cancelAnimationFrame(raf); clearTimeout(idle); clearTimeout(hard);
    document.removeEventListener('pointermove', onMove);
    cv.remove();
    if (path) path.style.visibility = '';
    tile.__scatter = null;
  }
  function wake() { if (!raf && !stopped) raf = requestAnimationFrame(step); }
  function step() {
    raf = 0;
    if (!tile.isConnected) { stop(); return; }
    const pushing = P.last && performance.now() - P.last < HOLD;
    g.clearRect(-k * 6, -k * 6, r.width + k * 12, r.height + k * 12);
    let moving = false;
    for (const p of parts) {
      if (pushing) {
        const dx = p.x - P.x, dy = p.y - P.y, d = Math.hypot(dx, dy) || 0.001;
        if (d < R) { const f = Math.pow(1 - d / R, 2) * k * 0.95; p.vx += (dx / d) * f; p.vy += (dy / d) * f; }
      }
      p.vx += (p.hx - p.x) * 0.07; p.vy += (p.hy - p.y) * 0.07;   // the spring that pulls it home
      p.vx *= 0.8; p.vy *= 0.8;                                  // calm it down
      p.x += p.vx; p.y += p.vy;
      let off = Math.hypot(p.x - p.hx, p.y - p.hy);
      const fast = Math.abs(p.vx) + Math.abs(p.vy) > 0.05;
      if (fast || (!pushing && off > 0.08)) moving = true;
      else if (!pushing || off < 0.08) { p.x = p.hx; p.y = p.hy; p.vx = p.vy = 0; off = 0; }
      const t = Math.min(1, off / (k * 3));                      // pushed squares turn orange, squares at home are black
      g.fillStyle = t > 0.02 ? colour(1 - t) : 'rgb(17,17,19)';
      const s = k + 0.35;
      g.fillRect(p.x, p.y, s, s);
    }
    if (!moving) {
      if (!pushing) stop();       // everything home and the mouse still: the real code takes over again
      return;                     // pushed but settled: wait for the next movement
    }
    raf = requestAnimationFrame(step);
  }
  setTimeout(() => stop(), 120000); // never left running
  onMove(firstEvent);
  return { stop };
}
