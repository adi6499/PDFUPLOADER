// Sets (or changes) the team password.   Run on the server:  npm run password
// The password is stored only as a scrambled hash in <dataDir>/auth.json. Changing it signs everybody out.
// The running server notices the change by itself within a few seconds; no restart needed.
import { loadConfig } from '../server/config.mjs';
import { writeAuth } from '../server/auth.mjs';

const { DATA_DIR } = loadConfig();

function ask(question) {
  return new Promise((resolve) => {
    const out = process.stdout, inp = process.stdin;
    out.write(question);
    if (!inp.isTTY) { // piped in: read one line
      let buf = '';
      inp.setEncoding('utf8');
      inp.on('data', (c) => { buf += c; const i = buf.indexOf('\n'); if (i >= 0) { inp.pause(); resolve(buf.slice(0, i).replace(/\r$/, '')); } });
      inp.on('end', () => resolve(buf.replace(/\r?\n$/, '')));
      return;
    }
    let pw = '';
    inp.setRawMode(true); inp.resume(); inp.setEncoding('utf8');
    const onKey = (k) => {
      for (const ch of k) {
        if (ch === '\r' || ch === '\n') { inp.setRawMode(false); inp.pause(); inp.removeListener('data', onKey); out.write('\n'); resolve(pw); return; }
        if (ch === '\u0003') { out.write('\nStopped. Nothing was changed.\n'); process.exit(1); }
        if (ch === '\u007f' || ch === '\b') { if (pw.length) { pw = pw.slice(0, -1); out.write('\b \b'); } continue; }
        pw += ch; out.write('*');
      }
    };
    inp.on('data', onKey);
  });
}

console.log('Jinharsh Docs - team password');
console.log('Everyone on the team uses this one password to upload and manage PDFs. Customers never need it.\n');
const a = await ask('New team password (at least 8 characters): ');
if (a.length < 8) { console.log('Too short. Nothing was changed.'); process.exit(1); }
if (process.stdin.isTTY) {
  const b = await ask('Type it again: ');
  if (a !== b) { console.log('The two did not match. Nothing was changed.'); process.exit(1); }
}
const file = await writeAuth(DATA_DIR, a);
console.log(`\nSaved (as a scrambled hash) in ${file}`);
console.log('Anyone who was signed in must sign in again with the new password.');
process.exit(0);
