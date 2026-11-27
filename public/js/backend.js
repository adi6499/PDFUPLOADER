// How the public pages reach the server, all in one place: the address of a catalogue's page, visit counting,
// queries, and whether this person may upload. The copy of these pages that runs on the PHP catalogue hub
// (catalog.jinharsh.com, built by tools/php-hub/build.mjs) swaps only this file, so every other file is the same.
// Nothing here may touch the page when the file is loaded: the server imports markup.js, which imports this.

// a catalogue's own page (printed QR codes carry it, so the form never changes)
export const catPath = (code) => `/c/${code}`;
export const teamPath = '/team';

// a visit, a read, a download, a share... ev = { type, code, device, source, visitor }
export function sendTrack(ev) {
  const body = JSON.stringify(ev);
  if (navigator.sendBeacon && navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }))) return;
  fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
}

// a visitor's question. q = { name, company, email, phone, message, website, code, title, device, source }
export async function sendInquiry(q) {
  const r = await fetch('/api/inquiry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(q) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Could not send. Please try again.');
}

// "I am on this page" (a catalogue's code, or '' for the front page), so the team can see who is looking right now;
// visitors get back only { ok }. leave = this page is closing.
export async function sendPing({ code = '', id = '', leave = false }) {
  const body = JSON.stringify({ code, id, leave });
  if (leave) { try { navigator.sendBeacon('/api/ping', new Blob([body], { type: 'application/json' })); } catch {} return null; }
  const r = await fetch('/api/ping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, cache: 'no-store' });
  return r.ok ? r.json() : null;
}

// may this person upload catalogues (the Upload button on the front page)
export const canUpload = () => fetch('/api/info').then((r) => r.json()).then((i) => !!(i && i.auth && i.auth.signedIn)).catch(() => false);
