/* ============================================
   HEADER COMPONENT
   Toont de app-titel, een profiel-avatar (klik =
   profile-modal voor nickname + foto) en uitlogknop.
============================================ */

import * as Store from '../store.js?v=2.9.0';
import { sessionClear, sessionGet, invalidateSubscriptionCache } from '../supabase.js?v=2.9.0';
import { initialsFromName, colorFromSeed, escapeHtml, showToast, formatRelativeTime } from '../utils.js?v=2.9.0';
import * as Api from '../communityApi.js?v=2.9.0';

/* Cache key voor nickname + avatar-url zodat header bij volgende
   page-load meteen de juiste pill kan tonen (geen email-flicker). */
const PROFILE_CACHE_KEY = 'community.profile.cache.v1';

function getCachedProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function setCachedProfile(profile) {
  try {
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({
      nickname: profile.nickname || null,
      avatar_url: profile.avatar_url || null,
      user_id: profile.user_id || null,
    }));
  } catch {}
}

/* ----------------------------------------
   RENDER
---------------------------------------- */
export function render() {
  const user = Store.getCurrentUser();
  const userId = sessionGet()?.user_id || '';
  const cached = getCachedProfile();

  // Gebruik gecachet profiel als beschikbaar, anders fallback op email-initialen
  const displayName = cached?.nickname || user || 'Gast';
  const initials = initialsFromName(cached?.nickname || user || '?');
  const color = colorFromSeed(userId);
  const avatarHtml = cached?.avatar_url
    ? `<img src="${escapeHtml(cached.avatar_url)}" alt="">`
    : escapeHtml(initials);
  const avatarBg = cached?.avatar_url ? 'transparent' : color;

  return `
    <div class="header-inner">
      <a class="header-title" href="#/" id="header-home-link" title="Naar het hub">
        <img src="/pril-leven-logo.png" alt="" class="header-logo" />
        <span>Community Pril leven</span>
      </a>
      <div class="header-user">
        <a href="#/" class="header-home-btn" id="header-home-btn" title="Naar het hub" aria-label="Naar het hub">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5 12 3l9 6.5V21a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1V9.5Z"/></svg>
        </a>
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
        <button class="header-avatar-btn" id="header-avatar-btn" title="Mijn profiel" aria-label="Mijn profiel">
          <span class="header-avatar" id="header-avatar" style="background:${avatarBg};">${avatarHtml}</span>
          <span class="header-avatar-name" id="header-avatar-name">${escapeHtml(displayName)}</span>
        </button>
        <button class="btn-logout" id="header-logout-btn" title="Uitloggen">Uitloggen</button>
      </div>
    </div>
  `;
}

/* ----------------------------------------
   INIT
---------------------------------------- */
export function init() {
  const logoutBtn = document.getElementById('header-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      const email = Store.getCurrentUser();
      localStorage.removeItem('receptenboek_user');
      sessionClear();
      if (email) invalidateSubscriptionCache(email);
      Store.clearAdminCache();
      Store.clearCache();
      location.reload();
    });
  }

  const avatarBtn = document.getElementById('header-avatar-btn');
  if (avatarBtn) {
    avatarBtn.addEventListener('click', () => {
      window.location.hash = '#/profiel';
    });
  }

  // Eerste keer: profiel laden + bell starten
  loadInitialAvatar();
  initBell();
}

/* ============================================
   Notificatie-bell
============================================ */
const BELL_POLL_MS = 60 * 1000;
let _bellTimer = null;

function initBell() {
  const btn      = document.getElementById('tl-bell-btn');
  const dropdown = document.getElementById('tl-bell-dropdown');
  const markBtn  = document.getElementById('tl-bell-mark-read');
  if (!btn) return;

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
    await refreshBellList();
  });

  markBtn?.addEventListener('click', async () => {
    const { ok, error } = await Api.markNotificationsRead();
    if (!ok) { showToast(error || 'Mislukt', 'error'); return; }
    setBellBadge(0);
    document.querySelectorAll('.tl-notif').forEach(n => n.classList.remove('is-unread'));
    setTimeout(closeBell, 300);
  });

  dropdown.addEventListener('click', async (e) => {
    const notif = e.target.closest('[data-action="open-notif"]');
    if (!notif) return;
    const postId  = notif.dataset.postId;
    const replyId = notif.dataset.replyId;
    if (!postId) return;
    closeBell();
    await navigateToPost(postId, replyId);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-role="bell"]')) closeBell();
  });

  refreshBellCount();
  startBellPolling();
}

