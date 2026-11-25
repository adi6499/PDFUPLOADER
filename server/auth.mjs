// The team password.
// - Stored only as a scrambled hash (scrypt) in <dataDir>/auth.json, never as the password itself.
// - Signing in gives the browser a cookie that lasts 30 days. It is signed with a secret that changes
//   whenever the password changes, so a new password signs everybody out.
// - After 8 wrong tries from one address, that address waits 15 minutes.
import { promises as fs, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

export const COOKIE = 'jd_team';
const DAYS = 30;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password).normalize('NFKC'), salt, 64, SCRYPT);
  return { v: 1, salt: salt.toString('base64'), hash: hash.toString('base64'), secret: randomBytes(32).toString('base64'), setAt: new Date().toISOString() };
}

export async function writeAuth(dataDir, password) {
  await fs.mkdir(dataDir, { recursive: true });
  const file = join(dataDir, 'auth.json');
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(hashPassword(password), null, 2), { mode: 0o600 });
  await fs.rename(tmp, file);
  return file;
}

export class Auth {
  constructor(dataDir) { this.file = join(dataDir, 'auth.json'); this.data = null; this.mtime = -1; this.checkedAt = 0; this.fails = new Map(); }

  // re-read the file when it changes, so a new password works without restarting the server
  current() {
    const now = Date.now();
    if (now - this.checkedAt > 3000) {
      this.checkedAt = now;
      let m = -1;
      try { m = statSync(this.file).mtimeMs; } catch {}
      if (m !== this.mtime) {
        this.mtime = m;
        try { this.data = m < 0 ? null : JSON.parse(readFileSync(this.file, 'utf8')); } catch { this.data = null; }
      }
    }
    return this.data;
  }
  get passwordSet() { const a = this.current(); return !!(a && a.hash && a.salt && a.secret); }

  verify(password) {
    const a = this.current(); if (!a) return false;
    try {
      const want = Buffer.from(a.hash, 'base64');
      const got = scryptSync(String(password ?? '').normalize('NFKC'), Buffer.from(a.salt, 'base64'), want.length, SCRYPT);
      return timingSafeEqual(want, got);
    } catch { return false; }
  }

  #sign(exp) { return createHmac('sha256', Buffer.from(this.current().secret, 'base64')).update('team.' + exp).digest('base64url'); }
  token() { const exp = Date.now() + DAYS * 86400000; return exp + '.' + this.#sign(exp); }
  checkToken(t) {
    if (!t || !this.passwordSet) return false;
    const [exp, sig] = String(t).split('.');
    if (!exp || !sig || !(Number(exp) > Date.now())) return false;
    const want = Buffer.from(this.#sign(exp)); const got = Buffer.from(sig);
    return want.length === got.length && timingSafeEqual(want, got);
  }
  cookie(secure) { return `${COOKIE}=${this.token()}; Path=/; Max-Age=${DAYS * 86400}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`; }
  static clearCookie(secure) { return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`; }

  // wrong-password brake, per address
  blocked(ip) { const f = this.fails.get(ip); return !!(f && f.until > Date.now()); }
  failed(ip) {
    const f = this.fails.get(ip) || { n: 0, until: 0 };
    f.n += 1; if (f.n >= 8) { f.until = Date.now() + 15 * 60000; f.n = 0; }
    this.fails.set(ip, f);
    if (this.fails.size > 5000) this.fails.clear();
  }
  succeeded(ip) { this.fails.delete(ip); }
}

export function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
