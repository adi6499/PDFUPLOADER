// "Visitors & queries" on the team page: who opened, read and downloaded which catalogue, the queries visitors
// sent (with one-tap call, WhatsApp and email), the numbers per catalogue, the last 30 days, the exhibition dates,
// and Excel (CSV) copies of the visits and the queries. The data comes from /api/insights (server/activity.mjs).
import { icon } from '/vendor/icons.js?v=3';
import * as M from './motion.js';
import { swallow, pourInto } from './particles.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (t) => { try { JUI.toast(t); } catch {} };
const WHAT = { visit: 'Opened', hub: 'Front page', read: 'Read online', download: 'Downloaded', share: 'Shared', video: 'Watched a video', query: 'Sent a query' };
const DEVICE = { phone: 'Phone', tablet: 'Tablet', computer: 'Computer' };
const PHASE = { before: 'Before the exhibition', during: 'During the exhibition', after: 'After the exhibition' };
const nf = (n) => Number(n || 0).toLocaleString('en-IN');
const when = (t) => {
  if (!t) return '';
  const [d, hm] = t.split(' ');
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const yest = new Date(Date.now() + 5.5 * 3600e3 - 864e5).toISOString().slice(0, 10);
  const day = d === today ? 'Today' : d === yest ? 'Yesterday' : new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `${day}, ${hm}`;
};
const waNumber = (p) => { let d = String(p || '').replace(/\D/g, ''); if (d.length === 10) d = '91' + d; return d.length >= 11 ? d : ''; };

