// A Lighthouse-style speed check on this PC, with nothing to download: opens a page in a clean, hidden Chrome
// (no extensions, like an Incognito window), as a phone with a 4x slower processor on a slow 4G line, a few times,
// and prints the five numbers Lighthouse scores plus the score they add up to (Lighthouse 13 mobile weights).
//   node tools/speed.mjs [url] [runs]        e.g. node tools/speed.mjs http://localhost:8180/c/rz934 5
// Visit counting (/api/track) is blocked, so the test never shows up in "Visitors & queries".
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL_ = process.argv[2] || 'http://localhost:8180/c/rz934';
const RUNS = Number(process.argv.slice(3).find((a) => /^\d+$/.test(a)) || 3);
const VERBOSE = process.argv.includes('--why');
const PROFILE = process.argv.includes('--profile');
const TRACE = process.argv.includes('--trace');

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
];
const exe = BROWSERS.find((p) => existsSync(p));
if (!exe) { console.error('No Chrome or Edge found.'); process.exit(1); }

// ---- the score, as Lighthouse works it out (log-normal curves; mobile thresholds) ----
const CURVES = {
  fcp: { p10: 1800, median: 3000, w: 0.10 },
  si: { p10: 3387, median: 5800, w: 0.10 },
  lcp: { p10: 2500, median: 4000, w: 0.25 },
  tbt: { p10: 200, median: 600, w: 0.30 },
  cls: { p10: 0.1, median: 0.25, w: 0.25 },
};
function erf(x) { // Abramowitz-Stegun 7.1.26
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
function part(value, { p10, median }) {
  if (value <= 0) return 1;
  const z = (Math.log(value / median) * 0.9061938024368232) / -Math.log(p10 / median);
  const c = (1 - erf(z)) / 2;
  if (value <= p10) return Math.max(0.9, Math.min(1, c));
  if (value <= median) return Math.max(0.5, Math.min(0.8999, c));
  return Math.max(0, Math.min(0.4999, c));
}
const scoreOf = (m) => Object.entries(CURVES).reduce((s, [k, c]) => s + c.w * part(m[k], c), 0);

// ---- a tiny DevTools-protocol client (Node's own WebSocket) ----
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const waiting = new Map(), listeners = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && waiting.has(msg.id)) {
        const { ok, fail } = waiting.get(msg.id); waiting.delete(msg.id);
        msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
      } else if (msg.method) listeners.forEach((f) => f(msg));
    };
    ws.onerror = reject;
    ws.onopen = () => resolve({
      send: (method, params = {}, sessionId) => new Promise((ok, fail) => {
        const n = ++id; waiting.set(n, { ok, fail });
        ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
      }),
      on: (f) => listeners.push(f),
      close: () => ws.close(),
    });
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// what the page itself notes down while it loads (read back at the end)
const COLLECT = `(() => {
  const m = window.__speed = { fcp: 0, lcp: 0, lcpWhat: '', cls: 0, tasks: [], frames: [] };
  const o = (type, f) => { try { new PerformanceObserver((l) => l.getEntries().forEach(f)).observe({ type, buffered: true }); } catch {} };
  o('paint', (e) => { if (e.name === 'first-contentful-paint') m.fcp = e.startTime; });
  o('largest-contentful-paint', (e) => { m.lcp = e.startTime; const el = e.element; m.lcpWhat = el ? el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '') + (e.url ? ' ' + e.url.replace(location.origin, '') : '') : e.url; });
  o('layout-shift', (e) => { if (!e.hadRecentInput) m.cls += e.value; });
  o('longtask', (e) => m.tasks.push({ start: Math.round(e.startTime), ms: Math.round(e.duration) }));
  o('long-animation-frame', (e) => m.frames.push({ start: Math.round(e.startTime), ms: Math.round(e.duration), block: Math.round(e.blockingDuration),
    render: Math.round(e.startTime + e.duration - (e.renderStart || e.startTime + e.duration)), style: Math.round(e.startTime + e.duration - (e.styleAndLayoutStart || e.startTime + e.duration)),
    scripts: e.scripts.map((s) => ({ ms: Math.round(s.duration), what: (s.sourceURL || '').replace(location.origin, '') + (s.sourceFunctionName ? ' ' + s.sourceFunctionName : '') + ' [' + s.invokerType + ': ' + String(s.invoker).slice(0, 60) + ']', layout: Math.round(s.forcedStyleAndLayoutDuration) })) }));
})();`;

