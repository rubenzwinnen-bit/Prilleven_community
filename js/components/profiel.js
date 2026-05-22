/* ============================================
   PROFIEL COMPONENT
   Profielpagina: account-info + kinderen + dieet in het gezin.
   Route: #/profiel
============================================ */

import * as Store from '../store.js?v=2.6.3';
import { sessionGet } from '../supabase.js?v=2.6.3';
import { escapeHtml, showToast, processImageForUpload, initialsFromName, colorFromSeed } from '../utils.js?v=2.6.3';
import * as Api from '../childrenApi.js?v=2.6.3';
import * as FamilyApi from '../familyApi.js?v=2.6.3';
import * as CommunityApi from '../communityApi.js?v=2.6.3';
import { ALLERGEN_FLOW } from '../content/eersteHapjes-allergen-flow.js?v=2.6.3';

/* ----------------------------------------
   ALLERGEENLIJST (13 standaard-allergenen, identiek aan tracker)
   Eén bron van waarheid: ALLERGEN_FLOW.
---------------------------------------- */
const ALLERGEN_OPTIONS = [...ALLERGEN_FLOW]
  .sort((a, b) => a.order - b.order)
  .map(a => ({ key: a.key, label: a.label }));

/* ----------------------------------------
   DIEET-OPTIES (zelfde set als ALLOWED_DIET op de server)
---------------------------------------- */
const DIET_OPTIONS = [
  { key: 'vegetarisch',  label: 'Vegetarisch' },
  { key: 'veganistisch', label: 'Veganistisch' },
  { key: 'glutenvrij',   label: 'Glutenvrij' },
  { key: 'lactosevrij',  label: 'Lactosevrij' },
  { key: 'pescotarisch', label: 'Pescotarisch' },
  { key: 'halal',        label: 'Halal' },
  { key: 'kosher',       label: 'Kosher' },
  { key: 'geen-varken',  label: 'Geen varken' },
  { key: 'geen-rund',    label: 'Geen rund' },
];

/* ----------------------------------------
   LEEFTIJD BEREKENEN
---------------------------------------- */
function calcAge(birthdate) {
  if (!birthdate) return '';
  const b = new Date(birthdate + 'T00:00:00Z');
  const now = new Date();
  const diffDays = (now - b) / (1000 * 60 * 60 * 24);
  const months = Math.floor(diffDays / 30.4375);
  if (months < 24) return `${months} maand${months !== 1 ? 'en' : ''}`;
  const years = Math.floor(months / 12);
  return `${years} jaar`;
}

/* ----------------------------------------
   RENDER SHELL
---------------------------------------- */
export function render() {
  return `
    <div class="profiel-page">
      <div class="profiel-page-inner">
        <div class="profiel-loading">Profiel laden…</div>
      </div>
    </div>
  `;
}

/* ----------------------------------------
   INIT — laadt data en rendert de pagina
---------------------------------------- */
export async function init() {
  const container = document.querySelector('.profiel-page-inner');
  if (!container) return;

  const [childrenRes, familyRes, profileRes] = await Promise.all([
    Api.getChildren(),
    FamilyApi.getFamilyDiet(),
    CommunityApi.getMyProfile(),
  ]);
  if (!childrenRes.ok) {
    container.innerHTML = `<p class="profiel-error">${escapeHtml(childrenRes.error || 'Kon profiel niet laden.')}</p>`;
    return;
  }

  renderPage(
    container,
    childrenRes.data.children || [],
    familyRes.ok ? (familyRes.data.family_diet || []) : [],
    profileRes.ok ? (profileRes.data?.profile || null) : null,
  );
}

