/* ============================================
   ALLERGENEN INTRODUCEREN
   Tracker voor de 13 standaard-allergenen per kindje.
   Bron-van-waarheid: eerste_hapjes_allergen_doses (3 doses per
   allergeen, reactie geen/mild/ernstig). Bekende allergieën uit
   het profiel (children.known_allergies) worden bij init gesynced
   naar eerste_hapjes_state.allergen_state.known_allergies en
   automatisch als 'allergisch' getoond.
============================================ */

import { escapeHtml, showToast, colorFromSeed, initialsFromName } from '../utils.js?v=2.5.6';
import { getChildren } from '../childrenApi.js?v=2.5.6';
import {
  loadEhState,
  patchEhState,
  loadEhDoses,
  createEhDose,
  deleteEhDose,
} from '../eersteHapjesStateApi.js?v=2.5.6';
import { loadSymptomsForChild } from '../eersteHapjesSymptomsApi.js?v=2.5.6';
import {
  ALLERGEN_FLOW,
  REACTION_LEVELS,
  getEligibleAllergens,
  getAllergenStatus,
} from '../content/eersteHapjes-allergen-flow.js?v=2.5.6';
import { openSymptomLogModal } from './symptomLogModal.js?v=2.5.6';
import { mountAllergenenAgenda } from './allergenenAgenda.js?v=2.5.6';

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
  const totalByKey = {};
  for (const d of doses) {
    totalByKey[d.allergen_key] = (totalByKey[d.allergen_key] || 0) + 1;
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
  // pre_introduced: gemarkeerd-als-veilig vóór tracking, telt als completed
  const preIntro = ehState?.allergen_state?.pre_introduced || [];
  for (const key of preIntro) {
    if (!completed.includes(key)) completed.push(key);
    delete inProgress[key];
  }
  return {
    completed,
    inProgress,
    totalByKey,
    knownAllergies: ehState?.allergen_state?.known_allergies || [],
    preIntroduced: preIntro,
    paused: !!ehState?.allergen_state?.paused,
  };
}

/**
 * Bepaal de eerstvolgende dose-suggestie.
 * Returnt null als alles veilig of niets eligibel.
 */
