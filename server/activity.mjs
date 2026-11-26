// Who looked at what: visits, catalogues opened, downloads, shares and queries (the sales side of the site).
//
// On the company server every event is added as one line at the end of a file in the data folder, so nothing is ever
// rewritten or lost:   data/events.jsonl     visits, reads, downloads, shares, queries (short)
//                      data/inquiries.jsonl  the queries in full (name, phone, email, company, message)
// On the hosted trial (no disk) queries are kept in the list itself and visits are not stored.
//
// Times are India time. When an exhibition is set (name, first and last day), every event says whether it happened
// before, during or after it.
import { promises as fs, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const EVENT_TYPES = ['visit', 'hub', 'read', 'download', 'share', 'video', 'query'];

// India time, as "2026-11-26" and "2026-11-26 14:05"
export function istParts(t = Date.now()) {
  const s = new Date(t + 5.5 * 3600 * 1000).toISOString();
  return { day: s.slice(0, 10), time: s.slice(0, 10) + ' ' + s.slice(11, 16), hour: Number(s.slice(11, 13)) };
}
export function phaseOf(ex, day) {
  if (!ex || !ex.start || !ex.end) return '';
  if (day < ex.start) return 'before';
  if (day > ex.end) return 'after';
  return 'during';
}
export const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
export const cleanVisitor = (v = {}) => {
  const out = { name: clip(v.name, 80), email: clip(v.email, 120).toLowerCase(), company: clip(v.company, 120), phone: clip(v.phone, 30) };
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) out.email = '';
  return Object.values(out).some(Boolean) ? out : null;
};
export const cleanDevice = (d) => (['phone', 'tablet', 'computer'].includes(d) ? d : '');
export const cleanSource = (s) => clip(s, 60).toLowerCase().replace(/[^a-z0-9 ._:/-]/g, '');

export class Activity {
  constructor({ dir = null, store }) {
    this.store = store;
    this.eventsFile = dir ? join(dir, 'events.jsonl') : null;
    this.inquiryFile = dir ? join(dir, 'inquiries.jsonl') : null;
    this.queue = [];
    this.timer = null;
    this.writing = Promise.resolve();
  }

  // a new event: written within a second (several at once are written together)
  add(e) {
    if (!this.eventsFile) return;
    this.queue.push(JSON.stringify(e));
    if (!this.timer) this.timer = setTimeout(() => this.flush(), 1000);
  }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    if (!this.queue.length || !this.eventsFile) return this.writing;
    const lines = this.queue.splice(0).join('\n') + '\n';
    this.writing = this.writing.then(() => fs.appendFile(this.eventsFile, lines)).catch(() => {});
    return this.writing;
  }

  async addInquiry(q) {
    if (this.inquiryFile) { await fs.appendFile(this.inquiryFile, JSON.stringify(q) + '\n'); return; }
    const db = this.store.db;
    db.inquiries = [q, ...(db.inquiries || [])].slice(0, 2000);
    await this.store.save();
  }

  // Every event, oldest first, read line by line: the history can grow for years, so it is never held in memory
  // whole. fn may return a promise (then the reading waits for it, e.g. while a download catches up).
  async eachEvent(fn) {
    await this.flush();
    if (!this.eventsFile) return;
    let input;
    try { await fs.access(this.eventsFile); input = createReadStream(this.eventsFile, { encoding: 'utf8', highWaterMark: 256 * 1024 }); } catch { return; }
    const rl = createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const line of rl) {
        if (!line) continue;
        let e;
        try { e = JSON.parse(line); } catch { continue; } // a half-written line
        const r = fn(e);
        if (r && r.then) await r;
      }
    } finally { rl.close(); input.destroy(); }
  }

  async inquiries(limit = 5000) {
    if (this.inquiryFile) return readLines(this.inquiryFile, limit);
    return (this.store.db.inquiries || []).slice(0, limit);
  }

  // The team's numbers, worked out in one pass over the history. Kept until the files change (or the exhibition does),
  // so opening the panel twice costs nothing the second time.
  async insights(ex, docs) {
    await this.flush();
    const stamp = async (f) => { try { const st = await fs.stat(f); return st.size + ':' + st.mtimeMs; } catch { return '-'; } };
    const key = [this.eventsFile ? await stamp(this.eventsFile) : '', this.inquiryFile ? await stamp(this.inquiryFile) : (this.store.db.inquiries || []).length,
      JSON.stringify(ex || null), istParts().day, docs.length].join('|');
    if (this.cache && this.cache.key === key) return this.cache.value;
    const T = newTally(ex);
    await this.eachEvent((e) => tallyEvent(T, e));
    const all = await this.inquiries(100000);
    const value = { summary: finishTally(T, all, docs), recent: T.recent.slice(-300).reverse(), inquiries: all.slice(0, 500) };
    this.cache = { key, value };
    return value;
  }

  // the visits for Excel, written straight to the answer a few hundred rows at a time (never all in memory)
  async visitsCsv(res, columns, headers) {
    res.writeHead(200, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    let chunk = '\ufeff' + columns.map((c) => csvCell(c[0])).join(',') + '\r\n';
    await this.eachEvent(async (e) => {
      if (e.team) return;
      chunk += columns.map((c) => csvCell(c[1](e))).join(',') + '\r\n';
      if (chunk.length > 64 * 1024) { const ok = res.write(chunk); chunk = ''; if (!ok) await once(res, 'drain'); }
    });
    res.end(chunk);
  }
}