function startBellPolling() {
  if (_bellTimer) clearInterval(_bellTimer);
  _bellTimer = setInterval(() => {
    if (document.visibilityState === 'visible') refreshBellCount();
  }, BELL_POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshBellCount();
  });
}

async function refreshBellCount() {
  const { ok, data } = await Api.getNotifications();
  if (!ok || !data) return;
  setBellBadge(Number(data.unread || 0));
}

function setBellBadge(n) {
  const badge = document.getElementById('tl-bell-badge');
  if (!badge) return;
  if (n > 0) {
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

async function refreshBellList() {
  const list = document.getElementById('tl-bell-list');
  list.innerHTML = '<div class="tl-empty">Laden…</div>';
  const { ok, data, error } = await Api.getNotifications();
  if (!ok) {
    list.innerHTML = `<div class="tl-empty tl-error">${escapeHtml(error)}</div>`;
    return;
  }
  setBellBadge(Number(data.unread || 0));
  const items = data.notifications || [];
  list.innerHTML = items.length === 0
    ? `<div class="tl-empty">Geen notificaties.</div>`
    : items.map(renderNotifRow).join('');
}

async function navigateToPost(postId, replyId = null) {
  let card = document.querySelector(`.tl-post[data-post-id="${CSS.escape(postId)}"]`);
  if (!card) {
    // Navigeer naar home en probeer daarna te scrollen
    window.location.hash = '#/';
    await new Promise(r => setTimeout(r, 600));
    card = document.querySelector(`.tl-post[data-post-id="${CSS.escape(postId)}"]`);
    if (!card) return; // post gepagineerd of verwijderd
  }
  if (replyId) {
    const toggle    = card.querySelector('[data-action="toggle-replies"]');
    const container = card.querySelector('[data-role="replies-container"]');
    if (toggle && container?.classList.contains('hidden')) toggle.click();
  }
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.add('is-highlighted');
  setTimeout(() => card.classList.remove('is-highlighted'), 1500);
  if (replyId) {
    setTimeout(() => {
      const replyEl = card.querySelector(`.tl-reply[data-reply-id="${CSS.escape(replyId)}"]`);
      if (replyEl) {
        replyEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        replyEl.classList.add('is-highlighted');
        setTimeout(() => replyEl.classList.remove('is-highlighted'), 1500);
      }
    }, 600);
  }
}

function renderNotifRow(n) {
  const unread  = !n.read_at ? ' is-unread' : '';
  const time    = formatRelativeTime(n.created_at);
  const actor   = escapeHtml(n.actor_nickname || 'Iemand');
  const preview = n.post_preview ? `<span class="tl-notif-preview">"${escapeHtml(n.post_preview)}…"</span>` : '';
  let label = '';
  if (n.type === 'reply')      label = `<strong>${actor}</strong> reageerde op je post`;
  else if (n.type === 'like')  label = `<strong>${actor}</strong> liked je post`;
  else                          label = `<strong>${actor}</strong> · ${escapeHtml(n.type)}`;
  const postId  = n.post_id  ? escapeHtml(n.post_id)  : '';
  const replyId = n.reply_id ? escapeHtml(n.reply_id) : '';
  const cursor  = postId ? ' tl-notif-clickable' : '';
  return `
    <div class="tl-notif${unread}${cursor}" data-action="open-notif" data-post-id="${postId}" data-reply-id="${replyId}">
      <div class="tl-notif-text">${label}</div>
      ${preview}
      <div class="tl-notif-time">${escapeHtml(time)}</div>
    </div>
  `;
}

async function loadInitialAvatar() {
  const { ok, data } = await Api.getMyProfile();
  if (!ok || !data?.profile) return;
  refreshHeaderAvatar(data.profile);
  setCachedProfile(data.profile);
}

function refreshHeaderAvatar(profile) {
  const av = document.getElementById('header-avatar');
  const nameEl = document.getElementById('header-avatar-name');
  if (!av) return;
  if (profile.avatar_url) {
    av.innerHTML = `<img src="${escapeHtml(profile.avatar_url)}" alt="">`;
    av.style.background = 'transparent';
  } else if (profile.nickname) {
    av.innerHTML = escapeHtml(initialsFromName(profile.nickname));
    av.style.background = colorFromSeed(profile.user_id || '');
  }
  if (nameEl && profile.nickname) {
    nameEl.textContent = profile.nickname;
  }
  setCachedProfile(profile);
}
