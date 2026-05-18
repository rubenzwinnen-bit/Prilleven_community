/* ============================================
   ALLERGENEN INTRODUCEREN
   Tracker voor de 13 standaard-allergenen per kindje.
   Bron-van-waarheid: eerste_hapjes_allergen_doses (3 doses per
   allergeen, reactie geen/mild/ernstig). Bekende allergieën uit
   het profiel (children.known_allergies) worden bij init gesynced
   naar eerste_hapjes_state.allergen_state.known_allergies en
   automatisch als 'allergisch' getoond.
============================================ */

import { escapeHtml, showToast, colorFromSeed, initialsFromName } from '../utils.js?v=2.5.3';
import { getChildren } from '../childrenApi.js?v=2.5.3';
import {
  loadEhState,
  patchEhState,
  loadEhDoses,
  createEhDose,
  deleteEhDose,
} from '../eersteHapjesStateApi.js?v=2.5.3';
import { loadSymptomsForChild } from '../eersteHapjesSymptomsApi.js?v=2.5.3';
import {
  ALLERGEN_FLOW,
  REACTION_LEVELS,
  getEligibleAllergens,
  getAllergenStatus,
} from '../content/eersteHapjes-allergen-flow.js?v=2.5.3';
import { openSymptomLogModal } from './symptomLogModal.js?v=2.5.3';
import { mountAllergenenAgenda } from './allergenenAgenda.js?v=2.5.3';

let state = {
  loaded: false,
  children: [],
  activeId: null,
  ehState: null,
  doses: [],
  symptoms: [],
  error: null,
};

function ageMonthsFromBirthdate(birthdate) {
  if (!birthdate) return 0;
  const b = new Date(birthdate + 'T00:00:00Z');
  const now = new Date();
  let m = (now.getUTCFullYear() - b.getUTCFullYear()) * 12 + (now.getUTCMonth() - b.getUTCMonth());
  if (now.getUTCDate() < b.getUTCDate()) m -= 1;
  return Math.max(0, m);
}

function deriveStatusContext(doses, ehState) {
  const successByKey = {};
  for (const d of doses) {
    if (d.reaction === 'geen') {
      successByKey[d.allergen_key] = (successByKey[d.allergen_key] || 0) + 1;
    }
  }
  const completed = [];
  const inProgress = {};
  for (const [key, count] of Object.entries(successByKey)) {
    if (count >= 3) completed.push(key);
    else inProgress[key] = count;
  }
  return {
    completed,
    inProgress,
    knownAllergies: ehState?.allergen_state?.known_allergies || [],
    paused: !!ehState?.allergen_state?.paused,
  };
}

export function render() {
  return `
    <div class="allergenen-page" id="allergenen-root">
      <div class="empty-state">
        <div class="empty-state-icon">&#9203;</div>
        <h3>Allergenen laden…</h3>
      </div>
    </div>
  `;
}

export async function init() {
  const root = document.getElementById('allergenen-root');
  if (!root) return;

  await loadChildren();
  await renderApp(root);
}

async function loadChildren() {
  const { ok, data, error } = await getChildren();
  state.loaded = true;
  if (!ok) {
    state.children = [];
    state.activeId = null;
    state.error = error;
    return;
  }
  state.children = (data?.children || []).filter(c => !c.archived_at);
  if (!state.activeId || !state.children.find(c => c.id === state.activeId)) {
    const sorted = [...state.children].sort((a, b) => new Date(b.birthdate) - new Date(a.birthdate));
    state.activeId = sorted[0]?.id || null;
  }
}

async function loadChildData(childId) {
  state.ehState = null;
  state.doses = [];
  state.symptoms = [];
  try {
    const [s, d, sy] = await Promise.all([
      loadEhState(childId),
      loadEhDoses(childId),
      loadSymptomsForChild(childId).catch(() => []),
    ]);
    state.ehState = s;
    state.doses = d;
    state.symptoms = sy || [];

    // Sync known_allergies vanuit profiel → eerste_hapjes_state
    const child = state.children.find(c => c.id === childId);
    const profileAllergies = (child?.known_allergies || []).filter(k =>
      ALLERGEN_FLOW.some(a => a.key === k)
    );
    const trackerAllergies = s?.allergen_state?.known_allergies || [];
    const sameContent = profileAllergies.length === trackerAllergies.length
      && profileAllergies.every(k => trackerAllergies.includes(k));
    if (!sameContent) {
      try {
        const updated = await patchEhState(childId, {
          allergen_state: { ...(s?.allergen_state || {}), known_allergies: profileAllergies },
        });
        state.ehState = updated;
      } catch (e) {
        console.warn('Sync known_allergies failed', e);
      }
    }
  } catch (e) {
    state.error = e.message || String(e);
  }
}

