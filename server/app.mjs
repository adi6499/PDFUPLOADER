// Jinharsh Docs - the program itself: every address the site answers.
// It runs in two places with the same rules:
//   - the company server (and this computer): files on the server's own disk      -> server/server.mjs
//   - a hosted trial copy on Vercel: files in Vercel's Blob store                -> api/index.js
import { promises as fs, createReadStream, existsSync } from 'node:fs';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { join, resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store, receiveFile, readSmallBody, cleanFileName } from './store.mjs';
import { BlobStore } from './blobstore.mjs';
import { ROOT, readJson, loadConfig } from './config.mjs';
import { Auth, readCookie, COOKIE } from './auth.mjs';
import { Activity, EVENT_TYPES, istParts, phaseOf, cleanVisitor, cleanDevice, cleanSource, clip, newId, toCsv } from './activity.mjs';

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
  const { cfg, PUBLIC_URL, DATA_DIR, MAX_UPLOAD, TRUST_PROXY, PRINTABLE, LOOPBACK, STORAGE, TRIAL, TEAM_OPEN, INQUIRY_FORWARD } = C;
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
  // visits, downloads and queries (see activity.mjs); on the trial copy there is no disk for them
  const activity = new Activity({ dir: BLOB ? null : DATA_DIR, store });

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
    "default-src 'self'", `img-src 'self' data: blob: https://i.ytimg.com${BLOB ? ' ' + BLOB_HOSTS : ''}`,
    "frame-src https://www.youtube-nocookie.com https://player.vimeo.com", "style-src 'self' 'unsafe-inline'", "font-src 'self' data: blob:",
    "script-src 'self' 'wasm-unsafe-eval'", "worker-src 'self' blob:", `connect-src 'self'${BLOB ? ' ' + BLOB_HOSTS + ' https://vercel.com' : ''}`, "object-src 'none'",
    "base-uri 'none'", "frame-ancestors 'self'", "form-action 'self'",
  ].join('; ');

  function publicDoc(doc) {
    const basics = { code: doc.code, title: doc.title, note: doc.note || '', brand: doc.brand || '', category: doc.category || '', status: doc.status, media: doc.media || [] };
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
  // ---------- visitors ----------
  const exhibition = () => store.db.settings?.exhibition || null;
  // the city and country, when the host in front of us adds them (Vercel, Cloudflare); otherwise left empty
  function placeOf(req) {
    const h = req.headers, dec = (v) => { try { return decodeURIComponent(String(v || '')); } catch { return ''; } };
    if (C.ON_VERCEL) return { city: clip(dec(h['x-vercel-ip-city']), 60), country: clip(h['x-vercel-ip-country'], 4) };
    if (TRUST_PROXY) return { city: clip(dec(h['cf-ipcity']), 60), country: clip(h['cf-ipcountry'], 4) };
    return { city: '', country: '' };
  }
  function recordEvent(req, b) {
    const type = EVENT_TYPES.includes(b.type) ? b.type : null;
    if (!type) return;
    const doc = b.code ? store.get(String(b.code)) : null;
    if (b.code && !doc) return;
    if (type === 'visit' && doc && doc.status === 'live') store.countScan(doc);
    const t = istParts(), place = placeOf(req);
    activity.add({ id: newId(), at: new Date().toISOString(), time: t.time, day: t.day, hour: t.hour, phase: phaseOf(exhibition(), t.day), type,
      code: doc ? doc.code : '', title: doc ? doc.title : '', brand: doc ? doc.brand || '' : '',
      device: cleanDevice(b.device), source: cleanSource(b.source), city: place.city, country: place.country,
      visitor: cleanVisitor(b.visitor),
      // someone signed in to the team page (not just the open office copy) is left out of the numbers
      team: auth.passwordSet && !!auth.checkToken(readCookie(req, COOKIE)) || undefined });
  }
  // a copy of each query to the company's Odoo bridge (same fields Mitul's hub sends); never holds the visitor up
  function forwardInquiry(q) {
    if (!INQUIRY_FORWARD) return;
    let host = '';
    try { host = new URL(PUBLIC_URL).hostname; } catch {}
    const body = JSON.stringify({ name: q.name, email: q.email, phone: q.phone, company: q.company,
      message: (q.title ? `[Catalogue: ${q.title}] ` : '') + q.message, source_domain: host, product_category: q.brand || 'Catalogues' });
    (overrides.forwardFetch || fetch)(INQUIRY_FORWARD, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(5000) }).catch(() => {});
  }
  // a few requests a minute per address at most (stops robots filling the files)
  const hits = new Map();
  function tooMany(req, kind, max, windowMs) {
    const key = kind + ' ' + clientIp(req), now = Date.now();
    let h = hits.get(key);
    if (!h || now > h.until) { h = { n: 0, until: now + windowMs }; hits.set(key, h); }
    h.n++;
    if (hits.size > 5000) for (const [k, v] of hits) if (now > v.until) hits.delete(k);
    return h.n > max;
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
    if (/^\/vendor\/fonts\//.test(rel)) return sendFile(req, res, full, type, { immutable: true }); // a changed font gets a new file name
    return sendFile(req, res, full, type, { maxAge: /^\/vendor\/pdfjs\//.test(rel) ? 604800 : 0 });
  }

  // ---------- the front page: / ----------
  let hubTemplate = null, markup = null, markupAt = 0;
  // The cards, brand buttons and count line, made by the same code the page itself uses (public/js/markup.js), so
  // they are on screen at the first paint instead of being built by the phone afterwards. If anything goes wrong
  // the page is sent without them and draws them itself, as before.
  async function hubParts(list) {
    try {
      const file = join(PUBLIC, 'js', 'markup.js');
      const at = cfg.dev ? (await fs.stat(file)).mtimeMs : 0;   // (while developing, a changed file is read again)
      if (!markup || at !== markupAt) { markup = await import(pathToFileURL(file).href + (at ? '?m=' + at : '')); markupAt = at; }
      const sorted = markup.sortCatalogs(list.slice());
      const brands = markup.brandsOf(sorted);
      return { eyebrow: markup.esc(markup.hubEyebrow(sorted, brands)), chips: markup.chipsHtml(brands), cards: sorted.map(markup.cardHtml).join('') };
    } catch (e) {
      console.error('front page cards could not be made here (the page will draw them):', e && e.message);
      return null;
    }
  }
  async function serveHub(req, res) {
    if (!hubTemplate || cfg.dev) hubTemplate = await fs.readFile(join(PUBLIC, 'index.html'), 'utf8');
    const list = store.list().filter((d) => d.status === 'live').map(publicDoc);
    // the same order the page shows: catalogues with a PDF first, newest first
    const first = list.filter((d) => !d.waiting && d.cover).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 2);
    const preload = first.map((d) => `<link rel="preload" as="image" href="${esc(d.thumb || d.cover)}">`).join('\n  ');
    const data = JSON.stringify({ catalogs: list, publicUrl: base(req), site: SITE, printable: PRINTABLE }).replace(/</g, '\\u003c');
    let html = hubTemplate.replace('<!--PRELOAD-->', () => preload).replace('<!--DATA-->', () => `<script type="application/json" id="boot">${data}</script>`);
    const parts = list.length ? await hubParts(list) : null;
    const EYEBROW = '<div class="ju-eyebrow" id="hubEyebrow">Jinharsh Industrial Solutions</div>';
    const CHIPS = '<div class="chips" id="chips" role="group" aria-label="Brands"></div>';
    const CARDS = '<section class="cards" id="cards" aria-live="polite"></section>';
    if (parts && html.includes(EYEBROW) && html.includes(CHIPS) && html.includes(CARDS)) {
      html = html.replace(EYEBROW, () => EYEBROW.replace('Jinharsh Industrial Solutions', parts.eyebrow))
        .replace(CHIPS, () => CHIPS.replace('></div>', `>${parts.chips}</div>`))
        .replace(CARDS, () => `<section class="cards ju-enter" id="cards" aria-live="polite" data-ready>${parts.cards}</section>`);
    }
    sendPacked(req, res, 200, html, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP, 'Cache-Control': 'no-cache' });
  }

  // ---------- the scan page: /c/<code> ----------
  let viewTemplate = null;
  async function serveView(req, res, code) {
    if (!viewTemplate || cfg.dev) viewTemplate = await fs.readFile(join(PUBLIC, 'view.html'), 'utf8');
    const doc = store.get(code);
    const B = base(req);
    let state, meta, hero = '';
    // the other catalogues, for the "More catalogues" list under each one
    const others = store.list().filter((d) => d.status === 'live' && d.code !== code).map(publicDoc).filter((p) => !p.waiting)
      .slice(0, 24).map((p) => ({ code: p.code, title: p.title, brand: p.brand, cover: p.cover, thumb: p.thumb, coverW: p.coverW, coverH: p.coverH, pages: p.pages }));
    const menu = store.list().filter((d) => d.status === 'live').map(publicDoc)
      .map((p) => ({ code: p.code, title: p.title, brand: p.brand, category: p.category, thumb: p.thumb || p.cover, waiting: !!p.waiting, link: !!p.waiting && !!p.sourceUrl && !/\.pdf(\?|#|$)/i.test(p.sourceUrl) }));
    if (doc && doc.status === 'live') {
      const p = publicDoc(doc);
      state = { status: p.waiting ? 'waiting' : 'live', doc: p, countsScans: !BLOB, others, menu };
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
      // the cover comes in the page itself, so it is on screen before any script has run (view.js keeps this same picture)
      if (p.cover && !p.waiting) hero = `<section class="v-hero"><div class="v-cover"><img src="${esc(p.cover)}" alt="Cover of ${esc(p.title)}" width="${p.coverW || 720}" height="${p.coverH || 1018}" fetchpriority="high" style="view-transition-name:cover-${esc(p.code)}"></div></section>`;
    } else {
      state = { status: doc ? 'archived' : store.isRetired(code) ? 'retired' : 'missing', doc: doc ? { title: doc.title, code: doc.code } : null, others, menu };
      meta = `<title>${esc(SITE.company?.short || 'Jinharsh')}</title>\n  <meta name="robots" content="noindex">`;
    }
    const data = JSON.stringify({ ...state, site: SITE, publicUrl: B, printable: PRINTABLE }).replace(/</g, '\\u003c');
    // (functions, so a $ in a title is never read as a replacement pattern)
    const html = viewTemplate.replace('<!--META-->', () => meta).replace('<!--HERO-->', () => hero)
      .replace('<!--DATA-->', () => `<script type="application/json" id="boot">${data}</script>`);
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

  // who is on the site right now: page id -> { c: catalogue code ('' = front page), t: when it last said so }
  const presence = (() => {
    const seen = new Map();
    const prune = () => { const t = Date.now(); for (const [k, v] of seen) if (t - v.t > 75000) seen.delete(k); };
    return {
      touch(id, code, leave) { prune(); if (leave) seen.delete(id); else if (seen.size < 5000 || seen.has(id)) seen.set(id, { c: code, t: Date.now() }); },
      counts() { prune(); const cats = {}; for (const v of seen.values()) if (v.c) cats[v.c] = (cats[v.c] || 0) + 1; return { ok: true, total: seen.size, cats }; },
    };
  })();

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

    // public: what visitors do (a visit to a catalogue also counts as a scan, as before)
    if (parts[1] === 'track' && m === 'POST') {
      if (tooMany(req, 'track', 120, 60000)) req.resume();
      else { let b = {}; try { b = await readJsonBody(req, 8192); } catch {} recordEvent(req, b); }
      res.writeHead(204, { 'Cache-Control': 'no-store' }); return res.end();
    }
    // public: "I am on this page" (public/js/live.js), about every 30 s from each open page. Only the team sees the
    // counts (with the insights below); a visitor gets back just "ok". Nothing is written down: 75 seconds in memory.
    if (parts[1] === 'ping' && m === 'POST') {
      if (tooMany(req, 'ping', 20, 60000)) { req.resume(); return send(res, 200, { ok: true }, { 'Cache-Control': 'no-store' }); }
      let b = {}; try { b = await readJsonBody(req, 1024); } catch {}
      presence.touch(String(b.id || clientIp(req)).slice(0, 40), String(b.code || '').slice(0, 120), !!b.leave);
      return send(res, 200, { ok: true }, { 'Cache-Control': 'no-store' });
    }
    // public: a visitor's question about a product. Saved here, and a copy goes to the company's Odoo bridge if set.
    if (parts[1] === 'inquiry' && m === 'POST') {
      if (tooMany(req, 'inquiry', 6, 10 * 60000)) { req.resume(); return fail(res, 429, 'Too many messages from here. Please try again in a few minutes, or call us.'); }
      let b;
      try { b = await readJsonBody(req, 16384); } catch { return fail(res, 400, 'The message could not be read.'); }
      if (b.website) return send(res, 201, { ok: true }); // the hidden field only robots fill in
      const v = cleanVisitor(b) || {};
      const message = clip(b.message, 2000);
      if (!v.name || (!v.email && !v.phone)) return fail(res, 400, 'Please give your name and an email address or phone number.');
      const doc = b.code ? store.get(String(b.code)) : null;
      const t = istParts(), place = placeOf(req);
      const q = { id: newId(), at: new Date().toISOString(), time: t.time, day: t.day, phase: phaseOf(exhibition(), t.day),
        name: v.name, email: v.email || '', phone: v.phone || '', company: v.company || '', message,
        code: doc ? doc.code : '', title: doc ? doc.title : '', brand: doc ? doc.brand || '' : '',
        device: cleanDevice(b.device), source: cleanSource(b.source), city: place.city, country: place.country };
      await activity.addInquiry(q);
      recordEvent(req, { type: 'query', code: q.code, device: b.device, source: b.source, visitor: v });
      forwardInquiry(q);
      return send(res, 201, { ok: true });
    }

    // public: count one scan (sent by the scan page after it opens; link previews by chat apps don't run it)
    if (parts[1] === 'p' && parts[2] && parts[3] === 'scan' && m === 'POST') {
      const doc = store.get(parts[2]);
      if (doc && doc.status === 'live') store.countScan(doc);
      res.writeHead(204, { 'Cache-Control': 'no-store' }); return res.end();
    }

    // ---- below: the team's own screens ----
    if (!['check-code', 'docs', 'blob-upload', 'insights', 'settings'].includes(parts[1])) return fail(res, 404, 'Unknown address');
    if (!isTeam(req)) { req.resume(); return fail(res, 401, 'Please sign in.'); }
    if (!storageReady()) { req.resume(); return fail(res, 503, 'The trial copy has no file storage connected yet. In Vercel: project → Storage → connect a Blob store, then redeploy.'); }

    // the team's visitor numbers, the queries, and the Excel (CSV) copies of both
    if (parts[1] === 'insights' && m === 'GET') {
      const stamp = istParts().day;
      if (parts[2] === 'visits.csv') {
        return activity.visitsCsv(res, [['Time (India)', (e) => e.time], ['What', (e) => e.type], ['Catalogue', (e) => e.title], ['Brand', (e) => e.brand],
          ['Exhibition', (e) => e.phase], ['Device', (e) => e.device], ['Came from', (e) => e.source], ['Place', (e) => [e.city, e.country].filter(Boolean).join(', ')],
          ['Name', (e) => e.visitor?.name], ['Email', (e) => e.visitor?.email], ['Company', (e) => e.visitor?.company], ['Phone', (e) => e.visitor?.phone]],
        { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="catalogue-visits-${stamp}.csv"` });
      }
      if (parts[2] === 'queries.csv') {
        const inquiries = await activity.inquiries(100000);
        return send(res, 200, toCsv(inquiries, [['Time (India)', (q) => q.time], ['Name', (q) => q.name], ['Company', (q) => q.company], ['Email', (q) => q.email],
          ['Phone', (q) => q.phone], ['Catalogue', (q) => q.title], ['Brand', (q) => q.brand], ['Message', (q) => q.message], ['Exhibition', (q) => q.phase],
          ['Device', (q) => q.device], ['Came from', (q) => q.source], ['Place', (q) => [q.city, q.country].filter(Boolean).join(', ')]]),
        { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="catalogue-queries-${stamp}.csv"` });
      }
      const got = await activity.insights(exhibition(), store.list());
      return send(res, 200, { summary: got.summary, events: got.recent, inquiries: got.inquiries,
        exhibition: exhibition(), keepsVisits: !BLOB, forwards: !!INQUIRY_FORWARD, live: presence.counts() });
    }
    // the exhibition: its name and first and last day (visits are then marked before / during / after)
    if (parts[1] === 'settings' && m === 'PUT') {
      const b = await readJsonBody(req);
      const e = b.exhibition || {};
      const okDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
      let ex = null;
      if (e.name || e.start || e.end) {
        if (!okDay(e.start) || !okDay(e.end) || e.start > e.end) return fail(res, 400, 'Please give the first and last day of the exhibition (the last day can\'t be before the first).');
        ex = { name: clip(e.name, 80) || 'Exhibition', start: e.start, end: e.end };
      }
      store.db.settings = { ...(store.db.settings || {}), exhibition: ex };
      await store.save();
      return send(res, 200, { exhibition: ex });
    }

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
