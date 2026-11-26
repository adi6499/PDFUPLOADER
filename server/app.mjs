// Jinharsh Docs - the program itself: every address the site answers.
// It runs in two places with the same rules:
//   - the company server (and this computer): files on the server's own disk      -> server/server.mjs
//   - a hosted trial copy on Vercel: files in Vercel's Blob store                -> api/index.js
import { promises as fs, createReadStream, existsSync } from 'node:fs';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { join, resolve, extname, sep } from 'node:path';
import { Store, receiveFile, readSmallBody, cleanFileName } from './store.mjs';
import { BlobStore } from './blobstore.mjs';
import { ROOT, readJson, loadConfig } from './config.mjs';
import { Auth, readCookie, COOKIE } from './auth.mjs';

const PUBLIC = join(ROOT, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.icc': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};
const BLOB_HOSTS = 'https://*.public.blob.vercel-storage.com';

// ---------- smaller downloads: text files are sent compressed (brotli, or gzip for older browsers) ----------
// A phone on a slow connection gets about a quarter of the bytes. Each file is compressed once and kept in memory
// until it changes on disk.
const brotli = promisify(zlib.brotliCompress), gzip = promisify(zlib.gzip);
const COMPRESSIBLE = /^(text\/|application\/(json|manifest\+json)|image\/svg\+xml)/;
function encodingFor(req, type, size) {
  if (!COMPRESSIBLE.test(type) || size < 1024 || req.headers.range) return null;
  const a = String(req.headers['accept-encoding'] || '');
  return /\bbr\b/.test(a) ? 'br' : /\bgzip\b/.test(a) ? 'gzip' : null;
}
const squeeze = (buf, enc) => (enc === 'br'
  ? brotli(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: buf.length > 300000 ? 6 : 10, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } })
  : gzip(buf, { level: 9 }));
const packedFiles = new Map(); // path -> { key, br, gzip } (promises)
function packedFile(path, st, enc) {
  const key = st.size + ':' + st.mtimeMs;
  let p = packedFiles.get(path);
  if (!p || p.key !== key) { p = { key }; packedFiles.set(path, p); }
  if (!p[enc]) p[enc] = fs.readFile(path).then((raw) => squeeze(raw, enc)).catch((e) => { delete p[enc]; throw e; });
  return p[enc];
}
// a page or list made for this visit: compressed on the spot (quick, they are small)
function sendPacked(req, res, status, body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const type = headers['Content-Type'] || (typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8');
  const buf = Buffer.from(text);
  const enc = encodingFor(req, type, buf.length);
  if (!enc) return send(res, status, text, { 'Content-Type': type, ...headers });
  const out = enc === 'br'
    ? zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })
    : zlib.gzipSync(buf, { level: 6 });
  res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers, 'Content-Type': type, 'Content-Encoding': enc, Vary: 'Accept-Encoding', 'Content-Length': out.length });
  res.end(out);
}

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const data = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isBuf ? 'application/octet-stream' : typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers,
  });
  res.end(data);
}
const fail = (res, status, message) => send(res, status, { error: message });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : null; };
const redirect = (res, to) => { res.writeHead(302, { Location: to, 'Cache-Control': 'no-cache' }); res.end(); };
async function readJsonBody(req, max = 64 * 1024) { return JSON.parse((await readSmallBody(req, max)).toString('utf8') || '{}'); }