// newest first (used for the queries, which stay small)
async function readLines(file, limit) {
  if (!file) return [];
  let txt = '';
  try { txt = await fs.readFile(file, 'utf8'); } catch { return []; }
  const lines = txt.split('\n');
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    if (!lines[i]) continue;
    try { out.push(JSON.parse(lines[i])); } catch { /* a half-written line */ }
  }
  return out;
}

export const newId = () => randomBytes(5).toString('hex');

// ---------- the numbers the team page shows, added up one event at a time ----------
const inc = (m, k) => { if (k) m.set(k, (m.get(k) || 0) + 1); };
const sorted = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 50);
export function newTally(ex) {
  const today = istParts().day;
  const days = new Map();
  for (let i = 29; i >= 0; i--) { const d = istParts(Date.now() - i * 864e5).day; days.set(d, { day: d, visits: 0, downloads: 0 }); }
  return { ex, today, days, totals: { visits: 0, reads: 0, downloads: 0, shares: 0, videos: 0, queries: 0, people: 0, today: 0 },
    phases: { before: 0, during: 0, after: 0 }, per: new Map(), devices: new Map(), sources: new Map(), places: new Map(), people: new Set(), recent: [] };
}
export function tallyEvent(T, e) {
  if (!e || e.team) return;
  const t = T.totals, day = T.days.get(e.day);
  if (e.type === 'visit' || e.type === 'hub') {
    t.visits++;
    if (e.day === T.today) t.today++;
    if (T.phases[e.phase] !== undefined) T.phases[e.phase]++;
    inc(T.devices, e.device); inc(T.sources, e.source); inc(T.places, [e.city, e.country].filter(Boolean).join(', '));
    if (day) day.visits++;
  } else if (e.type === 'read') t.reads++;
  else if (e.type === 'download') { t.downloads++; if (day) day.downloads++; }
  else if (e.type === 'share') t.shares++;
  else if (e.type === 'video') t.videos++;
  if (e.code) {
    let r = T.per.get(e.code);
    if (!r) { r = { code: e.code, title: e.title || e.code, visit: 0, read: 0, download: 0, share: 0, video: 0, query: 0 }; T.per.set(e.code, r); }
    if (r[e.type] !== undefined) r[e.type]++;
  }
  if (e.visitor && (e.visitor.email || e.visitor.phone)) T.people.add(e.visitor.email || e.visitor.phone);
  T.recent.push(e);
  if (T.recent.length > 600) T.recent.splice(0, 300); // only the newest few hundred are kept
}
export function finishTally(T, inquiries, docs) {
  for (const q of inquiries) if (q.email || q.phone) T.people.add(q.email || q.phone);
  const titles = new Map(docs.map((d) => [d.code, d.title]));
  const catalogues = [...T.per.values()].map((r) => ({ ...r, title: titles.get(r.code) || r.title }))
    .sort((a, b) => (b.visit + b.read + b.download) - (a.visit + a.read + a.download));
  return {
    totals: { ...T.totals, queries: inquiries.length, people: T.people.size },
    phases: T.ex && T.ex.start ? T.phases : null,
    phase: phaseOf(T.ex, T.today),
    catalogues, devices: sorted(T.devices), sources: sorted(T.sources), places: sorted(T.places),
    days: [...T.days.values()],
  };
}

// CSV that Excel opens correctly (UTF-8 mark first, quotes doubled)
export const csvCell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function toCsv(rows, columns) {
  return '\ufeff' + [columns.map((c) => csvCell(c[0])).join(','), ...rows.map((r) => columns.map((c) => csvCell(c[1](r))).join(','))].join('\r\n') + '\r\n';
}