async function renderApp(root) {
  if (state.error) {
    root.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">&#9888;</div>
        <h3>Er ging iets mis</h3>
        <p>${escapeHtml(state.error)}</p>
      </div>
    `;
    return;
  }

  if (state.children.length === 0) {
    root.innerHTML = `
      <div class="allergenen-welcome">
        <h2>Welkom bij Allergenen introduceren</h2>
        <p>Voeg eerst een kindje toe via je profiel om te beginnen.</p>
        <a class="btn btn-primary" href="#/profiel">Open Mijn profiel</a>
      </div>
    `;
    return;
  }

  const active = state.children.find(c => c.id === state.activeId) || state.children[0];
  state.activeId = active.id;

  // Eerst skeleton met switcher tonen, daarna data laden
  root.innerHTML = `
    <header class="allergenen-header">
      <h2>Allergenen introduceren</h2>
      <p class="allergenen-intro">
        Volg de 13 allergenen — telkens 3 doses met een rustpauze van minstens 2 dagen ertussen.
        Bekende allergieën uit het profiel zijn automatisch gemarkeerd.
      </p>
      <div class="allergenen-header-actions">
        <button type="button" class="btn btn-outline btn-sm" data-action="open-agenda">
          📅 Open agenda
        </button>
        <button type="button" class="btn btn-outline btn-sm" data-action="log-symptom">
          ➕ Symptoom loggen
        </button>
      </div>
    </header>
    ${renderSwitcher(state.children, active)}
    <div class="allergenen-warn-slot" id="allergenen-warn-slot"></div>
    <div class="allergenen-grid" id="allergenen-grid">
      <div class="empty-state"><div class="empty-state-icon">&#9203;</div><h3>Data laden…</h3></div>
    </div>
  `;
  bindSwitcher(root);
  bindHeaderActions(root);

  await loadChildData(active.id);
  renderArtsWarning(root);
  renderGrid(root, active);
}

function bindHeaderActions(root) {
  root.querySelector('[data-action="open-agenda"]')?.addEventListener('click', () => {
    openAgendaModal();
  });
  root.querySelector('[data-action="log-symptom"]')?.addEventListener('click', async () => {
    const active = state.children.find(c => c.id === state.activeId);
    if (!active) return;
    const result = await openSymptomLogModal({ childId: active.id, childName: active.name });
    if (!result) return;
    state.symptoms = [result.symptom, ...state.symptoms];
    if (result.red_flag) {
      showToast('Symptoom geregistreerd — raadpleeg een arts.', 'warning');
    } else {
      showToast('Symptoom geregistreerd.', 'success');
    }
    renderArtsWarning(root);
    renderGrid(root, active);
  });
}

function shouldShowArtsWarning() {
  // Trigger: laatste dose met ernstige reactie of een heftig symptoom in laatste 14 dagen.
  const cutoff = Date.now() - 14 * 86400000;
  const recentErnstigeDose = (state.doses || []).some(d => {
    if (d.reaction !== 'ernstig') return false;
    const t = new Date((d.intro_date || '') + 'T00:00:00Z').getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
  const recentHeftigSymptom = (state.symptoms || []).some(s => {
    if (s.severity !== 'heftig') return false;
    const t = new Date(s.occurred_at || 0).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
  return recentErnstigeDose || recentHeftigSymptom;
}

function renderArtsWarning(root) {
  const slot = root.querySelector('#allergenen-warn-slot');
  if (!slot) return;
  if (!shouldShowArtsWarning()) { slot.innerHTML = ''; return; }
  slot.innerHTML = `
    <div class="allergenen-arts-warn">
      <strong>⚠️ Raadpleeg een arts.</strong>
      Er is recent een ernstige reactie of heftig symptoom gelogd voor dit kindje.
      Pril Leven geeft geen medisch advies — neem contact op met je huisarts,
      kinderarts of Kind &amp; Gezin.
    </div>
  `;
}

async function openAgendaModal() {
  // Verzamel data per kindje (cache voor actief kind staat al in state).
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay agenda-overlay';
  overlay.innerHTML = `
    <div class="modal agenda-modal">
      <header class="agenda-modal-header">
        <h2>Agenda — introducties &amp; symptomen</h2>
        <button class="btn btn-outline btn-sm" data-action="close">Sluiten</button>
      </header>
      <div class="agenda-modal-body" id="agenda-modal-body">
        <div class="empty-state"><div class="empty-state-icon">&#9203;</div><h3>Data laden…</h3></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('[data-action="close"]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape' && document.body.contains(overlay)) {
      document.removeEventListener('keydown', escHandler);
      close();
    }
  });

  // Laad per kindje state + doses + symptomen.
  const dataByChild = {};
  await Promise.all(state.children.map(async (c) => {
    if (c.id === state.activeId) {
      dataByChild[c.id] = {
        ehState: state.ehState,
        doses: state.doses,
        symptoms: state.symptoms,
      };
      return;
    }
    try {
      const [s, d, sy] = await Promise.all([
        loadEhState(c.id),
        loadEhDoses(c.id),
        loadSymptomsForChild(c.id).catch(() => []),
      ]);
      dataByChild[c.id] = { ehState: s, doses: d, symptoms: sy || [] };
    } catch {
      dataByChild[c.id] = { ehState: null, doses: [], symptoms: [] };
    }
  }));

  const body = overlay.querySelector('#agenda-modal-body');
  body.innerHTML = '';
  mountAllergenenAgenda(body, {
    children: state.children,
    dataByChild,
    activeIds: [state.activeId],
  });
}

