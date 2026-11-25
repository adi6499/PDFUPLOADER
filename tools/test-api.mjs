// End-to-end check of the promises this site makes. Starts its own server on a spare port with an
// empty, throw-away data folder, so your real documents are never touched.   Run:  npm test
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const srv = spawn(process.execPath, [join(root, 'server', 'server.mjs')], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: data, PUBLIC_URL: 'https://docs.example.com' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((res, rej) => { srv.stdout.on('data', (d) => { if (String(d).includes('running')) res(); }); srv.on('exit', () => rej(new Error('server did not start'))); });

const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
try {
  console.log('Upload');
  let r = await j(await fetch(`${BASE}/api/docs?title=Test%20Catalogue&name=cat.pdf&pages=1&code=Catalogue`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: tinyPdf('one') }));
  ok(r.status === 201, 'a PDF can be uploaded with a chosen name');
  ok(r.body?.code === 'catalogue', 'the chosen name is made lower-case: catalogue');
  ok(r.body?.link === 'https://docs.example.com/c/catalogue', 'the link inside the QR is the public address + /c/catalogue');
  const link1 = r.body.link;

  r = await j(await fetch(`${BASE}/api/docs?title=x&name=x.pdf`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: Buffer.from('not a pdf at all') }));
  ok(r.status === 400, 'a file that is not a real PDF is refused');
  r = await j(await fetch(`${BASE}/api/docs?title=x&name=x.pdf&code=catalogue`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: tinyPdf('dup') }));
  ok(r.status === 409, 'a name already in use cannot be taken again');
  r = await j(await fetch(`${BASE}/api/docs?title=Auto&name=auto.pdf`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: tinyPdf('auto') }));
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

  console.log('Replace the PDF');
  r = await j(await fetch(`${BASE}/api/docs/catalogue/versions?name=cat-v2.pdf&pages=1`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: tinyPdf('two') }));
  ok(r.status === 201 && r.body.current === 2, 'a new version is added');
  ok(r.body.link === link1, 'THE LINK (AND SO THE QR) IS EXACTLY THE SAME AFTER REPLACING');
  html = await (await fetch(`${BASE}/c/catalogue`)).text();
  ok(html.includes('/f/catalogue/2/'), 'scanning now opens version 2');
  const latest = await fetch(`${BASE}/f/catalogue/latest`, { redirect: 'manual' });
  ok(latest.status === 302 && latest.headers.get('location').includes('/f/catalogue/2/'), '/f/catalogue/latest always points to the newest file');
  r = await j(await fetch(`${BASE}/api/docs/catalogue`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current: 1 }) }));
  ok(r.body.current === 1 && r.body.link === link1, 'you can switch back to version 1, same link');

  console.log('Counting scans');
  await fetch(`${BASE}/api/p/catalogue/scan`, { method: 'POST' });
  await fetch(`${BASE}/api/p/catalogue/scan`, { method: 'POST' });
  r = await j(await fetch(`${BASE}/api/docs/catalogue`));
  ok(r.body.scans === 2, 'opens are counted');

  console.log('Archive and delete');
  r = await j(await fetch(`${BASE}/api/docs/catalogue`, { method: 'DELETE' }));
  ok(r.status === 409, 'a live document cannot be deleted by mistake (archive first)');
  await fetch(`${BASE}/api/docs/catalogue`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'archived' }) });
  html = await (await fetch(`${BASE}/c/catalogue`)).text();
  ok(html.includes('"status":"archived"'), 'an archived document shows "no longer available"');
  ok((await fetch(`${BASE}/f/catalogue/1/cat.pdf`)).status === 404, 'the file of an archived document cannot be downloaded');
  r = await j(await fetch(`${BASE}/api/docs/catalogue`, { method: 'DELETE' }));
  ok(r.status === 200, 'an archived document can be deleted');
  r = await j(await fetch(`${BASE}/api/check-code?code=catalogue`));
  ok(r.body.ok === false, 'a deleted code is never given to another document');
  page = await fetch(`${BASE}/c/catalogue`);
  ok(page.status === 404 && (await page.text()).includes('"status":"retired"'), 'its old QR still opens a polite page, not an error');
  ok((await fetch(`${BASE}/c/${auto}`)).status === 200, 'other documents are not affected');
  ok((await fetch(`${BASE}/c/nothing-here`)).status === 404, 'an unknown code shows the "nothing linked" page');

  console.log('Safety');
  ok((await fetch(`${BASE}/..%2f..%2fpackage.json`)).status === 404, 'files outside the site cannot be read');
  ok((await fetch(`${BASE}/__samples/x.pdf`)).status !== 200, 'the private test folder is closed on a real address');
} catch (e) {
  failed++; console.error(e);
} finally {
  srv.kill();
  rmSync(data, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
