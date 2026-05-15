/* ============================================
   PROFIEL COMPONENT
   Profielpagina: account-info + kinderen beheren.
   Route: #/profiel
============================================ */

import * as Store from '../store.js?v=2.5.0';
import { sessionGet } from '../supabase.js?v=2.5.0';
import { escapeHtml, showToast } from '../utils.js?v=2.5.0';
import * as Api from '../childrenApi.js?v=2.5.0';
import { openProfileModal } from './profileModal.js?v=2.5.0';

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

const TEXTURE_LABEL = {
  puree: 'Puree',
  stukjes: 'Stukjes / BLW',
  combi: 'Combinatie',
};

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

  const { ok, data, error } = await Api.getChildren();
  if (!ok) {
    container.innerHTML = `<p class="profiel-error">${escapeHtml(error || 'Kon profiel niet laden.')}</p>`;
    return;
  }

  const children = data.children || [];
  renderPage(container, children);
}

/* ----------------------------------------
   PAGINA OPBOUWEN
---------------------------------------- */
function renderPage(container, children) {
  const email = Store.getCurrentUser() || '';

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
      <div class="profiel-account-row">
        <span class="profiel-account-label">Community nickname</span>
        <span class="profiel-account-value profiel-account-value--action">
          <button class="btn btn-outline btn-sm" id="profiel-edit-nickname-btn">Nickname &amp; foto wijzigen</button>
        </span>
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
      <div id="profiel-kind-form-wrap" class="hidden"></div>
    </section>
  `;

  bindPageEvents(container, children);
}

/* ----------------------------------------
   KINDKAART HTML
---------------------------------------- */
function renderKindCard(kind) {
  const age = calcAge(kind.birthdate);
  const texture = kind.texture_preference ? TEXTURE_LABEL[kind.texture_preference] : null;
  const eczema = kind.has_eczema ? 'Ja' : 'Nee';

  const allergies = Array.isArray(kind.known_allergies) && kind.known_allergies.length > 0
    ? kind.known_allergies.map(a => `<span class="profiel-tag">${escapeHtml(a)}</span>`).join('')
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
          ${texture ? `<span class="profiel-kind-texture">${escapeHtml(texture)}</span>` : ''}
        </div>
        <div class="profiel-kind-actions">
          <button class="btn btn-outline btn-sm kind-edit-btn" data-id="${escapeHtml(kind.id)}">Bewerken</button>
          <button class="btn btn-outline btn-sm btn-danger kind-delete-btn" data-id="${escapeHtml(kind.id)}" title="Kind archiveren">Verwijderen</button>
        </div>
      </div>
      <div class="profiel-kind-details">
        <div class="profiel-kind-detail-row">
          <span class="profiel-kind-detail-label">Eczeem</span>
          <span class="profiel-kind-detail-val">${eczema}</span>
        </div>
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
   KIND FORMULIER HTML
---------------------------------------- */
function renderKindForm(kind = null) {
  const isEdit = !!kind;
  const v = kind || {};
  const allergies = Array.isArray(v.known_allergies) ? v.known_allergies : [];

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
        <span class="profiel-form-label">Voedingsstijl</span>
        <div class="profiel-radio-group">
          ${[['puree', 'Puree'], ['stukjes', 'Stukjes / BLW'], ['combi', 'Combinatie']].map(([val, label]) => `
            <label class="profiel-radio-label">
              <input type="radio" name="pkf-texture" value="${val}"
                ${v.texture_preference === val ? 'checked' : ''}>
              ${label}
            </label>
          `).join('')}
        </div>
      </div>

      <div class="profiel-form-row">
        <span class="profiel-form-label">Eczeem aanwezig?</span>
        <div class="profiel-radio-group">
          <label class="profiel-radio-label">
            <input type="radio" name="pkf-eczema" value="ja" ${v.has_eczema ? 'checked' : ''}> Ja
          </label>
          <label class="profiel-radio-label">
            <input type="radio" name="pkf-eczema" value="nee" ${!v.has_eczema ? 'checked' : ''}> Nee
          </label>
        </div>
      </div>

      <div class="profiel-form-row">
        <label class="profiel-form-label">Bekende allergieën</label>
        <div class="profiel-allergen-input-wrap">
          <div class="profiel-tags" id="pkf-allergy-tags">
            ${allergies.map(a => renderAllergenTag(a)).join('')}
          </div>
          <div class="profiel-allergen-add-row">
            <input type="text" id="pkf-allergy-input" class="auth-input auth-input--sm"
              placeholder="Typ een allergeen en druk Enter" maxlength="50" autocomplete="off">
            <button type="button" class="btn btn-outline btn-sm" id="pkf-allergy-add-btn">+ Toevoegen</button>
          </div>
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

function renderAllergenTag(allergen) {
  return `<span class="profiel-tag profiel-tag--removable" data-allergen="${escapeHtml(allergen)}">
    ${escapeHtml(allergen)}<button type="button" class="profiel-tag-remove" aria-label="Verwijder ${escapeHtml(allergen)}">×</button>
  </span>`;
}

/* ----------------------------------------
   EVENT HANDLERS
---------------------------------------- */
function bindPageEvents(container, children) {
  // Nickname/avatar modal vanuit header
  document.getElementById('profiel-edit-nickname-btn')?.addEventListener('click', async () => {
    const updated = await openProfileModal();
    if (updated) {
      document.dispatchEvent(new CustomEvent('community:profile-updated', { detail: updated }));
      showToast('Profiel bijgewerkt.', 'success');
    }
  });

  // Kind toevoegen
  document.getElementById('profiel-add-kind-btn')?.addEventListener('click', () => {
    openForm(null, children, container);
  });

  // Kind bewerken
  container.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.kind-edit-btn');
    if (editBtn) {
      const id = editBtn.dataset.id;
      const kind = children.find(c => c.id === id);
      if (kind) openForm(kind, children, container);
      return;
    }

    const deleteBtn = e.target.closest('.kind-delete-btn');
    if (deleteBtn) {
      const id = deleteBtn.dataset.id;
      const kind = children.find(c => c.id === id);
      if (kind) confirmDelete(kind, children, container);
    }
  });
}

/* ----------------------------------------
   FORMULIER OPENEN
---------------------------------------- */
function openForm(kind, children, container) {
  const formWrap = document.getElementById('profiel-kind-form-wrap');
  if (!formWrap) return;
  formWrap.innerHTML = renderKindForm(kind);
  formWrap.classList.remove('hidden');
  formWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const allergyTags = formWrap.querySelector('#pkf-allergy-tags');
  const allergyInput = formWrap.querySelector('#pkf-allergy-input');
  const allergyAddBtn = formWrap.querySelector('#pkf-allergy-add-btn');
  const errorEl = formWrap.querySelector('#pkf-error');
  const saveBtn = formWrap.querySelector('#pkf-save-btn');
  const cancelBtn = formWrap.querySelector('#pkf-cancel-btn');

  function getAllergies() {
    return [...allergyTags.querySelectorAll('[data-allergen]')]
      .map(el => el.dataset.allergen);
  }

  function addAllergen() {
    const val = allergyInput.value.trim().toLowerCase().slice(0, 50);
    if (!val) return;
    const existing = getAllergies();
    if (existing.includes(val)) { allergyInput.value = ''; return; }
    if (existing.length >= 30) return;
    allergyTags.insertAdjacentHTML('beforeend', renderAllergenTag(val));
    allergyInput.value = '';
    allergyInput.focus();
  }

  allergyAddBtn?.addEventListener('click', addAllergen);
  allergyInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addAllergen(); }
  });

  allergyTags?.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.profiel-tag-remove');
    if (removeBtn) removeBtn.closest('[data-allergen]').remove();
  });

  cancelBtn?.addEventListener('click', () => {
    formWrap.classList.add('hidden');
    formWrap.innerHTML = '';
  });

  saveBtn?.addEventListener('click', async () => {
    errorEl.classList.add('hidden');

    const name = formWrap.querySelector('#pkf-name').value.trim();
    const birthdate = formWrap.querySelector('#pkf-birthdate').value;
    const texture = formWrap.querySelector('input[name="pkf-texture"]:checked')?.value || null;
    const hasEczema = formWrap.querySelector('input[name="pkf-eczema"]:checked')?.value === 'ja';
    const known_allergies = getAllergies();
    const previous_reactions = formWrap.querySelector('#pkf-reactions').value.trim() || null;
    const notes = formWrap.querySelector('#pkf-notes').value.trim() || null;

    if (!name) { showFormError(errorEl, 'Naam is verplicht.'); return; }
    if (!birthdate) { showFormError(errorEl, 'Geboortedatum is verplicht.'); return; }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Opslaan…';

    const payload = {
      name, birthdate,
      texture_preference: texture,
      has_eczema: hasEczema,
      known_allergies,
      previous_reactions,
      notes,
    };

    let result;
    if (kind) {
      result = await Api.updateChild(kind.id, payload);
    } else {
      result = await Api.createChild(payload);
    }

    if (!result.ok) {
      showFormError(errorEl, result.error || 'Er ging iets mis.');
      saveBtn.disabled = false;
      saveBtn.textContent = kind ? 'Opslaan' : 'Kind toevoegen';
      return;
    }

    // Ververs de lijst
    formWrap.classList.add('hidden');
    formWrap.innerHTML = '';
    const fresh = await Api.getChildren();
    if (fresh.ok) {
      renderPage(container, fresh.data.children || []);
    }
    showToast(kind ? 'Profiel bijgewerkt.' : 'Kind toegevoegd.', 'success');
  });
}

/* ----------------------------------------
   VERWIJDEREN BEVESTIGEN
---------------------------------------- */
async function confirmDelete(kind, children, container) {
  if (!confirm(`Wil je "${kind.name}" verwijderen? Dit is niet ongedaan te maken.`)) return;

  const { ok, error } = await Api.archiveChild(kind.id);
  if (!ok) {
    showToast(error || 'Verwijderen mislukt.', 'error');
    return;
  }
  const fresh = await Api.getChildren();
  if (fresh.ok) renderPage(container, fresh.data.children || []);
  showToast(`${kind.name} verwijderd.`, 'success');
}

/* ----------------------------------------
   HELPERS
---------------------------------------- */
function showFormError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}
