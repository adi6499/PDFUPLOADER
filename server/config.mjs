// Settings, read the same way by the server and by the small tools.
// Order (later wins): config.json (in git) -> config.local.json (this machine only) -> environment variables.
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; } };

export function loadConfig() {
  const cfg = { ...readJson(join(ROOT, 'config.json')), ...readJson(join(ROOT, 'config.local.json')) };
  const PORT = Number(process.env.PORT || cfg.port || 8180);
  const HOST = process.env.HOST || cfg.host || '127.0.0.1';
  const PUBLIC_URL = String(process.env.PUBLIC_URL || cfg.publicUrl || `http://localhost:${PORT}`).replace(/\/+$/, '');
  const DATA_DIR = resolve(ROOT, process.env.DATA_DIR || cfg.dataDir || 'data');
  const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_MB || cfg.maxUploadMB || 150) * 1024 * 1024;
  const TRUST_PROXY = String(process.env.TRUST_PROXY ?? cfg.trustProxy ?? '') === 'true';
  // A QR that points at this computer or the office network only works there. The app warns before anyone prints one.
  let PRINTABLE = false;
  try {
    const h = new URL(PUBLIC_URL).hostname;
    PRINTABLE = !(h === 'localhost' || /^127\./.test(h) || h === '[::1]' || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.endsWith('.local'));
  } catch {}
  const LOOPBACK = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1';
  return { cfg, PORT, HOST, PUBLIC_URL, DATA_DIR, MAX_UPLOAD, TRUST_PROXY, PRINTABLE, LOOPBACK };
}
