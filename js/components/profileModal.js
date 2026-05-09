/* ============================================
   PROFILE MODAL
   Volledige profiel-bewerking: nickname + avatar.
   Wordt geopend vanuit de header-avatar.
   Returnt Promise<profile|null>.
============================================ */

import { escapeHtml, processImageForUpload, showToast, initialsFromName, colorFromSeed } from '../utils.js?v=2.23.0';
import { sessionGet } from '../supabase.js?v=2.23.0';
import * as Api from '../communityApi.js?v=2.23.0';
import { getMyChildren, deleteChild } from '../eersteHapjesApi.js?v=2.23.0';
import { openChildOnboardingModal } from './childOnboardingModal.js?v=2.23.0';
import { openAllergenManager } from './allergenManager.js?v=2.23.0';

function renderChildItem(child) {
  const ageMonths = (() => {
    if (!child.birthdate) return null;
    const d = new Date(child.birthdate + 'T00:00:00Z');
    if (Number.isNaN(d.getTime())) return null;
    const now = Date.now();
    return Math.floor((now - d.getTime()) / (1000 * 60 * 60 * 24 * 30.4375));
  })();
  let ageLabel = '';
  if (typeof ageMonths === 'number') {
    if (ageMonths < 24) ageLabel = `${ageMonths} mnd`;
    else ageLabel = `${Math.floor(ageMonths / 12)} jaar`;
  }
  const safeName = escapeHtml(child.name || 'Kindje');
  const safeId = escapeHtml(child.id);
  return `
    <div class="pf-children-item">
      <div class="pf-children-item-main">
        <div class="pf-children-item-name">${safeName}</div>
        <div class="pf-children-item-meta">${escapeHtml(child.birthdate || '—')}${ageLabel ? ` · ${ageLabel}` : ''}</div>
      </div>
      <button class="pf-children-item-allergens"
              data-allergens-child="${safeId}"
              data-child-name="${safeName}"
              type="button">
        Allergenen
      </button>
      <button class="pf-children-item-del"
              data-del-child="${safeId}"
              data-child-name="${safeName}"
              type="button"
              aria-label="Verwijder ${safeName}">×</button>
    </div>
  `;
}

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

        <div class="pf-children-section">
          <div class="pf-children-head">
            <h3>Mijn kinderen</h3>
            <p class="pf-children-sub">Eén plek voor je kindjes — wordt gebruikt door HapjesHeld én Eerste Hapjes.</p>
          </div>
          <div class="pf-children-list" data-children-list>
            <div class="pf-children-loading">Laden…</div>
          </div>
          <button type="button" class="btn btn-outline btn-sm" id="pf-children-add">+ Kindje toevoegen</button>
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

    // ---------- Kinderen-sectie ----------
    const childrenListEl = overlay.querySelector('[data-children-list]');
    const addChildBtn    = overlay.querySelector('#pf-children-add');

    async function refreshChildren() {
      childrenListEl.innerHTML = `<div class="pf-children-loading">Laden…</div>`;
      const { ok, data, error } = await getMyChildren();
      if (!ok) {
        childrenListEl.innerHTML = `<div class="pf-children-error">${escapeHtml(error || 'Kon kindjes niet laden.')}</div>`;
        return;
      }
      const children = data?.children || [];
      if (children.length === 0) {
        childrenListEl.innerHTML = `<div class="pf-children-empty">Nog geen kindje toegevoegd.</div>`;
        return;
      }
      childrenListEl.innerHTML = children.map((c) => renderChildItem(c)).join('');
      childrenListEl.querySelectorAll('[data-del-child]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.delChild;
          const name = btn.dataset.childName || 'dit kindje';
          if (!window.confirm(`"${name}" verwijderen? Alle gekoppelde data (maaltijden, allergenen, fases) blijft maar wordt onbereikbaar.`)) return;
          btn.disabled = true;
          const { ok: dOk, error: dErr } = await deleteChild(id);
          if (!dOk) {
            btn.disabled = false;
            showToast(dErr || 'Verwijderen mislukt.', 'error');
            return;
          }
          showToast(`${name} verwijderd.`, 'success');
          refreshChildren();
        });
      });
      childrenListEl.querySelectorAll('[data-allergens-child]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.allergensChild;
          const name = btn.dataset.childName || 'kindje';
          await openAllergenManager({ childId: id, childName: name });
          // Geen refresh nodig — allergenen-state blijft visueel intern in
          // de allergenManager. Bij hersluiten valt er niets aan deze lijst
          // te updaten (count tonen we niet inline).
        });
      });
    }

    addChildBtn.addEventListener('click', async () => {
      const child = await openChildOnboardingModal();
      if (child) {
        showToast(`${child.name || 'Kindje'} toegevoegd.`, 'success');
        refreshChildren();
      }
    });

    refreshChildren();

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