export async function openInsights({ from = null } = {}) {
  const ov = document.createElement('div');
  ov.className = 'ju-overlay';
  ov.innerHTML = `<div class="ju-sheet wide insights" role="dialog" aria-modal="true" aria-label="Visitors and queries">
    <button class="ju-icon close-x" type="button" data-x aria-label="Close">${icon('x')}</button>
    <div class="ju-eyebrow">Visitors & queries</div>
    <h2>Who looked at your catalogues</h2>
    <div class="in-body"><div class="in-loading">${icon('chart-column')}Loading…</div></div>
  </div>`;
  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';
  const sheet = ov.querySelector('.insights'), body = ov.querySelector('.in-body');
  if (from) { try { const r = from.getBoundingClientRect(); pourInto({ left: r.left, top: r.top, width: r.width, height: r.height }, sheet); } catch {} }
  let closed = false;
  const close = (at) => {
    if (closed) return; closed = true;
    document.removeEventListener('keydown', onKey);
    swallow(sheet, { at });
    M.play(ov, [{ opacity: 1 }, { opacity: 0 }], { duration: 460, easing: 'ease-in' }).then(() => { ov.remove(); document.body.style.overflow = ''; });
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('click', (e) => {
    if (e.target === ov) return close();
    const x = e.target.closest('[data-x]');
    if (x) { const b = x.getBoundingClientRect(); close({ x: b.left + b.width / 2, y: b.top + b.height / 2 }); }
  });

  let D = null, tab = 'queries';
  async function load() {
    const r = await fetch('/api/insights');
    if (r.status === 401) { location.reload(); return; }
    D = await r.json();
    if (!r.ok) throw new Error(D.error || 'Could not load the numbers');
  }
  try { await load(); } catch (e) { body.innerHTML = `<p class="bad">${esc(e.message)}</p>`; return; }

  function render(first = false) {
    const s = D.summary, t = s.totals, ex = D.exhibition;
    const tiles = [
      ['Visits', t.visits, t.today ? `${nf(t.today)} today` : 'catalogue pages opened', 'users'],
      ['Read online', t.reads, 'opened the reader', 'book-open'],
      ['Downloads', t.downloads, 'PDFs downloaded', 'arrow-down-to-line'],
      ['Queries', t.queries, 'sent to the team', 'message-square-text'],
      ['People', t.people, 'left a name or number', 'user'],
    ];
    const max = Math.max(1, ...s.days.map((d) => d.visits));
    body.innerHTML = `
      ${ex ? `<div class="in-ex"><span class="ju-pill ${s.phase === 'during' ? 'ok' : ''}">${icon('calendar-days')}${esc(ex.name)} · ${esc(PHASE[s.phase] || '')}</span>
        ${s.phases ? `<span class="ju-muted">Visits before ${nf(s.phases.before)} · during ${nf(s.phases.during)} · after ${nf(s.phases.after)}</span>` : ''}</div>` : ''}
      <div class="in-tiles">${tiles.map(([k, n, sub, ic]) => `<div class="in-tile">${icon(ic)}<b data-n="${n}">${first ? 0 : nf(n)}</b><span>${k}</span><small>${sub}</small></div>`).join('')}</div>
      <div class="in-days" aria-label="Visits in the last 30 days">${s.days.map((d) => `<i style="--h:${Math.round((d.visits / max) * 100)}%" title="${esc(d.day)}: ${d.visits} visits, ${d.downloads} downloads"></i>`).join('')}</div>
      <div class="in-days-cap"><span>30 days ago</span><span>Today</span></div>
      <div class="ju-seg in-tabs" role="tablist">
        ${[['queries', `Queries (${nf(t.queries)})`], ['catalogues', 'Catalogues'], ['activity', 'Activity'], ['exhibition', 'Exhibition']]
          .map(([k, l]) => `<button type="button" data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}
      </div>
      <div class="in-panel">${panel()}</div>
      <div class="btns in-foot">
        <a class="ju-btn" href="/api/insights/queries.csv" download>${icon('file-spreadsheet')}Queries for Excel</a>
        <a class="ju-btn" href="/api/insights/visits.csv" download>${icon('file-spreadsheet')}Visits for Excel</a>
      </div>
      <p class="ju-small ju-muted in-note">${D.keepsVisits ? '' : 'This trial copy keeps queries but not visits. '}${D.forwards ? 'Each query is also sent to Odoo. ' : ''}People who sign in to this team page are not counted.</p>`;
    if (first) {
      // the numbers count up and the bars grow
      body.querySelectorAll('.in-tile b').forEach((b) => {
        const n = Number(b.dataset.n), t0 = performance.now(), dur = 700;
        const step = (now) => { const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3); b.textContent = nf(Math.round(n * e)); if (p < 1) requestAnimationFrame(step); };
        requestAnimationFrame(step);
        setTimeout(() => { b.textContent = nf(n); }, dur + 200);
      });
      M.rise(body.querySelectorAll('.in-tile'), { step: 50 });
      requestAnimationFrame(() => body.querySelector('.in-days')?.classList.add('grown'));
    } else body.querySelector('.in-days')?.classList.add('grown');
  }

  function panel() {
    const s = D.summary;
    if (tab === 'queries') {
      if (!D.inquiries.length) return `<div class="in-empty">${icon('message-square-text')}<b>No queries yet</b><p class="ju-muted">They appear here as soon as a visitor sends one from a catalogue page.</p></div>`;
      return `<div class="in-queries">${D.inquiries.map((q) => {
        const wa = waNumber(q.phone);
        return `<article class="in-q">
          <div class="in-q-head"><b>${esc(q.name)}</b>${q.company ? `<span>${esc(q.company)}</span>` : ''}<time>${esc(when(q.time))}</time></div>
          ${q.message ? `<p>${esc(q.message)}</p>` : ''}
          <div class="in-q-meta">${q.title ? `<span class="ju-pill">${icon('file-text')}${esc(q.title)}</span>` : ''}${q.phase ? `<span class="ju-muted">${esc(PHASE[q.phase])}</span>` : ''}${q.device ? `<span class="ju-muted">${esc(DEVICE[q.device] || q.device)}</span>` : ''}${q.source ? `<span class="ju-muted">from ${esc(q.source)}</span>` : ''}</div>
          <div class="in-q-acts">
            ${q.phone ? `<a class="ju-btn sm" href="tel:${esc(q.phone.replace(/[^\d+]/g, ''))}">${icon('phone')}${esc(q.phone)}</a>` : ''}
            ${wa ? `<a class="ju-btn sm" href="https://wa.me/${wa}?text=${encodeURIComponent(`Hello ${q.name}, this is Jinharsh about your query${q.title ? ' on ' + q.title : ''}.`)}" target="_blank" rel="noopener">${icon('message-circle')}WhatsApp</a>` : ''}
            ${q.email ? `<a class="ju-btn sm" href="mailto:${esc(q.email)}?subject=${encodeURIComponent('Your query' + (q.title ? ': ' + q.title : ''))}">${icon('mail')}${esc(q.email)}</a>` : ''}
          </div>
        </article>`;
      }).join('')}</div>`;
    }
    if (tab === 'catalogues') {
      if (!s.catalogues.length) return `<div class="in-empty">${icon('chart-column')}<b>No visits yet</b><p class="ju-muted">Each catalogue's numbers appear here once people start opening them.</p></div>`;
      return `<div class="in-table-wrap"><table class="in-table"><thead><tr><th>Catalogue</th><th>Opened</th><th>Read</th><th>Downloaded</th><th>Shared</th><th>Videos</th><th>Queries</th></tr></thead>
        <tbody>${s.catalogues.map((c) => `<tr><td><a href="/c/${esc(c.code)}?preview=1" target="_blank" rel="noopener">${esc(c.title)}</a></td><td>${nf(c.visit)}</td><td>${nf(c.read)}</td><td>${nf(c.download)}</td><td>${nf(c.share)}</td><td>${nf(c.video)}</td><td>${nf(c.query)}</td></tr>`).join('')}</tbody></table></div>
        <div class="in-split">
          ${list('Devices', s.devices.map(([k, n]) => [DEVICE[k] || k, n]))}
          ${list('Came from', s.sources)}
          ${s.places.length ? list('Places', s.places) : ''}
        </div>`;
    }
    if (tab === 'activity') {
      if (!D.events.length) return `<div class="in-empty">${icon('users')}<b>Nothing yet</b><p class="ju-muted">${D.keepsVisits ? 'Visits appear here as people open the catalogues.' : 'This trial copy does not keep visits.'}</p></div>`;
      return `<div class="in-acts">${D.events.map((e) => `<div class="in-act">
        <time>${esc(when(e.time))}</time>
        <span class="in-what t-${esc(e.type)}">${esc(WHAT[e.type] || e.type)}</span>
        <span class="in-cat">${esc(e.title || (e.type === 'hub' ? 'All catalogues' : ''))}</span>
        <span class="ju-muted">${[DEVICE[e.device], e.source, [e.city, e.country].filter(Boolean).join(', '), e.visitor ? [e.visitor.name, e.visitor.company].filter(Boolean).join(' · ') : ''].filter(Boolean).map(esc).join(' · ')}</span>
      </div>`).join('')}</div>`;
    }
    const ex = D.exhibition || {};
    return `<form class="in-exform">
      <p class="ju-muted">Set the exhibition's dates and every visit and query is marked as before, during or after it, so you can see what happened after the show.</p>
      <label class="field"><span>Exhibition name</span><input class="ju-inp" name="name" maxlength="80" value="${esc(ex.name || '')}" placeholder="e.g. IMTEX 2027, Bengaluru"></label>
      <div class="two">
        <label class="field"><span>First day</span><input class="ju-inp" name="start" type="date" value="${esc(ex.start || '')}"></label>
        <label class="field"><span>Last day</span><input class="ju-inp" name="end" type="date" value="${esc(ex.end || '')}"></label>
      </div>
      <div class="btns">
        <button class="ju-btn primary" type="submit">${icon('check')}Save</button>
        ${D.exhibition ? `<button class="ju-btn ghost" type="button" data-clear-ex>No exhibition</button>` : ''}
      </div>
    </form>`;
  }
  const list = (title, rows) => `<div class="in-list"><h3>${esc(title)}</h3>${rows.length ? rows.slice(0, 8).map(([k, n]) => `<div><span>${esc(k)}</span><b>${nf(n)}</b></div>`).join('') : '<p class="ju-muted">None yet</p>'}</div>`;

  async function saveEx(exhibition) {
    const r = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exhibition }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast(j.error || 'Could not save'); return; }
    toast(exhibition ? 'Exhibition dates saved' : 'Exhibition cleared');
    await load(); render();
  }
  body.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) {
      tab = t.dataset.tab;
      body.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b === t));
      const p = body.querySelector('.in-panel');
      M.resize(sheet, () => { p.innerHTML = panel(); });
      M.rise([p], { y: 8 });
      return;
    }
    if (e.target.closest('[data-clear-ex]')) saveEx(null);
  });
  body.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const name = f.elements.name.value.trim(), start = f.elements.start.value, end = f.elements.end.value;
    if (!start || !end) { M.shake(f.querySelector('.two')); return; }
    saveEx({ name, start, end });
  });
  render(true);
}