function renderSwitcher(children, active) {
  const chips = children.map((c) => {
    const isActive = c.id === active.id;
    const color = colorFromSeed(c.id);
    const initials = initialsFromName(c.name);
    return `
      <button class="allergenen-child-chip ${isActive ? 'active' : ''}" data-child-id="${c.id}" type="button">
        <span class="allergenen-child-avatar" style="background:${color};">${escapeHtml(initials)}</span>
        <span class="allergenen-child-name">${escapeHtml(c.name)}</span>
      </button>
    `;
  }).join('');
  return `
    <div class="allergenen-switcher">
      <div class="allergenen-switcher-chips">${chips}</div>
    </div>
  `;
}

function bindSwitcher(root) {
  root.querySelectorAll('.allergenen-child-chip[data-child-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.childId;
      if (id === state.activeId) return;
      state.activeId = id;
      await renderApp(root);
    });
  });
}

function renderGrid(root, child) {
  const grid = document.getElementById('allergenen-grid');
  if (!grid) return;

  const ageMonths = ageMonthsFromBirthdate(child.birthdate);
  const ctx = deriveStatusContext(state.doses, state.ehState);
  const eligible = getEligibleAllergens(ageMonths);
  const all = [...ALLERGEN_FLOW].sort((a, b) => a.order - b.order);

  grid.innerHTML = `
    <ul class="allergenen-list">
      ${all.map(a => renderAllergenItem(a, ctx, ageMonths, child)).join('')}
    </ul>
  `;

  // Klik op een item → toggle expand
  grid.querySelectorAll('.allergenen-item-head').forEach(head => {
    head.addEventListener('click', () => {
      const item = head.closest('.allergenen-item');
      const isOpen = item.classList.toggle('open');
      head.setAttribute('aria-expanded', String(isOpen));
    });
  });

  // Nieuwe dose registreren
  grid.querySelectorAll('[data-action="add-dose"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.key;
      const doseNumber = parseInt(btn.dataset.dose, 10);
      openDoseModal(child.id, key, doseNumber);
    });
  });

  // Dose verwijderen
  grid.querySelectorAll('[data-action="delete-dose"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (!confirm('Deze dose verwijderen?')) return;
      try {
        await deleteEhDose(id);
        state.doses = state.doses.filter(d => d.id !== id);
        renderArtsWarning(root);
        renderGrid(root, child);
      } catch (err) {
        showToast(err.message || 'Verwijderen mislukt.', 'error');
      }
    });
  });
}

