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
export function assemble(tile, link) {
  const c = cellsOf(tile, link);
  if (!c || calm()) return;
  const s = swarm();
  const R = Math.max(innerWidth, innerHeight) * 0.42;
  const n = Math.min(c.cells.length, 1800);
  const pts = Array.from({ length: n }, () => {
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
export function bindImage(fromEl, toEl, { cols = 46 } = {}) {
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
        if (fromEl.tagName === 'IMG' && fromEl.complete && fromEl.naturalWidth) {
          const oc = document.createElement('canvas'); oc.width = cols; oc.height = rows;
          const og = oc.getContext('2d', { willReadFrequently: true });
          og.drawImage(fromEl, 0, 0, cols, rows);
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