function getNextDoseSuggestion(ctx, ageMonths) {
  const ordered = [...ALLERGEN_FLOW].sort((a, b) => a.order - b.order);
  for (const a of ordered) {
    if (ctx.knownAllergies.includes(a.key)) continue;
    if (ctx.completed.includes(a.key)) continue;
    if (a.ageCondition.introFrom && ageMonths < a.ageCondition.introFrom) continue;
    const total = ctx.totalByKey[a.key] || 0;
    if (total >= 3) continue; // 3 doses geregistreerd maar niet veilig → vastgelopen, sla over
    return { allergen: a, doseNumber: total + 1 };
  }
  return null;
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

  // Skeleton met switcher tonen, data laden
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
    <div class="allergenen-stage" id="allergenen-stage">
      <div class="empty-state"><div class="empty-state-icon">&#9203;</div><h3>Data laden…</h3></div>
    </div>
  `;
  bindSwitcher(root);
  bindHeaderActions(root);

  await loadChildData(active.id);
  renderArtsWarning(root);
  renderStage(root, active);
}

/**
 * Kies welk scherm getoond wordt op basis van allergen_state.
 */
function renderStage(root, child) {
  const stage = root.querySelector('#allergenen-stage');
  if (!stage) return;
  const allergenState = state.ehState?.allergen_state || {};
  if (!allergenState.started) {
    renderWelcome(stage, child);
  } else if (!allergenState.setup_done) {
    renderSetup(stage, child);
  } else {
    stage.innerHTML = `<div class="allergenen-grid" id="allergenen-grid"></div>`;
    renderGrid(root, child);
  }
}

/* ============================================
   ONBOARDING — Welkomscherm
============================================ */
function renderWelcome(stage, child) {
  stage.innerHTML = `
    <div class="allergenen-welcome-card">
      <div class="allergenen-welcome-icon">🍽️</div>
      <h3>Klaar om allergenen te introduceren voor ${escapeHtml(child.name)}?</h3>
      <p>
        We begeleiden je door de 13 allergenen, in de juiste volgorde,
        met telkens 3 doses zonder reactie om een allergeen als veilig te markeren.
      </p>
      <p>
        Je kiest zelf wanneer je start, wanneer je naar het volgende allergeen
        gaat en wanneer je een nieuwe dose registreert. Bekende allergieën uit
        het profiel slaan we automatisch over.
      </p>
      <button type="button" class="btn btn-primary btn-lg" data-action="start-flow">
        Start met introduceren
      </button>
    </div>
  `;
  stage.querySelector('[data-action="start-flow"]').addEventListener('click', async () => {
    try {
      const updated = await patchEhState(child.id, {
        allergen_state: { ...(state.ehState?.allergen_state || {}), started: true },
      });
      state.ehState = updated;
      const root = document.getElementById('allergenen-root');
      if (root) renderStage(root, child);
    } catch (err) {
      showToast(err.message || 'Starten mislukt.', 'error');
    }
  });
}

/* ============================================
   ONBOARDING — Markeer reeds geïntroduceerd
============================================ */
function renderSetup(stage, child) {
  const knownAllergies = state.ehState?.allergen_state?.known_allergies || [];
  const ageMonths = ageMonthsFromBirthdate(child.birthdate);
  const candidates = [...ALLERGEN_FLOW]
    .sort((a, b) => a.order - b.order)
    .filter(a => !knownAllergies.includes(a.key));

  const items = candidates.map(a => {
    const locked = a.ageCondition.introFrom && ageMonths < a.ageCondition.introFrom;
    return `
      <label class="allergenen-setup-item ${locked ? 'is-locked' : ''}">
        <input type="checkbox" data-key="${a.key}" ${locked ? 'disabled' : ''}>
        <span class="allergenen-setup-icon">${a.icon}</span>
        <span class="allergenen-setup-label">
          <strong>${escapeHtml(a.label)}</strong>
          <small>${escapeHtml(a.suggestedFood)}</small>
          ${locked ? `<em>Vanaf ${a.ageCondition.introFrom} maanden</em>` : ''}
        </span>
      </label>
    `;
  }).join('');

  stage.innerHTML = `
    <div class="allergenen-setup-card">
      <h3>Reeds geïntroduceerd?</h3>
      <p>
        Vink aan welke allergenen ${escapeHtml(child.name)} al regelmatig en
        zonder reactie heeft gegeten. Deze slaan we over — je hoeft hier geen
        doses meer voor te loggen.
      </p>
      <div class="allergenen-setup-list">
        ${items || '<p>Geen allergenen om te markeren.</p>'}
      </div>
      <div class="allergenen-setup-actions">
        <button type="button" class="btn btn-outline" data-action="setup-skip">
          Niets aanvinken
        </button>
        <button type="button" class="btn btn-primary" data-action="setup-save">
          Verder
        </button>
      </div>
    </div>
  `;

  const finalize = async (preIntroduced) => {
    try {
      const current = state.ehState?.allergen_state || {};
      const updated = await patchEhState(child.id, {
        allergen_state: {
          ...current,
          pre_introduced: preIntroduced,
          setup_done: true,
        },
      });
      state.ehState = updated;
      const root = document.getElementById('allergenen-root');
      if (root) renderStage(root, child);
    } catch (err) {
      showToast(err.message || 'Opslaan mislukt.', 'error');
    }
  };

  stage.querySelector('[data-action="setup-skip"]').addEventListener('click', () => finalize([]));
  stage.querySelector('[data-action="setup-save"]').addEventListener('click', () => {
    const checked = [...stage.querySelectorAll('input[type="checkbox"][data-key]:checked')]
      .map(i => i.dataset.key);
    finalize(checked);
  });
}

/**
 * Bereken welke allergenen-keys "reeds geïntroduceerd" zijn. Union van:
 *   (a) keys waarvan minstens 1 dose bestaat,
 *   (b) pre_introduced (gemarkeerd als reeds-veilig vóór tracking),
 *   (c) known_allergies (uit profiel, bekend allergisch).
 * Gesorteerd via ALLERGEN_FLOW.order.
 */
function computeIntroducedKeys(doses, ehState) {
  const set = new Set();
  for (const d of (doses || [])) set.add(d.allergen_key);
  for (const k of (ehState?.allergen_state?.pre_introduced || [])) set.add(k);
  for (const k of (ehState?.allergen_state?.known_allergies || [])) set.add(k);
  const ordered = [...ALLERGEN_FLOW].sort((a, b) => a.order - b.order);
  const out = [];
  for (const a of ordered) {
    if (set.has(a.key)) out.push(a.key);
  }
  return out;
}

function bindHeaderActions(root) {
  root.querySelector('[data-action="open-agenda"]')?.addEventListener('click', () => {
    openAgendaModal();
  });
  root.querySelector('[data-action="log-symptom"]')?.addEventListener('click', async () => {
    const active = state.children.find(c => c.id === state.activeId);
    if (!active) return;
    const introducedKeys = computeIntroducedKeys(state.doses, state.ehState);
    const result = await openSymptomLogModal({
      childId: active.id,
      childName: active.name,
      introducedKeys,
    });
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
  const nextUp = getNextDoseSuggestion(ctx, ageMonths);

  grid.innerHTML = `
    ${renderNextUpBanner(nextUp, ctx)}
    <ul class="allergenen-list">
      ${all.map(a => renderAllergenItem(a, ctx, ageMonths, child)).join('')}
    </ul>
  `;

  // Next-up CTA → opent dose-modal voor het juiste allergeen
  const nextBtn = grid.querySelector('[data-action="next-dose"]');
  if (nextBtn && nextUp) {
    nextBtn.addEventListener('click', () => {
      openDoseModal(child.id, nextUp.allergen.key, nextUp.doseNumber);
    });
  }

  // Klik op een item → toggle expand
  grid.querySelectorAll('.allergenen-item-head').forEach(head => {
    head.addEventListener('click', () => {
      const item = head.closest('.allergenen-item');
      const isOpen = item.classList.toggle('open');
      head.setAttribute('aria-expanded', String(isOpen));
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

function renderNextUpBanner(nextUp, ctx) {
  if (!nextUp) {
    // Alles geïntroduceerd
    const total = ALLERGEN_FLOW.length;
    const done = ctx.completed.length + ctx.knownAllergies.length;
    if (done >= total) {
      return `
        <div class="allergenen-nextup allergenen-nextup--done">
          🎉 <strong>Alle allergenen zijn geïntroduceerd.</strong>
          Je hoeft niets meer te doen — bekijk de historiek in de agenda.
        </div>
      `;
    }
    return `
      <div class="allergenen-nextup allergenen-nextup--wait">
        ⏳ Er is op dit moment geen volgende dose beschikbaar
        (bv. wachten op leeftijdsvoorwaarde).
      </div>
    `;
  }
  const a = nextUp.allergen;
  return `
    <div class="allergenen-nextup">
      <div class="allergenen-nextup-main">
        <span class="allergenen-nextup-icon">${a.icon}</span>
        <div class="allergenen-nextup-body">
          <span class="allergenen-nextup-label">Volgende stap</span>
          <strong>${escapeHtml(a.label)} — dose ${nextUp.doseNumber}/3</strong>
          <small>${escapeHtml(a.suggestedFood)}</small>
        </div>
      </div>
      <button type="button" class="btn btn-primary" data-action="next-dose">
        Dose ${nextUp.doseNumber} registreren
      </button>
    </div>
  `;
}

const SEVERITY_DISPLAY = {
  mild:   { icon: '🟢', label: 'Mild' },
  matig:  { icon: '🟠', label: 'Twijfel' },
  heftig: { icon: '🔴', label: 'Ernstig' },
};

const SYMPTOM_DETAIL_LABELS = {
  time_after_eating: {
    'direct':     'Direct (<15 min)',
    'snel':       'Snel (15 min – 1 u)',
    'later':      'Later (1 – 4 u)',
    'veel-later': 'Veel later (>4 u)',
    'onbekend':   'Onbekend tijdstip',
  },
  duration: {
    'kort':          'Kort (<30 min)',
    'paar-uur':      'Een paar uur',
    'halve-dag':     'Een halve dag',
    'dag-of-langer': 'Een dag of langer',
    'nog-bezig':     'Nog bezig',
  },
  worsened: {
    'stabiel':         'Bleef stabiel',
    'langzaam-erger':  'Langzaam erger',
    'snel-erger':      'Snel erger',
    'minder':          'Werden minder',
  },
  behavior: {
    'normaal':       'Normaal',
    'onrustig':      'Onrustig/huilerig',
    'ongemakkelijk': 'Erg ongemakkelijk',
    'suf':           'Suf/lethargisch',
  },
};

function symptomDetailChips(s) {
  const parts = [];
  for (const field of ['time_after_eating', 'duration', 'worsened', 'behavior']) {
    const v = s[field];
    if (!v) continue;
    const label = SYMPTOM_DETAIL_LABELS[field]?.[v];
    if (label) parts.push(label);
  }
  return parts;
}

function formatSymptomDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
}

function renderAllergenItem(allergen, ctx, ageMonths, child) {
  const status = getAllergenStatus(allergen.key, ctx, ageMonths);
  const dosesForKey = state.doses
    .filter(d => d.allergen_key === allergen.key)
    .sort((a, b) => (a.dose_number - b.dose_number));
  const symptomsForKey = (state.symptoms || [])
    .filter(s => s.linked_allergen_key === allergen.key)
    .sort((a, b) => new Date(b.occurred_at || 0) - new Date(a.occurred_at || 0));
  const successCount = ctx.inProgress[allergen.key] || (ctx.completed.includes(allergen.key) ? 3 : 0);
  const stuck = dosesForKey.length >= 3 && !ctx.completed.includes(allergen.key)
    && !ctx.knownAllergies.includes(allergen.key);

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

        ${stuck ? `
          <div class="allergenen-stuck-box">
            Er was een reactie tijdens de 3 introducties — dit allergeen heeft
            geen 3× <em>geen reactie</em>. Verwijder een dose en log opnieuw na
            een rustperiode, of markeer dit allergeen als allergie in
            <a href="#/profiel">Mijn profiel</a>.
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
                  ${d.notes ? `<span class="allergenen-dose-notes">${escapeHtml(d.notes)}</span>` : ''}
                  <button class="allergenen-dose-del" data-action="delete-dose" data-id="${d.id}" title="Verwijderen" aria-label="Dose verwijderen">&#128465;</button>
                </li>
              `).join('')}
            </ul>
          </div>
        ` : ''}

        ${symptomsForKey.length > 0 ? `
          <div class="allergenen-symptoms">
            <h4>Gelogde symptomen</h4>
            <ul class="allergenen-symptom-list">
              ${symptomsForKey.map(s => {
                const sev = SEVERITY_DISPLAY[s.severity] || { icon: '⚪', label: s.severity || '' };
                const chips = symptomDetailChips(s);
                return `
                <li class="allergenen-symptom allergenen-symptom--${s.severity}">
                  <span class="allergenen-symptom-severity">${sev.icon} ${escapeHtml(sev.label)}</span>
                  <span class="allergenen-symptom-date">${escapeHtml(formatSymptomDateTime(s.occurred_at))}</span>
                  ${chips.length ? `
                    <span class="allergenen-symptom-details">
                      ${chips.map(c => `<span class="allergenen-symptom-chip">${escapeHtml(c)}</span>`).join('')}
                    </span>
                  ` : ''}
                  ${s.notes ? `<span class="allergenen-symptom-notes">${escapeHtml(s.notes)}</span>` : ''}
                </li>
                `;
              }).join('')}
            </ul>
          </div>
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

      <p class="allergenen-dose-modal-hint">
        Een reactie komt vaak pas later. Merk je iets op? Log dit apart via
        <strong>“Symptoom loggen”</strong> op het overzicht.
      </p>

      <label for="dose-notes">Notities (optioneel)</label>
      <textarea id="dose-notes" rows="3" maxlength="500" placeholder="Hoeveelheid, observaties…"></textarea>

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
    const notes = overlay.querySelector('#dose-notes').value.trim();
    const errorEl = overlay.querySelector('#dose-error');

    try {
      const dose = await createEhDose({
        child_id: childId,
        allergen_key: allergenKey,
        dose_number: doseNumber,
        intro_date: date,
        reaction: 'geen',
        notes: notes || null,
      });
      state.doses = [...state.doses, dose];
      close();
      showToast('Dose geregistreerd.', 'success');
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
