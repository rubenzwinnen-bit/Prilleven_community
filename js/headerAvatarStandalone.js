/* ============================================
   STANDALONE HEADER AVATAR
   Mini-component voor pagina's buiten de SPA
   (chat.html, admin-chat.html). Injecteert een
   avatar-pill in een gegeven container en hangt
   de profile-modal eraan.
============================================ */

import { sessionGet, sessionClear, invalidateSubscriptionCache } from './supabase.js?v=2.17.0';
import { initialsFromName, colorFromSeed, escapeHtml } from './utils.js?v=2.17.0';
import * as Api from './communityApi.js?v=2.17.0';
import { openProfileModal } from './components/profileModal.js?v=2.17.0';

/**
 * Hang een logout-handler aan een button. Werkt voor de standalone
 * pagina's (chat.html, admin-chat.html) waar Store/Router niet beschikbaar
 * zijn op dezelfde manier als in de SPA.
 */
export function attachLogoutHandler(btn) {
  if (!btn) return;
  btn.addEventListener('click', () => {
    const session = sessionGet();
    const email = session?.email || null;
    try { localStorage.removeItem('receptenboek_user'); } catch {}
    sessionClear();
    if (email) invalidateSubscriptionCache(email);
    // Terug naar hub (of inlog-scherm als sessie weg is).
    window.location.href = '/';
  });
}

/* Cache key voor nickname + avatar-url. Gedeeld met header.js zodat
   alle pagina's hetzelfde profiel meteen kunnen tonen. */
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

/**
 * Mount een avatar-pill in `container`. Returnt een functie om opnieuw
 * te renderen na update.
 */
export function mountHeaderAvatar(container, { showName = true } = {}) {
  if (!container) return () => {};

  const session = sessionGet();
  const email   = session?.email || 'Gast';
  const userId  = session?.user_id || '';
  const cached  = getCachedProfile();

  const displayName = cached?.nickname || email;
  const initials = initialsFromName(cached?.nickname || email);
  const color    = colorFromSeed(userId);
  const avatarHtml = cached?.avatar_url
    ? `<img src="${escapeHtml(cached.avatar_url)}" alt="">`
    : escapeHtml(initials);
  const avatarBg = cached?.avatar_url ? 'transparent' : color;

  container.innerHTML = `
    <button type="button" class="header-avatar-btn" data-role="standalone-avatar" title="Mijn profiel" aria-label="Mijn profiel">
      <span class="header-avatar" data-role="standalone-avatar-icon" style="background:${avatarBg};">${avatarHtml}</span>
      ${showName ? `<span class="header-avatar-name" data-role="standalone-avatar-name">${escapeHtml(displayName)}</span>` : ''}
    </button>
  `;

  const btn = container.querySelector('[data-role="standalone-avatar"]');
  btn.addEventListener('click', async () => {
    const updated = await openProfileModal();
    if (updated) refresh(updated);
  });

  // Eerste fetch om DB-avatar/nickname meteen te tonen
  loadAndRefresh();

  function refresh(profile) {
    const av = container.querySelector('[data-role="standalone-avatar-icon"]');
    const nm = container.querySelector('[data-role="standalone-avatar-name"]');
    if (!av) return;
    if (profile.avatar_url) {
      av.innerHTML = `<img src="${escapeHtml(profile.avatar_url)}" alt="">`;
      av.style.background = 'transparent';
    } else if (profile.nickname) {
      av.innerHTML = escapeHtml(initialsFromName(profile.nickname));
      av.style.background = colorFromSeed(profile.user_id || userId);
    }
    if (nm && profile.nickname) nm.textContent = profile.nickname;
  }

  async function loadAndRefresh() {
    const { ok, data } = await Api.getMyProfile();
    if (ok && data?.profile) refresh(data.profile);
  }

  return loadAndRefresh;
}
