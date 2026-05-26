/* ============================================
   ADMIN DASHBOARD
   Tabbladen voor beheer. Huidig: Chat (reports queue).
============================================ */

import { showToast, escapeHtml, confirm as confirmDialog, nl2br, formatRelativeTime } from '../utils.js?v=2.9.0';
import { listReports, resolveReport } from '../communityApi.js?v=2.9.0';

const TABS = [
  { id: 'chat', label: 'Chat' },
];

export function render() {
  const tabHeaders = TABS.map(t =>
    `<button class="admin-tab-btn ${t.id === 'chat' ? 'is-active' : ''}" data-tab="${t.id}">${t.label}</button>`
  ).join('');

  return `
    <div class="admin-dashboard" id="admin-dashboard">
      <div class="admin-dashboard-head">
        <h1 class="admin-dashboard-title">🛡 Admin dashboard</h1>
      </div>
      <div class="admin-tab-bar">
        ${tabHeaders}
      </div>
      <div class="admin-tab-content" id="admin-tab-content">
        <div class="tl-empty">Laden…</div>
      </div>
    </div>
  `;
}

export async function init() {
  const dashboard = document.getElementById('admin-dashboard');
  if (!dashboard) return;

  const tabBar    = dashboard.querySelector('.admin-tab-bar');
  const content   = document.getElementById('admin-tab-content');

  let activeTab = 'chat';

  const loadTab = async (tabId) => {
    activeTab = tabId;
    tabBar.querySelectorAll('.admin-tab-btn').forEach(b => {
      b.classList.toggle('is-active', b.dataset.tab === tabId);
    });
    if (tabId === 'chat') {
      await renderChatTab(content);
    }
  };

  tabBar.addEventListener('click', (e) => {
    const btn = e.target.closest('.admin-tab-btn');
    if (btn) loadTab(btn.dataset.tab);
  });

  await loadTab('chat');
}

/* ============================================
   TAB: Chat — reports queue
============================================ */
async function renderChatTab(content) {
  content.innerHTML = `
    <div class="admin-reports-wrap">
      <div class="admin-reports-toolbar">
        <h2 class="admin-reports-subtitle">Reports queue</h2>
        <button type="button" class="btn btn-outline btn-sm" id="admin-reports-refresh">Vernieuwen</button>
      </div>
      <div class="admin-reports-list" id="admin-reports-list">
        <div class="tl-empty">Laden…</div>
      </div>
    </div>
  `;

  const list = content.querySelector('#admin-reports-list');

  document.getElementById('admin-reports-refresh')?.addEventListener('click', () => refreshReports(list));

  await refreshReports(list);

  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const row = btn.closest('.tl-report-row');
    if (!row) return;
    const reportId = row.dataset.reportId;

    if (btn.dataset.action === 'report-dismiss') {
      btn.disabled = true;
      const { ok, error } = await resolveReport(reportId);
      if (!ok) { btn.disabled = false; showToast(error || 'Mislukt', 'error'); return; }
      row.remove();
      showToast('Melding gesloten');
      ensureEmpty(list);
    } else if (btn.dataset.action === 'report-delete') {
      const ok = await confirmDialog('Verwijder dit bericht én sluit de melding?');
      if (!ok) return;
      btn.disabled = true;
      const { ok: success, error } = await resolveReport(reportId, { delete_target: true });
      if (!success) { btn.disabled = false; showToast(error || 'Mislukt', 'error'); return; }
      row.remove();
      showToast('Verwijderd en gesloten');
      ensureEmpty(list);
    }
  });
}

async function refreshReports(list) {
  list.innerHTML = `<div class="tl-empty">Laden…</div>`;
  const { ok, data, error } = await listReports();
  if (!ok) {
    list.innerHTML = `<div class="tl-empty tl-error">Kon reports niet laden: ${escapeHtml(error)}</div>`;
    return;
  }
  const reports = data.reports || [];
  if (reports.length === 0) {
    list.innerHTML = `<div class="tl-empty">Geen openstaande meldingen 🎉</div>`;
    return;
  }
  list.innerHTML = reports.map(renderReportRow).join('');
}

function ensureEmpty(list) {
  if (!list.querySelector('.tl-report-row')) {
    list.innerHTML = `<div class="tl-empty">Geen openstaande meldingen 🎉</div>`;
  }
}

function renderReportRow(rep) {
  const t = rep.target;
  const targetBody = t?.body
    ? nl2br(escapeHtml(t.body.slice(0, 240))) + (t.body.length > 240 ? '…' : '')
    : '<em>(verwijderd)</em>';
  const targetMeta = t
    ? `${escapeHtml(t.nickname || '(naamloos)')} · ${escapeHtml(formatRelativeTime(t.created_at))}`
    : '<em>doel bestaat niet meer</em>';
  return `
    <article class="tl-report-row" data-report-id="${escapeHtml(rep.id)}" data-target-type="${escapeHtml(rep.target_type)}" data-target-id="${escapeHtml(rep.target_id)}">
      <div class="tl-report-meta">
        <span class="tl-report-type">${rep.target_type === 'post' ? '📄 Post' : '💬 Reactie'}</span>
        <span class="tl-time">${escapeHtml(formatRelativeTime(rep.created_at))}</span>
      </div>
      <div class="tl-report-target">
        <div class="tl-report-target-meta">${targetMeta}</div>
        <div class="tl-report-target-body">${targetBody}</div>
      </div>
      ${rep.reason ? `<div class="tl-report-reason"><strong>Reden:</strong> ${escapeHtml(rep.reason)}</div>` : ''}
      <div class="tl-report-actions">
        <button type="button" class="btn btn-outline btn-sm" data-action="report-dismiss">Niets doen</button>
        <button type="button" class="btn btn-danger btn-sm" data-action="report-delete">Verwijder bericht</button>
      </div>
    </article>
  `;
}
