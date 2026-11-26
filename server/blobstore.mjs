// Storage for a hosted TRIAL copy on Vercel, where the program has no lasting disk of its own.
// Everything lives in a Vercel Blob store connected to the project (Vercel adds BLOB_READ_WRITE_TOKEN):
//   docs/<code>/v<N>.pdf      every version of every PDF (uploaded by the browser straight into the store)
//   docs/<code>/v<N>.webp     its cover picture
//   db/db-<time>-<rand>.json  the document list; every change writes a NEW file, the newest one wins,
//                             so a reader can never get an old copy from a cache. The last 10 are kept.
// The rules (codes never change, versions, archive, delete) are the same as on the company server: see store.mjs.
import { Store } from './store.mjs';

const KEEP_DB = 10;
const rand = () => Math.random().toString(36).slice(2, 8);

export class BlobStore extends Store {
  // api = { put, list, head, del } from @vercel/blob (tests pass a pretend one)
  constructor({ api, token, fetchImpl = fetch }) {
    super('/tmp/jinharsh-docs-unused');
    this.api = api; this.token = token; this.fetch = fetchImpl;
    this.kind = 'blob';
    this.readAt = 0; this.dbName = '';
  }

  get ready() { return !!this.token; }
  opts(extra) { return { token: this.token, ...extra }; }

  async load() { if (this.ready) await this.refresh(0); }

  // Re-read the list when the copy we hold is older than maxAgeMs (several copies of the program may run at once).
  async refresh(maxAgeMs = 1000) {
    if (!this.ready || Date.now() - this.readAt < maxAgeMs) return;
    const { blobs } = await this.api.list(this.opts({ prefix: 'db/', limit: 1000 }));
    blobs.sort((a, b) => (a.pathname < b.pathname ? 1 : -1));
    this.dbBlobs = blobs;
    if (!blobs.length) { this.db = { docs: [], retired: [] }; this.readAt = Date.now(); return; }
    if (blobs[0].pathname !== this.dbName) {
      const r = await this.fetch(blobs[0].url, { cache: 'no-store' });
      if (!r.ok) throw new Error('Could not read the document list (' + r.status + ')');
      const raw = await r.json();
      this.db = { docs: Array.isArray(raw.docs) ? raw.docs : [], retired: Array.isArray(raw.retired) ? raw.retired : [] };
      this.dbName = blobs[0].pathname;
    }
    this.readAt = Date.now();
  }

  save() {
    this.queue = this.queue.then(async () => {
      const name = `db/db-${String(Date.now()).padStart(13, '0')}-${rand()}.json`;
      await this.api.put(name, JSON.stringify(this.db), this.opts({
        access: 'public', addRandomSuffix: false, contentType: 'application/json', cacheControlMaxAge: 60,
      }));
      this.dbName = name; this.readAt = Date.now();
      // tidy up: keep the newest few lists only (best effort)
      const old = (this.dbBlobs || []).filter((b) => b.pathname !== name).slice(KEEP_DB - 1);
      this.dbBlobs = [{ pathname: name }, ...(this.dbBlobs || [])].slice(0, KEEP_DB);
      if (old.length) this.api.del(old.map((b) => b.url), this.opts()).catch(() => {});
    });
    return this.queue;
  }

  // The browser asks to upload to docs/<code>/v<N>.pdf; the store adds a random tail to the name.
  pdfPath(code, v) { return `docs/${code}/v${v}.pdf`; }
  pathOk(pathname, code, v) { return new RegExp(`^docs/${code}/v${v}(-[A-Za-z0-9]+)?\\.pdf$`).test(String(pathname)); }

  // The browser has already put the PDF into the store; check it really is there and really is a PDF.
  async verifyUpload(pathname, maxBytes) {
    let h;
    try { h = await this.api.head(pathname, this.opts()); } catch { return { error: 'The file did not arrive. Please try again.' }; }
    if (!h || !h.size) return { error: 'The file did not arrive. Please try again.' };
    if (h.size > maxBytes) { await this.api.del(h.url, this.opts()).catch(() => {}); return { error: 'This file is too big.' }; }
    const r = await this.fetch(h.url, { headers: { Range: 'bytes=0-7' }, cache: 'no-store' });
    const first = Buffer.from(await r.arrayBuffer()).subarray(0, 5).toString('latin1');
    if (first !== '%PDF-') { await this.api.del(h.url, this.opts()).catch(() => {}); return { error: 'This file is not a real PDF.' }; }
    return { url: h.url, size: h.size, pathname };
  }

  async placeFile(code, v, input) { return { url: input.url, pathname: input.pathname }; }

  async writeCover(code, v, ext, buf, old, suffix = '') {
    const r = await this.api.put(`docs/${code}/v${v}${suffix}.${ext}`, buf, this.opts({
      access: 'public', addRandomSuffix: true,
      contentType: ext === 'webp' ? 'image/webp' : 'image/jpeg', cacheControlMaxAge: 31536000,
    }));
    return { url: r.url };
  }

  async removeFiles(code) {
    const { blobs } = await this.api.list(this.opts({ prefix: `docs/${code}/`, limit: 1000 }));
    if (blobs.length) await this.api.del(blobs.map((b) => b.url), this.opts());
  }

  // Counting every scan would mean writing the whole list each time, which uses up the free monthly allowance.
  countScan() {}
  async flush() {}
}
