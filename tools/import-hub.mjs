// Brings the catalogues of the old catalog.jinharsh.com hub across, with the SAME names, so every QR made
// by the old hub (catalog.jinharsh.com/?cat=<name>) keeps working. Each one arrives "waiting for its PDF":
// its page says so (or opens the maker's own copy, if the hub linked one) until the team uploads the PDF.
//
//   npm run import-hub                    (uses deploy/hub-catalogs.json)
//   npm run import-hub -- other-file.json
//   npm run import-hub -- --pdfs /www/wwwroot/catalog.jinharsh.com/hub/pdfs
//        the hub's own PDFs (entries with "pdfFile") are taken from that folder and go live straight away;
//        their cover pictures are made the next time someone opens the team page.
// Running it again is safe: catalogues already there are left alone (one still waiting gets its PDF if it is found).
//
// Run it while the site is STOPPED (the running program keeps its own copy of the list and would overwrite).
import { readFileSync, existsSync, statSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import net from 'node:net';
import { ROOT, loadConfig } from '../server/config.mjs';
import { Store } from '../server/store.mjs';

const { DATA_DIR, PORT, HOST, STORAGE } = loadConfig();
if (STORAGE !== 'disk') { console.log('This tool is for the company server (files on disk).'); process.exit(1); }

const running = await new Promise((ok) => {
  const s = net.connect(PORT, HOST === '0.0.0.0' ? '127.0.0.1' : HOST);
  s.on('connect', () => { s.destroy(); ok(true); }); s.on('error', () => ok(false));
  setTimeout(() => { s.destroy(); ok(false); }, 1500);
});
if (running) { console.log(`The site is running on port ${PORT}. Stop it first (pm2 stop jinharsh-docs), then run this again.`); process.exit(1); }

const args = process.argv.slice(2);
const at = args.indexOf('--pdfs');
const pdfDir = at >= 0 ? args[at + 1] : '';
if (at >= 0) args.splice(at, 2);
if (pdfDir && !existsSync(pdfDir)) { console.log(`The folder ${pdfDir} was not found.`); process.exit(1); }
const file = args[0] || join(ROOT, 'deploy', 'hub-catalogs.json');
const raw = JSON.parse(readFileSync(file, 'utf8'));
const list = Array.isArray(raw) ? raw : raw.catalogs;
const store = new Store(DATA_DIR);
await store.load();
let added = 0;
// the hub's own PDF for an entry, copied to the program's upload folder first (the original stays where it is)
function ownPdf(c) {
  if (!pdfDir || !c.pdfFile) return null;
  const src = join(pdfDir, c.pdfFile);
  if (!existsSync(src)) { console.log(`                  (${c.pdfFile} not in ${pdfDir})`); return null; }
  const tmp = store.tmpPath();
  copyFileSync(src, tmp);
  return { tmp, size: statSync(tmp).size, name: c.pdfFile };
}
for (const c of list) {
  const there = store.get(c.id);
  if (there) {
    const pdf = !there.versions.length ? ownPdf(c) : null;
    if (pdf) { await store.addVersion(there, pdf); added++; console.log(`  PDF added       ${c.id}   (now live)`); }
    else console.log(`  already there   ${c.id}`);
    continue;
  }
  const pdf = ownPdf(c);
  if (pdf) {
    await store.create({ ...pdf, pages: null, code: c.id, title: c.title, brand: c.brand, category: c.category, note: c.description });
    added++; console.log(`  added, live     ${c.id}   (with ${c.pdfFile})`);
    continue;
  }
  const d = await store.createWaiting({ code: c.id, title: c.title, brand: c.brand, category: c.category, note: c.note || c.description, sourceUrl: c.sourceUrl || c.pdfUrl });
  if (d) {
    added++;
    const portal = d.sourceUrl && !/\.pdf(\?|#|$)/i.test(d.sourceUrl);
    console.log(`  added           ${c.id}${d.sourceUrl ? (portal ? '   (opens its interactive guide)' : '   (opens the maker\'s copy until our PDF is uploaded)') : ''}`);
  } else console.log(`  SKIPPED         ${c.id}: ${store.checkCode(c.id).reason}`);
}
console.log(`\n${added} catalogue(s) added. Start the site again; they show under "Waiting for PDF" on the team screen.`);
