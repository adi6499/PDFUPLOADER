// Who looked at what: visits, catalogues opened, downloads, shares and queries (the sales side of the site).
//
// On the company server every event is added as one line at the end of a file in the data folder, so nothing is ever
// rewritten or lost:   data/events.jsonl     visits, reads, downloads, shares, queries (short)
//                      data/inquiries.jsonl  the queries in full (name, phone, email, company, message)
// On the hosted trial (no disk) queries are kept in the list itself and visits are not stored.
//
// Times are India time. When an exhibition is set (name, first and last day), every event says whether it happened
// before, during or after it.
import { promises as fs } from 'node:fs';
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

  async events(limit = 20000) { await this.flush(); return readLines(this.eventsFile, limit); }
  async inquiries(limit = 5000) {
    if (this.inquiryFile) return readLines(this.inquiryFile, limit);
    return (this.store.db.inquiries || []).slice(0, limit);
  }
}

// newest first
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

// The numbers the team page shows, worked out from the events and queries.
export function summarise(events, inquiries, docs, ex) {
  const count = (arr, key) => { const m = new Map(); for (const x of arr) { const k = key(x); if (k) m.set(k, (m.get(k) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]); };
  const of = (t) => events.filter((e) => e.type === t);
  const visits = events.filter((e) => e.type === 'visit' || e.type === 'hub');
  const titles = new Map(docs.map((d) => [d.code, d.title]));
  const per = new Map();
  for (const e of events) {
    if (!e.code) continue;
    const r = per.get(e.code) || { code: e.code, title: titles.get(e.code) || e.title || e.code, visit: 0, read: 0, download: 0, share: 0, video: 0, query: 0 };
    if (r[e.type] !== undefined) r[e.type]++;
    per.set(e.code, r);
  }
  const people = new Set();
  for (const e of events) if (e.visitor?.email || e.visitor?.phone) people.add(e.visitor.email || e.visitor.phone);
  for (const q of inquiries) if (q.email || q.phone) people.add(q.email || q.phone);
  const today = istParts().day;
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = istParts(Date.now() - i * 864e5).day;
    days.push({ day: d, visits: visits.filter((e) => e.day === d).length, downloads: events.filter((e) => e.type === 'download' && e.day === d).length });
  }
  return {
    totals: { visits: visits.length, reads: of('read').length, downloads: of('download').length, shares: of('share').length, videos: of('video').length, queries: inquiries.length, people: people.size, today: visits.filter((e) => e.day === today).length },
    phases: ex && ex.start ? { before: visits.filter((e) => e.phase === 'before').length, during: visits.filter((e) => e.phase === 'during').length, after: visits.filter((e) => e.phase === 'after').length } : null,
    phase: phaseOf(ex, today),
    catalogues: [...per.values()].sort((a, b) => (b.visit + b.read + b.download) - (a.visit + a.read + a.download)),
    devices: count(visits, (e) => e.device),
    sources: count(visits, (e) => e.source),
    places: count(visits, (e) => [e.city, e.country].filter(Boolean).join(', ')),
    days,
  };
}

// CSV that Excel opens correctly (UTF-8 mark first, quotes doubled)
export function toCsv(rows, columns) {
  const cell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [columns.map((c) => cell(c[0])).join(','), ...rows.map((r) => columns.map((c) => cell(c[1](r))).join(','))].join('\r\n') + '\r\n';
}
