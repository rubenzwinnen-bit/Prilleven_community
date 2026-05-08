/* ============================================
   EERSTE HAPJES TRAJECT
   SPA-pagina met onboarding + Vandaag.
   Brok B — onboarding & kindje-switcher.
   Brok C — maaltijd- en symptoom-logging.
   Brok D — allergenen-tracker + recept-warning.
============================================ */

import { escapeHtml, colorFromSeed, initialsFromName, showToast } from '../utils.js?v=2.5.0';
import {
  getMyChildren,
  getMealsForChild,
  getSymptomsForChild,
  getAllergensForChild,
  deleteMealLog,
  deleteSymptom,
} from '../eersteHapjesApi.js?v=2.5.0';
import { openChildOnboardingModal } from './childOnboardingModal.js?v=2.5.0';
import { openMealLogModal } from './mealLogModal.js?v=2.5.0';
import { openSymptomLogModal } from './symptomLogModal.js?v=2.5.0';
import { openAllergenManager } from './allergenManager.js?v=2.5.0';

// Module-state
let state = {
  loaded: false,
  children: [],
  activeId: null,
  meals: [],
  symptoms: [],
  allergens: [],
  logsLoadedFor: null, // child_id waarvoor logs geladen zijn
};

const TEXTURE_LABEL = {
  puree:   'Puree',
  stukjes: 'Stukjes',
  combi:   'Combi',
};

const MEAL_TYPE_LABEL = {
  ontbijt: 'Ontbijt',
  lunch:   'Lunch',
  diner:   'Diner',
  snack:   'Snack',
};

const REACTION_EMOJI = {
  positief:  '😋',
  neutraal:  '😐',
  afwijzing: '😖',
};

const SYMPTOM_TYPE_LABEL = {
  huid: 'Huid', buik: 'Buikpijn', diarree: 'Diarree', braken: 'Braken',
  slaap: 'Slaap', koorts: 'Koorts', jeuk: 'Jeuk', zwelling: 'Zwelling',
  ademhaling: 'Ademhaling', anders: 'Anders',
};

const SYMPTOM_TYPE_ICON = {
  huid: '🌡', buik: '🤰', diarree: '💧', braken: '🤢',
  slaap: '😴', koorts: '🤒', jeuk: '✋', zwelling: '🫧',
  ademhaling: '🫁', anders: '❓',
};

export function render() {
  return `
    <div class="eh-page" id="eh-root">
      <div class="eh-loading-shell">
        <div class="eh-loading-spinner" aria-hidden="true"></div>
        <p>Even een momentje…</p>
      </div>
    </div>
  `;
}

export async function init() {
  const root = document.getElementById('eh-root');
  if (!root) return;

  await loadChildren();
  await renderApp(root);
}

async function loadChildren() {
  const { ok, data, error } = await getMyChildren();
  if (!ok) {
    state.loaded = true;
    state.children = [];
    state.activeId = null;
    state._error = error;
    return;
  }
  state.loaded = true;
  state.children = data.children || [];
  if (!state.activeId || !state.children.find(c => c.id === state.activeId)) {
    const firstActive = state.children.find(c => !c.archived_at);
    state.activeId = firstActive?.id || null;
  }
}

async function loadLogs(childId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const fromIsoToday = today.toISOString();
  // Symptomen: laatste 7 dagen voor patroonherkenning
  const fromIsoWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [mealsRes, sympRes, allergRes] = await Promise.all([
    getMealsForChild(childId, { from: fromIsoToday }),
    getSymptomsForChild(childId, { from: fromIsoWeek }),
    getAllergensForChild(childId),
  ]);

  state.meals = mealsRes.ok ? (mealsRes.data?.meals || []) : [];
  state.symptoms = sympRes.ok ? (sympRes.data?.symptoms || []) : [];
  state.allergens = allergRes.ok ? (allergRes.data?.allergens || []) : [];
  state.logsLoadedFor = childId;
}

