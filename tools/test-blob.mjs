// Checks the Vercel TRIAL copy's storage logic without touching Vercel: a pretend Blob store in memory
// stands in for the real one; Vercel's own upload-permit code (handleUpload) is the real one.   Run: npm run test:trial
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.mjs';

let failed = 0, passed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok  ', what); } else { failed++; console.log('  FAIL', what); } };
const data = mkdtempSync(join(tmpdir(), 'jdocs-trial-'));

// ---- a pretend Vercel Blob store ----
const HOST = 'https://fakestore.public.blob.vercel-storage.com/';
const files = new Map();
let ops = 0;
const rand = () => Math.random().toString(36).slice(2, 10);
const fakeApi = {
  async put(pathname, body, o = {}) {
    ops++;
    if (o.addRandomSuffix) pathname = pathname.replace(/(\.[a-z0-9]+)$/i, `-${rand()}$1`);
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : await new Response(body).arrayBuffer());
    const e = { url: HOST + pathname, pathname, size: buf.length, contentType: o.contentType || '', uploadedAt: new Date(), body: buf };
    files.set(pathname, e);
    return { url: e.url, pathname, contentType: e.contentType };
  },
  async list(o = {}) { ops++; return { blobs: [...files.values()].filter((f) => f.pathname.startsWith(o.prefix || '')).map(({ body, ...x }) => x), hasMore: false }; },
  async head(pathname) { const f = files.get(pathname); if (!f) throw new Error('BlobNotFoundError'); const { body, ...x } = f; return x; },
  async del(urls) { for (const u of [].concat(urls)) files.delete(String(u).replace(HOST, '')); },
};
const fakeFetch = async (url, o = {}) => {
  const f = files.get(String(url).replace(HOST, '').split('?')[0]);
  if (!f) return new Response('not found', { status: 404 });
  const m = /bytes=(\d+)-(\d+)/.exec((o.headers && (o.headers.Range || o.headers.range)) || '');
  return new Response(m ? f.body.subarray(+m[1], +m[2] + 1) : f.body, { status: m ? 206 : 200 });
};
// what the browser does after getting a permit: put the file straight into the store
const browserUpload = (pathname, buf) => fakeApi.put(pathname, buf, { addRandomSuffix: true, contentType: 'application/pdf' });
const pdf = (w) => Buffer.from(`%PDF-1.4\n% ${w}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`, 'latin1');

const TOKEN = 'vercel_blob_rw_fakestore_' + 'x'.repeat(30);
const config = { STORAGE: 'blob', TRIAL: true, PRINTABLE: false, LOOPBACK: false, TEAM_OPEN: false, PUBLIC_URL: 'https://pdf-trial.vercel.app', DATA_DIR: data };
async function serve(token = TOKEN) {
  const app = await createApp({ config, blobApi: fakeApi, blobToken: token, fetch: fakeFetch });
  const srv = http.createServer(app.handle);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { app, srv, base: `http://127.0.0.1:${srv.address().port}` };
}
const J = async (r) => ({ status: r.status, body: await r.json().catch(() => null), headers: r.headers });
const post = (u, body) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const permit = (base, pathname) => post(`${base}/api/blob-upload`, { type: 'blob.generate-client-token', payload: { pathname, clientPayload: null, multipart: false } });

