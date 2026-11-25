// Team sign-in. On success the server sets a cookie for 30 days and the page reloads into the team screen.
import { shake } from './motion.js';

const form = document.getElementById('form');
const pw = document.getElementById('pw');
const msg = document.getElementById('msg');
const go = document.getElementById('go');

fetch('/api/info').then((r) => r.json()).then((j) => {
  if (j.auth && !j.auth.passwordSet) {
    document.getElementById('lead').textContent = 'No team password has been set on the server yet. Ask whoever looks after the server to run: npm run password';
    pw.disabled = go.disabled = true;
  }
}).catch(() => {});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!pw.value) { pw.focus(); shake(form); return; }
  go.disabled = true; msg.textContent = '';
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw.value }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { form.classList.add('signin-ok'); setTimeout(() => location.replace('/'), 260); return; }
    msg.textContent = j.error || 'Could not sign in.';
    pw.select(); shake(form);
  } catch {
    msg.textContent = 'Cannot reach the server. Check the internet connection.';
    shake(form);
  }
  go.disabled = false;
});
