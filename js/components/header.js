/* ============================================
   HEADER COMPONENT
   Toont de app-titel, een profiel-avatar (klik =
   profile-modal voor nickname + foto) en uitlogknop.
============================================ */

import * as Store from '../store.js?v=2.0.1';
import { sessionClear, sessionGet, invalidateSubscriptionCache } from '../supabase.js?v=2.0.1';
import { initialsFromName, colorFromSeed, escapeHtml } from '../utils.js?v=2.0.1';
import * as Api from '../communityApi.js?v=2.0.1';
import { openProfileModal } from './profileModal.js?v=2.0.1';

/* ----------------------------------------
   RENDER
---------------------------------------- */
export function render() {
  const user = Store.getCurrentUser();
  const userId = sessionGet()?.user_id || '';
  const initials = initialsFromName(user || '?');
  const color = colorFromSeed(userId);
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
        <button class="header-avatar-btn" id="header-avatar-btn" title="Mijn profiel" aria-label="Mijn profiel">
          <span class="header-avatar" id="header-avatar" style="background:${color};">${escapeHtml(initials)}</span>
          <span class="header-avatar-name" id="header-avatar-name">${escapeHtml(user || 'Gast')}</span>
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
    avatarBtn.addEventListener('click', async () => {
      const updated = await openProfileModal();
      if (updated) {
        refreshHeaderAvatar(updated);
        // Trigger event zodat andere views (bv. timeline composer-nick)
        // hun weergave kunnen verversen.
        document.dispatchEvent(new CustomEvent('community:profile-updated', { detail: updated }));
      }
    });
  }

  // Eerste keer: probeer profiel uit DB te laden zodat avatar uit Supabase komt
  // (en niet alleen de e-mail-initialen).
  loadInitialAvatar();
}

async function loadInitialAvatar() {
  const { ok, data } = await Api.getMyProfile();
  if (!ok || !data?.profile) return;
  refreshHeaderAvatar(data.profile);
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
}