const A = await serve();
const B = A.base;
try {
  console.log('Trial copy basics');
  let r = await J(await fetch(`${B}/api/info`));
  ok(r.body.storage === 'blob' && r.body.storageReady === true, 'it uses the Vercel file storage');
  ok(r.body.trial === true && r.body.printable === false, 'it is marked as a trial: its QR codes are not for printing');
  ok(r.body.auth.open === true, 'the team page is open in the trial (no sign-in, as asked)');

  console.log('Upload permits');
  r = await J(await permit(B, 'docs/catalogue/v1.pdf'));
  ok(r.status === 200 && r.body.type === 'blob.generate-client-token' && r.body.clientToken, 'a permit is given for a new, free link name');
  r = await J(await permit(B, 'docs/api/v1.pdf'));
  ok(r.status === 400, 'no permit for a name the site keeps for itself');
  r = await J(await permit(B, 'other/place.pdf'));
  ok(r.status === 400, 'no permit for files outside the documents folder');

  console.log('Upload a PDF');
  let up = await browserUpload('docs/catalogue/v1.pdf', pdf('one'));
  r = await J(await post(`${B}/api/docs?code=catalogue`, { title: 'Test Catalogue', name: 'cat.pdf', pages: 2, pathname: up.pathname }));
  ok(r.status === 201 && r.body.code === 'catalogue', 'the uploaded PDF is listed under its link name');
  ok(r.body.link === 'https://pdf-trial.vercel.app/c/catalogue', 'its QR link is the trial address + /c/catalogue');
  ok(r.body.live.file.startsWith(HOST), 'the scan page reads the PDF straight from the file storage');
  r = await J(await permit(B, 'docs/catalogue/v1.pdf'));
  ok(r.status === 400, 'a link name already in use gets no permit');
  const bad = await browserUpload('docs/fake/v1.pdf', Buffer.from('hello, not a pdf'));
  r = await J(await post(`${B}/api/docs?code=fake`, { title: 'x', name: 'x.pdf', pathname: bad.pathname }));
  ok(r.status === 400 && !files.has(bad.pathname), 'a file that is not a real PDF is refused and removed');
  r = await J(await post(`${B}/api/docs?code=sneaky`, { title: 'x', name: 'x.pdf', pathname: up.pathname }));
  ok(r.status === 400, 'a document cannot point at another document\'s file');

  console.log('Cover, scan page, file links');
  const cov = await fetch(`${B}/api/docs/catalogue/versions/1/cover?w=720&h=1018`, { method: 'PUT', headers: { 'Content-Type': 'image/webp' }, body: Buffer.from('RIFFxxxxWEBP') });
  ok(cov.status === 200, 'the cover picture is saved in the file storage');
  let html = await (await fetch(`${B}/c/catalogue`)).text();
  ok(html.includes('Test Catalogue') && html.includes('"countsScans":false'), 'the scan page opens (opens are not counted in the trial)');
  ok(/og:image" content="https:\/\/fakestore/.test(html), 'the WhatsApp preview picture comes from the file storage');
  let f = await fetch(`${B}/f/catalogue/latest?dl=1`, { redirect: 'manual' });
  ok(f.status === 302 && f.headers.get('location').startsWith(HOST) && f.headers.get('location').endsWith('?download=1'), '/f/catalogue/latest sends people to the newest file');

  console.log('Replace the PDF');
  r = await J(await permit(B, 'docs/catalogue/v3.pdf'));
  ok(r.status === 400, 'no permit for a version number that is out of order');
  r = await J(await permit(B, 'docs/catalogue/v2.pdf'));
  ok(r.status === 200, 'a permit for the next version');
  up = await browserUpload('docs/catalogue/v2.pdf', pdf('two'));
  r = await J(await post(`${B}/api/docs/catalogue/versions`, { name: 'cat-v2.pdf', pages: 3, pathname: up.pathname }));
  ok(r.status === 201 && r.body.current === 2 && r.body.link === 'https://pdf-trial.vercel.app/c/catalogue', 'version 2 is shown, SAME LINK AND QR');

  console.log('Another copy of the program sees the same list');
  const A2 = await serve();
  r = await J(await fetch(`${A2.base}/api/docs/catalogue`));
  ok(r.status === 200 && r.body.current === 2 && r.body.versions.length === 2, 'a second copy (Vercel runs several) reads the newest list');
  await J(await fetch(`${A2.base}/api/docs/catalogue`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"title":"Renamed in copy 2"}' }));
  await new Promise((res) => setTimeout(res, 1100));
  r = await J(await fetch(`${B}/api/docs/catalogue`));
  ok(r.body.title === 'Renamed in copy 2', 'a change made by one copy is seen by the other within a second');
  A2.srv.close();
  const lists = [...files.keys()].filter((k) => k.startsWith('db/'));
  ok(lists.length <= 10, `old copies of the list are tidied up (${lists.length} kept)`);

  console.log('Archive and delete');
  await J(await fetch(`${B}/api/docs/catalogue`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"status":"archived"}' }));
  r = await J(await fetch(`${B}/api/docs/catalogue`, { method: 'DELETE' }));
  ok(r.status === 200 && ![...files.keys()].some((k) => k.startsWith('docs/catalogue/')), 'deleting removes every file of that document from the storage');
  page: {
    const p = await fetch(`${B}/c/catalogue`);
    ok(p.status === 404 && (await p.text()).includes('"status":"retired"'), 'its old QR opens the polite "no longer available" page');
  }
  r = await J(await permit(B, 'docs/catalogue/v1.pdf'));
  ok(r.status === 400, 'a deleted link name is never given out again');

  console.log('Storage not connected yet');
  const N = await serve('');
  r = await J(await fetch(`${N.base}/api/info`));
  ok(r.body.storageReady === false, 'the page can tell the storage is not connected');
  r = await J(await fetch(`${N.base}/api/docs`));
  ok(r.status === 503 && /Blob/.test(r.body.error), 'uploads explain how to connect the storage in Vercel');
  N.srv.close();
} catch (e) {
  failed++; console.error(e);
} finally {
  A.srv.close();
  rmSync(data, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
