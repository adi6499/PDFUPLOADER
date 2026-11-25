// Jinharsh Docs - the web server for the company server (and this computer).
// Upload a PDF, get a permanent link + QR code. Replace the PDF any time; the link and QR never change.
//
//   npm start            -> http://localhost:8180
//
// Settings: config.json (shared), config.local.json (this computer only, not in git), or environment variables
//   PORT, HOST, PUBLIC_URL (the address printed inside every QR code), DATA_DIR, MAX_UPLOAD_MB, TRUST_PROXY
// Every address the site answers is in app.mjs (the same program also runs as a trial copy on Vercel: api/index.js).
import http from 'node:http';
import { createApp } from './app.mjs';

const { handle, store, C, VERSION, describeAccess } = await createApp();
// Visits from other devices (phones on the office Wi-Fi) are written to the log, so "it doesn't open on my phone"
// can be told apart from "the phone never reached this computer". Behind the company server's web server every
// visit comes from this machine itself, so nothing is logged there.
const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const server = http.createServer((req, res) => {
  const ip = req.socket.remoteAddress || '';
  if (!LOCAL.has(ip)) {
    const t0 = Date.now();
    res.on('finish', () => console.log(`${new Date().toLocaleTimeString('en-IN')}  visit from ${ip.replace('::ffff:', '')}  ${req.method} ${req.url}  -> ${res.statusCode} (${Date.now() - t0} ms)`));
  }
  return handle(req, res);
});
server.requestTimeout = 15 * 60 * 1000; // big PDFs on slow connections
server.listen(C.PORT, C.HOST, () => {
  console.log(`Jinharsh Docs ${VERSION} running at http://${C.HOST === '0.0.0.0' ? 'localhost' : C.HOST}:${C.PORT}`);
  console.log(`QR codes point to: ${C.PUBLIC_URL}${C.PRINTABLE ? '' : '   (preview address - do not print these QR codes)'}`);
  console.log(`Files are kept: ${C.STORAGE === 'blob' ? 'in a Vercel Blob store' : 'in ' + C.DATA_DIR}`);
  console.log(describeAccess());
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await store.flush().catch(() => {}); process.exit(0); });