/* ----------------------------------------
   PAGINA OPBOUWEN
---------------------------------------- */
function renderPage(container, children, familyDiet, profile) {
  const email = Store.getCurrentUser() || '';
  const userId = sessionGet()?.user_id || '';
  const nickname = profile?.nickname || '';
  const avatarUrl = profile?.avatar_url || null;

  container.innerHTML = `
    <div class="profiel-header">
      <h1 class="profiel-title">Mijn profiel</h1>
    </div>

    <section class="profiel-section">
      <div class="profiel-section-head">
        <h2 class="profiel-section-title">Account</h2>
      </div>
      <div class="profiel-account-row">
        <span class="profiel-account-label">E-mailadres</span>
        <span class="profiel-account-value">${escapeHtml(email)}</span>
      </div>

      <div class="profiel-nickname-inline" id="profiel-nickname-inline">
        <p class="profiel-section-sub">Andere ouders zien je nickname en eventuele foto bij je posts. Je e-mailadres blijft altijd verborgen.</p>

        <div class="profiel-nickname-row">
          <div class="profile-avatar-preview" id="profiel-avatar-preview">
            ${avatarUrl
              ? `<img src="${escapeHtml(avatarUrl)}" alt="Profielfoto">`
              : `<span class="tl-avatar profile-avatar-placeholder" style="background:${colorFromSeed(userId)};">${escapeHtml(initialsFromName(nickname) || '?')}</span>`}
          </div>
          <div class="profiel-nickname-fields">
            <label for="profiel-nickname-input" class="profiel-form-label">Community nickname</label>
            <input
              type="text"
              id="profiel-nickname-input"
              class="auth-input"
              placeholder="Nickname (bv. Sarah_M)"
              maxlength="30"
              autocomplete="off"
              value="${escapeHtml(nickname)}"
            >
            <div class="nickname-rules">2–30 tekens · letters, cijfers, spaties, _ en -</div>
            <div class="profiel-avatar-buttons">
              <button type="button" class="btn btn-outline btn-sm" id="profiel-photo-btn">
                ${avatarUrl ? 'Foto wijzigen' : 'Foto kiezen'}
              </button>
              <button type="button" class="btn btn-outline btn-sm" id="profiel-photo-remove" ${avatarUrl ? '' : 'style="display:none;"'}>Foto verwijderen</button>
              <input type="file" id="profiel-photo-input" accept="image/*" class="visually-hidden">
            </div>
          </div>
        </div>

        <div id="profiel-nickname-error" class="auth-error hidden"></div>

        <div class="profiel-nickname-actions">
          <button class="btn btn-primary btn-sm" id="profiel-nickname-save">Opslaan</button>
          <span id="profiel-nickname-status" class="profiel-diet-status"></span>
        </div>
      </div>
    </section>

    <section class="profiel-section" id="profiel-kinderen-section">
      <div class="profiel-section-head">
        <h2 class="profiel-section-title">Mijn kind${children.length !== 1 ? 'eren' : ''}</h2>
        <button class="btn btn-primary btn-sm" id="profiel-add-kind-btn">+ Kind toevoegen</button>
      </div>
      <div id="profiel-kinderen-list">
        ${children.length === 0
          ? '<p class="profiel-empty">Nog geen kinderen toegevoegd.</p>'
          : children.map(c => renderKindCard(c)).join('')}
      </div>
    </section>

    <section class="profiel-section" id="profiel-dieet-section">
      <div class="profiel-section-head">
        <h2 class="profiel-section-title">Dieet in het gezin</h2>
      </div>
      <p class="profiel-section-sub">Selecteer wat van toepassing is op jullie gezin.</p>
      <div class="profiel-diet-grid" id="profiel-diet-grid">
        ${DIET_OPTIONS.map(opt => `
          <label class="profiel-diet-chip${familyDiet.includes(opt.key) ? ' is-checked' : ''}">
            <input type="checkbox" value="${opt.key}" ${familyDiet.includes(opt.key) ? 'checked' : ''}>
            <span>${escapeHtml(opt.label)}</span>
          </label>
        `).join('')}
      </div>
      <div id="profiel-diet-status" class="profiel-diet-status"></div>
    </section>
  `;

  bindPageEvents(container, children);
  bindNicknameSection(container, profile);
}