async function main() {
  const profile = mkdtempSync(path.join(os.tmpdir(), 'chrome-speed-'));
  const child = spawn(exe, ['--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
  const stopAll = () => { // every process of this test profile, never the user's own browser
    try { child.kill(); } catch {}
    if (process.platform === 'win32') {
      try {
        const ps = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${path.basename(profile)}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
        spawn('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' }).on('exit', () => { try { rmSync(profile, { recursive: true, force: true }); } catch {} });
      } catch {}
    } else try { rmSync(profile, { recursive: true, force: true }); } catch {}
  };
  try {
    let port = 0;
    for (let i = 0; i < 100 && !port; i++) {
      await wait(100);
      try { port = Number(readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch {}
    }
    if (!port) throw new Error('the test browser did not start');
    const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const cdp = await connect(ver.webSocketDebuggerUrl);
    const all = [];
    for (let run = 1; run <= RUNS; run++) {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId: s } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      let loaded = false;
      const errors = [];
      cdp.on((m) => {
        if (m.sessionId !== s) return;
        if (m.method === 'Page.loadEventFired') loaded = true;
        // a page that breaks while loading does less work and would score falsely well: say so loudly
        if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description?.split('\n').slice(0, 2).join(' ') || m.params.exceptionDetails.text);
      });
      await cdp.send('Runtime.enable', {}, s);
      await cdp.send('Page.enable', {}, s);
      await cdp.send('Network.enable', {}, s);
      await cdp.send('Network.clearBrowserCache', {}, s);
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: false }, s);
      await cdp.send('Network.setBlockedURLs', { urls: ['*/api/track*', '*action=track*', '*action=inquiry*'] }, s); // (ours, and the PHP hub's)
      // Lighthouse's phone: Moto G Power sized screen, 4x slower processor, slow 4G (its "applied" settings)
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 412, height: 823, deviceScaleFactor: 1.75, mobile: true }, s);
      await cdp.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' }, s);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }, s);
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 562.5, downloadThroughput: (1474.56 * 1024) / 8, uploadThroughput: (675 * 1024) / 8 }, s);
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: COLLECT }, s);
      const reqs = new Map();
      if (VERBOSE) cdp.on((m) => {
        if (m.sessionId !== s) return;
        const p = m.params;
        if (m.method === 'Network.requestWillBeSent') reqs.set(p.requestId, { url: p.request.url.replace(/^https?:\/\/[^/]+/, ''), t: p.timestamp, prio: p.request.initialPriority });
        if (m.method === 'Network.loadingFinished' && reqs.has(p.requestId)) Object.assign(reqs.get(p.requestId), { end: p.timestamp, kb: Math.round(p.encodedDataLength / 1024) });
      });
      if (PROFILE) { await cdp.send('Profiler.enable', {}, s); await cdp.send('Profiler.setSamplingInterval', { interval: 100 }, s); await cdp.send('Profiler.start', {}, s); }
      const trace = [];
      let traced = null;
      if (TRACE) {
        cdp.on((m) => {
          if (m.method === 'Tracing.dataCollected') trace.push(...m.params.value);
          if (m.method === 'Tracing.tracingComplete') traced();
        });
        await cdp.send('Tracing.start', { traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8', 'v8.execute', 'blink', 'loading'] }, transferMode: 'ReportEvents' });
      }
      await cdp.send('Page.navigate', { url: URL_ }, s);
      const t0 = Date.now();
      while (!loaded && Date.now() - t0 < 30000) await wait(100);
      await wait(7000); // let the page settle (Lighthouse waits for a quiet spell too)
      if (PROFILE) { // where the processor's time went (self time per function, at the 4x slower speed)
        const { profile: pr } = await cdp.send('Profiler.stop', {}, s);
        const byId = new Map(pr.nodes.map((n) => [n.id, n])), self = new Map();
        let total = 0;
        pr.samples.forEach((id, i) => {
          const f = byId.get(id).callFrame;
          if (f.functionName === '(idle)' || f.functionName === '(program)') return;
          const k = f.url ? `${f.url.replace(/^https?:\/\/[^/]+/, '')} ${f.functionName || '(top)'}:${f.lineNumber + 1}` : `(${f.functionName})`;
          const d = (pr.timeDeltas[i] || 0) / 1000;
          self.set(k, (self.get(k) || 0) + d); total += d;
        });
        console.log(`   busy: ${Math.round(total)} ms; most self time:`);
        [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, v]) => console.log(`      ${v.toFixed(1).padStart(6)} ms  ${k}`));
      }
      if (TRACE) { // what each long task on the page's main thread was made of
        const done = new Promise((r) => { traced = r; });
        await cdp.send('Tracing.end');
        await done;
        const main = trace.find((e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain' && trace.some((x) => x.pid === e.pid && x.name === 'ParseHTML'));
        const ev = trace.filter((e) => main && e.pid === main.pid && e.tid === main.tid && e.ph === 'X' && e.dur);
        const t0 = Math.min(...ev.map((e) => e.ts));
        for (const task of ev.filter((e) => (e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask') && e.dur > 50000)) {
          // each event's own time (its length minus what ran inside it), added up by name
          const kids = ev.filter((e) => e !== task && e.ts >= task.ts && e.ts + e.dur <= task.ts + task.dur)
            .sort((a, b) => a.ts - b.ts || b.dur - a.dur);
          const stack = [], own = new Map();
          for (const k of kids) {
            while (stack.length && stack[stack.length - 1].ts + stack[stack.length - 1].dur <= k.ts) stack.pop();
            if (stack.length) own.set(stack[stack.length - 1], (own.get(stack[stack.length - 1]) ?? stack[stack.length - 1].dur) - k.dur);
            stack.push(k);
          }
          const sum = new Map();
          for (const k of kids) {
            const what = k.name + (k.args?.data?.url ? ' ' + String(k.args.data.url).replace(/^https?:\/\/[^/]+/, '').slice(0, 40) : k.args?.data?.functionName ? ' ' + k.args.data.functionName : '');
            sum.set(what, (sum.get(what) || 0) + (own.get(k) ?? k.dur) / 1000);
          }
          console.log(`   task @${Math.round((task.ts - t0) / 1000)} ms: ${Math.round(task.dur / 1000)} ms = ` +
            [...sum.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${Math.round(v)}`).join(', '));
        }
      }
      if (VERBOSE) {
        const t = [...reqs.values()].sort((a, b) => a.t - b.t), base = t.length ? t[0].t : 0;
        for (const r of t) console.log(`   net ${String(Math.round((r.t - base) * 1000)).padStart(5)} → ${String(r.end ? Math.round((r.end - base) * 1000) : '-').padStart(5)} ms ${String(r.kb ?? '').padStart(4)} KB ${r.prio.padEnd(8)} ${r.url.slice(0, 70)}`);
      }
      const { result } = await cdp.send('Runtime.evaluate', { expression: 'JSON.stringify(window.__speed)', returnByValue: true }, s);
      const m = JSON.parse(result.value);
      // blocking time: the part of every task over 50 ms, after the first paint
      const tbt = m.tasks.filter((t) => t.start + t.ms > m.fcp).reduce((a, t) => a + Math.max(0, t.ms - 50), 0);
      const r = { fcp: Math.round(m.fcp), lcp: Math.round(m.lcp), tbt, cls: Math.round(m.cls * 1000) / 1000, si: Math.round(m.fcp) };
      r.score = Math.round(scoreOf(r) * 100);
      all.push(r);
      console.log(`run ${run}: score ${r.score}  first paint ${r.fcp} ms  biggest paint ${r.lcp} ms (${m.lcpWhat})  blocking ${r.tbt} ms  shift ${r.cls}`);
      for (const e of errors) console.log(`   !! PAGE ERROR (this score does not count): ${e}`);
      if (errors.length) process.exitCode = 2;
      if (VERBOSE) {
        console.log('   long tasks:', m.tasks.map((t) => `${t.ms}ms@${t.start}`).join(', ') || 'none');
        for (const f of m.frames.filter((f) => f.ms >= 50)) {
          console.log(`   frame @${f.start}: ${f.ms} ms (render ${f.render}, style+layout ${f.style})`);
          for (const sc of f.scripts.filter((x) => x.ms >= 5)) console.log(`      ${sc.ms} ms ${sc.what}${sc.layout ? ` (forced layout ${sc.layout})` : ''}`);
        }
      }
      await cdp.send('Target.closeTarget', { targetId });
    }
    const med = (k) => all.map((r) => r[k]).sort((a, b) => a - b)[Math.floor(all.length / 2)];
    const m = { fcp: med('fcp'), lcp: med('lcp'), tbt: med('tbt'), cls: med('cls'), si: med('si') };
    console.log(`\nmiddle of ${RUNS}: score ${Math.round(scoreOf(m) * 100)}  (first paint ${m.fcp} ms, biggest paint ${m.lcp} ms, blocking ${m.tbt} ms, shift ${m.cls})`);
    console.log('Speed Index is taken as the first paint here (close enough for this page).');
    try { await cdp.send('Browser.close'); } catch {}
    cdp.close();
  } finally {
    stopAll();
  }
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
