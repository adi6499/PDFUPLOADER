// Jinharsh Docs - the web server.
// Upload a PDF, get a permanent link + QR code. Replace the PDF any time; the link and QR never change.
//
//   npm start            -> http://localhost:8180
//
// Settings: config.json (shared), config.local.json (this computer only, not in git), or environment variables
//   PORT, HOST, PUBLIC_URL (the address printed inside every QR code), DATA_DIR, MAX_UPLOAD_MB, TRUST_PROXY
import http from 'node:http';
import { promises as fs, createReadStream, existsSync } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';
import { Store, receiveFile, readSmallBody, cleanFileName } from './store.mjs';
import { ROOT, readJson, loadConfig } from './config.mjs';
import { Auth, readCookie, COOKIE } from './auth.mjs';

const PUBLIC = join(ROOT, 'public');
const { cfg, PORT, HOST, PUBLIC_URL, DATA_DIR, MAX_UPLOAD, TRUST_PROXY, PRINTABLE, LOOPBACK } = loadConfig();
const SITE = readJson(join(ROOT, 'site.json'));
const VERSION = readJson(join(ROOT, 'package.json')).version || '0';
const SECURE = PUBLIC_URL.startsWith('https://');
const auth = new Auth(DATA_DIR);

// Who may use the team screen:
//  - with a team password set: only people who signed in with it
//  - with no password yet: only on a preview address on this computer (nobody else can reach it);
//    on a real address the team screen stays locked until a password is set (npm run password)
const openPreview = () => !auth.passwordSet && !PRINTABLE && LOOPBACK;
const isTeam = (req) => openPreview() || auth.checkToken(readCookie(req, COOKIE));
const clientIp = (req) => (TRUST_PROXY && (String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.headers['x-real-ip'])) || req.socket.remoteAddress || '?';
// changes may only come from our own pages (a second guard next to the SameSite cookie)
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { const u = new URL(o); return u.host === req.headers.host || u.origin === new URL(PUBLIC_URL).origin; } catch { return false; }
}

const store = new Store(DATA_DIR);

// ---------- small helpers ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.icc': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};
const CSP = [
  "default-src 'self'", "img-src 'self' data: blob:", "style-src 'self' 'unsafe-inline'", "font-src 'self' data: blob:",
  "script-src 'self' 'wasm-unsafe-eval'", "worker-src 'self' blob:", "connect-src 'self'", "object-src 'none'",
  "base-uri 'none'", "frame-ancestors 'self'", "form-action 'self'",
].join('; ');

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

function publicDoc(doc) {
  const v = doc.versions.find((x) => x.v === doc.current) || doc.versions[doc.versions.length - 1];
  return {
    code: doc.code, title: doc.title, note: doc.note, status: doc.status, updatedAt: v.uploadedAt,
    version: v.v, pages: v.pages, size: v.size, name: v.name,
    file: `/f/${doc.code}/${v.v}/${encodeURIComponent(v.name)}`,
    cover: v.cover ? `/cover/${doc.code}/${v.v}.${v.cover.ext}` : null,
    coverW: v.cover?.w || null, coverH: v.cover?.h || null,
  };
}
function teamDoc(doc) {
  return { ...doc, link: `${PUBLIC_URL}/c/${doc.code}`, live: publicDoc(doc) };
}

async function sendFile(req, res, path, type, { immutable = false, disposition = null, maxAge = 0 } = {}) {
  let st;
  try { st = await fs.stat(path); } catch { return fail(res, 404, 'Not found'); }
  if (!st.isFile()) return fail(res, 404, 'Not found');
  const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  const headers = {
    'Content-Type': type, 'Accept-Ranges': 'bytes', ETag: etag, 'Last-Modified': st.mtime.toUTCString(),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : maxAge ? `public, max-age=${maxAge}` : 'no-cache',
  };
  if (disposition) headers['Content-Disposition'] = disposition;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }

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
  const isHtml = type.startsWith('text/html');
  if (isHtml) res.setHeader('Content-Security-Policy', CSP);
  return sendFile(req, res, full, type, { maxAge: rel.startsWith('/vendor/') ? 604800 : 0 });
}