/* ----------------------------------------
   KINDKAART HTML (geen voedingsstijl/eczeem meer)
---------------------------------------- */
function renderKindCard(kind) {
  const age = calcAge(kind.birthdate);

  const allergies = Array.isArray(kind.known_allergies) && kind.known_allergies.length > 0
    ? kind.known_allergies.map(a => {
        const opt = ALLERGEN_OPTIONS.find(o => o.key === a);
        return `<span class="profiel-tag">${escapeHtml(opt ? opt.label.split(' (')[0] : a)}</span>`;
      }).join('')
    : '<span class="profiel-empty-inline">Geen bekende allergieën</span>';

  const introduced = Array.isArray(kind.introduced_allergens) && kind.introduced_allergens.length > 0
    ? kind.introduced_allergens.map(a => `<span class="profiel-tag profiel-tag--intro">${escapeHtml(a)}</span>`).join('')
    : '<span class="profiel-empty-inline">Nog geen via HapjesHeld</span>';

  return `
    <div class="profiel-kind-card" data-id="${escapeHtml(kind.id)}">
      <div class="profiel-kind-card-header">
        <div class="profiel-kind-info">
          <span class="profiel-kind-naam">${escapeHtml(kind.name || '—')}</span>
          ${age ? `<span class="profiel-kind-leeftijd">${age}</span>` : ''}
        </div>
        <div class="profiel-kind-actions">
          <button class="btn btn-outline btn-sm kind-edit-btn" data-id="${escapeHtml(kind.id)}">Bewerken</button>
          <button class="btn btn-outline btn-sm btn-danger kind-delete-btn" data-id="${escapeHtml(kind.id)}">Verwijderen</button>
        </div>
      </div>
      <div class="profiel-kind-details">
        <div class="profiel-kind-detail-row">
          <span class="profiel-kind-detail-label">Bekende allergieën</span>
          <div class="profiel-tags">${allergies}</div>
        </div>
        <div class="profiel-kind-detail-row">
          <span class="profiel-kind-detail-label">Geïntroduceerd via HapjesHeld</span>
          <div class="profiel-tags">${introduced}</div>
        </div>
        ${kind.previous_reactions ? `
        <div class="profiel-kind-detail-row">
          <span class="profiel-kind-detail-label">Eerdere reacties</span>
          <span class="profiel-kind-detail-val">${escapeHtml(kind.previous_reactions)}</span>
        </div>` : ''}
        ${kind.notes ? `
        <div class="profiel-kind-detail-row">
          <span class="profiel-kind-detail-label">Opmerkingen</span>
          <span class="profiel-kind-detail-val">${escapeHtml(kind.notes)}</span>
        </div>` : ''}
      </div>
    </div>
  `;
}

/* ----------------------------------------
   KIND FORMULIER HTML (geen voedingsstijl/eczeem meer)
---------------------------------------- */
function renderKindForm(kind = null) {
  const isEdit = !!kind;
  const v = kind || {};
  const selected = new Set(Array.isArray(v.known_allergies) ? v.known_allergies : []);
  const selectedCount = selected.size;

  return `
    <div class="profiel-kind-form" id="profiel-kind-form">
      <h3 class="profiel-form-title">${isEdit ? 'Kind bewerken' : 'Kind toevoegen'}</h3>

      <div class="profiel-form-row">
        <label class="profiel-form-label" for="pkf-name">Naam <span class="req">*</span></label>
        <input type="text" id="pkf-name" class="auth-input" maxlength="50"
          placeholder="Naam van je kindje" value="${escapeHtml(v.name || '')}" autocomplete="off">
      </div>

      <div class="profiel-form-row">
        <label class="profiel-form-label" for="pkf-birthdate">Geboortedatum <span class="req">*</span></label>
        <input type="date" id="pkf-birthdate" class="auth-input"
          max="${new Date().toISOString().slice(0, 10)}"
          min="${new Date(Date.now() - 10 * 365.25 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}"
          value="${escapeHtml(v.birthdate || '')}">
      </div>

      <div class="profiel-form-row">
        <label class="profiel-form-label">Bekende allergieën</label>
        <div class="profiel-allergen-dropdown-wrap" id="pkf-allergen-wrap">
          <button type="button" class="profiel-allergen-trigger" id="pkf-allergen-trigger" aria-expanded="false">
            <span id="pkf-allergen-label">${selectedCount > 0 ? `${selectedCount} geselecteerd` : 'Kies allergieën…'}</span>
            <span class="profiel-allergen-arrow">▾</span>
          </button>
          <div class="profiel-allergen-panel hidden" id="pkf-allergen-panel">
            ${ALLERGEN_OPTIONS.map(opt => `
              <label class="profiel-allergen-option">
                <input type="checkbox" name="pkf-allergen" value="${opt.key}"
                  ${selected.has(opt.key) ? 'checked' : ''}>
                <span>${escapeHtml(opt.label)}</span>
              </label>
            `).join('')}
          </div>
        </div>
        <div class="profiel-tags profiel-allergen-selected-tags" id="pkf-selected-allergen-tags">
          ${[...selected].map(k => {
            const opt = ALLERGEN_OPTIONS.find(o => o.key === k);
            return opt ? `<span class="profiel-tag">${escapeHtml(opt.label.split(' (')[0])}</span>` : '';
          }).join('')}
        </div>
      </div>

      <div class="profiel-form-row">
        <label class="profiel-form-label" for="pkf-reactions">Eerdere reacties</label>
        <textarea id="pkf-reactions" class="auth-input profiel-textarea" maxlength="1000"
          placeholder="Beschrijf eventuele eerdere reacties op voeding…"
          rows="3">${escapeHtml(v.previous_reactions || '')}</textarea>
      </div>

      <div class="profiel-form-row">
        <label class="profiel-form-label" for="pkf-notes">Opmerkingen <span class="profiel-form-optional">(optioneel)</span></label>
        <textarea id="pkf-notes" class="auth-input profiel-textarea" maxlength="500"
          placeholder="Verdere opmerkingen over je kindje…"
          rows="2">${escapeHtml(v.notes || '')}</textarea>
      </div>

      <div id="pkf-error" class="auth-error hidden"></div>

      <div class="profiel-form-actions">
        <button class="btn btn-outline" id="pkf-cancel-btn">Annuleren</button>
        <button class="btn btn-primary" id="pkf-save-btn">${isEdit ? 'Opslaan' : 'Kind toevoegen'}</button>
      </div>
    </div>
  `;
}

