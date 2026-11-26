// Copies of the catalogue PDFs that live on other websites, kept on the hub itself, so the hub's own reader can show
// them (a browser may not read a PDF from another website, which is why they were shown in Google's viewer).
//   node tools/php-hub/make-mirror.mjs <site folder>  [https://catalog.jinharsh.com]
// A PDF that sits on one of the sites in the same repo (groz.tools, omega.rexnord.co.in, ...) is copied from there
// (Git keeps one copy of identical files); any other is downloaded once. Copies go to <site folder>/mirror/ and
// covers/covers.json gets "file": "/hub/mirror/<name>" for each. Copies already there (same size) are kept.
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';

const SITE = process.argv[2];
const LIVE = (process.argv[3] || 'https://catalog.jinharsh.com').replace(/\/$/, '');
if (!SITE || !existsSync(path.join(SITE, 'api.php'))) { console.error('Give the hub folder (the one with api.php).'); process.exit(1); }
const SITES = path.dirname(path.resolve(SITE));          // the repo's sites/ folder
const OUT = path.join(SITE, 'mirror');
const META = path.join(SITE, 'covers', 'covers.json');
await fs.mkdir(OUT, { recursive: true });
let meta = {};
try { meta = JSON.parse(await fs.readFile(META, 'utf8')); } catch {}

const list = await (await fetch(`${LIVE}/hub/api.php?action=catalogs`)).json();
const liveHost = new URL(LIVE).host;
for (const c of list) {
  const url = String(c.pdfUrl || '');
  if (!/^https?:/i.test(url) || !/\.pdf(\?|#|$)/i.test(url)) continue;       // own files and portals need nothing
  const u = new URL(url);
  if (u.host === liveHost) continue;
  const name = decodeURIComponent(path.basename(u.pathname)).replace(/[^A-Za-z0-9._-]+/g, '-');
  const dest = path.join(OUT, name);
  const inRepo = path.join(SITES, u.host.replace(/^www\./, ''), decodeURIComponent(u.pathname));
  let size = 0;
  try { size = Number((await fetch(url, { method: 'HEAD' })).headers.get('content-length')) || 0; } catch {}
  const have = existsSync(dest) ? (await fs.stat(dest)).size : -1;
  if (have > 0 && (!size || have === size)) console.log(`  ${c.id}: kept ${name}`);
  else if (existsSync(inRepo) && (!size || (await fs.stat(inRepo)).size === size)) {
    await fs.copyFile(inRepo, dest);
    console.log(`  ${c.id}: copied ${name} from ${path.relative(SITES, inRepo)}`);
  } else {
    const r = await fetch(url);
    if (!r.ok) { console.log(`  ${c.id}: could not download (${r.status}), left in the Google viewer`); continue; }
    await fs.writeFile(dest, Buffer.from(await r.arrayBuffer()));
    console.log(`  ${c.id}: downloaded ${name} from ${u.host}`);
  }
  meta[c.id] = { ...(meta[c.id] || {}), file: `/hub/mirror/${name}`, size: (await fs.stat(dest)).size };
}
await fs.writeFile(META, JSON.stringify(meta, null, 1) + '\n');
console.log(`covers.json: ${Object.values(meta).filter((m) => m.file).length} catalogues with a copy here`);