async function renderApp(root) {
  if (state._error) {
    root.innerHTML = `
      <div class="eh-page-inner">
        <div class="empty-state">
          <h3>Er ging iets mis</h3>
          <p>${escapeHtml(state._error)}</p>
        </div>
      </div>
    `;
    return;
  }

  if (state.children.length === 0) {
    root.innerHTML = `
      <div class="eh-page-inner">
        <div class="eh-welcome">
          <div class="eh-welcome-icon">🥄</div>
          <h2 class="eh-welcome-title">Welkom bij Eerste Hapjes</h2>
          <p class="eh-welcome-sub">Voeg je eerste kindje toe om te starten.</p>
          <button class="btn btn-primary" id="eh-start-onboarding">Toevoegen</button>
        </div>
      </div>
    `;
    const btn = document.getElementById('eh-start-onboarding');
    btn.addEventListener('click', () => openOnboarding(root));
    openOnboarding(root);
    return;
  }

  const active = state.children.find(c => c.id === state.activeId)
              || state.children[0];

  // Logs laden als nog niet gedaan voor dit kindje
  if (state.logsLoadedFor !== active.id) {
    await loadLogs(active.id);
  }

  root.innerHTML = `
    <div class="eh-page-inner">
      ${renderSwitcher(state.children, active)}
      ${renderToday(active)}
    </div>
  `;

  bindSwitcher(root);
  bindLogActions(root, active);
}

function renderSwitcher(children, active) {
  const chips = children.map(c => {
    const isActive = c.id === active.id;
    const color = colorFromSeed(c.id);
    const initials = initialsFromName(c.name);
    return `
      <button
        class="eh-child-chip ${isActive ? 'active' : ''}"
        data-child-id="${c.id}"
        type="button"
      >
        <span class="eh-child-avatar" style="background:${color};">${escapeHtml(initials)}</span>
        <span class="eh-child-name">${escapeHtml(c.name)}</span>
      </button>
    `;
  }).join('');

  return `
    <div class="eh-switcher">
      <div class="eh-switcher-chips">
        ${chips}
        <button class="eh-child-chip eh-child-chip-add" data-action="add-child" type="button">
          <span class="eh-child-avatar eh-child-avatar-add">+</span>
          <span class="eh-child-name">Kindje toevoegen</span>
        </button>
      </div>
    </div>
  `;
}

function renderToday(child) {
  const ageLabel = formatAge(child.birthdate);
  const texture = child.texture_preference
    ? TEXTURE_LABEL[child.texture_preference]
    : null;

  return `
    <section class="eh-today">
      <header class="eh-today-header">
        <h1 class="eh-today-title">Vandaag met ${escapeHtml(child.name)}</h1>
        <p class="eh-today-meta">
          ${escapeHtml(ageLabel)}${texture ? ` · structuur: ${escapeHtml(texture)}` : ''}
        </p>
      </header>

      <div class="eh-today-grid">
        ${renderMealsCard(child)}
        ${renderSymptomsCard(child)}
        ${renderAllergensCard(child)}
        <div class="eh-today-card eh-today-card-soon">
          <h3>Volgende stap</h3>
          <p>Korte uitleg per fase, op het moment dat het relevant wordt.</p>
          <span class="eh-today-pill">Binnenkort</span>
        </div>
      </div>
    </section>
  `;
}

function renderMealsCard() {
  const meals = state.meals;
  const body = meals.length === 0
    ? `<p class="eh-log-empty">Nog geen maaltijden gelogd vandaag.</p>`
    : `<ul class="eh-log-list">
         ${meals.map(m => renderMealRow(m)).join('')}
       </ul>`;

  return `
    <div class="eh-today-card eh-log-card eh-log-card-meals">
      <header class="eh-log-card-header">
        <h3>Maaltijden vandaag</h3>
        <button class="eh-log-add" data-action="add-meal" aria-label="Maaltijd toevoegen">+</button>
      </header>
      ${body}
    </div>
  `;
}

function renderMealRow(m) {
  const time = new Date(m.eaten_at).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
  const typeLabel = MEAL_TYPE_LABEL[m.meal_type] || m.meal_type;
  const reactionEmoji = m.reaction ? REACTION_EMOJI[m.reaction] : '';
  return `
    <li class="eh-log-item" data-meal-id="${m.id}">
      <div class="eh-log-item-main">
        <div class="eh-log-item-top">
          <span class="eh-log-time">${escapeHtml(time)}</span>
          <span class="eh-log-type">${escapeHtml(typeLabel)}</span>
          ${reactionEmoji ? `<span class="eh-log-emoji">${reactionEmoji}</span>` : ''}
        </div>
        <div class="eh-log-item-body">
          ${escapeHtml(m.food_text)}
          ${m.amount ? `<span class="eh-log-meta">· ${escapeHtml(m.amount)}</span>` : ''}
        </div>
        ${m.notes ? `<div class="eh-log-notes">${escapeHtml(m.notes)}</div>` : ''}
      </div>
      <button class="eh-log-delete" data-action="delete-meal" data-id="${m.id}" aria-label="Verwijder maaltijd">×</button>
    </li>
  `;
}