/* ----------------------------------------
   EVENT HANDLERS
---------------------------------------- */
function bindPageEvents(container, children) {
  // Kind toevoegen → form onderaan de lijst
  document.getElementById('profiel-add-kind-btn')?.addEventListener('click', () => {
    closeInlineForm();
    openAddForm(container);
  });

  // Bewerken / verwijderen via event delegation
  container.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.kind-edit-btn');
    if (editBtn) {
      const id = editBtn.dataset.id;
      const kind = children.find(c => c.id === id);
      if (kind) openEditForm(kind, container);
      return;
    }

    const deleteBtn = e.target.closest('.kind-delete-btn');
    if (deleteBtn) {
      const id = deleteBtn.dataset.id;
      const kind = children.find(c => c.id === id);
      if (kind) confirmDelete(kind, container);
    }
  });

  // Dieet-chips: bij elke verandering meteen opslaan (autosave)
  bindDietChipEvents(container);
}

/* ----------------------------------------
   DIEET-CHIPS — autosave
---------------------------------------- */
function bindDietChipEvents(container) {
  const grid = container.querySelector('#profiel-diet-grid');
  const status = container.querySelector('#profiel-diet-status');
  if (!grid) return;

  let pendingTimer = null;
  let saveInFlight = false;

  const setStatus = (msg, level = '') => {
    if (!status) return;
    status.textContent = msg || '';
    status.className = 'profiel-diet-status' + (level ? ' is-' + level : '');
  };

  const saveDiet = async () => {
    if (saveInFlight) return;
    saveInFlight = true;
    const selected = [...grid.querySelectorAll('input[type=checkbox]:checked')].map(i => i.value);
    setStatus('Opslaan…');
    const res = await FamilyApi.setFamilyDiet(selected);
    saveInFlight = false;
    if (!res.ok) {
      setStatus(res.error || 'Opslaan mislukt.', 'error');
      return;
    }
    setStatus('Opgeslagen', 'success');
    setTimeout(() => setStatus(''), 1800);
  };

  grid.addEventListener('change', (e) => {
    if (!e.target.matches('input[type=checkbox]')) return;
    e.target.closest('.profiel-diet-chip')?.classList.toggle('is-checked', e.target.checked);
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(saveDiet, 400); // debounce: één call per "burst"
  });
}

