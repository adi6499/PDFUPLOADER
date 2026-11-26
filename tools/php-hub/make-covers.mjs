// Cover pictures for the PHP catalogue hub (catalog.jinharsh.com), whose catalogue list has none: page 1 of every
// catalogue PDF, drawn the same way our team page draws covers (720 px wide + a 360 px small copy, WebP).
// Only the first page is read: the PDFs are opened in pieces (byte ranges), so a big catalogue is not fetched whole.
//   node tools/php-hub/make-covers.mjs <site folder>  [https://catalog.jinharsh.com]
// Writes <site folder>/covers/<id>.webp, <id>-t.webp and covers.json ({ id: { w, h, pages, size } }).
// Catalogues that already have a cover are skipped (delete one to make it again).
import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = process.argv[2];
const LIVE = (process.argv[3] || 'https://catalog.jinharsh.com').replace(/\/$/, '');
if (!SITE) { console.error('Which site folder? node tools/php-hub/make-covers.mjs <site folder>'); process.exit(1); }
const OUT = path.join(SITE, 'covers');
const PDFJS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'vendor', 'pdfjs');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find((p) => existsSync(p));

const list = await (await fetch(`${LIVE}/hub/api.php?action=catalogs`)).json();
const abs = (u) => (/^https?:/i.test(u) ? u : LIVE + u);
const todo = list.filter((c) => /\.pdf(\?|#|$)/i.test(c.pdfUrl || '')).map((c) => ({ id: c.id, url: abs(c.pdfUrl) }));
await fs.mkdir(OUT, { recursive: true });
let meta = {};
try { meta = JSON.parse(await fs.readFile(path.join(OUT, 'covers.json'), 'utf8')); } catch {}
const need = todo.filter((t) => !(meta[t.id] && existsSync(path.join(OUT, t.id + '.webp'))));
console.log(`${todo.length} catalogue PDFs, ${need.length} without a cover yet`);
const allowed = new Set(todo.map((t) => t.url));
let done = 0;

const PAGE = `<!doctype html><meta charset="utf-8"><script type="module">
const L = await import('/pdfjs/pdf.min.mjs');
L.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
const OPTS = { cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/', iccUrl: '/pdfjs/iccs/', isEvalSupported: false };
const blob = (cv, q) => new Promise((ok) => cv.toBlob(ok, 'image/webp', q));
for (const t of ${JSON.stringify(need)}) {
  try {
    const task = L.getDocument({ url: '/fetch?u=' + encodeURIComponent(t.url), rangeChunkSize: 65536, disableAutoFetch: true, disableStream: true, ...OPTS });
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 720 / base.width });
    const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const g = cv.getContext('2d', { alpha: false }); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: g, canvas: cv, viewport: vp, background: '#ffffff' }).promise;
    const th = document.createElement('canvas'); th.width = 360; th.height = Math.round(cv.height * 360 / cv.width);
    const tg = th.getContext('2d', { alpha: false }); tg.fillStyle = '#fff'; tg.fillRect(0, 0, th.width, th.height);
    tg.imageSmoothingQuality = 'high'; tg.drawImage(cv, 0, 0, th.width, th.height);
    const q = 'id=' + encodeURIComponent(t.id) + '&w=' + cv.width + '&h=' + cv.height + '&pages=' + doc.numPages;
    await fetch('/save?kind=cover&' + q, { method: 'POST', body: await blob(cv, 0.84) });
    await fetch('/save?kind=thumb&' + q, { method: 'POST', body: await blob(th, 0.8) });
    await task.destroy();
  } catch (e) { await fetch('/fail?id=' + encodeURIComponent(t.id), { method: 'POST', body: String(e && e.message || e) }); }
}
await fetch('/done', { method: 'POST' });
</script>`;

const TYPES = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm' };
let finish;
const finished = new Promise((r) => { finish = r; });
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PAGE); }
    if (u.pathname.startsWith('/pdfjs/')) {
      const f = path.join(PDFJS, decodeURIComponent(u.pathname.slice(7)));
      if (!f.startsWith(PDFJS)) { res.writeHead(403); return res.end(); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
      return res.end(await fs.readFile(f));
    }
    if (u.pathname === '/fetch') {   // a piece of one of the catalogue PDFs (only those), passed through
      const target = u.searchParams.get('u');
      if (!allowed.has(target)) { res.writeHead(403); return res.end(); }
      const r = await fetch(target, { headers: req.headers.range ? { range: req.headers.range } : {} });
      const h = { 'Content-Type': 'application/pdf' };
      for (const k of ['content-range', 'accept-ranges']) if (r.headers.get(k)) h[k] = r.headers.get(k);
      const body = Buffer.from(await r.arrayBuffer());
      h['content-length'] = body.length;
      res.writeHead(r.status, h);
      return res.end(body);
    }
    let body = []; for await (const c of req) body.push(c); body = Buffer.concat(body);
    const id = u.searchParams.get('id');
    if (u.pathname === '/save' && id && /^[a-z0-9-]{1,120}$/i.test(id)) {
      const thumb = u.searchParams.get('kind') === 'thumb';
      await fs.writeFile(path.join(OUT, id + (thumb ? '-t' : '') + '.webp'), body);
      if (!thumb) {
        const url = todo.find((t) => t.id === id).url;
        let size = 0; try { size = Number((await fetch(url, { method: 'HEAD' })).headers.get('content-length')) || 0; } catch {}
        meta[id] = { w: +u.searchParams.get('w'), h: +u.searchParams.get('h'), pages: +u.searchParams.get('pages'), size };
        console.log(`  ${id}: ${meta[id].pages} pages, cover ${(body.length / 1024).toFixed(0)} KB`);
        done++;
      }
    } else if (u.pathname === '/fail') console.log(`  ${id}: could not read page 1 (${body.toString().slice(0, 140)})`);
    else if (u.pathname === '/done') finish();
    res.writeHead(204); res.end();
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

let child = null, profile = null;
if (need.length) {
  profile = mkdtempSync(path.join(os.tmpdir(), 'chrome-speed-covers-'));
  child = spawn(CHROME, ['--headless=new', `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions', '--remote-debugging-port=0', `http://127.0.0.1:${port}/`], { stdio: 'ignore' });
  const timer = setTimeout(() => { console.log('  (stopped after 10 minutes)'); finish(); }, 600000);
  await finished;
  clearTimeout(timer);
}
await fs.writeFile(path.join(OUT, 'covers.json'), JSON.stringify(meta, null, 1) + '\n');
console.log(`made ${done} cover(s); covers.json has ${Object.keys(meta).length}`);
server.close();
if (child) {
  try { child.kill(); } catch {}
  if (process.platform === 'win32') {
    const ps = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${path.basename(profile)}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
    spawn('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' }).on('exit', () => { try { rmSync(profile, { recursive: true, force: true }); } catch {} });
  }
}