// overrides (for tests): { config: {...}, blobApi, blobToken, fetch, handleUpload }
export async function createApp(overrides = {}) {
  const C = { ...loadConfig(), ...(overrides.config || {}) };
  const { cfg, PUBLIC_URL, DATA_DIR, MAX_UPLOAD, TRUST_PROXY, PRINTABLE, LOOPBACK, STORAGE, TRIAL, TEAM_OPEN } = C;
  const SITE = readJson(join(ROOT, 'site.json'));
  const VERSION = readJson(join(ROOT, 'package.json')).version || '0';
  const BLOB = STORAGE === 'blob';

  let store;
  if (BLOB) {
    const api = overrides.blobApi || await import('@vercel/blob');
    store = new BlobStore({ api, token: overrides.blobToken ?? process.env.BLOB_READ_WRITE_TOKEN, fetchImpl: overrides.fetch || fetch });
  } else {
    store = new Store(DATA_DIR);
  }
  await store.load();
  const storageReady = () => store.ready !== false;

  const auth = new Auth(DATA_DIR);
  // Who may use the team screen:
  //  - with a team password set: only people who signed in with it
  //  - with no password: a trial copy, or a preview on this computer (nobody else can reach it);
  //    on the real company address the team screen stays locked until a password is set (npm run password)
  const openAccess = () => !auth.passwordSet && (TRIAL || TEAM_OPEN || (!PRINTABLE && LOOPBACK));
  const isTeam = (req) => openAccess() || auth.checkToken(readCookie(req, COOKIE));
  const clientIp = (req) => (TRUST_PROXY && (String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.headers['x-real-ip'])) || req.socket?.remoteAddress || '?';
  const base = (req) => PUBLIC_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
  const SECURE = (req) => base(req).startsWith('https://');
  // changes may only come from our own pages (a second guard next to the SameSite cookie)
  function sameOrigin(req) {
    const o = req.headers.origin;
    if (!o) return true;
    try { const u = new URL(o); return u.host === req.headers.host || u.host === req.headers['x-forwarded-host'] || (PUBLIC_URL && u.origin === new URL(PUBLIC_URL).origin); } catch { return false; }
  }
  const CSP = [
    "default-src 'self'", `img-src 'self' data: blob:${BLOB ? ' ' + BLOB_HOSTS : ''}`, "style-src 'self' 'unsafe-inline'", "font-src 'self' data: blob:",
    "script-src 'self' 'wasm-unsafe-eval'", "worker-src 'self' blob:", `connect-src 'self'${BLOB ? ' ' + BLOB_HOSTS + ' https://vercel.com' : ''}`, "object-src 'none'",
    "base-uri 'none'", "frame-ancestors 'self'", "form-action 'self'",
  ].join('; ');

  function publicDoc(doc) {
    const basics = { code: doc.code, title: doc.title, note: doc.note || '', brand: doc.brand || '', category: doc.category || '', status: doc.status };
    const v = doc.versions.find((x) => x.v === doc.current) || doc.versions[doc.versions.length - 1];
    if (!v) return { ...basics, waiting: true, sourceUrl: doc.sourceUrl || '', updatedAt: doc.updatedAt, cover: null };
    const file = BLOB ? v.url : `/f/${doc.code}/${v.v}/${encodeURIComponent(v.name)}`;
    return {
      ...basics, updatedAt: v.uploadedAt,
      version: v.v, pages: v.pages, size: v.size, name: v.name,
      file, download: BLOB ? v.url + '?download=1' : file + '?dl=1',
      cover: v.cover ? (BLOB ? v.cover.url : `/cover/${doc.code}/${v.v}.${v.cover.ext}`) : null,
      coverW: v.cover?.w || null, coverH: v.cover?.h || null,
      // the small copy for lists and the front page (the full cover until one has been made)
      thumb: v.thumb ? (BLOB ? v.thumb.url : `/cover/${doc.code}/${v.v}-t.${v.thumb.ext}`) : null,
    };
  }
  const teamDoc = (req, doc) => ({ ...doc, link: `${base(req)}/c/${doc.code}`, live: publicDoc(doc) });

  async function sendFile(req, res, path, type, { immutable = false, disposition = null, maxAge = 0 } = {}) {
    let st;
    try { st = await fs.stat(path); } catch { return fail(res, 404, 'Not found'); }
    if (!st.isFile()) return fail(res, 404, 'Not found');
    const enc = encodingFor(req, type, st.size);
    const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}${enc ? '-' + enc : ''}"`;
    const headers = {
      'Content-Type': type, 'Accept-Ranges': 'bytes', ETag: etag, 'Last-Modified': st.mtime.toUTCString(),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : maxAge ? `public, max-age=${maxAge}` : 'no-cache',
    };
    if (COMPRESSIBLE.test(type)) headers.Vary = 'Accept-Encoding';
    if (disposition) headers['Content-Disposition'] = disposition;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
    if (enc) {
      try {
        const body = await packedFile(path, st, enc);
        res.writeHead(200, { ...headers, 'Content-Encoding': enc, 'Content-Length': body.length });
        return res.end(req.method === 'HEAD' ? undefined : body);
      } catch { /* fall back to the plain file below */ }
    }
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
      start = Math.max(0, start); end = Math.min(end, st.size - 1);
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      return createReadStream(path, { start, end }).on('error', () => res.destroy()).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    createReadStream(path).on('error', () => res.destroy()).pipe(res);
  }

  async function serveStatic(req, res, urlPath) {
    let rel = decodeURIComponent(urlPath);
    if (rel === '/' || rel === '') rel = '/index.html';
    const full = resolve(PUBLIC, '.' + rel);
    if (!full.startsWith(PUBLIC + sep)) return fail(res, 404, 'Not found');
    const type = MIME[extname(full).toLowerCase()] || 'application/octet-stream';
    if (type.startsWith('text/html')) res.setHeader('Content-Security-Policy', CSP);
    // big files that never change (the PDF reader, the fonts) are kept by the browser for a week; everything else,
    // including the icon set that grows with new screens, is checked each time (a quick "not changed" answer)
    return sendFile(req, res, full, type, { maxAge: /^\/vendor\/(pdfjs|fonts)\//.test(rel) ? 604800 : 0 });
  }

  // ---------- the front page: / ----------
  let hubTemplate = null;
  async function serveHub(req, res) {
    if (!hubTemplate || cfg.dev) hubTemplate = await fs.readFile(join(PUBLIC, 'index.html'), 'utf8');
    const list = store.list().filter((d) => d.status === 'live').map(publicDoc);
    // the same order the page shows: catalogues with a PDF first, newest first
    const first = list.filter((d) => !d.waiting && d.cover).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 2);
    const preload = first.map((d) => `<link rel="preload" as="image" href="${esc(d.thumb || d.cover)}">`).join('\n  ');
    const data = JSON.stringify({ catalogs: list, publicUrl: base(req), site: SITE, printable: PRINTABLE }).replace(/</g, '\\u003c');
    const html = hubTemplate.replace('<!--PRELOAD-->', preload).replace('<!--DATA-->', `<script type="application/json" id="boot">${data}</script>`);
    sendPacked(req, res, 200, html, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP, 'Cache-Control': 'no-cache' });
  }

  // ---------- the scan page: /c/<code> ----------
  let viewTemplate = null;
  async function serveView(req, res, code) {
    if (!viewTemplate || cfg.dev) viewTemplate = await fs.readFile(join(PUBLIC, 'view.html'), 'utf8');
    const doc = store.get(code);
    const B = base(req);
    let state, meta;
    // the other catalogues, for the "More catalogues" list under each one
    const others = store.list().filter((d) => d.status === 'live' && d.code !== code).map(publicDoc).filter((p) => !p.waiting)
      .slice(0, 24).map((p) => ({ code: p.code, title: p.title, brand: p.brand, cover: p.cover, thumb: p.thumb, coverW: p.coverW, coverH: p.coverH, pages: p.pages }));
    if (doc && doc.status === 'live') {
      const p = publicDoc(doc);
      state = { status: p.waiting ? 'waiting' : 'live', doc: p, countsScans: !BLOB, others };
      const desc = [p.pages ? p.pages + ' pages' : null, 'PDF', SITE.company?.short || 'Jinharsh'].filter(Boolean).join(' · ');
      const img = p.cover ? (p.cover.startsWith('http') ? p.cover : B + p.cover) : '';
      meta = [
        `<title>${esc(p.title)} · ${esc(SITE.company?.short || 'Jinharsh')}</title>`,
        `<meta name="description" content="${esc(desc)}">`,
        `<meta property="og:type" content="website">`,
        `<meta property="og:title" content="${esc(p.title)}">`,
        `<meta property="og:description" content="${esc(desc)}">`,
        `<meta property="og:url" content="${esc(B + '/c/' + doc.code)}">`,
        `<meta property="og:site_name" content="${esc(SITE.company?.name || 'Jinharsh')}">`,
        img ? `<meta property="og:image" content="${esc(img)}">` : '',
        img ? `<meta name="twitter:card" content="summary_large_image">` : '',
        // the cover is the biggest thing on the page: fetch it straight away, not after the scripts have run
        p.cover ? `<link rel="preload" as="image" href="${esc(p.cover)}" fetchpriority="high">` : '',
        TRIAL ? `<meta name="robots" content="noindex">` : '',
      ].join('\n  ');
    } else {
      state = { status: doc ? 'archived' : store.isRetired(code) ? 'retired' : 'missing', doc: doc ? { title: doc.title, code: doc.code } : null, others };
      meta = `<title>${esc(SITE.company?.short || 'Jinharsh')}</title>\n  <meta name="robots" content="noindex">`;
    }
    const data = JSON.stringify({ ...state, site: SITE, publicUrl: B, printable: PRINTABLE }).replace(/</g, '\\u003c');
    const html = viewTemplate.replace('<!--META-->', meta).replace('<!--DATA-->', `<script type="application/json" id="boot">${data}</script>`);
    sendPacked(req, res, doc ? 200 : 404, html, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP, 'Cache-Control': 'no-cache' });
  }

  // ---------- uploads ----------
  // company server: the PDF itself comes in the request
  async function takeUpload(req, res) {
    const type = (req.headers['content-type'] || '').split(';')[0].trim();
    if (type !== 'application/pdf') { req.resume(); fail(res, 415, 'Only PDF files can be uploaded.'); return null; }
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > MAX_UPLOAD) { fail(res, 413, `This file is too big. The limit is ${MAX_UPLOAD / 1048576} MB.`); req.resume(); return null; }
    const tmp = store.tmpPath();
    try {
      const { size, head } = await receiveFile(req, tmp, MAX_UPLOAD);
      if (!head.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        await fs.rm(tmp, { force: true });
        fail(res, 400, 'This file is not a real PDF.'); return null;
      }
      return { tmp, size };
    } catch (e) {
      if (e.status === 413) fail(res, 413, `This file is too big. The limit is ${MAX_UPLOAD / 1048576} MB.`);
      else fail(res, 400, 'The upload was cut off. Please try again.');
      return null;
    }
  }
  // trial copy: the browser has put the PDF straight into the Blob store; we get its name and check it
  async function takeBlobUpload(req, res, code, v) {
    let body;
    try { body = await readJsonBody(req); } catch { fail(res, 400, 'Bad request'); return null; }
    if (!store.pathOk(body.pathname, code, v)) { fail(res, 400, 'The uploaded file has an unexpected name. Please try again.'); return null; }
    const got = await store.verifyUpload(body.pathname, MAX_UPLOAD);
    if (got.error) { fail(res, 400, got.error); return null; }
    return { ...got, body };
  }

  // the trial copy hands out short-lived upload permits: only PDFs, only to the next free name
  async function blobPermit(req, res) {
    let body;
    try { body = await readJsonBody(req); } catch { return fail(res, 400, 'Bad request'); }
    const handleUpload = overrides.handleUpload || (await import('@vercel/blob/client')).handleUpload;
    try {
      const out = await handleUpload({
        body, request: req, token: store.token,
        onBeforeGenerateToken: async (pathname) => {
          await store.refresh(0);
          const m = /^docs\/([a-z0-9-]+)\/v(\d+)\.pdf$/.exec(String(pathname));
          if (!m) throw new Error('Unexpected file name.');
          const code = m[1], v = Number(m[2]);
          if (v === 1) { const c = store.checkCode(code); if (!c.ok) throw new Error(c.reason); }
          else { const d = store.get(code); if (!d || store.nextVersion(d) !== v) throw new Error('The list changed meanwhile. Reload the page and try again.'); }
          return { allowedContentTypes: ['application/pdf'], maximumSizeInBytes: MAX_UPLOAD, addRandomSuffix: true, cacheControlMaxAge: 31536000 };
        },
      });
      return send(res, 200, out);
    } catch (e) {
      return fail(res, 400, e.message || 'Upload permit refused.');
    }
  }

  // ---------- API ----------
  async function api(req, res, url, parts) {
    const m = req.method;
    const q = url.searchParams;

    if (parts[1] === 'info' && m === 'GET') {
      return send(res, 200, {
        publicUrl: base(req), printable: PRINTABLE, trial: TRIAL, storage: STORAGE, storageReady: storageReady(), countsScans: !BLOB,
        maxUploadMB: MAX_UPLOAD / 1048576, version: VERSION, site: SITE,
        auth: { passwordSet: auth.passwordSet, open: openAccess(), signedIn: isTeam(req) },
      });
    }
    if (parts[1] === 'health') return send(res, 200, { ok: true, version: VERSION, storage: STORAGE, storageReady: storageReady() });

    // public: every live catalogue, for the front page
    if (parts[1] === 'catalogs' && m === 'GET') {
      const list = store.list().filter((d) => d.status === 'live').map(publicDoc);
      return sendPacked(req, res, 200, { catalogs: list, publicUrl: base(req), site: SITE, printable: PRINTABLE }, { 'Cache-Control': 'public, max-age=30' });
    }

    if (m !== 'GET' && m !== 'HEAD' && !sameOrigin(req)) { req.resume(); return fail(res, 403, 'Not allowed from another website.'); }

    if (parts[1] === 'login' && m === 'POST') {
      const ip = clientIp(req);
      if (auth.blocked(ip)) { req.resume(); return fail(res, 429, 'Too many wrong tries. Please wait 15 minutes and try again.'); }
      if (!auth.passwordSet) { req.resume(); return fail(res, 409, 'No team password has been set on the server yet.'); }
      let body = {};
      try { body = await readJsonBody(req, 4096); } catch {}
      if (!auth.verify(body.password)) {
        auth.failed(ip);
        return fail(res, 401, auth.blocked(ip) ? 'Too many wrong tries. Please wait 15 minutes and try again.' : 'That password is not right.');
      }
      auth.succeeded(ip);
      return send(res, 200, { ok: true }, { 'Set-Cookie': auth.cookie(SECURE(req)) });
    }
    if (parts[1] === 'logout' && m === 'POST') return send(res, 200, { ok: true }, { 'Set-Cookie': Auth.clearCookie(SECURE(req)) });

    // public: count one scan (sent by the scan page after it opens; link previews by chat apps don't run it)
    if (parts[1] === 'p' && parts[2] && parts[3] === 'scan' && m === 'POST') {
      const doc = store.get(parts[2]);
      if (doc && doc.status === 'live') store.countScan(doc);
      res.writeHead(204, { 'Cache-Control': 'no-store' }); return res.end();
    }

    // ---- below: the team's own screens ----
    if (!['check-code', 'docs', 'blob-upload'].includes(parts[1])) return fail(res, 404, 'Unknown address');
    if (!isTeam(req)) { req.resume(); return fail(res, 401, 'Please sign in.'); }
    if (!storageReady()) { req.resume(); return fail(res, 503, 'The trial copy has no file storage connected yet. In Vercel: project → Storage → connect a Blob store, then redeploy.'); }

    if (parts[1] === 'check-code' && m === 'GET') {
      if (q.has('suggest')) return send(res, 200, { ok: true, code: store.newCode() });
      return send(res, 200, store.checkCode(q.get('code')));
    }
    if (parts[1] === 'blob-upload' && m === 'POST') {
      if (!BLOB) { req.resume(); return fail(res, 404, 'Unknown address'); }
      return blobPermit(req, res);
    }

    if (!parts[2]) {
      if (m === 'GET') return send(res, 200, { docs: store.list().map((d) => teamDoc(req, d)), publicUrl: base(req), printable: PRINTABLE, trial: TRIAL });
      if (m === 'POST') {
        let code = null;
        const askCode = q.get('code');
        if (askCode) {
          const c = store.checkCode(askCode);
          if (!c.ok) { req.resume(); return fail(res, 409, c.reason); }
          code = c.code;
        }
        if (BLOB) {
          if (!code) { req.resume(); return fail(res, 400, 'Missing link name.'); }
          const up = await takeBlobUpload(req, res, code, 1); if (!up) return;
          const b = up.body;
          const doc = await store.create({ title: b.title, brand: b.brand, category: b.category, code, size: up.size, name: b.name, pages: num(b.pages), url: up.url, pathname: up.pathname });
          return send(res, 201, teamDoc(req, doc));
        }
        const up = await takeUpload(req, res); if (!up) return;
        if (code && store.taken(code)) { await fs.rm(up.tmp, { force: true }); return fail(res, 409, 'That name was just taken by another upload. Choose another.'); }
        const doc = await store.create({ title: q.get('title'), brand: q.get('brand'), category: q.get('category'), code, tmp: up.tmp, size: up.size, name: q.get('name'), pages: num(q.get('pages')) });
        return send(res, 201, teamDoc(req, doc));
      }
      return fail(res, 405, 'Not allowed');
    }

    const doc = store.get(parts[2]);
    if (!doc) { req.resume(); return fail(res, 404, 'No document has this code.'); }

    if (!parts[3]) {
      if (m === 'GET') return send(res, 200, teamDoc(req, doc));
      if (m === 'PATCH') {
        let patch;
        try { patch = await readJsonBody(req); } catch { return fail(res, 400, 'Bad request'); }
        return send(res, 200, teamDoc(req, await store.update(doc, patch)));
      }
      if (m === 'DELETE') {
        if (doc.status !== 'archived') return fail(res, 409, 'Archive the document first, then delete it.');
        await store.remove(doc);
        return send(res, 200, { ok: true });
      }
      return fail(res, 405, 'Not allowed');
    }

    if (parts[3] === 'versions' && !parts[4] && m === 'POST') {
      if (BLOB) {
        const up = await takeBlobUpload(req, res, doc.code, store.nextVersion(doc)); if (!up) return;
        return send(res, 201, teamDoc(req, await store.addVersion(doc, { size: up.size, name: up.body.name, pages: num(up.body.pages), url: up.url, pathname: up.pathname })));
      }
      const up = await takeUpload(req, res); if (!up) return;
      return send(res, 201, teamDoc(req, await store.addVersion(doc, { tmp: up.tmp, size: up.size, name: q.get('name'), pages: num(q.get('pages')) })));
    }

    if (parts[3] === 'versions' && parts[4] && (parts[5] === 'cover' || parts[5] === 'thumb') && m === 'PUT') {
      const v = num(parts[4]), small = parts[5] === 'thumb';
      const type = (req.headers['content-type'] || '').split(';')[0].trim();
      const ext = type === 'image/webp' ? 'webp' : type === 'image/jpeg' ? 'jpg' : null;
      if (!ext || !v) { req.resume(); return fail(res, 415, 'Cover must be a JPEG or WebP picture.'); }
      let buf;
      try { buf = await readSmallBody(req, (small ? 1 : 4) * 1024 * 1024); } catch { return fail(res, 413, 'Cover picture too big'); }
      const ver = small ? await store.setThumb(doc, v, ext, buf, num(q.get('w')), num(q.get('h')))
        : await store.setCover(doc, v, ext, buf, num(q.get('w')), num(q.get('h')));
      if (!ver) return fail(res, 404, 'No such version');
      return send(res, 200, teamDoc(req, doc));
    }

    return fail(res, 404, 'Unknown address');
  }

  // ---------- the router ----------
  // the public address is https: a visit that came in over plain http is sent to the https address, and browsers are
  // told to always use https from now on (the proxy in front says which one it was)
  const HTTPS_SITE = /^https:/i.test(PUBLIC_URL);
  async function handle(req, res) {
    try {
      const proto = TRUST_PROXY ? String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() : '';
      if (HTTPS_SITE && proto === 'http' && (req.method === 'GET' || req.method === 'HEAD')) {
        res.writeHead(301, { Location: PUBLIC_URL + req.url, 'Cache-Control': 'no-cache' }); return res.end();
      }
      if (proto === 'https') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
      const url = new URL(req.url, 'http://x');
      // on Vercel, the rewrite passes the original address in ?__p=
      const orig = url.searchParams.get('__p');
      if (orig) { url.pathname = orig; url.searchParams.delete('__p'); }
      const path = url.pathname;
      const parts = path.split('/').filter(Boolean);
      const dynamic = ['api', 'c', 'f', 'cover'].includes(parts[0]);
      if (dynamic && storageReady()) await store.refresh(parts[0] === 'api' ? 1000 : 15000);

      if (parts[0] === 'api') return await api(req, res, url, parts);

      // /c/<code>  - the address inside every QR code. Never change this route.
      if (parts[0] === 'c' && parts[1] && parts.length === 2 && (req.method === 'GET' || req.method === 'HEAD')) {
        return await serveView(req, res, decodeURIComponent(parts[1]).toLowerCase());
      }

      // /f/<code>/latest  - always the newest PDF (a permanent direct link to the file)
      // /f/<code>/<v>/<name>.pdf  - one exact version
      if (parts[0] === 'f' && parts[1] && (req.method === 'GET' || req.method === 'HEAD')) {
        const doc = store.get(decodeURIComponent(parts[1]));
        if (!doc || doc.status !== 'live') return fail(res, 404, 'This document is not available.');
        const dl = url.searchParams.has('dl');
        if (parts[2] === 'latest') {
          const p = publicDoc(doc);
          if (p.waiting) return p.sourceUrl ? redirect(res, p.sourceUrl) : fail(res, 404, 'This catalogue has no PDF yet.');
          return redirect(res, dl ? p.download : p.file);
        }
        const v = num(parts[2]);
        const ver = doc.versions.find((x) => x.v === v);
        if (!ver) return fail(res, 404, 'No such version');
        if (BLOB) return redirect(res, ver.url + (dl ? '?download=1' : ''));
        const name = cleanFileName(ver.name).replace(/[^\x20-\x7e]/g, '_');
        const disp = `${dl ? 'attachment' : 'inline'}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(ver.name)}`;
        return await sendFile(req, res, store.filePath(doc.code, v), 'application/pdf', { immutable: true, disposition: disp });
      }

      // /cover/<code>/<v>.<ext>  (the cover)   /cover/<code>/<v>-t.<ext>  (its small copy)
      if (parts[0] === 'cover' && parts[1] && parts[2]) {
        const doc = store.get(decodeURIComponent(parts[1]));
        const mm = /^(\d+)(-t)?\.(jpg|webp)$/.exec(parts[2]);
        if (!doc || !mm) return fail(res, 404, 'Not found');
        const which = mm[2] ? 'thumb' : 'cover';
        if (BLOB) { const ver = doc.versions.find((x) => x.v === Number(mm[1])); return ver?.[which]?.url ? redirect(res, ver[which].url) : fail(res, 404, 'Not found'); }
        return await sendFile(req, res, store.coverPath(doc.code, Number(mm[1]), mm[3], mm[2] || ''), MIME['.' + mm[3]], { immutable: true });
      }

      // a private test folder, only ever on this computer
      const fromHere = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress);
      if (parts[0] === '__samples' && !PRINTABLE && !TRIAL && fromHere && existsSync(join(ROOT, 'samples'))) {
        const full = resolve(ROOT, 'samples', decodeURIComponent(parts.slice(1).join('/')));
        if (!full.startsWith(join(ROOT, 'samples') + sep)) return fail(res, 404, 'Not found');
        return await sendFile(req, res, full, 'application/pdf');
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'Not allowed');
      // the front page: every catalogue. Links from the old catalog.jinharsh.com hub keep working:
      //   /?cat=<id>  -> that catalogue's page        /?qr=1 -> the front page (each card has its QR)
      if (path === '/' || path === '/index.html') {
        const cat = url.searchParams.get('cat');
        if (cat && /^[A-Za-z0-9-]{1,40}$/.test(cat)) return redirect(res, '/c/' + cat.toLowerCase());
        return await serveHub(req, res);
      }
      // the team screen
      if (path === '/team' || path === '/team/' || path === '/team.html') return await serveStatic(req, res, isTeam(req) ? '/team.html' : '/login.html');
      if (path === '/login.html') return redirect(res, '/team');
      return await serveStatic(req, res, path);
    } catch (e) {
      console.error(new Date().toISOString(), req.method, req.url, e);
      if (!res.headersSent) fail(res, 500, 'Something went wrong on the server.');
      else res.destroy();
    }
  }

  const describeAccess = () => auth.passwordSet ? 'Team screen: password protected.'
    : TRIAL ? 'Team screen: open (TRIAL copy: anyone with the address can upload).'
    : TEAM_OPEN ? 'Team screen: open to everyone who can reach this address (teamOpen; no password set).'
    : openAccess() ? 'Team screen: open (preview on this computer only; set a password with: npm run password)'
    : 'Team screen: LOCKED until a team password is set (npm run password)';

  return { handle, store, C, VERSION, describeAccess };
}
