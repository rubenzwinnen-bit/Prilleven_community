/* ============================================
   STANDALONE HEADER BELL
   Notificatie-bel voor pagina's buiten de SPA
   (chat.html). Injecteert de bel in een gegeven
   container en start polling.
============================================ */

import { escapeHtml, showToast, formatRelativeTime } from './utils.js?v=2.9.0';
import * as Api from './communityApi.js?v=2.9.0';

const BELL_POLL_MS = 60 * 1000;
let _bellTimer = null;

/**
 * Mount de notificatie-bel in `container`.
 * Zet de bel-HTML erin en start polling + event handlers.
 */
export function mountHeaderBell(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="header-bell tl-bell" data-role="bell">
      <button type="button" class="header-bell-btn tl-bell-btn" id="tl-bell-btn" aria-label="Notificaties" aria-expanded="false">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        <span class="tl-bell-badge hidden" id="tl-bell-badge">0</span>
      </button>
      <div class="tl-bell-dropdown hidden" id="tl-bell-dropdown" data-role="bell-dropdown">
        <div class="tl-bell-head">
          <strong>Notificaties</strong>
          <button type="button" class="tl-bell-mark-read" id="tl-bell-mark-read">Markeer gelezen</button>
        </div>
        <div class="tl-bell-list" id="tl-bell-list">
          <div class="tl-empty">Laden…</div>
        </div>
      </div>
    </div>
  `;

  const btn      = container.querySelector('#tl-bell-btn');
  const dropdown = container.querySelector('#tl-bell-dropdown');
  const markBtn  = container.querySelector('#tl-bell-mark-read');

  const closeBell = () => {
    dropdown.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
  };

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const wasOpen = !dropdown.classList.contains('hidden');
    if (wasOpen) { closeBell(); return; }
    dropdown.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
    await refreshBellList(container);
  });

  markBtn?.addEventListener('click', async () => {
    const { ok, error } = await Api.markNotificationsRead();
    if (!ok) { showToast(error || 'Mislukt', 'error'); return; }
    setBellBadge(container, 0);
    container.querySelectorAll('.tl-notif').forEach(n => n.classList.remove('is-unread'));
    setTimeout(closeBell, 300);
  });

  dropdown.addEventListener('click', (e) => {
    const notif = e.target.closest('[data-action="open-notif"]');
    if (!notif) return;
    const postId = notif.dataset.postId;
    if (!postId) return;
    closeBell();
    // Navigeer naar de SPA-tijdlijn waar de post staat
    window.location.href = '/';
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-role="bell"]')) closeBell();
  });

  refreshBellCount(container);
  startBellPolling(container);
}

function startBellPolling(container) {
  if (_bellTimer) clearInterval(_bellTimer);
  _bellTimer = setInterval(() => {
    if (document.visibilityState === 'visible') refreshBellCount(container);
  }, BELL_POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshBellCount(container);
  });
}

async function refreshBellCount(container) {
  const { ok, data } = await Api.getNotifications();
  if (!ok || !data) return;
  setBellBadge(container, Number(data.unread || 0));
}

function setBellBadge(container, n) {
  const badge = container.querySelector('#tl-bell-badge');
  if (!badge) return;
  if (n > 0) {
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

async function refreshBellList(container) {
  const list = container.querySelector('#tl-bell-list');
  list.innerHTML = '<div class="tl-empty">Laden…</div>';
  const { ok, data, error } = await Api.getNotifications();
  if (!ok) {
    list.innerHTML = `<div class="tl-empty tl-error">${escapeHtml(error)}</div>`;
    return;
  }
  setBellBadge(container, Number(data.unread || 0));
  const items = data.notifications || [];
  list.innerHTML = items.length === 0
    ? `<div class="tl-empty">Geen notificaties.</div>`
    : items.map(renderNotifRow).join('');
}

function renderNotifRow(n) {
  const unread  = !n.read_at ? ' is-unread' : '';
  const time    = formatRelativeTime(n.created_at);
  const actor   = escapeHtml(n.actor_nickname || 'Iemand');
  const preview = n.post_preview ? `<span class="tl-notif-preview">"${escapeHtml(n.post_preview)}…"</span>` : '';
  let label = '';
  if (n.type === 'reply')     label = `<strong>${actor}</strong> reageerde op je post`;
  else if (n.type === 'like') label = `<strong>${actor}</strong> liked je post`;
  else                         label = `<strong>${actor}</strong> · ${escapeHtml(n.type)}`;
  const postId = n.post_id ? escapeHtml(n.post_id) : '';
  const cursor = postId ? ' tl-notif-clickable' : '';
  return `
    <div class="tl-notif${unread}${cursor}" data-action="open-notif" data-post-id="${postId}">
      <div class="tl-notif-text">${label}</div>
      ${preview}
      <div class="tl-notif-time">${escapeHtml(time)}</div>
    </div>
  `;
}
