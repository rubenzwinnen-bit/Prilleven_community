/* ============================================
   PROFIEL COMPONENT
   Profielpagina: account-info + kinderen beheren.
   Route: #/profiel
============================================ */

import * as Store from '../store.js?v=2.5.4';
import { sessionGet } from '../supabase.js?v=2.5.4';
import { escapeHtml, showToast } from '../utils.js?v=2.5.4';
import * as Api from '../childrenApi.js?v=2.5.4';
import { openProfileModal } from './profileModal.js?v=2.5.4';
import { ALLERGEN_FLOW } from '../content/eersteHapjes-allergen-flow.js?v=2.5.4';

/* ----------------------------------------
   ALLERGEENLIJST (13 standaard-allergenen, identiek aan tracker)
   Eén bron van waarheid: ALLERGEN_FLOW.
---------------------------------------- */
const ALLERGEN_OPTIONS = [...ALLERGEN_FLOW]
  .sort((a, b) => a.order - b.order)
  .map(a => ({ key: a.key, label: a.label }));

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

  renderPage(container, data.children || []);
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
          ${texture ? `<span class="profiel-kind-texture">${escapeHtml(texture)}</span>` : ''}
        </div>
        <div class="profiel-kind-actions">
          <button class="btn btn-outline btn-sm kind-edit-btn" data-id="${escapeHtml(kind.id)}">Bewerken</button>
          <button class="btn btn-outline btn-sm btn-danger kind-delete-btn" data-id="${escapeHtml(kind.id)}">Verwijderen</button>
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
  document.getElementById('profiel-edit-nickname-btn')?.addEventListener('click', async () => {
    const updated = await openProfileModal();
    if (updated) {
      document.dispatchEvent(new CustomEvent('community:profile-updated', { detail: updated }));
      showToast('Profiel bijgewerkt.', 'success');
    }
  });

  // Kind toevoegen → form onderaan de lijst
  document.getElementById('profiel-add-kind-btn')?.addEventListener('click', () => {
    // Sluit eventueel open bewerkformulier
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
}

/* ----------------------------------------
   FORMULIER HELPERS
---------------------------------------- */

// Sluit inline formulier als dat open staat (in een kaart)
function closeInlineForm() {
  const existing = document.getElementById('profiel-kind-form');
  if (!existing) return;
  const wrap = existing.closest('.profiel-kind-card[data-editing]');
  if (wrap) {
    const kindId = wrap.dataset.id;
    // We herstellen via een herlaad — simpelste aanpak
    wrap.removeAttribute('data-editing');
  }
}

// Bewerken: vervang de kaart door het formulier IN PLACE
function openEditForm(kind, container) {
  // Sluit andere open formulieren
  const existingForm = document.getElementById('profiel-kind-form');
  if (existingForm) {
    const oldCard = existingForm.closest('.profiel-kind-card');
    if (oldCard && oldCard.dataset.id !== kind.id) {
      // Andere kaart was open — herstel die eerst (simpel: herlaad pagina-sectie)
      // We laten het voor nu gewoon vervangen
    }
  }
  // Sluit ook "toevoegen"-formulier
  const addWrap = document.getElementById('profiel-add-form-wrap');
  if (addWrap) addWrap.remove();

  const card = document.querySelector(`.profiel-kind-card[data-id="${CSS.escape(kind.id)}"]`);
  if (!card) return;

  card.setAttribute('data-editing', '1');
  card.innerHTML = renderKindForm(kind);
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  bindFormEvents(card, kind, container);
}

// Toevoegen: voeg een nieuwe formulier-kaart toe onderaan de lijst
function openAddForm(container) {
  const list = document.getElementById('profiel-kinderen-list');
  if (!list) return;

  // Verwijder al bestaand toevoegformulier
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

// Bindt alle events in een formulier (werkt voor zowel kaart-in-place als nieuw)
function bindFormEvents(formWrap, kind, container) {
  const errorEl = formWrap.querySelector('#pkf-error');
  const saveBtn = formWrap.querySelector('#pkf-save-btn');
  const cancelBtn = formWrap.querySelector('#pkf-cancel-btn');

  // Allergieën dropdown
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

  // Sluit panel bij klik buiten
  document.addEventListener('click', function closePanel(e) {
    if (!formWrap.contains(e.target)) {
      panel?.classList.add('hidden');
      trigger?.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', closePanel);
    }
  });

  // Update label + tags bij elke checkbox-wijziging
  panel?.addEventListener('change', () => updateAllergenDisplay(panel, label, selectedTagsEl));

  cancelBtn?.addEventListener('click', async () => {
    if (kind) {
      // Herstel de originele kaart
      const card = formWrap; // formWrap IS de kaart bij edit
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
    const texture = formWrap.querySelector('input[name="pkf-texture"]:checked')?.value || null;
    const hasEczema = formWrap.querySelector('input[name="pkf-eczema"]:checked')?.value === 'ja';
    const known_allergies = getSelectedAllergens(panel);
    const previous_reactions = formWrap.querySelector('#pkf-reactions').value.trim() || null;
    const notes = formWrap.querySelector('#pkf-notes').value.trim() || null;

    if (!name) { showFormError(errorEl, 'Naam is verplicht.'); return; }
    if (!birthdate) { showFormError(errorEl, 'Geboortedatum is verplicht.'); return; }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Opslaan…';

    const payload = { name, birthdate, texture_preference: texture, has_eczema: hasEczema, known_allergies, previous_reactions, notes };

    const result = kind
      ? await Api.updateChild(kind.id, payload)
      : await Api.createChild(payload);

    if (!result.ok) {
      showFormError(errorEl, result.error || 'Er ging iets mis.');
      saveBtn.disabled = false;
      saveBtn.textContent = kind ? 'Opslaan' : 'Kind toevoegen';
      return;
    }

    const fresh = await Api.getChildren();
    if (fresh.ok) renderPage(container, fresh.data.children || []);
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