/* ----------------------------------------
   NICKNAME & AVATAR — inline onder Account
---------------------------------------- */
function bindNicknameSection(container, initialProfile) {
  const section     = container.querySelector('#profiel-nickname-inline');
  if (!section) return;

  const userId      = sessionGet()?.user_id || '';
  const input       = section.querySelector('#profiel-nickname-input');
  const errorEl     = section.querySelector('#profiel-nickname-error');
  const statusEl    = section.querySelector('#profiel-nickname-status');
  const saveBtn     = section.querySelector('#profiel-nickname-save');
  const photoBtn    = section.querySelector('#profiel-photo-btn');
  const photoInput  = section.querySelector('#profiel-photo-input');
  const photoRemove = section.querySelector('#profiel-photo-remove');
  const previewEl   = section.querySelector('#profiel-avatar-preview');

  let pendingAvatar = null;  // { blob, previewUrl }
  let removeAvatar  = false;
  let currentAvatarUrl = initialProfile?.avatar_url || null;

  const setStatus = (msg, level = '') => {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.className = 'profiel-diet-status' + (level ? ' is-' + level : '');
  };
  const showError = (msg) => {
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
    saveBtn.disabled = false;
  };
  const clearError = () => {
    errorEl.textContent = '';
    errorEl.classList.add('hidden');
  };

  photoBtn?.addEventListener('click', () => photoInput?.click());

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
      photoBtn.textContent = 'Foto wijzigen';
      photoRemove.style.display = '';
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
    currentAvatarUrl = null;
    previewEl.innerHTML = `<span class="tl-avatar profile-avatar-placeholder" style="background:${colorFromSeed(userId)};">${escapeHtml(initialsFromName(input.value) || '?')}</span>`;
    photoBtn.textContent = 'Foto kiezen';
    photoRemove.style.display = 'none';
  });

  saveBtn?.addEventListener('click', async () => {
    clearError();
    const newNick = input.value.trim();
    if (!newNick) { showError('Vul een nickname in.'); return; }

    saveBtn.disabled = true;
    setStatus('Opslaan…');

    try {
      let avatarPathUpdate = undefined;
      if (pendingAvatar?.blob) {
        const urlRes = await CommunityApi.getAvatarUploadUrl();
        if (!urlRes.ok) { showError(urlRes.error || 'Kon upload-URL niet ophalen.'); setStatus(''); return; }
        const upRes = await CommunityApi.uploadToStorage(urlRes.data.uploadUrl, pendingAvatar.blob);
        if (!upRes.ok) { showError(upRes.error || 'Foto-upload mislukt.'); setStatus(''); return; }
        avatarPathUpdate = urlRes.data.path;
      } else if (removeAvatar) {
        avatarPathUpdate = null;
      }

      const updates = { nickname: newNick };
      if (avatarPathUpdate !== undefined) updates.avatar_path = avatarPathUpdate;

      const { ok, data, error } = await CommunityApi.updateMyProfile(updates);
      if (!ok) { showError(error || 'Er ging iets mis.'); setStatus(''); return; }

      // Reset pending state met fresh data
      if (pendingAvatar?.previewUrl) URL.revokeObjectURL(pendingAvatar.previewUrl);
      pendingAvatar = null;
      removeAvatar = false;
      currentAvatarUrl = data.profile?.avatar_url || null;

      setStatus('Opgeslagen', 'success');
      setTimeout(() => setStatus(''), 1800);
      saveBtn.disabled = false;
      document.dispatchEvent(new CustomEvent('community:profile-updated', { detail: data.profile }));
    } catch (err) {
      showError(err.message || 'Er ging iets mis.');
      setStatus('');
    }
  });
}

/* ----------------------------------------
   FORMULIER HELPERS
---------------------------------------- */

function closeInlineForm() {
  const existing = document.getElementById('profiel-kind-form');
  if (!existing) return;
  const wrap = existing.closest('.profiel-kind-card[data-editing]');
  if (wrap) wrap.removeAttribute('data-editing');
}

function openEditForm(kind, container) {
  const addWrap = document.getElementById('profiel-add-form-wrap');
  if (addWrap) addWrap.remove();

  const card = document.querySelector(`.profiel-kind-card[data-id="${CSS.escape(kind.id)}"]`);
  if (!card) return;

  card.setAttribute('data-editing', '1');
  card.innerHTML = renderKindForm(kind);
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  bindFormEvents(card, kind, container);
}

function openAddForm(container) {
  const list = document.getElementById('profiel-kinderen-list');
  if (!list) return;

  const existing = document.getElementById('profiel-add-form-wrap');
  if (existing) existing.remove();

  const wrap = document.createElement('div');
  wrap.id = 'profiel-add-form-wrap';
  wrap.className = 'profiel-kind-card';
  wrap.innerHTML = renderKindForm(null);
  list.appendChild(wrap);
  wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  bindFormEvents(wrap, null, container);
}

