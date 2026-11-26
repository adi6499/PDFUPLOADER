// The document list and the files on disk.
//
// THE ONE RULE: a document's code (the part after /c/ in its link) is given once and never changes,
// never gets reused, and keeps working for ever. Replacing the PDF adds a new version under the SAME code,
// so a QR code printed on a visiting card always opens the newest file.
//
// Layout on disk:
//   <dataDir>/db.json                     the list of documents (written safely: temp file, then rename)
//   <dataDir>/docs/<code>/v1.pdf          every version of every PDF is kept
//   <dataDir>/docs/<code>/v1.jpg          the cover picture of that version
//   <dataDir>/docs/<code>/v1-t.webp       a small copy of it (thumbnail) for lists and the front page
//   <dataDir>/tmp/                        uploads land here first, then move into place
import { promises as fs, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';

// No 0/o, 1/i/l: nothing that can be misread from a printed card.
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const AUTO_LEN = 5;
export const CODE_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const RESERVED = new Set(['api', 'c', 'f', 'cover', 'vendor', 'js', 'css', 'assets', 'admin', 'new', 'login', 'logout', 'settings', 'help']);

export const nowIso = () => new Date().toISOString();
const istDay = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export function cleanTitle(t) {
  return String(t ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
}
export function cleanNote(t) {
  return String(t ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}
// only ordinary web links (never javascript: and the like)
export function cleanUrl(u) {
  try { const x = new URL(String(u ?? '').trim()); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href.slice(0, 500) : ''; } catch { return ''; }
}
// videos, installation videos and trials & recommendations shown on a catalogue's page
const MEDIA_KINDS = ['video', 'install', 'trial'];
export function cleanMedia(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 24).map((m) => ({
    kind: MEDIA_KINDS.includes(m?.kind) ? m.kind : 'video',
    title: String(m?.title ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120),
    url: cleanUrl(m?.url),
  })).filter((m) => m.url);
}
export function cleanFileName(n) {
  const base = String(n ?? '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').replace(/\s+/g, ' ').trim();
  const s = base.slice(0, 120) || 'document.pdf';
  return /\.pdf$/i.test(s) ? s : s + '.pdf';
}

export class Store {
  constructor(dataDir) {
    this.dir = dataDir;
    this.docsDir = join(dataDir, 'docs');
    this.tmpDir = join(dataDir, 'tmp');
    this.dbFile = join(dataDir, 'db.json');
    this.db = { docs: [], retired: [] };
    this.queue = Promise.resolve();
    this.scanTimer = null;
  }

  async load() {
    await fs.mkdir(this.docsDir, { recursive: true });
    await fs.mkdir(this.tmpDir, { recursive: true });
    try {
      const raw = JSON.parse(await fs.readFile(this.dbFile, 'utf8'));
      this.db = { ...raw, docs: Array.isArray(raw.docs) ? raw.docs : [], retired: Array.isArray(raw.retired) ? raw.retired : [] };
    } catch (e) {
      if (e.code !== 'ENOENT') throw new Error('db.json could not be read - fix or restore it before starting: ' + e.message);
    }
    // leftovers from an upload that was cut off
    for (const f of await fs.readdir(this.tmpDir)) await fs.rm(join(this.tmpDir, f), { force: true });
  }

  // every write goes through one queue, so two uploads at once can never overwrite each other's changes
  save() {
    this.queue = this.queue.then(async () => {
      const tmp = this.dbFile + '.' + randomUUID() + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(this.db, null, 2));
      await fs.rename(tmp, this.dbFile);
    });
    return this.queue;
  }

  list() { return this.db.docs; }
  get(code) { return this.db.docs.find(d => d.code === String(code).toLowerCase()) || null; }
  isRetired(code) { return this.db.retired.includes(String(code).toLowerCase()); }
  taken(code) { return !!this.get(code) || this.isRetired(code); }

  checkCode(code) {
    code = String(code ?? '').trim().toLowerCase();
    if (!code) return { ok: false, reason: 'Type a short name, or leave it empty for an automatic one.' };
    if (code.length < 3) return { ok: false, reason: 'Use at least 3 letters or numbers.' };
    if (!CODE_RE.test(code)) return { ok: false, reason: 'Use only small letters, numbers and dashes (no spaces).' };
    if (RESERVED.has(code)) return { ok: false, reason: 'That word is kept for the website itself. Try another.' };
    if (this.taken(code)) return { ok: false, reason: 'That name is already used by another QR code.' };
    return { ok: true, code };
  }

  newCode() {
    for (let tries = 0; tries < 1000; tries++) {
      let c = '';
      for (let i = 0; i < AUTO_LEN; i++) c += ALPHABET[randomInt(ALPHABET.length)];
      if (/[a-z]/.test(c) && /[2-9]/.test(c) && !this.taken(c)) return c;
    }
    throw new Error('Could not find a free code');
  }

  tmpPath() { return join(this.tmpDir, randomUUID() + '.part'); }
  filePath(code, v) { return join(this.docsDir, code, 'v' + v + '.pdf'); }
  coverPath(code, v, ext, suffix = '') { return join(this.docsDir, code, 'v' + v + suffix + '.' + ext); }

  // ---- where the files physically go (a hosted copy can swap these for another kind of storage) ----
  kind = 'disk';
  async refresh() {}
  async placeFile(code, v, input) {
    await fs.mkdir(join(this.docsDir, code), { recursive: true });
    await fs.rename(input.tmp, this.filePath(code, v));
    return {};
  }
  async writeCover(code, v, ext, buf, old, suffix = '') {
    await fs.mkdir(join(this.docsDir, code), { recursive: true });
    if (old && old.ext !== ext) await fs.rm(this.coverPath(code, v, old.ext, suffix), { force: true });
    await fs.writeFile(this.coverPath(code, v, ext, suffix), buf);
    return {};
  }
  async removeFiles(code) { await fs.rm(join(this.docsDir, code), { recursive: true, force: true }); }

  async create(input) {
    const { title, size, name, pages } = input;
    const code = input.code ? input.code : this.newCode();
    const extra = await this.placeFile(code, 1, input);
    const t = nowIso();
    const doc = {
      code, title: cleanTitle(title) || cleanFileName(name).replace(/\.pdf$/i, ''),
      brand: this.brandOf(input.brand), category: this.categoryOf(input.category), note: cleanNote(input.note), sourceUrl: '',
      status: 'live', createdAt: t, updatedAt: t, current: 1,
      versions: [{ v: 1, name: cleanFileName(name), size, pages: pages || null, uploadedAt: t, cover: null, ...extra }],
      scans: 0, lastScanAt: null, scanDays: {},
    };
    this.db.docs.unshift(doc);
    await this.save();
    return doc;
  }

  // A catalogue that has its link (and QR) but no PDF yet: its scan page says "coming soon",
  // or opens the maker's own copy (sourceUrl) until our PDF is uploaded. Used for the old hub's catalogues.
  // one spelling per brand (and category): "JinHarsh" or "JINHARSH" becomes the "Jinharsh" already used by another
  // catalogue, so the brand filters never show the same brand twice
  brandOf(b, except = null) { return this.sameAs(b, 'brand', except); }
  categoryOf(c, except = null) { return this.sameAs(c, 'category', except); }
  sameAs(v, key, except) {
    const t = cleanTitle(v).slice(0, 60);
    if (!t) return '';
    const hit = this.db.docs.find((d) => d !== except && d[key] && d[key].toLowerCase() === t.toLowerCase());
    return hit ? hit[key] : t;
  }

  async createWaiting({ code, title, brand, category, note, sourceUrl }) {
    const c = this.checkCode(code);
    if (!c.ok) return null;
    const t = nowIso();
    const doc = {
      code: c.code, title: cleanTitle(title) || c.code, brand: this.brandOf(brand), category: this.categoryOf(category),
      note: cleanNote(note), sourceUrl: cleanUrl(sourceUrl), status: 'live', createdAt: t, updatedAt: t, current: 0, versions: [],
      scans: 0, lastScanAt: null, scanDays: {},
    };
    this.db.docs.push(doc);
    await this.save();
    return doc;
  }

  nextVersion(doc) { return doc.versions.length ? Math.max(...doc.versions.map(x => x.v)) + 1 : 1; }

  async addVersion(doc, input) {
    const { size, name, pages } = input;
    const v = this.nextVersion(doc);
    const extra = await this.placeFile(doc.code, v, input);
    const t = nowIso();
    doc.versions.push({ v, name: cleanFileName(name), size, pages: pages || null, uploadedAt: t, cover: null, ...extra });
    doc.current = v; doc.updatedAt = t;
    await this.save();
    return doc;
  }

  async setCover(doc, v, ext, buf, w, h) {
    const ver = doc.versions.find(x => x.v === v);
    if (!ver) return null;
    const extra = await this.writeCover(doc.code, v, ext, buf, ver.cover);
    ver.cover = { ext, w: w || null, h: h || null, at: nowIso(), ...extra };
    ver.thumb = null; // a new cover needs a new small copy
    await this.save();
    return ver;
  }

  // the small copy of the cover, for lists and the front page (about a sixth of the size)
  async setThumb(doc, v, ext, buf, w, h) {
    const ver = doc.versions.find(x => x.v === v);
    if (!ver || !ver.cover) return null;
    const extra = await this.writeCover(doc.code, v, ext, buf, ver.thumb, '-t');
    ver.thumb = { ext, w: w || null, h: h || null, at: nowIso(), ...extra };
    await this.save();
    return ver;
  }

  async update(doc, patch) {
    if (patch.title !== undefined) { const t = cleanTitle(patch.title); if (t) doc.title = t; }
    if (patch.note !== undefined) doc.note = cleanNote(patch.note);
    if (patch.brand !== undefined) doc.brand = this.brandOf(patch.brand, doc);
    if (patch.category !== undefined) doc.category = this.categoryOf(patch.category, doc);
    if (patch.sourceUrl !== undefined) doc.sourceUrl = cleanUrl(patch.sourceUrl);
    if (patch.media !== undefined) doc.media = cleanMedia(patch.media);
    if (patch.status === 'live' || patch.status === 'archived') doc.status = patch.status;
    if (patch.current !== undefined) {
      const v = Number(patch.current);
      if (doc.versions.some(x => x.v === v)) doc.current = v;
    }
    doc.updatedAt = nowIso();
    await this.save();
    return doc;
  }

  // Removes the files for good. The code stays reserved, so an old printed QR can never open someone else's PDF.
  async remove(doc) {
    await this.removeFiles(doc.code);
    this.db.docs = this.db.docs.filter(d => d !== doc);
    if (!this.db.retired.includes(doc.code)) this.db.retired.push(doc.code);
    await this.save();
  }

  countScan(doc) {
    const day = istDay();
    doc.scans = (doc.scans || 0) + 1;
    doc.lastScanAt = nowIso();
    doc.scanDays = doc.scanDays || {};
    doc.scanDays[day] = (doc.scanDays[day] || 0) + 1;
    const keys = Object.keys(doc.scanDays).sort();
    while (keys.length > 400) delete doc.scanDays[keys.shift()];
    // scans can come quickly; write them at most every 3 seconds
    if (!this.scanTimer) this.scanTimer = setTimeout(() => { this.scanTimer = null; this.save().catch(() => {}); }, 3000);
  }

  async flush() { if (this.scanTimer) { clearTimeout(this.scanTimer); this.scanTimer = null; } await this.save(); }
}

// Writes a request body to a temp file, stopping if it grows past `max` bytes.
export function receiveFile(req, path, max) {
  return new Promise((resolve, reject) => {
    let size = 0, head = Buffer.alloc(0), failed = false;
    const out = createWriteStream(path);
    const fail = (err) => { if (failed) return; failed = true; req.unpipe?.(out); out.destroy(); fs.rm(path, { force: true }).finally(() => reject(err)); };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (head.length < 8) head = Buffer.concat([head, chunk.subarray(0, 8)]);
      if (size > max) { const e = new Error('too-big'); e.status = 413; fail(e); req.resume(); }
    });
    req.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => { if (!failed) resolve({ size, head }); });
    req.pipe(out);
  });
}

export function readSmallBody(req, max) {
  return new Promise((resolve, reject) => {
    const parts = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > max) { const e = new Error('too-big'); e.status = 413; reject(e); req.destroy(); } else parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}
