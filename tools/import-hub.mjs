// Brings the catalogues of the old catalog.jinharsh.com hub across, with the SAME names, so every QR made
// by the old hub (catalog.jinharsh.com/?cat=<name>) keeps working. Each one arrives "waiting for its PDF":
// its page says so (or opens the maker's own copy, if the hub linked one) until the team uploads the PDF.
//
//   npm run import-hub                    (uses deploy/hub-catalogs.json)
//   npm run import-hub -- other-file.json
//
// Run it while the site is STOPPED (the running program keeps its own copy of the list and would overwrite).
import { readFileSync } from 'node:fs';
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

const file = process.argv[2] || join(ROOT, 'deploy', 'hub-catalogs.json');
const raw = JSON.parse(readFileSync(file, 'utf8'));
const list = Array.isArray(raw) ? raw : raw.catalogs;
const store = new Store(DATA_DIR);
await store.load();
let added = 0;
for (const c of list) {
  if (store.get(c.id)) { console.log(`  already there   ${c.id}`); continue; }
  const d = await store.createWaiting({ code: c.id, title: c.title, brand: c.brand, category: c.category, note: c.description, sourceUrl: c.sourceUrl || c.pdfUrl });
  if (d) { added++; console.log(`  added           ${c.id}${d.sourceUrl ? '   (opens the maker\'s copy until our PDF is uploaded)' : ''}`); }
  else console.log(`  SKIPPED         ${c.id}: ${store.checkCode(c.id).reason}`);
}
console.log(`\n${added} catalogue(s) added. Start the site again; they show under "Waiting for PDF" on the team screen.`);
