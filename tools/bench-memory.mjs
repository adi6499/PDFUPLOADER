// How much memory does the program need? Starts a separate copy on a throw-away data folder (port 8199), fills it
// with catalogues and two busy years of visitor history, puts it under heavy use, and prints its memory after each
// step and the highest it reached. Your own data is not touched.
//
//   node tools/bench-memory.mjs [path to a sample PDF]
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, createWriteStream, openSync, writeSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8199, BASE = `http://127.0.0.1:${PORT}`;
const data = mkdtempSync(join(tmpdir(), 'jd-bench-'));
const samplePath = process.argv[2];
const sample = samplePath ? readFileSync(samplePath) : Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(3 * 1024 * 1024, 32)]);
const EVENTS = Number(process.env.EVENTS || 300000);

// two busy years of visits: written straight into the history file
{
  const fd = openSync(join(data, 'events.jsonl'), 'w');
  const types = ['visit', 'visit', 'visit', 'read', 'download', 'share', 'hub', 'video'];
  let buf = '';
  for (let i = 0; i < EVENTS; i++) {
    const t = Date.now() - (EVENTS - i) * 200000;
    const s = new Date(t + 5.5 * 3600e3).toISOString();
    buf += JSON.stringify({ id: i.toString(16), at: new Date(t).toISOString(), time: s.slice(0, 10) + ' ' + s.slice(11, 16), day: s.slice(0, 10), hour: 10,
      phase: '', type: types[i % types.length], code: 'cat' + (i % 20), title: 'Catalogue ' + (i % 20), brand: 'Brand ' + (i % 6),
      device: i % 3 ? 'phone' : 'computer', source: ['QR or direct', 'whatsapp', 'google', 'direct'][i % 4], city: '', country: '',
      visitor: i % 50 === 0 ? { name: 'Visitor ' + i, email: `v${i}@example.com`, company: 'Co ' + (i % 300), phone: '' } : null }) + '\n';
    if (buf.length > 1 << 20) { writeSync(fd, buf); buf = ''; }
  }
  writeSync(fd, buf); closeSync(fd);
}

const srv = spawn(process.execPath, [join(root, 'server', 'server.mjs')], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: data, PUBLIC_URL: BASE, TEAM_OPEN: 'true', TRIAL: 'false', STORAGE: 'disk', MAX_UPLOAD_MB: '200' },
  stdio: 'ignore',
});
const mem = () => {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', `$p = Get-Process -Id ${srv.pid}; "$($p.WorkingSet64) $($p.PeakWorkingSet64)"`]).toString().trim().split(' ');
    return { now: Math.round(Number(out[0]) / 1048576), peak: Math.round(Number(out[1]) / 1048576) };
  } catch { return { now: -1, peak: -1 }; }
};
const say = (what) => { const m = mem(); console.log(`${what.padEnd(58)} memory now ${String(m.now).padStart(4)} MB   highest so far ${String(m.peak).padStart(4)} MB`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function pool(n, conc, fn) { let i = 0; await Promise.all(Array.from({ length: conc }, async () => { while (i < n) { const k = i++; try { await fn(k); } catch {} } })); }

try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch {} await wait(150); }
  await wait(800);
  say('Started, nothing happening');

  // 20 catalogues of about 3.5 MB each
  for (let i = 0; i < 20; i++) {
    await fetch(`${BASE}/api/docs?title=Catalogue%20${i}&name=cat${i}.pdf&pages=4&code=cat${i}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: sample });
  }
  say('20 catalogues uploaded (one after another)');

  await pool(1000, 60, async (k) => { await (await fetch(`${BASE}/c/cat${k % 20}`, { headers: { 'Accept-Encoding': 'br' } })).text(); });
  say('1,000 catalogue pages opened, 60 at a time');

  await pool(300, 60, async () => { await (await fetch(`${BASE}/`, { headers: { 'Accept-Encoding': 'br' } })).text(); });
  for (const f of ['/js/particles.js', '/js/view.js', '/vendor/pdfjs/pdf.min.mjs', '/vendor/pdfjs/pdf.worker.min.mjs', '/css/app.css']) await (await fetch(BASE + f, { headers: { 'Accept-Encoding': 'br' } })).arrayBuffer();
  say('300 front pages + every script, compressed');

  await pool(60, 30, async (k) => { const r = await fetch(`${BASE}/f/cat${k % 20}/1/cat.pdf`); for await (const _ of r.body) { /* read and drop */ } });
  say('60 PDF downloads, 30 at the same time');

  await pool(3000, 60, async (k) => { await fetch(`${BASE}/api/track`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'visit', code: 'cat' + (k % 20), device: 'phone' }) }); });
  say('3,000 visits counted, 60 at a time');

  for (let i = 0; i < 3; i++) { const r = await fetch(`${BASE}/api/insights`); const j = await r.json(); if (i === 0) console.log(`   (statistics: ${j.summary?.totals?.visits} visits counted from ${EVENTS.toLocaleString()} history lines)`); }
  say(`Visitors & queries opened 3 times (${EVENTS.toLocaleString()} history lines)`);
  await (await fetch(`${BASE}/api/insights/visits.csv`)).arrayBuffer();
  say('Visits downloaded for Excel');

  // one 150 MB upload, sent as it is read from disk
  const big = join(data, 'big.pdf');
  { const w = createWriteStream(big); w.write('%PDF-1.4\n'); const chunk = Buffer.alloc(1 << 20, 32); for (let i = 0; i < 150; i++) w.write(chunk); await new Promise((r) => w.end(r)); }
  const { Readable } = await import('node:stream');
  const { createReadStream } = await import('node:fs');
  const up = await fetch(`${BASE}/api/docs?title=Big&name=big.pdf&code=bigone`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: Readable.toWeb(createReadStream(big)), duplex: 'half' });
  say(`A 150 MB PDF uploaded (answer ${up.status})`);

  await wait(3000);
  say('Three seconds later, resting');
} finally {
  srv.kill();
  await wait(500);
  try { rmSync(data, { recursive: true, force: true }); } catch {}
}