function bindFormEvents(formWrap, kind, container) {
  const errorEl = formWrap.querySelector('#pkf-error');
  const saveBtn = formWrap.querySelector('#pkf-save-btn');
  const cancelBtn = formWrap.querySelector('#pkf-cancel-btn');

  const trigger = formWrap.querySelector('#pkf-allergen-trigger');
  const panel = formWrap.querySelector('#pkf-allergen-panel');
  const label = formWrap.querySelector('#pkf-allergen-label');
  const selectedTagsEl = formWrap.querySelector('#pkf-selected-allergen-tags');

  trigger?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !panel.classList.contains('hidden');
    panel.classList.toggle('hidden', isOpen);
    trigger.setAttribute('aria-expanded', String(!isOpen));
  });

  document.addEventListener('click', function closePanel(e) {
    if (!formWrap.contains(e.target)) {
      panel?.classList.add('hidden');
      trigger?.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', closePanel);
    }
  });

  panel?.addEventListener('change', () => updateAllergenDisplay(panel, label, selectedTagsEl));

  cancelBtn?.addEventListener('click', async () => {
    if (kind) {
      const card = formWrap;
      card.removeAttribute('data-editing');
      card.innerHTML = renderKindCard(kind);
    } else {
      formWrap.remove();
    }
  });

  saveBtn?.addEventListener('click', async () => {
    errorEl.classList.add('hidden');

    const name = formWrap.querySelector('#pkf-name').value.trim();
    const birthdate = formWrap.querySelector('#pkf-birthdate').value;
    const known_allergies = getSelectedAllergens(panel);
    const previous_reactions = formWrap.querySelector('#pkf-reactions').value.trim() || null;
    const notes = formWrap.querySelector('#pkf-notes').value.trim() || null;

    if (!name) { showFormError(errorEl, 'Naam is verplicht.'); return; }
    if (!birthdate) { showFormError(errorEl, 'Geboortedatum is verplicht.'); return; }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Opslaan…';

    const payload = { name, birthdate, known_allergies, previous_reactions, notes };

    const result = kind
      ? await Api.updateChild(kind.id, payload)
      : await Api.createChild(payload);

    if (!result.ok) {
      showFormError(errorEl, result.error || 'Er ging iets mis.');
      saveBtn.disabled = false;
      saveBtn.textContent = kind ? 'Opslaan' : 'Kind toevoegen';
      return;
    }

    const [fresh, family, prof] = await Promise.all([
      Api.getChildren(),
      FamilyApi.getFamilyDiet(),
      CommunityApi.getMyProfile(),
    ]);
    if (fresh.ok) renderPage(
      container,
      fresh.data.children || [],
      family.ok ? (family.data.family_diet || []) : [],
      prof.ok ? (prof.data?.profile || null) : null,
    );
    showToast(kind ? 'Profiel bijgewerkt.' : 'Kind toegevoegd.', 'success');
  });
}

/* ----------------------------------------
   ALLERGEENDROPDOWN HELPERS
---------------------------------------- */
function getSelectedAllergens(panel) {
  if (!panel) return [];
  return [...panel.querySelectorAll('input[name="pkf-allergen"]:checked')]
    .map(cb => cb.value);
}

function updateAllergenDisplay(panel, label, tagsEl) {
  const selected = getSelectedAllergens(panel);
  label.textContent = selected.length > 0 ? `${selected.length} geselecteerd` : 'Kies allergieën…';
  tagsEl.innerHTML = selected.map(k => {
    const opt = ALLERGEN_OPTIONS.find(o => o.key === k);
    return opt ? `<span class="profiel-tag">${escapeHtml(opt.label.split(' (')[0])}</span>` : '';
  }).join('');
}

/* ----------------------------------------
   VERWIJDEREN BEVESTIGEN
---------------------------------------- */
async function confirmDelete(kind, container) {
  if (!confirm(`Wil je "${kind.name}" verwijderen? Dit is niet ongedaan te maken.`)) return;
  const { ok, error } = await Api.archiveChild(kind.id);
  if (!ok) { showToast(error || 'Verwijderen mislukt.', 'error'); return; }
  const [fresh, family, prof] = await Promise.all([
    Api.getChildren(),
    FamilyApi.getFamilyDiet(),
    CommunityApi.getMyProfile(),
  ]);
  if (fresh.ok) renderPage(
    container,
    fresh.data.children || [],
    family.ok ? (family.data.family_diet || []) : [],
    prof.ok ? (prof.data?.profile || null) : null,
  );
  showToast(`${kind.name} verwijderd.`, 'success');
}

/* ----------------------------------------
   HELPERS
---------------------------------------- */
function showFormError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}
