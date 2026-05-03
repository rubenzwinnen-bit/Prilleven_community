/* ============================================
   STANDALONE HEADER AVATAR
   Mini-component voor pagina's buiten de SPA
   (chat.html, admin-chat.html). Injecteert een
   avatar-pill in een gegeven container en hangt
   de profile-modal eraan.
============================================ */

import { sessionGet } from './supabase.js?v=2.0.1';
import { initialsFromName, colorFromSeed, escapeHtml } from './utils.js?v=2.0.1';
import * as Api from './communityApi.js?v=2.0.1';
import { openProfileModal } from './components/profileModal.js?v=2.0.1';

/**
 * Mount een avatar-pill in `container`. Returnt een functie om opnieuw
 * te renderen na update.
 */
export function mountHeaderAvatar(container, { showName = true } = {}) {
  if (!container) return () => {};

  const session = sessionGet();
  const email   = session?.email || 'Gast';
  const userId  = session?.user_id || '';
  const initials = initialsFromName(email);
  const color    = colorFromSeed(userId);

  container.innerHTML = `
    <button type="button" class="header-avatar-btn" data-role="standalone-avatar" title="Mijn profiel" aria-label="Mijn profiel">
      <span class="header-avatar" data-role="standalone-avatar-icon" style="background:${color};">${escapeHtml(initials)}</span>
      ${showName ? `<span class="header-avatar-name" data-role="standalone-avatar-name">${escapeHtml(email)}</span>` : ''}
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
