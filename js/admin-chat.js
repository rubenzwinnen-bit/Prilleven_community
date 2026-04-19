// Admin dashboard — laadt stats uit /api/admin/* endpoints.
// Toegang: vereist een ingelogde user met is_admin = true.

import { sessionGet, sessionRefreshIfNeeded, sessionClear, fetchSubscriptionStatus } from './supabase.js';

const gate = document.getElementById('gate');
const dashboard = document.getElementById('dashboard');
const tabs = document.querySelectorAll('.admin-tab');

// ---------- Auth gate ----------
async function checkAccess() {
  const session = await sessionRefreshIfNeeded();
  if (!session || !session.email) {
    sessionClear();
    window.location.href = '/';
    return false;
  }
  const status = await fetchSubscriptionStatus(session.email);
  if (!status.is_admin) {
    gate.innerHTML = '<div class="error-box">🔒 Admin-rechten vereist. <a href="/">Terug naar site</a></div>';
    return false;
  }
  return true;
}

async function authedFetch(path) {
  const session = await sessionRefreshIfNeeded();
  if (!session) throw new Error('Geen sessie');
  const res = await fetch(path, {
    headers: { Authorization: 'Bearer ' + session.access_token },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `${res.status}`);
  }
  return res.json();
}

// ---------- Formatters ----------
function fmtCents(c) {
  return '€' + (Number(c || 0) / 100).toFixed(2);
}
function fmtNum(n) {
  return new Intl.NumberFormat('nl-BE').format(Number(n || 0));
}
function fmtPct(v) {
  return (Number(v || 0) * 100).toFixed(1) + '%';
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' }) +
    ' ' + d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
}
function fmtRelTime(iso) {
  if (!iso) return 'nooit';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'net';
  if (s < 3600) return Math.floor(s / 60) + ' min geleden';
  if (s < 86400) return Math.floor(s / 3600) + ' u geleden';
  return Math.floor(s / 86400) + ' d geleden';
}
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}
function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ---------- Global stats ----------
async function loadGlobalStats() {
  const el = document.getElementById('global-stats');
  try {
    const data = await authedFetch('/api/admin?section=global');
    el.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="label">Actieve gebruikers</div>
          <div class="value">${fmtNum(data.users.active)}</div>
          <div class="sub">van ${fmtNum(data.users.total)} totaal</div>
        </div>
        <div class="stat-card">
          <div class="label">Vragen vandaag</div>
          <div class="value">${fmtNum(data.today.queries)}</div>
          <div class="sub">${fmtNum(data.today.cache_hits)} cache-hits</div>
        </div>
        <div class="stat-card">
          <div class="label">Kosten vandaag</div>
          <div class="value">${fmtCents(data.today.cost_cents)}</div>
          <div class="sub">${fmtNum(data.today.tokens_in + data.today.tokens_out)} tokens</div>
        </div>
        <div class="stat-card">
          <div class="label">Cache hit rate</div>
          <div class="value">${fmtPct(data.today.cache_hit_rate)}</div>
          <div class="sub">vandaag</div>
        </div>
        <div class="stat-card">
          <div class="label">Rate-limit hits</div>
          <div class="value">${fmtNum(data.today.rate_limit_hits)}</div>
          <div class="sub">vandaag</div>
        </div>
        <div class="stat-card">
          <div class="label">Vragen deze maand</div>
          <div class="value">${fmtNum(data.month.queries)}</div>
          <div class="sub">${fmtCents(data.month.cost_cents)} totaal</div>
        </div>
      </div>
    `;
  } catch (err) {
    el.innerHTML = '<div class="error-box">Kon statistieken niet laden: ' + esc(err.message) + '</div>';
  }
}

// ---------- Users ----------
let usersCache = [];
let usersSort = { col: 'cost_cents_30d', dir: 'desc' };

function renderUsersTable() {
  const el = document.getElementById('users-table');
  const search = (document.getElementById('users-search').value || '').toLowerCase().trim();
  let rows = usersCache;
  if (search) rows = rows.filter(r => (r.email || '').toLowerCase().includes(search));

  rows.sort((a, b) => {
    const va = a[usersSort.col]; const vb = b[usersSort.col];
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (typeof va === 'string') return usersSort.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    return usersSort.dir === 'asc' ? va - vb : vb - va;
  });

  document.getElementById('users-count').textContent = `${rows.length} gebruikers`;

  if (rows.length === 0) { el.innerHTML = '<div class="empty">Geen gebruikers gevonden.</div>'; return; }

  const header = (col, label) => `<th data-sort="${col}" style="cursor:pointer;">${label} ${usersSort.col === col ? (usersSort.dir === 'asc' ? '▲' : '▼') : ''}</th>`;

  el.innerHTML = `
    <table>
      <thead>
        <tr>
          ${header('email', 'Email')}
          <th>Abonnement</th>
          ${header('queries_30d', 'Vragen 30d')}
          ${header('tokens_in_30d', 'Tokens in')}
          ${header('tokens_out_30d', 'Tokens uit')}
          ${header('cost_cents_30d', 'Kosten 30d')}
          ${header('rate_limit_hits_30d', 'Rate hits')}
          ${header('conversations', 'Gesprekken')}
          ${header('memories', 'Geheugen')}
          ${header('last_activity', 'Laatst actief')}
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>
              ${esc(r.email)}
              ${r.is_admin ? '<span class="pill ok" style="margin-left:.3rem;">admin</span>' : ''}
              ${!r.has_registered ? '<span class="pill gray" style="margin-left:.3rem;">niet geregistreerd</span>' : ''}
            </td>
            <td>
              ${r.subscription_active
                ? `<span class="pill ok">actief</span>`
                : `<span class="pill err">inactief</span>`}
              ${r.cancelled_at ? '<div class="row-details">opgezegd ' + fmtRelTime(r.cancelled_at) + '</div>' : ''}
              ${r.subscription_end_date ? '<div class="row-details">einde: ' + fmtDate(r.subscription_end_date) + '</div>' : ''}
            </td>
            <td>${fmtNum(r.queries_30d)}</td>
            <td>${fmtNum(r.tokens_in_30d)}</td>
            <td>${fmtNum(r.tokens_out_30d)}</td>
            <td>${fmtCents(r.cost_cents_30d)}</td>
            <td>${r.rate_limit_hits_30d > 0 ? '<span class="pill warn">' + r.rate_limit_hits_30d + '</span>' : '0'}</td>
            <td>${fmtNum(r.conversations)}</td>
            <td>${fmtNum(r.memories)}</td>
            <td>${fmtRelTime(r.last_activity)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  // Hook sortable headers
  el.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (usersSort.col === col) usersSort.dir = usersSort.dir === 'asc' ? 'desc' : 'asc';
      else { usersSort.col = col; usersSort.dir = 'desc'; }
      renderUsersTable();
    });
  });
}

