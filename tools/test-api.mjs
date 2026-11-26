// End-to-end check of the promises this site makes. Starts its own server on a spare port with an
// empty, throw-away data folder, so your real documents are never touched.   Run:  npm test
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAuth } from '../server/auth.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = mkdtempSync(join(tmpdir(), 'jdocs-test-'));
const PORT = 8190 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
let failed = 0, passed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok  ', what); } else { failed++; console.log('  FAIL', what); } };

// the smallest real PDF: one blank page with a word on it
function tinyPdf(word) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = `BT /F1 24 Tf 20 100 Td (${word}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

await writeAuth(data, 'test-pass-123');
// bring the old hub's catalogues across, the way the company server will (npm run import-hub)
// (the hub's own PDFs sit in a folder on the server; here a pretend one holds the master catalogue)
const hubPdfs = join(data, 'hub-pdfs');
mkdirSync(hubPdfs, { recursive: true });
writeFileSync(join(hubPdfs, 'jinharsh-master-catalog.pdf'), tinyPdf('master'));
const imported = execFileSync(process.execPath, [join(root, 'tools', 'import-hub.mjs'), '--pdfs', hubPdfs], { env: { ...process.env, DATA_DIR: data, PORT: String(PORT), HOST: '127.0.0.1' } }).toString();
const srv = spawn(process.execPath, [join(root, 'server', 'server.mjs')], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: data, PUBLIC_URL: 'https://docs.example.com', TEAM_OPEN: 'false', TRIAL: 'false', STORAGE: 'disk' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((res, rej) => { srv.stdout.on('data', (d) => { if (String(d).includes('running')) res(); }); srv.on('exit', () => rej(new Error('server did not start'))); });

const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
let COOKIE_HDR = '';
// a request from the team screen (signed in)
const T = (path, opts = {}) => fetch(BASE + path, { ...opts, headers: { ...(opts.headers || {}), Cookie: COOKIE_HDR } });
try {
  console.log('Team sign-in');
  ok((await T(`/api/docs`)).status === 401, 'without signing in, the team list cannot be read');
  ok((await T(`/api/docs?title=x&name=x.pdf`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: tinyPdf('x') })).status === 401, 'without signing in, nothing can be uploaded');
  ok((await (await fetch(`${BASE}/team`)).text()).includes('Team password'), 'the team address (/team) shows the sign-in page');
  ok((await (await fetch(`${BASE}/`)).text()).includes('id="cards"'), 'the front page (all catalogues) is open to everyone');
  let li = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'wrong-one' }) });
  ok(li.status === 401, 'a wrong password is refused');
  li = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify({ password: 'test-pass-123' }) });
  ok(li.status === 403, 'another website cannot sign in for you');
  li = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test-pass-123' }) });
  const sc = li.headers.get('set-cookie') || '';
  ok(li.status === 200 && /HttpOnly/.test(sc) && /Secure/.test(sc) && /SameSite=Lax/.test(sc), 'the right password gives a safe 30-day cookie');
  COOKIE_HDR = sc.split(';')[0];
  ok((await (await T('/team')).text()).includes('id="list"'), 'signed in, /team shows the team screen');
  ok((await T('/api/docs')).status === 200, 'signed in, the team list can be read');
  ok((await fetch(`${BASE}/api/docs`, { headers: { Cookie: 'jd_team=' + (Date.now() + 9e8) + '.fake' } })).status === 401, 'a made-up cookie does not work');

  console.log('Upload');
  let r = await j(await T(`/api/docs?title=Test%20Catalogue&name=cat.pdf&pages=1&code=Catalogue`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: tinyPdf('one') }));
  ok(r.status === 201, 'a PDF can be uploaded with a chosen name');
  ok(r.body?.code === 'catalogue', 'the chosen name is made lower-case: catalogue');
  ok(r.body?.link === 'https://docs.example.com/c/catalogue', 'the link inside the QR is the public address + /c/catalogue');
  const link1 = r.body.link;

  r = await j(await T(`/api/docs?title=x&name=x.pdf`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: Buffer.from('not a pdf at all') }));
  ok(r.status === 400, 'a file that is not a real PDF is refused');
  r = await j(await T(`/api/docs?title=x&name=x.pdf&code=catalogue`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: tinyPdf('dup') }));
  ok(r.status === 409, 'a name already in use cannot be taken again');
  r = await j(await T(`/api/docs?title=Auto&name=auto.pdf`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: tinyPdf('auto') }));
  ok(r.status === 201 && /^[2-9a-hjkmnp-z]{5}$/.test(r.body.code), 'without a chosen name, a 5-letter code with no look-alike letters is given: ' + r.body?.code);
  const auto = r.body.code;

  console.log('Scan page');
  let page = await fetch(`${BASE}/c/catalogue`);
  let html = await page.text();
  ok(page.status === 200 && html.includes('Test Catalogue'), 'the scan page opens and shows the name');
  ok(html.includes('og:title'), 'the scan page has a preview card for WhatsApp');
  ok((await fetch(`${BASE}/c/CATALOGUE`)).status === 200, 'capital letters in the link still work');
  const f1 = await fetch(`${BASE}/f/catalogue/1/cat.pdf`, { headers: { Range: 'bytes=0-7' } });
  ok(f1.status === 206 && (await f1.text()) === '%PDF-1.4', 'the PDF can be read in pieces (fast first page)');
  const js = await fetch(`${BASE}/js/view.js`, { headers: { 'Accept-Encoding': 'br' } });
  ok(js.headers.get('content-encoding') === 'br' && (await js.text()).includes('openReader'), 'scripts are sent compressed (about 4 times smaller on phones)');
  const pdfPart = await fetch(`${BASE}/f/catalogue/1/cat.pdf`, { headers: { Range: 'bytes=0-7', 'Accept-Encoding': 'br' } });
  ok(!pdfPart.headers.get('content-encoding') && (await pdfPart.text()) === '%PDF-1.4', 'PDFs are never compressed, so reading in pieces still works');
  const hub = await fetch(`${BASE}/`);
  const hubHtml = await hub.text();
  ok(hubHtml.includes('id="boot"') && hubHtml.includes('Test Catalogue'), 'the front page arrives with its list inside (one trip less)');
  r = await j(await T(`/api/docs/catalogue/versions/1/cover?w=720&h=1018`, { method: 'PUT', headers: { 'Content-Type': 'image/webp' }, body: Buffer.from('RIFFxxxxWEBP') }));
  ok(r.status === 200 && r.body.live.cover && !r.body.live.thumb, 'a cover picture is saved (its small copy comes next)');
  r = await j(await T(`/api/docs/catalogue/versions/1/thumb?w=360&h=509`, { method: 'PUT', headers: { 'Content-Type': 'image/webp' }, body: Buffer.from('RIFFyyyyWEBP') }));
  ok(r.status === 200 && /\/cover\/catalogue\/1-t\.webp$/.test(r.body.live.thumb || ''), 'the small copy of the cover is saved');
  const th = await fetch(`${BASE}/cover/catalogue/1-t.webp`);
  ok(th.status === 200 && (await th.text()) === 'RIFFyyyyWEBP', 'the small copy is served to lists and the front page');
  ok((await (await fetch(`${BASE}/`)).text()).includes('/cover/catalogue/1-t.webp'), 'the front page shows the small copy, not the full cover');

  console.log('Replace the PDF');
  r = await j(await T(`/api/docs/catalogue/versions?name=cat-v2.pdf&pages=1`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: tinyPdf('two') }));
  ok(r.status === 201 && r.body.current === 2, 'a new version is added');
  ok(r.body.link === link1, 'THE LINK (AND SO THE QR) IS EXACTLY THE SAME AFTER REPLACING');
  html = await (await fetch(`${BASE}/c/catalogue`)).text();
  ok(html.includes('/f/catalogue/2/'), 'scanning now opens version 2');
  const latest = await fetch(`${BASE}/f/catalogue/latest`, { redirect: 'manual' });
  ok(latest.status === 302 && latest.headers.get('location').includes('/f/catalogue/2/'), '/f/catalogue/latest always points to the newest file');
  r = await j(await T(`/api/docs/catalogue`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current: 1 }) }));
  ok(r.body.current === 1 && r.body.link === link1, 'you can switch back to version 1, same link');

  console.log('Counting scans');
  await fetch(`${BASE}/api/p/catalogue/scan`, { method: 'POST' });
  await fetch(`${BASE}/api/p/catalogue/scan`, { method: 'POST' });
  r = await j(await T(`/api/docs/catalogue`));
  ok(r.body.scans === 2, 'opens are counted');

  console.log('Visitors and queries (sales)');
  const post = (path, body) => fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await post('/api/track', { type: 'visit', code: 'catalogue', device: 'phone', source: 'whatsapp' });
  await post('/api/track', { type: 'download', code: 'catalogue', device: 'phone', visitor: { name: 'Ravi', email: 'ravi@example.com', company: 'Steel Co' } });
  await post('/api/track', { type: 'hub', device: 'computer' });
  await post('/api/track', { type: 'nonsense', code: 'catalogue' });
  await post('/api/track', { type: 'visit', code: 'no-such-thing' });
  r = await j(await T(`/api/docs/catalogue`));
  ok(r.body.scans === 3, 'a visit sent with the visitor details still counts as a scan');
  r = await j(await post('/api/inquiry', { name: 'Ravi', message: 'Price for 22220?' }));
  ok(r.status === 400, 'a query needs a name and an email or phone number');
  r = await j(await post('/api/inquiry', { name: 'Ravi', phone: '+91 98200 00000', company: 'Steel Co', message: 'Price for 22220 EJ?', code: 'catalogue', device: 'phone' }));
  ok(r.status === 201, 'a visitor can send a query about a catalogue');
  r = await j(await post('/api/inquiry', { name: 'Bot', email: 'bot@example.com', message: 'spam', website: 'http://spam' }));
  ok(r.status === 201, 'robots filling the hidden field get a polite "thanks"…');
  r = await j(await fetch(`${BASE}/api/insights`));
  ok(r.status === 401, 'visitor numbers and queries are for the team only');
  r = await j(await T(`/api/insights`));
  const s = r.body?.summary;
  ok(r.status === 200 && s.totals.visits === 2 && s.totals.downloads === 1 && s.totals.queries === 1, 'the team sees visits, downloads and queries (…but the robot\'s message is not saved)');
  ok(s.totals.people === 2 && s.catalogues[0]?.code === 'catalogue' && s.catalogues[0].download === 1, 'known visitors and each catalogue\'s numbers are counted');
  ok(r.body.inquiries[0]?.phone === '+91 98200 00000' && r.body.inquiries[0]?.title === 'Test Catalogue', 'the query keeps the phone number and which catalogue it was about');
  const csv = await T(`/api/insights/queries.csv`);
  const csvBytes = new Uint8Array(await csv.arrayBuffer());
  const csvText = new TextDecoder().decode(csvBytes);
  ok(csv.headers.get('content-type').startsWith('text/csv') && csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf && csvText.includes('Price for 22220 EJ?'), 'queries download as a CSV that Excel opens correctly');
  r = await j(await T(`/api/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exhibition: { name: 'IMTEX', start: '2026-12-01', end: '2026-11-01' } }) }));
  ok(r.status === 400, 'an exhibition cannot end before it starts');
  r = await j(await T(`/api/docs/catalogue`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brand: 'TIMKEN' }) }));
  ok(r.body.brand === 'Timken', 'a brand typed in other capitals joins the one already used (never "Timken" and "TIMKEN" side by side)');
  r = await j(await T(`/api/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exhibition: { name: 'IMTEX', start: '2026-01-01', end: '2026-01-05' } }) }));
  await post('/api/track', { type: 'visit', code: 'catalogue' });
  r = await j(await T(`/api/insights`));
  ok(r.body.exhibition?.name === 'IMTEX' && r.body.summary.phases?.after === 1, 'with exhibition dates, visits are marked before / during / after');
  r = await j(await T(`/api/docs/catalogue`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ media: [
    { kind: 'video', title: 'How it works', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, { kind: 'trial', title: 'Trial at a steel plant', url: 'javascript:alert(1)' }] }) }));
  ok(r.body.media?.length === 1 && r.body.media[0].kind === 'video', 'videos can be added to a catalogue (unsafe links are dropped)');
  html = await (await fetch(`${BASE}/c/catalogue`)).text();
  ok(html.includes('How it works') && html.includes('"menu":['), 'the catalogue page carries its videos and the menu of all catalogues');

  console.log('Archive and delete');
  r = await j(await T(`/api/docs/catalogue`, { method: 'DELETE' }));
  ok(r.status === 409, 'a live document cannot be deleted by mistake (archive first)');
  await T(`/api/docs/catalogue`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'archived' }) });
  html = await (await fetch(`${BASE}/c/catalogue`)).text();
  ok(html.includes('"status":"archived"'), 'an archived document shows "no longer available"');
  ok((await fetch(`${BASE}/f/catalogue/1/cat.pdf`)).status === 404, 'the file of an archived document cannot be downloaded');
  r = await j(await T(`/api/docs/catalogue`, { method: 'DELETE' }));
  ok(r.status === 200, 'an archived document can be deleted');
  r = await j(await T(`/api/check-code?code=catalogue`));
  ok(r.body.ok === false, 'a deleted code is never given to another document');
  page = await fetch(`${BASE}/c/catalogue`);
  ok(page.status === 404 && (await page.text()).includes('"status":"retired"'), 'its old QR still opens a polite page, not an error');
  ok((await fetch(`${BASE}/c/${auto}`)).status === 200, 'other documents are not affected');
  ok((await fetch(`${BASE}/c/nothing-here`)).status === 404, 'an unknown code shows the "nothing linked" page');

  console.log('The old catalog.jinharsh.com hub');
  ok(/15 catalogue\(s\) added/.test(imported), 'npm run import-hub brought across Mitul\'s 12 hub catalogues and the 3 older links');
  let mc = await j(await T('/api/docs/jinharsh-master-catalog'));
  ok(mc.status === 200 && mc.body.versions.length === 1 && !mc.body.live.waiting, 'a hub PDF found in the --pdfs folder goes live straight away');
  html = await (await fetch(`${BASE}/c/rexnord-colour-coating`)).text();
  ok(html.includes('"sourceUrl":"https://colourcoating.rexnord.co.in/"') && html.includes('"link":true'), 'an interactive guide (a website, not a PDF) is kept as a link and marked in the menu');
  let red = await fetch(`${BASE}/?cat=Timken-SRB`, { redirect: 'manual' });
  ok(red.status === 302 && red.headers.get('location') === '/c/timken-srb', 'old hub links (/?cat=timken-srb) go to the same catalogue');
  let w = await j(await T('/api/docs/timken-srb'));
  ok(w.status === 200 && w.body.versions.length === 0 && w.body.live.waiting === true, 'the hub catalogues were brought across, waiting for their PDF');
  ok(w.body.brand === 'Timken' && w.body.category === 'Bearings', 'with their brand and category');
  html = await (await fetch(`${BASE}/c/timken-srb`)).text();
  ok(html.includes('"status":"waiting"') && html.includes('timken.com'), 'its page works now and offers the maker\'s own copy');
  red = await fetch(`${BASE}/f/timken-srb/latest`, { redirect: 'manual' });
  ok(red.status === 302 && red.headers.get('location').includes('timken.com'), 'its "newest file" link goes to the maker\'s copy until ours is uploaded');
  html = await (await fetch(`${BASE}/c/drager-safety`)).text();
  ok(html.includes('"status":"waiting"') && !html.includes('"sourceUrl":"http'), 'a hub catalogue with no PDF anywhere shows "coming soon"');
  let cats = await j(await fetch(`${BASE}/api/catalogs`));
  ok(cats.status === 200 && cats.body.catalogs.some((c) => c.code === 'timken-srb' && c.waiting) && !cats.body.catalogs.some((c) => c.status === 'archived'), 'the public list has every live catalogue, none archived');
  ok(!JSON.stringify(cats.body).includes('scanDays'), 'the public list does not show opens or other team details');
  const up1 = await j(await T('/api/docs/timken-srb/versions?name=timken.pdf&pages=1', { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: tinyPdf('timken') }));
  ok(up1.status === 201 && up1.body.current === 1 && !up1.body.live.waiting && up1.body.link === 'https://docs.example.com/c/timken-srb', 'uploading its PDF makes it version 1, SAME LINK');
  html = await (await fetch(`${BASE}/c/timken-srb`)).text();
  ok(html.includes('"status":"live"') && html.includes('/f/timken-srb/1/'), 'and its page now shows our PDF');
  const ed = await j(await T('/api/docs/timken-srb', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brand: 'Timken', category: 'Bearings', note: 'New note', sourceUrl: 'javascript:alert(1)' }) }));
  ok(ed.body.note === 'New note' && ed.body.sourceUrl === '', 'details can be edited; a harmful "link" is refused');

  console.log('Safety');
  ok((await fetch(`${BASE}/..%2f..%2fpackage.json`)).status === 404, 'files outside the site cannot be read');
  ok((await fetch(`${BASE}/__samples/x.pdf`)).status !== 200, 'the private test folder is closed on a real address');
  ok((await T('/api/docs', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' })).status === 403, 'another website cannot change anything, even for a signed-in person');
  const lo = await T('/api/logout', { method: 'POST' });
  ok(/Max-Age=0/.test(lo.headers.get('set-cookie') || ''), 'signing out removes the cookie');
  let last = 0;
  for (let i = 0; i < 9; i++) last = (await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'guess' + i }) })).status;
  ok(last === 429, 'after 8 wrong tries, that address must wait 15 minutes');
} catch (e) {
  failed++; console.error(e);
} finally {
  srv.kill();
  rmSync(data, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
