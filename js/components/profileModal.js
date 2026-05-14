/* ============================================
   PROFILE MODAL
   Volledige profiel-bewerking: nickname + avatar.
   Wordt geopend vanuit de header-avatar.
   Returnt Promise<profile|null>.
============================================ */

import { escapeHtml, processImageForUpload, showToast, initialsFromName, colorFromSeed } from '../utils.js?v=2.4.3';
import { sessionGet } from '../supabase.js?v=2.4.3';
import * as Api from '../communityApi.js?v=2.4.3';

export function openProfileModal() {
  return new Promise(async (resolve) => {
    // Laad huidig profiel als startwaarde
    const { data } = await Api.getMyProfile();
    const profile = data?.profile || null;
    const initialNick   = profile?.nickname || '';
    const initialAvatar = profile?.avatar_url || null;
    const userId = sessionGet()?.user_id || '';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay nickname-modal-overlay';
    overlay.innerHTML = `
      <div class="modal nickname-modal profile-modal">
        <h2>${profile ? 'Mijn profiel' : 'Maak je profiel aan'}</h2>
        <p class="nickname-modal-desc">
          Andere ouders zien je nickname en eventuele foto bij je posts.
          Je e-mailadres blijft altijd verborgen.
        </p>

        <div class="profile-avatar-section">
          <div class="profile-avatar-preview" id="pf-preview">
            ${initialAvatar
              ? `<img src="${escapeHtml(initialAvatar)}" alt="Profielfoto">`
              : `<span class="tl-avatar profile-avatar-placeholder" style="background:${colorFromSeed(userId)};">${escapeHtml(initialsFromName(initialNick) || '?')}</span>`}
          </div>
          <div class="profile-avatar-buttons">
            <button type="button" class="btn btn-outline btn-sm" id="pf-photo-btn">
              ${initialAvatar ? 'Foto wijzigen' : 'Foto kiezen'}
            </button>
            ${initialAvatar ? `<button type="button" class="btn btn-outline btn-sm" id="pf-photo-remove">Verwijderen</button>` : ''}
            <input type="file" id="pf-photo-input" accept="image/*" class="visually-hidden">
          </div>
        </div>

        <label for="pf-nickname-input" class="visually-hidden">Nickname</label>
        <input
          type="text"
          id="pf-nickname-input"
          class="auth-input"
          placeholder="Nickname (bv. Sarah_M)"
          maxlength="30"
          autocomplete="off"
          value="${escapeHtml(initialNick)}"
        >
        <div class="nickname-rules">
          2–30 tekens · letters, cijfers, spaties, _ en -
        </div>

        <div id="pf-error" class="auth-error hidden"></div>
        <div id="pf-loading" class="auth-loading hidden">Bezig met opslaan…</div>

        <div class="nickname-actions">
          <button class="btn btn-outline" id="pf-cancel">Annuleren</button>
          <button class="btn btn-primary" id="pf-save">Opslaan</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input      = overlay.querySelector('#pf-nickname-input');
    const errorEl    = overlay.querySelector('#pf-error');
    const loading    = overlay.querySelector('#pf-loading');
    const saveBtn    = overlay.querySelector('#pf-save');
    const cancelBtn  = overlay.querySelector('#pf-cancel');
    const photoBtn   = overlay.querySelector('#pf-photo-btn');
    const photoInput = overlay.querySelector('#pf-photo-input');
    const photoRemove= overlay.querySelector('#pf-photo-remove');
    const previewEl  = overlay.querySelector('#pf-preview');

    setTimeout(() => { input.focus(); input.select(); }, 50);

    let pendingAvatar = null;     // { blob, previewUrl } — nieuw geselecteerd
    let removeAvatar = false;     // true = verwijder bestaande avatar

    const close = (result) => {
      if (pendingAvatar?.previewUrl) URL.revokeObjectURL(pendingAvatar.previewUrl);
      overlay.remove();
      resolve(result);
    };

    const showError = (msg) => {
      errorEl.textContent = msg;
      errorEl.classList.remove('hidden');
      loading.classList.add('hidden');
      saveBtn.disabled = false;
    };

    photoBtn?.addEventListener('click', () => photoInput.click());
    photoInput?.addEventListener('change', async () => {
      const file = photoInput.files?.[0];
      if (!file) return;
      photoBtn.disabled = true;
      try {
        const { blob } = await processImageForUpload(file);
        if (pendingAvatar?.previewUrl) URL.revokeObjectURL(pendingAvatar.previewUrl);
        const previewUrl = URL.createObjectURL(blob);
        pendingAvatar = { blob, previewUrl };
        removeAvatar = false;
        previewEl.innerHTML = `<img src="${previewUrl}" alt="Profielfoto">`;
      } catch (err) {
        showToast(err.message || 'Kon foto niet verwerken.', 'error');
      } finally {
        photoBtn.disabled = false;
      }
    });

    photoRemove?.addEventListener('click', () => {
      if (pendingAvatar?.previewUrl) URL.revokeObjectURL(pendingAvatar.previewUrl);
      pendingAvatar = null;
      removeAvatar = true;
      previewEl.innerHTML = `<span class="tl-avatar profile-avatar-placeholder" style="background:${colorFromSeed(userId)};">${escapeHtml(initialsFromName(input.value || initialNick) || '?')}</span>`;
      photoRemove.style.display = 'none';
    });

    cancelBtn.addEventListener('click', () => close(null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close(null);
    });

    saveBtn.addEventListener('click', async () => {
      const newNick = input.value.trim();
      errorEl.classList.add('hidden');
      if (!newNick) {
        showError('Vul een nickname in.');
        return;
      }
      saveBtn.disabled = true;
      loading.classList.remove('hidden');

      try {
        // Upload avatar eerst (indien nieuw)
        let avatarPathUpdate = undefined;
        if (pendingAvatar?.blob) {
          const urlRes = await Api.getAvatarUploadUrl();
          if (!urlRes.ok) { showError(urlRes.error || 'Kon upload-URL niet ophalen.'); return; }
          const upRes = await Api.uploadToStorage(urlRes.data.uploadUrl, pendingAvatar.blob);
          if (!upRes.ok) { showError(upRes.error || 'Foto-upload mislukt.'); return; }
          avatarPathUpdate = urlRes.data.path;
        } else if (removeAvatar) {
          avatarPathUpdate = null;
        }

        const updates = { nickname: newNick };
        if (avatarPathUpdate !== undefined) updates.avatar_path = avatarPathUpdate;

        const { ok, data, error } = await Api.updateMyProfile(updates);
        if (!ok) { showError(error || 'Er ging iets mis.'); return; }
        close(data.profile);
      } catch (err) {
        showError(err.message || 'Er ging iets mis.');
      }
    });
  });
}