async function loadUsers() {
  const el = document.getElementById('users-table');
  try {
    const data = await authedFetch('/api/admin?section=users');
    usersCache = data.users || [];
    renderUsersTable();
  } catch (err) {
    el.innerHTML = '<div class="error-box">Kon gebruikers niet laden: ' + esc(err.message) + '</div>';
  }
}

// ---------- Recent queries ----------
async function loadQueries() {
  const el = document.getElementById('queries-table');
  try {
    const data = await authedFetch('/api/admin?section=queries&limit=50');
    const rows = data.queries || [];
    if (rows.length === 0) { el.innerHTML = '<div class="empty">Nog geen vragen.</div>'; return; }
    el.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Tijd</th>
            <th>Gebruiker</th>
            <th>Vraag</th>
            <th>Model</th>
            <th>Tokens</th>
            <th>Bronnen</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${fmtDate(r.timestamp)}</td>
              <td>${esc(r.email)}</td>
              <td>
                <div style="max-width:380px;">${esc(truncate(r.question, 120))}</div>
                <div class="row-details">→ ${esc(truncate(r.answer_preview, 90))}</div>
              </td>
              <td>${esc(r.model || '—')}</td>
              <td>${fmtNum(r.tokens_in)} / ${fmtNum(r.tokens_out)}</td>
              <td>${r.retrieved_count} chunks${r.had_image ? ' 📷' : ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    el.innerHTML = '<div class="error-box">Kon vragen niet laden: ' + esc(err.message) + '</div>';
  }
}

// ---------- Subscription events ----------
async function loadEvents() {
  const el = document.getElementById('events-table');
  const search = (document.getElementById('events-search').value || '').trim();
  try {
    const q = search ? `&email=${encodeURIComponent('%' + search + '%')}` : '';
    const data = await authedFetch('/api/admin?section=events&limit=100' + q);
    const rows = data.events || [];
    if (rows.length === 0) { el.innerHTML = '<div class="empty">Nog geen events.</div>'; return; }

    const pillForCategory = cat => {
      if (cat === 'activated') return '<span class="pill ok">activated</span>';
      if (cat === 'cancelled') return '<span class="pill warn">cancelled</span>';
      if (cat === 'expired') return '<span class="pill err">expired</span>';
      return '<span class="pill gray">' + esc(cat) + '</span>';
    };

    el.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Tijd</th>
            <th>Email</th>
            <th>Type</th>
            <th>Categorie</th>
            <th>Cyclus</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${fmtDate(r.received_at)}</td>
              <td>${esc(r.email)}</td>
              <td>${esc(r.event_type || '—')}</td>
              <td>${pillForCategory(r.category)}</td>
              <td>${esc(r.cycle || '—')}</td>
              <td>
                ${r.applied ? '<span class="pill ok">toegepast</span>' : '<span class="pill err">fout</span>'}
                ${r.error ? '<div class="row-details">' + esc(r.error) + '</div>' : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    el.innerHTML = '<div class="error-box">Kon events niet laden: ' + esc(err.message) + '</div>';
  }
}

// ---------- Tab switching ----------
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
  });
});

document.getElementById('users-search').addEventListener('input', () => renderUsersTable());
document.getElementById('events-search').addEventListener('input', debounce(() => loadEvents(), 400));

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------- Init ----------
async function init() {
  const ok = await checkAccess();
  if (!ok) return;
  gate.style.display = 'none';
  dashboard.style.display = '';

  await Promise.all([
    loadGlobalStats(),
    loadUsers(),
    loadQueries(),
    loadEvents(),
  ]);
}

init();
