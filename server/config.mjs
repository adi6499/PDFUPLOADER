// Settings, read the same way by the server and by the small tools.
// Order (later wins): config.json (in git) -> config.local.json (this machine only) -> environment variables.
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; } };

export function loadConfig() {
  const env = process.env;
  const cfg = { ...readJson(join(ROOT, 'config.json')), ...readJson(join(ROOT, 'config.local.json')) };
  const ON_VERCEL = env.VERCEL === '1';
  const PORT = Number(env.PORT || cfg.port || 8180);
  const HOST = env.HOST || cfg.host || '127.0.0.1';
  // On Vercel the address is the project's own vercel.app address unless one is given.
  const vercelUrl = env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '';
  const PUBLIC_URL = String(env.PUBLIC_URL || cfg.publicUrl || (ON_VERCEL ? vercelUrl : `http://localhost:${PORT}`)).replace(/\/+$/, '');
  const DATA_DIR = resolve(ROOT, env.DATA_DIR || cfg.dataDir || 'data');
  const MAX_UPLOAD = Number(env.MAX_UPLOAD_MB || cfg.maxUploadMB || 150) * 1024 * 1024;
  const TRUST_PROXY = String(env.TRUST_PROXY ?? cfg.trustProxy ?? '') === 'true';
  // where files are kept: 'disk' (the company server, this computer) or 'blob' (a Vercel trial copy)
  const STORAGE = env.STORAGE || cfg.storage || (ON_VERCEL ? 'blob' : 'disk');
  // a trial copy: its QR codes must never be printed, and (until a sign-in is chosen) its team page is open
  const TRIAL = String(env.TRIAL ?? cfg.trial ?? (ON_VERCEL ? 'true' : 'false')) === 'true';
  // A QR that points at this computer, the office network or a trial copy only works for a while. The app warns before anyone prints one.
  let PRINTABLE = false;
  try {
    const h = new URL(PUBLIC_URL).hostname;
    PRINTABLE = !TRIAL && !(h === 'localhost' || /^127\./.test(h) || h === '[::1]' || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.endsWith('.local'));
  } catch {}
  const LOOPBACK = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1';
  // team page open with no password (for trying it out on the office Wi-Fi); a team password, once set, still wins
  const TEAM_OPEN = String(env.TEAM_OPEN ?? cfg.teamOpen ?? 'false') === 'true';
  return { cfg, ON_VERCEL, PORT, HOST, PUBLIC_URL, DATA_DIR, MAX_UPLOAD, TRUST_PROXY, STORAGE, TRIAL, PRINTABLE, LOOPBACK, TEAM_OPEN };
}
