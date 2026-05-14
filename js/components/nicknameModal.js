/* ============================================
   NICKNAME MODAL
   Verplicht een nickname te kiezen voor de eerste
   community-actie (post, reply, like).
   Returnt een Promise<string|null> — string = gekozen
   nickname, null = user heeft geannuleerd.
============================================ */

import { escapeHtml } from '../utils.js?v=2.4.5';
import { setMyNickname, getMyProfile } from '../communityApi.js?v=2.4.5';

/**
 * Toon modal en wacht op resultaat.
 * Optioneel: { current } voor "wijzig nickname" flow.
 */
export function openNicknameModal({ current = '' } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay nickname-modal-overlay';
    overlay.innerHTML = `
      <div class="modal nickname-modal">
        <h2>Kies je nickname</h2>
        <p class="nickname-modal-desc">
          Andere gezinnen zien deze naam bij je posts. Je e-mailadres blijft
          altijd verborgen. Je kunt je nickname later nog wijzigen.
        </p>
        <input
          type="text"
          id="nickname-input"
          class="auth-input"
          placeholder="bv. Sarah_M"
          maxlength="30"
          autocomplete="off"
          value="${escapeHtml(current)}"
        >
        <div class="nickname-rules">
          2–30 tekens · letters, cijfers, spaties, _ en -
        </div>
        <div id="nickname-error" class="auth-error hidden"></div>
        <div id="nickname-loading" class="auth-loading hidden">Bezig met opslaan…</div>
        <div class="nickname-actions">
          <button class="btn btn-outline" id="nickname-cancel">Annuleren</button>
          <button class="btn btn-primary" id="nickname-save">Opslaan</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input   = overlay.querySelector('#nickname-input');
    const errorEl = overlay.querySelector('#nickname-error');
    const loading = overlay.querySelector('#nickname-loading');
    const saveBtn = overlay.querySelector('#nickname-save');
    const cancelBtn = overlay.querySelector('#nickname-cancel');

    setTimeout(() => { input.focus(); input.select(); }, 50);

    const close = (result) => {
      overlay.remove();
      resolve(result);
    };

    const showError = (msg) => {
      errorEl.textContent = msg;
      errorEl.classList.remove('hidden');
      loading.classList.add('hidden');
      saveBtn.disabled = false;
    };

    const submit = async () => {
      const value = input.value.trim();
      errorEl.classList.add('hidden');
      if (!value) {
        showError('Vul een nickname in.');
        return;
      }
      saveBtn.disabled = true;
      loading.classList.remove('hidden');

      const { ok, data, error } = await setMyNickname(value);
      if (!ok) {
        showError(error || 'Er ging iets mis.');
        return;
      }
      close(data.profile.nickname);
    };

    saveBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', () => close(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') close(null);
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
  });
}

/**
 * Geef de huidige nickname terug, vraag erom als ze ontbreekt.
 * Returnt string (nickname) of null (user weigerde).
 * Cachen in module-state om herhaalde API-calls te vermijden.
 */
let _cachedNickname = undefined; // undefined = nog niet gecheckt, null = expliciet geen

export async function ensureNickname() {
  if (_cachedNickname !== undefined && _cachedNickname !== null) {
    return _cachedNickname;
  }
  const { ok, data } = await getMyProfile();
  if (ok && data?.profile?.nickname) {
    _cachedNickname = data.profile.nickname;
    return _cachedNickname;
  }
  // Geen profiel → vraag er een
  const chosen = await openNicknameModal();
  _cachedNickname = chosen; // null als geannuleerd
  return chosen;
}

export function getCachedNickname() {
  return _cachedNickname || null;
}

export function invalidateNicknameCache() {
  _cachedNickname = undefined;
}