function renderAllergenItem(allergen, ctx, ageMonths, child) {
  const status = getAllergenStatus(allergen.key, ctx, ageMonths);
  const dosesForKey = state.doses
    .filter(d => d.allergen_key === allergen.key)
    .sort((a, b) => (a.dose_number - b.dose_number));
  const successCount = ctx.inProgress[allergen.key] || (ctx.completed.includes(allergen.key) ? 3 : 0);
  const nextDose = Math.min(3, dosesForKey.length + 1);
  const canLog = status !== 'allergisch' && status !== 'veilig' && status !== 'locked-age';

  const statusLabel = {
    'veilig':      '✅ Veilig',
    'allergisch':  '⚠️ Allergisch',
    'in-progress': `🟡 ${successCount}/3`,
    'wacht':       '⚪ Wachten',
    'locked-age':  `🔒 Vanaf ${allergen.ageCondition.introFrom} mnd`,
    'paused':      '⏸️ Gepauzeerd',
  }[status];

  return `
    <li class="allergenen-item allergenen-item--${status}" data-key="${allergen.key}">
      <button class="allergenen-item-head" aria-expanded="false" type="button">
        <span class="allergenen-item-icon">${allergen.icon}</span>
        <span class="allergenen-item-label">${escapeHtml(allergen.label)}</span>
        <span class="allergenen-item-status">${statusLabel}</span>
        <span class="allergenen-item-caret">&#9662;</span>
      </button>
      <div class="allergenen-item-body">
        <p class="allergenen-item-suggestion">${escapeHtml(allergen.suggestedFood)}</p>
        ${allergen.note ? `<p class="allergenen-item-note">💡 ${escapeHtml(allergen.note)}</p>` : ''}
        ${allergen.alternative ? `<p class="allergenen-item-alt">↔️ ${escapeHtml(allergen.alternative)}</p>` : ''}

        ${status === 'allergisch' ? `
          <div class="allergenen-allergic-box">
            Dit allergeen staat in het profiel als bekende allergie.
            Wijzig dit in <a href="#/profiel">Mijn profiel</a> om de tracker opnieuw te activeren.
          </div>
        ` : ''}

        ${dosesForKey.length > 0 ? `
          <div class="allergenen-doses">
            <h4>Geregistreerde doses</h4>
            <ul class="allergenen-dose-list">
              ${dosesForKey.map(d => `
                <li class="allergenen-dose allergenen-dose--${d.reaction}">
                  <span class="allergenen-dose-num">Dose ${d.dose_number}</span>
                  <span class="allergenen-dose-date">${escapeHtml(d.intro_date)}</span>
                  <span class="allergenen-dose-reaction">${escapeHtml(REACTION_LEVELS[d.reaction]?.label || d.reaction)}</span>
                  ${d.notes ? `<span class="allergenen-dose-notes">${escapeHtml(d.notes)}</span>` : ''}
                  <button class="btn btn-outline btn-sm" data-action="delete-dose" data-id="${d.id}" title="Verwijderen">&#128465;</button>
                </li>
              `).join('')}
            </ul>
          </div>
        ` : ''}

        ${canLog && nextDose <= 3 ? `
          <button class="btn btn-primary btn-sm" data-action="add-dose" data-key="${allergen.key}" data-dose="${nextDose}">
            Dose ${nextDose} registreren
          </button>
        ` : ''}
      </div>
    </li>
  `;
}

function openDoseModal(childId, allergenKey, doseNumber) {
  const allergen = ALLERGEN_FLOW.find(a => a.key === allergenKey);
  const today = new Date().toISOString().slice(0, 10);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal allergenen-dose-modal">
      <h3>${escapeHtml(allergen?.label || allergenKey)} — dose ${doseNumber}</h3>
      <p class="allergenen-dose-modal-sub">${escapeHtml(allergen?.suggestedFood || '')}</p>

      <label for="dose-date">Datum</label>
      <input type="date" id="dose-date" value="${today}" max="${today}">

      <label for="dose-reaction">Reactie</label>
      <select id="dose-reaction">
        <option value="geen">Geen reactie</option>
        <option value="mild">Milde reactie</option>
        <option value="ernstig">Ernstige reactie</option>
      </select>

      <label for="dose-notes">Notities (optioneel)</label>
      <textarea id="dose-notes" rows="3" maxlength="500" placeholder="Hoeveelheid, reactie, observaties…"></textarea>

      <div id="dose-error" class="auth-error hidden"></div>

      <div class="nickname-actions">
        <button class="btn btn-outline" id="dose-cancel">Annuleren</button>
        <button class="btn btn-primary" id="dose-save">Opslaan</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('#dose-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.querySelector('#dose-save').addEventListener('click', async () => {
    const date = overlay.querySelector('#dose-date').value;
    const reaction = overlay.querySelector('#dose-reaction').value;
    const notes = overlay.querySelector('#dose-notes').value.trim();
    const errorEl = overlay.querySelector('#dose-error');

    try {
      const dose = await createEhDose({
        child_id: childId,
        allergen_key: allergenKey,
        dose_number: doseNumber,
        intro_date: date,
        reaction,
        notes: notes || null,
      });
      state.doses = [...state.doses, dose];
      close();
      if (dose.reaction === 'ernstig') {
        showToast('Ernstige reactie gelogd — raadpleeg een arts.', 'warning');
      } else {
        showToast('Dose geregistreerd.', 'success');
      }
      const root = document.getElementById('allergenen-root');
      const child = state.children.find(c => c.id === childId);
      if (root && child) {
        renderArtsWarning(root);
        renderGrid(root, child);
      }
    } catch (err) {
      errorEl.textContent = err.message || 'Opslaan mislukt.';
      errorEl.classList.remove('hidden');
    }
  });
}