function renderAllergensCard(child) {
  const all = state.allergens || [];
  const tried = all.filter(a => a.status === 'geprobeerd');
  const planned = all.filter(a => a.status === 'gepland');
  const avoid = all.filter(a => a.status === 'vermijden');

  const chip = (a) => `
    <span class="eh-al-chip eh-al-chip-${escapeHtml(a.status)}${
      a.reaction && a.reaction !== 'geen' && a.reaction !== 'onbekend'
        ? ' eh-al-chip-react-' + escapeHtml(a.reaction)
        : ''
    }">
      ${escapeHtml(capitalize(a.allergen_key))}${
        a.reaction && a.reaction !== 'geen' && a.reaction !== 'onbekend'
          ? ` <span class="eh-al-chip-tag">${escapeHtml(a.reaction)}</span>`
          : ''
      }
    </span>
  `;

  let body;
  if (all.length === 0) {
    body = `<p class="eh-log-empty">Nog geen allergenen bijgehouden voor ${escapeHtml(child.name)}.</p>`;
  } else {
    body = `
      <div class="eh-al-groups">
        ${tried.length ? `
          <div class="eh-al-group">
            <div class="eh-al-group-label">Geprobeerd</div>
            <div class="eh-al-chips-row">${tried.map(chip).join('')}</div>
          </div>` : ''}
        ${planned.length ? `
          <div class="eh-al-group">
            <div class="eh-al-group-label">Gepland</div>
            <div class="eh-al-chips-row">${planned.map(chip).join('')}</div>
          </div>` : ''}
        ${avoid.length ? `
          <div class="eh-al-group">
            <div class="eh-al-group-label">Vermijden</div>
            <div class="eh-al-chips-row">${avoid.map(chip).join('')}</div>
          </div>` : ''}
      </div>
    `;
  }

  return `
    <div class="eh-today-card eh-log-card eh-log-card-allergens">
      <header class="eh-log-card-header">
        <h3>Allergenen</h3>
        <button class="eh-log-add" data-action="manage-allergens" aria-label="Allergenen beheren">✎</button>
      </header>
      ${body}
    </div>
  `;
}

function capitalize(s) {
  if (!s) return '';
  return s[0].toUpperCase() + s.slice(1);
}

function renderSymptomsCard() {
  const recent = state.symptoms;
  const body = recent.length === 0
    ? `<p class="eh-log-empty">Geen symptomen gelogd in de afgelopen week.</p>`
    : `<ul class="eh-log-list">
         ${recent.slice(0, 5).map(s => renderSymptomRow(s)).join('')}
       </ul>`;

  return `
    <div class="eh-today-card eh-log-card eh-log-card-symptoms">
      <header class="eh-log-card-header">
        <h3>Symptomen <span class="eh-log-card-sub">(7 dagen)</span></h3>
        <button class="eh-log-add" data-action="add-symptom" aria-label="Symptoom toevoegen">+</button>
      </header>
      ${body}
    </div>
  `;
}

function renderSymptomRow(s) {
  const when = new Date(s.occurred_at).toLocaleString('nl-BE', {
    weekday: 'short', hour: '2-digit', minute: '2-digit',
  });
  const label = SYMPTOM_TYPE_LABEL[s.symptom_type] || s.symptom_type;
  const icon = SYMPTOM_TYPE_ICON[s.symptom_type] || '';
  return `
    <li class="eh-log-item" data-symptom-id="${s.id}">
      <div class="eh-log-item-main">
        <div class="eh-log-item-top">
          <span class="eh-log-time">${escapeHtml(when)}</span>
          <span class="eh-log-type">${icon} ${escapeHtml(label)}</span>
          <span class="eh-log-severity eh-log-severity-${s.severity}">${escapeHtml(s.severity)}</span>
        </div>
        ${s.notes ? `<div class="eh-log-notes">${escapeHtml(s.notes)}</div>` : ''}
      </div>
      <button class="eh-log-delete" data-action="delete-symptom" data-id="${s.id}" aria-label="Verwijder symptoom">×</button>
    </li>
  `;
}