// ---------- the scan page: /c/<code> ----------
let viewTemplate = null;
async function serveView(req, res, code) {
  if (!viewTemplate || cfg.dev) viewTemplate = await fs.readFile(join(PUBLIC, 'view.html'), 'utf8');
  const doc = store.get(code);
  let state, meta;
  if (doc && doc.status === 'live') {
    const p = publicDoc(doc);
    state = { status: 'live', doc: p };
    const desc = [p.pages ? p.pages + ' pages' : null, 'PDF', SITE.company?.short || 'Jinharsh'].filter(Boolean).join(' · ');
    meta = [
      `<title>${esc(p.title)} · ${esc(SITE.company?.short || 'Jinharsh')}</title>`,
      `<meta name="description" content="${esc(desc)}">`,
      `<meta property="og:type" content="website">`,
      `<meta property="og:title" content="${esc(p.title)}">`,
      `<meta property="og:description" content="${esc(desc)}">`,
      `<meta property="og:url" content="${esc(PUBLIC_URL + '/c/' + doc.code)}">`,
      `<meta property="og:site_name" content="${esc(SITE.company?.name || 'Jinharsh')}">`,
      p.cover ? `<meta property="og:image" content="${esc(PUBLIC_URL + p.cover)}">` : '',
      p.cover ? `<meta name="twitter:card" content="summary_large_image">` : '',
    ].join('\n  ');
  } else {
    state = { status: doc ? 'archived' : store.isRetired(code) ? 'retired' : 'missing', doc: doc ? { title: doc.title, code: doc.code } : null };
    meta = `<title>${esc(SITE.company?.short || 'Jinharsh')}</title>\n  <meta name="robots" content="noindex">`;
  }
  const data = JSON.stringify({ ...state, site: SITE }).replace(/</g, '\\u003c');
  const html = viewTemplate.replace('<!--META-->', meta).replace('<!--DATA-->', `<script type="application/json" id="boot">${data}</script>`);
  send(res, doc ? 200 : 404, html, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP, 'Cache-Control': 'no-cache' });
}

// ---------- team API ----------
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : null; };

