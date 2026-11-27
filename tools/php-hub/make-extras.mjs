// Extras for the PHP catalogue hub (catalog.jinharsh.com), made from its catalogue PDFs:
//   - pictures of pages 2-5 (540 px wide, WebP) for Quick look and the cards' turning pages:
//       covers/<id>-p2.webp ... -p5.webp, and "peek": <how many> in covers/covers.json
//   - the text of every page, for searching inside the catalogues: search/index.json { v, made, cats: { id: [page texts] } }
//   - a small, light picture of EVERY page (300 px wide), shown at once by the reader while the sharp page is still
//     coming: previews/<id>/<n>.webp, and "prev": <pages> in covers.json
//   node tools/php-hub/make-extras.mjs <site folder>  [https://catalog.jinharsh.com]  [--again]
// Run make-covers.mjs first (this uses its covers.json). Catalogues done before are skipped unless --again.
// The PDFs are read from the live site in pieces (a PDF on another website: the hub's own copy in mirror/).
import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const AGAIN = process.argv.includes('--again');
const SITE = args[0];
const LIVE = (args[1] || 'https://catalog.jinharsh.com').replace(/\/$/, '');
if (!SITE) { console.error('Which site folder? node tools/php-hub/make-extras.mjs <site folder>'); process.exit(1); }
const COVERS = path.join(SITE, 'covers'), SEARCH = path.join(SITE, 'search');
const PDFJS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'vendor', 'pdfjs');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome'].find((p) => existsSync(p));
const PEEK = 4, WIDTH = 540, MAX_TEXT = 6000, PREV_W = 300;

const list = await (await fetch(`${LIVE}/hub/api.php?action=catalogs`)).json();
let meta = {};
try { meta = JSON.parse(await fs.readFile(path.join(COVERS, 'covers.json'), 'utf8')); } catch {}
let index = { v: 1, made: '', cats: {} };
try { index = JSON.parse(await fs.readFile(path.join(SEARCH, 'index.json'), 'utf8')); } catch {}
const abs = (u) => (/^https?:/i.test(u) ? u : LIVE + u);
const todo = list.filter((c) => /\.pdf(\?|#|$)/i.test(c.pdfUrl || ''))
  .map((c) => ({ id: c.id, url: abs((meta[c.id] && meta[c.id].file) || c.pdfUrl) }))
  .filter((t) => AGAIN || !(meta[t.id] && meta[t.id].peek !== undefined && index.cats[t.id] && meta[t.id].prev));
await fs.mkdir(COVERS, { recursive: true });
await fs.mkdir(SEARCH, { recursive: true });
console.log(`${todo.length} catalogue(s) to do`);
const allowed = new Set(todo.map((t) => t.url));

const PAGE = `<!doctype html><meta charset="utf-8"><script type="module">
const L = await import('/pdfjs/pdf.min.mjs');
L.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
const OPTS = { cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/', iccUrl: '/pdfjs/iccs/', isEvalSupported: false };
const blob = (cv, q) => new Promise((ok) => cv.toBlob(ok, 'image/webp', q));
for (const t of ${JSON.stringify(todo)}) {
  try {
    const task = L.getDocument({ url: '/fetch?u=' + encodeURIComponent(t.url), rangeChunkSize: 262144, disableAutoFetch: true, disableStream: true, ...OPTS });
    const doc = await task.promise;
    let peek = 0;
    for (let n = 2; n <= Math.min(doc.numPages, ${PEEK} + 1); n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: ${WIDTH} / base.width });
      const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      const g = cv.getContext('2d', { alpha: false }); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: g, canvas: cv, viewport: vp, background: '#ffffff' }).promise;
      await fetch('/save?id=' + encodeURIComponent(t.id) + '&n=' + n, { method: 'POST', body: await blob(cv, 0.8) });
      page.cleanup(); peek++;
    }
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      {   // the small picture of this page
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: ${PREV_W} / base.width });
        const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
        const g = cv.getContext('2d', { alpha: false }); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
        await page.render({ canvasContext: g, canvas: cv, viewport: vp, background: '#ffffff' }).promise;
        await fetch('/prev?id=' + encodeURIComponent(t.id) + '&n=' + n, { method: 'POST', body: await blob(cv, 0.6) });
      }
      const tc = await page.getTextContent();
      let s = '';
      for (const it of tc.items) { if (typeof it.str === 'string') s += it.str + (it.hasEOL ? ' ' : ''); }
      pages.push(s.replace(/\\s+/g, ' ').trim().slice(0, ${MAX_TEXT}));
      page.cleanup();
    }
    await fetch('/text?id=' + encodeURIComponent(t.id) + '&peek=' + peek + '&prev=' + doc.numPages, { method: 'POST', body: JSON.stringify(pages) });
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
    const ok = id && /^[a-z0-9-]{1,120}$/i.test(id);
    if (u.pathname === '/prev' && ok) {
      const n = Number(u.searchParams.get('n'));
      if (n >= 1 && n <= 5000) { await fs.mkdir(path.join(SITE, 'previews', id), { recursive: true }); await fs.writeFile(path.join(SITE, 'previews', id, `${n}.webp`), body); }
    } else if (u.pathname === '/save' && ok) {
      const n = Number(u.searchParams.get('n'));
      if (n >= 2 && n <= PEEK + 1) await fs.writeFile(path.join(COVERS, `${id}-p${n}.webp`), body);
    } else if (u.pathname === '/text' && ok) {
      const pages = JSON.parse(body.toString('utf8'));
      index.cats[id] = pages;
      meta[id] = { ...(meta[id] || {}), peek: Number(u.searchParams.get('peek')) || 0, prev: Number(u.searchParams.get('prev')) || 0 };
      const chars = pages.reduce((a, p) => a + p.length, 0);
      console.log(`  ${id}: ${meta[id].peek} page pictures, ${meta[id].prev} small page previews, text of ${pages.length} pages (${(chars / 1024).toFixed(0)} K letters)`);
    } else if (u.pathname === '/fail') console.log(`  ${id}: could not read it (${body.toString().slice(0, 140)})`);
    else if (u.pathname === '/done') finish();
    res.writeHead(204); res.end();
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

let child = null, profile = null;
if (todo.length) {
  profile = mkdtempSync(path.join(os.tmpdir(), 'chrome-speed-extras-'));
  child = spawn(CHROME, ['--headless=new', `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions', '--remote-debugging-port=0', `http://127.0.0.1:${port}/`], { stdio: 'ignore' });
  const timer = setTimeout(() => { console.log('  (stopped after 25 minutes)'); finish(); }, 1500000);
  await finished;
  clearTimeout(timer);
}
// catalogues no longer on the hub drop out of the search
const ids = new Set(list.map((c) => c.id));
for (const k of Object.keys(index.cats)) if (!ids.has(k)) delete index.cats[k];
index.made = new Date().toISOString().slice(0, 10);
await fs.writeFile(path.join(SEARCH, 'index.json'), JSON.stringify(index));
await fs.writeFile(path.join(COVERS, 'covers.json'), JSON.stringify(meta, null, 1) + '\n');
const size = (await fs.stat(path.join(SEARCH, 'index.json'))).size;
console.log(`search/index.json: ${Object.keys(index.cats).length} catalogues, ${(size / 1048576).toFixed(2)} MB`);
server.close();
if (child) {
  try { child.kill(); } catch {}
  if (process.platform === 'win32') {
    const ps = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${path.basename(profile)}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
    spawn('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' }).on('exit', () => { try { rmSync(profile, { recursive: true, force: true }); } catch {} });
  }
}