function bindSwitcher(root) {
  root.querySelectorAll('.eh-child-chip[data-child-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.childId;
      if (id === state.activeId) return;
      state.activeId = id;
      await renderApp(root);
    });
  });
  const addBtn = root.querySelector('[data-action="add-child"]');
  if (addBtn) addBtn.addEventListener('click', () => openOnboarding(root));
}

function bindLogActions(root, child) {
  const addMealBtn = root.querySelector('[data-action="add-meal"]');
  if (addMealBtn) {
    addMealBtn.addEventListener('click', async () => {
      const meal = await openMealLogModal({
        childId: child.id,
        childName: child.name,
        childAllergens: state.allergens,
      });
      if (meal) {
        showToast('Maaltijd opgeslagen.', 'success');
        await loadLogs(child.id);
        await renderApp(root);
      }
    });
  }

  const addSympBtn = root.querySelector('[data-action="add-symptom"]');
  if (addSympBtn) {
    addSympBtn.addEventListener('click', async () => {
      const sym = await openSymptomLogModal({ childId: child.id, childName: child.name });
      if (sym) {
        showToast('Symptoom opgeslagen.', 'success');
        await loadLogs(child.id);
        await renderApp(root);
      }
    });
  }

  // Allergenen-manager
  const manageAlBtn = root.querySelector('[data-action="manage-allergens"]');
  if (manageAlBtn) {
    manageAlBtn.addEventListener('click', async () => {
      await openAllergenManager({ childId: child.id, childName: child.name });
      // Bij sluiten: herlaad logs (allergenen kunnen gewijzigd zijn).
      await loadLogs(child.id);
      await renderApp(root);
    });
  }

  root.querySelectorAll('[data-action="delete-meal"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!window.confirm('Deze maaltijd-log verwijderen?')) return;
      const id = btn.dataset.id;
      const { ok, error } = await deleteMealLog(id);
      if (!ok) return showToast(error || 'Verwijderen mislukt.', 'error');
      showToast('Verwijderd.', 'success');
      await loadLogs(child.id);
      await renderApp(root);
    });
  });

  root.querySelectorAll('[data-action="delete-symptom"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!window.confirm('Deze symptoom-log verwijderen?')) return;
      const id = btn.dataset.id;
      const { ok, error } = await deleteSymptom(id);
      if (!ok) return showToast(error || 'Verwijderen mislukt.', 'error');
      showToast('Verwijderd.', 'success');
      await loadLogs(child.id);
      await renderApp(root);
    });
  });
}

async function openOnboarding(root) {
  const child = await openChildOnboardingModal();
  if (!child) return;
  showToast(`${child.name} is toegevoegd.`, 'success');
  state.children = [child, ...state.children];
  state.activeId = child.id;
  state.logsLoadedFor = null; // forceer logs-load voor het nieuwe kindje
  await renderApp(root);
}

/**
 * Geef een korte leeftijdsweergave: '3 weken', '5 maanden', '1 jaar 2 mnd', etc.
 */
function formatAge(birthdateIso) {
  if (!birthdateIso) return '';
  const today = new Date();
  const bd = new Date(birthdateIso + 'T00:00:00');
  const diffMs = today - bd;
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (days < 14)  return `${days} ${days === 1 ? 'dag' : 'dagen'}`;
  if (days < 60)  return `${Math.floor(days / 7)} weken`;

  let months = (today.getFullYear() - bd.getFullYear()) * 12
             + (today.getMonth() - bd.getMonth());
  if (today.getDate() < bd.getDate()) months -= 1;
  if (months < 12) return `${months} ${months === 1 ? 'maand' : 'maanden'}`;

  const years = Math.floor(months / 12);
  const rest  = months % 12;
  if (rest === 0) return `${years} ${years === 1 ? 'jaar' : 'jaar'}`;
  return `${years} jaar ${rest} mnd`;
}