async function takeUpload(req, res) {
  const type = (req.headers['content-type'] || '').split(';')[0].trim();
  if (type !== 'application/pdf') { fail(res, 415, 'Only PDF files can be uploaded.'); return null; }
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

async function api(req, res, url, parts) {
  const m = req.method;
  const q = url.searchParams;

  if (parts[1] === 'info' && m === 'GET') {
    return send(res, 200, {
      publicUrl: PUBLIC_URL, printable: PRINTABLE, maxUploadMB: MAX_UPLOAD / 1048576, version: VERSION, site: SITE,
      auth: { passwordSet: auth.passwordSet, open: openPreview(), signedIn: isTeam(req) },
    });
  }
  if (parts[1] === 'health') return send(res, 200, { ok: true, version: VERSION });

  if (m !== 'GET' && m !== 'HEAD' && !sameOrigin(req)) { req.resume(); return fail(res, 403, 'Not allowed from another website.'); }

  if (parts[1] === 'login' && m === 'POST') {
    const ip = clientIp(req);
    if (auth.blocked(ip)) { req.resume(); return fail(res, 429, 'Too many wrong tries. Please wait 15 minutes and try again.'); }
    if (!auth.passwordSet) { req.resume(); return fail(res, 409, 'No team password has been set on the server yet.'); }
    let body = {};
    try { body = JSON.parse((await readSmallBody(req, 4096)).toString('utf8') || '{}'); } catch {}
    if (!auth.verify(body.password)) {
      auth.failed(ip);
      return fail(res, 401, auth.blocked(ip) ? 'Too many wrong tries. Please wait 15 minutes and try again.' : 'That password is not right.');
    }
    auth.succeeded(ip);
    return send(res, 200, { ok: true }, { 'Set-Cookie': auth.cookie(SECURE) });
  }
  if (parts[1] === 'logout' && m === 'POST') return send(res, 200, { ok: true }, { 'Set-Cookie': Auth.clearCookie(SECURE) });

  if (parts[1] === 'check-code' && m === 'GET') {
    if (!isTeam(req)) return fail(res, 401, 'Please sign in.');
    if (q.has('suggest')) return send(res, 200, { ok: true, code: store.newCode() });
    return send(res, 200, store.checkCode(q.get('code')));
  }

  // public: count one scan (sent by the scan page after it opens; link previews by chat apps don't run it)
  if (parts[1] === 'p' && parts[2] && parts[3] === 'scan' && m === 'POST') {
    const doc = store.get(parts[2]);
    if (doc && doc.status === 'live') store.countScan(doc);
    res.writeHead(204, { 'Cache-Control': 'no-store' }); return res.end();
  }

  if (parts[1] !== 'docs') return fail(res, 404, 'Unknown address');

  // ---- below: the team's own screens ----
  if (!isTeam(req)) { req.resume(); return fail(res, 401, 'Please sign in.'); }
  if (!parts[2]) {
    if (m === 'GET') return send(res, 200, { docs: store.list().map(teamDoc), publicUrl: PUBLIC_URL, printable: PRINTABLE });
    if (m === 'POST') {
      let code = null;
      if (q.get('code')) {
        const c = store.checkCode(q.get('code'));
        if (!c.ok) { req.resume(); return fail(res, 409, c.reason); }
        code = c.code;
      }
      const up = await takeUpload(req, res); if (!up) return;
      if (code && store.taken(code)) { await fs.rm(up.tmp, { force: true }); return fail(res, 409, 'That name was just taken by another upload. Choose another.'); }
      const doc = await store.create({ title: q.get('title'), code, tmp: up.tmp, size: up.size, name: q.get('name'), pages: num(q.get('pages')) });
      return send(res, 201, teamDoc(doc));
    }
    return fail(res, 405, 'Not allowed');
  }

  const doc = store.get(parts[2]);
  if (!doc) { req.resume(); return fail(res, 404, 'No document has this code.'); }

  if (!parts[3]) {
    if (m === 'GET') return send(res, 200, teamDoc(doc));
    if (m === 'PATCH') {
      let patch;
      try { patch = JSON.parse((await readSmallBody(req, 64 * 1024)).toString('utf8') || '{}'); } catch { return fail(res, 400, 'Bad request'); }
      return send(res, 200, teamDoc(await store.update(doc, patch)));
    }
    if (m === 'DELETE') {
      if (doc.status !== 'archived') return fail(res, 409, 'Archive the document first, then delete it.');
      await store.remove(doc);
      return send(res, 200, { ok: true });
    }
    return fail(res, 405, 'Not allowed');
  }

  if (parts[3] === 'versions' && !parts[4] && m === 'POST') {
    const up = await takeUpload(req, res); if (!up) return;
    return send(res, 201, teamDoc(await store.addVersion(doc, { tmp: up.tmp, size: up.size, name: q.get('name'), pages: num(q.get('pages')) })));
  }

  if (parts[3] === 'versions' && parts[4] && parts[5] === 'cover' && m === 'PUT') {
    const v = num(parts[4]);
    const type = (req.headers['content-type'] || '').split(';')[0].trim();
    const ext = type === 'image/webp' ? 'webp' : type === 'image/jpeg' ? 'jpg' : null;
    if (!ext || !v) { req.resume(); return fail(res, 415, 'Cover must be a JPEG or WebP picture.'); }
    let buf;
    try { buf = await readSmallBody(req, 4 * 1024 * 1024); } catch { return fail(res, 413, 'Cover picture too big'); }
    const ver = await store.setCover(doc, v, ext, buf, num(q.get('w')), num(q.get('h')));
    if (!ver) return fail(res, 404, 'No such version');
    return send(res, 200, teamDoc(doc));
  }

  return fail(res, 404, 'Unknown address');
}

// ---------- the router ----------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    const parts = path.split('/').filter(Boolean);

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
      if (parts[2] === 'latest') {
        const p = publicDoc(doc);
        res.writeHead(302, { Location: p.file + (url.searchParams.has('dl') ? '?dl=1' : ''), 'Cache-Control': 'no-cache' });
        return res.end();
      }
      const v = num(parts[2]);
      const ver = doc.versions.find((x) => x.v === v);
      if (!ver) return fail(res, 404, 'No such version');
      const name = cleanFileName(ver.name).replace(/[^\x20-\x7e]/g, '_');
      const disp = `${url.searchParams.has('dl') ? 'attachment' : 'inline'}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(ver.name)}`;
      return await sendFile(req, res, store.filePath(doc.code, v), 'application/pdf', { immutable: true, disposition: disp });
    }

    // /cover/<code>/<v>.<ext>
    if (parts[0] === 'cover' && parts[1] && parts[2]) {
      const doc = store.get(decodeURIComponent(parts[1]));
      const mm = /^(\d+)\.(jpg|webp)$/.exec(parts[2]);
      if (!doc || !mm) return fail(res, 404, 'Not found');
      return await sendFile(req, res, store.coverPath(doc.code, Number(mm[1]), mm[2]), MIME['.' + mm[2]], { immutable: true });
    }

    // a private test folder, only ever on this computer
    if (parts[0] === '__samples' && !PRINTABLE && existsSync(join(ROOT, 'samples'))) {
      const full = resolve(ROOT, 'samples', decodeURIComponent(parts.slice(1).join('/')));
      if (!full.startsWith(join(ROOT, 'samples') + sep)) return fail(res, 404, 'Not found');
      return await sendFile(req, res, full, 'application/pdf');
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'Not allowed');
    if (path === '/' || path === '/index.html') return await serveStatic(req, res, isTeam(req) ? '/index.html' : '/login.html');
    if (path === '/login.html') { res.writeHead(302, { Location: '/' }); return res.end(); }
    return await serveStatic(req, res, path);
  } catch (e) {
    console.error(new Date().toISOString(), req.method, req.url, e);
    if (!res.headersSent) fail(res, 500, 'Something went wrong on the server.');
    else res.destroy();
  }
});

server.requestTimeout = 15 * 60 * 1000; // big PDFs on slow connections
await store.load();
server.listen(PORT, HOST, () => {
  console.log(`Jinharsh Docs ${VERSION} running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`QR codes point to: ${PUBLIC_URL}${PRINTABLE ? '' : '   (preview address - do not print these QR codes)'}`);
  console.log(auth.passwordSet ? 'Team screen: password protected.' : openPreview() ? 'Team screen: open (preview on this computer only; set a password with: npm run password)' : 'Team screen: LOCKED until a team password is set (npm run password)');
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await store.flush().catch(() => {}); process.exit(0); });
