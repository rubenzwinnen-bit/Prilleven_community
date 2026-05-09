/* ============================================
   EERSTE HAPJES TRAJECT
   SPA-pagina met onboarding + Vandaag.
   Brok B — onboarding & kindje-switcher.
   Brok C — maaltijd- en symptoom-logging.
   Brok D — allergenen-tracker + recept-warning.
   Brok E — microlearning-content (Volgende stap + Alle tips).
   Brok F — fasen-systeem (banner + detail + overzicht).
============================================ */

import { escapeHtml, colorFromSeed, initialsFromName, showToast } from '../utils.js?v=2.14.0';
import {
  getMyChildren,
  getMealsForChild,
  getSymptomsForChild,
  getAllergensForChild,
  getAllergenIntros,
  getPhases,
  deleteMealLog,
  deleteSymptom,
} from '../eersteHapjesApi.js?v=2.14.0';
import {
  ageMonthsFromBirthdate,
  getNextStepArticle,
  formatAgeRange,
} from '../eersteHapjesContent.js?v=2.14.0';
import { openChildOnboardingModal } from './childOnboardingModal.js?v=2.14.0';
import { openMealLogModal } from './mealLogModal.js?v=2.14.0';
import { openSymptomLogModal } from './symptomLogModal.js?v=2.14.0';
import { openSymptomDetailModal } from './symptomDetailModal.js?v=2.14.0';
import { openAllergenManager } from './allergenManager.js?v=2.14.0';
import {
  deriveAllergenState,
  statusLabel,
  statusTone,
  openAllergenTimelineModal,
} from './allergenIntroModal.js?v=2.14.0';
import { openArticleModal, openArticleListModal } from './articleModal.js?v=2.14.0';
import { openRiskFoodsListModal, openRiskFoodDetailModal } from './riskFoodsModal.js?v=2.14.0';
import {
  getRelevantRiskFoods,
  formatAgeLimit,
} from '../content/eersteHapjes-risk-foods.js?v=2.14.0';
import {
  renderPhaseBanner,
  openPhaseDetailModal,
  openPhaseOverviewModal,
} from './phaseModal.js?v=2.14.0';
import { getSymptomMeta, isRedFlag } from '../content/eersteHapjes-symptoms.js?v=2.14.0';
import { buildSuggestions } from '../eersteHapjesSuggestions.js?v=2.14.0';
import { getRecipes } from '../store.js?v=2.14.0';
import * as Router from '../router.js?v=2.14.0';

// Module-state
let state = {
  loaded: false,
  children: [],
  activeId: null,
  meals: [],
  symptoms: [],
  allergens: [],
  allergenIntrosByKey: {},
  recentMeals: [],
  recipesCache: [],
  phaseState: null,
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

// Symptoom-meta (label + icon) komen uit js/content/eersteHapjes-symptoms.js
// — zie getSymptomMeta() / SYMPTOMS daar.

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

/**
 * Sync access tot het huidige actieve kindje. Returnt null als nog niet
 * geladen. Gebruikt door modules buiten Eerste Hapjes (bv. recipeDetail).
 */
export function getActiveChildSnapshot() {
  return state.children.find((c) => c.id === state.activeId) || null;
}

/**
 * Async fallback: laad children als ze nog niet in state zitten en bepaal
 * een actief kindje (jongste niet-gearchiveerde). Returnt het object of null.
 */
export async function loadActiveChild() {
  if (state.children.length === 0) {
    const { ok, data } = await getMyChildren();
    if (!ok) return null;
    state.children = data?.children || [];
  }
  if (!state.activeId || !state.children.find((c) => c.id === state.activeId)) {
    const sorted = state.children
      .filter((c) => !c.archived_at)
      .sort((a, b) => new Date(b.birthdate) - new Date(a.birthdate));
    state.activeId = sorted[0]?.id || null;
  }
  return getActiveChildSnapshot();
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

  const [mealsRes, recentMealsRes, sympRes, allergRes, introsRes, phasesRes, recipesPromise] = await Promise.all([
    getMealsForChild(childId, { from: fromIsoToday }),
    getMealsForChild(childId, { from: fromIsoWeek }),
    getSymptomsForChild(childId, { from: fromIsoWeek }),
    getAllergensForChild(childId),
    getAllergenIntros(childId),
    getPhases(childId),
    getRecipes().catch(() => []),
  ]);

  state.meals = mealsRes.ok ? (mealsRes.data?.meals || []) : [];
  state.recentMeals = recentMealsRes.ok ? (recentMealsRes.data?.meals || []) : [];
  state.recipesCache = Array.isArray(recipesPromise) ? recipesPromise : [];
  state.symptoms = sympRes.ok ? (sympRes.data?.symptoms || []) : [];
  state.allergens = allergRes.ok ? (allergRes.data?.allergens || []) : [];
  state.allergenIntrosByKey = {};
  if (introsRes.ok) {
    for (const i of (introsRes.data?.intros || [])) {
      if (!state.allergenIntrosByKey[i.allergen_key]) state.allergenIntrosByKey[i.allergen_key] = [];
      state.allergenIntrosByKey[i.allergen_key].push(i);
    }
  }
  state.phaseState = phasesRes.ok ? phasesRes.data : null;
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

      ${renderPhaseBanner(state.phaseState)}

      ${renderRemindersCard(child)}

      <div class="eh-today-grid">
        ${renderMealsCard(child)}
        ${renderSymptomsCard(child)}
        ${renderAllergensCard(child)}
        ${renderNextStepCard(child)}
      </div>

      <div class="eh-today-foot">
        <button class="eh-tips-link" data-action="open-phases" type="button">
          Mijn fasen →
        </button>
        <button class="eh-tips-link" data-action="open-symptom-list" type="button">
          Symptomen-uitleg →
        </button>
        <button class="eh-tips-link" data-action="open-risk-foods" type="button">
          Risicovoedingen-lijst →
        </button>
      </div>
    </section>
  `;
}

function renderNextStepCard(child) {
  const months = ageMonthsFromBirthdate(child.birthdate);
  const article = getNextStepArticle(months);

  if (!article) {
    return `
      <div class="eh-today-card eh-log-card eh-log-card-nextstep">
        <header class="eh-log-card-header">
          <h3>Volgende stap</h3>
        </header>
        <p class="eh-log-empty">Geen artikel voor deze leeftijd. Check 'Alle tips' onderaan.</p>
      </div>
    `;
  }

  return `
    <div class="eh-today-card eh-log-card eh-log-card-nextstep">
      <header class="eh-log-card-header">
        <h3>Volgende stap</h3>
        <span class="eh-nextstep-age">${escapeHtml(formatAgeRange(article.ageMinMonths, article.ageMaxMonths))}</span>
      </header>
      <h4 class="eh-nextstep-title">${escapeHtml(article.title)}</h4>
      <p class="eh-nextstep-summary">${escapeHtml(article.summary)}</p>
      <button class="eh-nextstep-link" data-action="open-article" data-slug="${escapeHtml(article.slug)}">
        Lees meer →
      </button>
    </div>
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
  const introsByKey = state.allergenIntrosByKey || {};

  // Bouw rijen op basis van union (allergens-rijen + alle keys met intros).
  const keys = new Set();
  all.forEach((a) => keys.add(a.allergen_key));
  Object.keys(introsByKey).forEach((k) => keys.add(k));

  let body;
  if (keys.size === 0) {
    body = `<p class="eh-log-empty">Nog geen allergenen bijgehouden voor ${escapeHtml(child.name)}. Tik op ✎ om te beginnen.</p>`;
  } else {
    const allergensByKey = {};
    all.forEach((a) => { allergensByKey[a.allergen_key] = a; });

    const rows = Array.from(keys).sort().map((key) => {
      const allergen = allergensByKey[key] || null;
      const intros = introsByKey[key] || [];
      const st = deriveAllergenState(allergen, intros);
      const showProgress = st.status === 'probeer-opnieuw' || st.status === 'veilig';
      const pct = Math.min(100, Math.round((st.successfulCount / st.target) * 100));

      return `
        <button type="button" class="eh-al-row" data-allergen-key="${escapeHtml(key)}">
          <div class="eh-al-row-top">
            <span class="eh-al-row-name">${escapeHtml(capitalize(key))}</span>
            <span class="eh-al-row-pill eh-tone-${escapeHtml(statusTone(st.status))}">
              ${escapeHtml(statusLabel(st.status))}${showProgress ? ` · ${st.successfulCount}/${st.target}` : ''}
            </span>
          </div>
          ${showProgress ? `
            <div class="eh-al-row-progress">
              <div class="eh-al-row-progress-fill eh-tone-${escapeHtml(statusTone(st.status))}" style="width:${pct}%"></div>
            </div>
          ` : ''}
        </button>
      `;
    }).join('');

    body = `<div class="eh-al-rows">${rows}</div>`;
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

/* ============================================
   Reminders-card (brok H.6)
============================================ */
function buildReminders(child) {
  const reminders = [];

  // Allergeen-reminders (gepland zonder intro + her-introductie nodig).
  // Risicovoedingen worden NIET in deze card getoond — gebruiker raadpleegt
  // ze via de "Risicovoedingen-lijst →" footer-link.
  const allergens = state.allergens || [];
  const introsByKey = state.allergenIntrosByKey || {};
  for (const a of allergens) {
    if (a.status === 'vermijden') continue;
    const intros = introsByKey[a.allergen_key] || [];
    const st = deriveAllergenState(a, intros);
    if (st.status === 'later') {
      reminders.push({
        kind: 'reminder',
        type: 'allergen',
        key: a.allergen_key,
        label: capitalize(a.allergen_key),
        sub: 'Gepland — nog niet geprobeerd',
      });
    } else if (st.status === 'probeer-opnieuw') {
      const lastIntro = intros.reduce((latest, i) => {
        if (!latest) return i;
        return i.intro_date > latest.intro_date ? i : latest;
      }, null);
      const days = lastIntro ? daysSinceIso(lastIntro.intro_date) : 0;
      if (days >= 2) {
        reminders.push({
          kind: 'reminder',
          type: 'allergen',
          key: a.allergen_key,
          label: capitalize(a.allergen_key),
          sub: `${st.successfulCount}/${st.target} — ${days}d geleden, tijd voor herhaling`,
        });
      }
    }
  }

  return reminders;
}

// Combineer reminders + suggestions met dedupe (brok I.2).
// Reminder wint over suggestion bij zelfde "onderwerp" (bv. allergeen-key).
function buildAdvice(child) {
  const reminders = buildReminders(child);
  const suggestions = buildSuggestions({
    child,
    allergens: state.allergens,
    allergenIntrosByKey: state.allergenIntrosByKey,
    todayMeals: state.meals,
    recentMeals: state.recentMeals,
    symptoms: state.symptoms,
    phaseState: state.phaseState,
    recipes: state.recipesCache,
  });

  // Dedupe: bouw set van "onderwerp-keys" uit reminders zodat suggesties
  // over hetzelfde onderwerp niet duplicaten.
  const reminderAllergenKeys = new Set(
    reminders.filter((r) => r.type === 'allergen').map((r) => r.key)
  );
  const filteredSuggestions = suggestions.filter((s) => {
    if (s.action?.kind === 'open-intro' && reminderAllergenKeys.has(s.action.allergenKey)) {
      return false;
    }
    return true;
  }).map((s) => ({ ...s, kind: 'suggestion' }));

  return [...reminders, ...filteredSuggestions];
}

function showSuggestionInfo(infoKey, data) {
  // Per info-key een korte toelichting via toast.
  // Geen aparte modal voor v1 — als de uitleg te lang is, kunnen we later
  // upgraden naar een eigen modal-shell.
  if (infoKey === 'rejection') {
    const recipe = data.recipeName || 'dit recept';
    const n = data.count || 3;
    showToast(`${n}× afwijzing voor ${recipe}. Probeer een andere textuur (puree → stukjes), kleinere portie, of een ander tijdstip.`, 'info');
  } else if (infoKey === 'duplicate') {
    showToast(`Vandaag al ${data.count || 2} maaltijden van dit type — check je lijst hierboven of het klopt.`, 'info');
  } else if (infoKey === 'symptom-pattern') {
    const meta = getSymptomMeta(data.symptomType);
    const label = meta?.label || data.symptomType || 'symptoom';
    showToast(`${label} kwam ${data.count || 3}× voor deze week. Bekijk wat ${state.children.find(c=>c.id===state.activeId)?.name || 'je kindje'} de uren ervoor at — soms is er een patroon.`, 'info');
  } else {
    showToast('Geen info beschikbaar.', 'info');
  }
}

function daysSinceIso(iso) {
  if (!iso) return 0;
  const d = new Date(iso + 'T00:00:00Z').getTime();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today.getTime() - d) / (24 * 60 * 60 * 1000)));
}

function renderRemindersCard(child) {
  const items = buildAdvice(child);
  if (items.length === 0) return '';

  return `
    <div class="eh-today-card eh-reminders-card">
      <header class="eh-log-card-header">
        <h3>Tips & herinneringen</h3>
        <span class="eh-reminders-count">${items.length}</span>
      </header>
      <ul class="eh-reminders-list">
        ${items.map((item) => renderAdviceItem(item)).join('')}
      </ul>
    </div>
  `;
}

function renderAdviceItem(item) {
  if (item.kind === 'suggestion') {
    const a = item.action || {};
    const dataAttrs = [
      `data-suggestion-key="${escapeHtml(item.key)}"`,
      `data-action-kind="${escapeHtml(a.kind || '')}"`,
      a.allergenKey  ? `data-allergen-key="${escapeHtml(a.allergenKey)}"`   : '',
      a.recipeId     ? `data-recipe-id="${escapeHtml(a.recipeId)}"`         : '',
      a.infoKey      ? `data-info-key="${escapeHtml(a.infoKey)}"`           : '',
      a.symptomType  ? `data-symptom-type="${escapeHtml(a.symptomType)}"`   : '',
      a.mealType     ? `data-meal-type="${escapeHtml(a.mealType)}"`         : '',
    ].filter(Boolean).join(' ');
    return `
      <li class="eh-reminder-item eh-reminder-item-suggestion">
        <button class="eh-reminder-btn" ${dataAttrs} type="button">
          <span class="eh-reminder-main">
            <span class="eh-reminder-label">${escapeHtml(item.label)}</span>
            <span class="eh-reminder-sub">${escapeHtml(item.sub)}</span>
          </span>
          <span class="eh-reminder-arrow" aria-hidden="true">›</span>
        </button>
      </li>
    `;
  }
  // reminder (brok H.6)
  return `
    <li class="eh-reminder-item">
      <button class="eh-reminder-btn"
              data-reminder-type="${escapeHtml(item.type)}"
              data-reminder-key="${escapeHtml(item.key)}"
              type="button">
        <span class="eh-reminder-main">
          <span class="eh-reminder-label">${escapeHtml(item.label)}</span>
          <span class="eh-reminder-sub">${escapeHtml(item.sub)}</span>
        </span>
        <span class="eh-reminder-arrow" aria-hidden="true">›</span>
      </button>
    </li>
  `;
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
  const meta = getSymptomMeta(s.symptom_type);
  const label = meta?.label || s.symptom_type;
  const icon  = meta?.icon  || '';
  const flagged = isRedFlag(s.symptom_type, s.severity);
  return `
    <li class="eh-log-item ${flagged ? 'has-redflag' : ''}" data-symptom-id="${s.id}">
      <div class="eh-log-item-main">
        <div class="eh-log-item-top">
          <span class="eh-log-time">${escapeHtml(when)}</span>
          <span class="eh-log-type">${icon} ${escapeHtml(label)}</span>
          <span class="eh-log-severity eh-log-severity-${s.severity}">${escapeHtml(s.severity)}</span>
          ${flagged ? `<button class="eh-log-redflag-pill" data-action="open-symptom-info" data-key="${escapeHtml(s.symptom_type)}" type="button" aria-label="Meer info">⚠ Aandachtssignaal</button>` : ''}
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
        childBirthdate: child.birthdate,
        childAllergens: state.allergens,
        todayMeals: state.meals,
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
      const result = await openSymptomLogModal({ childId: child.id, childName: child.name });
      if (result?.symptom) {
        showToast('Symptoom opgeslagen.', 'success');
        await loadLogs(child.id);
        await renderApp(root);
        if (result.red_flag) {
          showRedFlagBanner(result.symptom.symptom_type);
        }
      }
    });
  }

  // "Symptomen-uitleg"-link → lijst-modal
  const symListBtn = root.querySelector('[data-action="open-symptom-list"]');
  if (symListBtn) {
    symListBtn.addEventListener('click', async () => {
      await openSymptomDetailModal({ listMode: true });
    });
  }

  // "Risicovoedingen-lijst"-link → lijst-modal (brok H.5)
  const riskListBtn = root.querySelector('[data-action="open-risk-foods"]');
  if (riskListBtn) {
    riskListBtn.addEventListener('click', async () => {
      const months = child.birthdate ? ageMonthsFromBirthdate(child.birthdate) : null;
      await openRiskFoodsListModal({ ageMonths: months });
    });
  }

  // Reminder-card items (brok H.6) — alleen nog allergeen-reminders
  root.querySelectorAll('[data-reminder-type]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const type = btn.dataset.reminderType;
      const key  = btn.dataset.reminderKey;
      if (type === 'allergen') {
        const allergen = (state.allergens || []).find((a) => a.allergen_key === key) || null;
        const result = await openAllergenTimelineModal({
          childId: child.id,
          allergenKey: key,
          allergenLabel: capitalize(key),
          allergen,
        });
        if (result?.changed) {
          await loadLogs(child.id);
          await renderApp(root);
        }
      }
    });
  });

  // Suggestion-card items (brok I.2)
  root.querySelectorAll('[data-suggestion-key]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const kind = btn.dataset.actionKind;
      if (kind === 'open-intro') {
        const allergenKey = btn.dataset.allergenKey;
        const result = await openAllergenIntroModal({
          childId: child.id,
          allergenKey,
          allergenLabel: capitalize(allergenKey),
        });
        if (result?.created) {
          await loadLogs(child.id);
          await renderApp(root);
        }
      } else if (kind === 'open-recipe') {
        const recipeId = btn.dataset.recipeId;
        if (recipeId) Router.navigate(`recipe/${recipeId}`);
      } else if (kind === 'open-meal-log') {
        document.querySelector('[data-action="add-meal"]')?.click();
      } else if (kind === 'open-phase-detail') {
        document.querySelector('[data-action="open-phases"]')?.click();
      } else if (kind === 'show-info') {
        const infoKey = btn.dataset.infoKey;
        showSuggestionInfo(infoKey, btn.dataset);
      }
    });
  });

  // ⚠-pill in elke symptoom-rij → opent detail-modal voor dat symptoom
  root.querySelectorAll('[data-action="open-symptom-info"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await openSymptomDetailModal({ symptomKey: btn.dataset.key });
    });
  });

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

  // Allergeen-rij in Vandaag-card → opent tijdlijn-modal
  root.querySelectorAll('.eh-al-row[data-allergen-key]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.allergenKey;
      const allergen = (state.allergens || []).find((a) => a.allergen_key === key) || null;
      const result = await openAllergenTimelineModal({
        childId: child.id,
        allergenKey: key,
        allergenLabel: capitalize(key),
        allergen,
      });
      if (result?.changed) {
        await loadLogs(child.id);
        await renderApp(root);
      }
    });
  });

  // "Volgende stap"-artikel openen
  const articleBtn = root.querySelector('[data-action="open-article"]');
  if (articleBtn) {
    articleBtn.addEventListener('click', async () => {
      const { getArticleBySlug } = await import('../eersteHapjesContent.js?v=2.14.0');
      const article = getArticleBySlug(articleBtn.dataset.slug);
      if (article) await openArticleModal(article);
    });
  }

  // "Alle tips"-modal
  const tipsBtn = root.querySelector('[data-action="open-tips"]');
  if (tipsBtn) {
    tipsBtn.addEventListener('click', async () => {
      const months = ageMonthsFromBirthdate(child.birthdate);
      await openArticleListModal({ ageMonths: months });
    });
  }

  // Fase-banner → detail-modal
  const phaseBannerBtn = root.querySelector('[data-action="open-phase-detail"]');
  if (phaseBannerBtn) {
    phaseBannerBtn.addEventListener('click', async () => {
      const { changed } = await openPhaseDetailModal({
        child,
        phaseState: state.phaseState,
      });
      if (changed) {
        await loadLogs(child.id);
        await renderApp(root);
      }
    });
  }

  // "Mijn fasen"-link → overzicht-modal
  const phasesBtn = root.querySelector('[data-action="open-phases"]');
  if (phasesBtn) {
    phasesBtn.addEventListener('click', async () => {
      const { changed } = await openPhaseOverviewModal({
        child,
        phaseState: state.phaseState,
      });
      if (changed) {
        await loadLogs(child.id);
        await renderApp(root);
      }
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
 * Adaptieve red-flag-banner — verschijnt na het loggen van een symptoom
 * dat door de server als red_flag gemarkeerd werd. Bewaart geen state:
 * verschijnt enkel direct na het loggen, sluit-knop ruimt op.
 */
function showRedFlagBanner(symptomKey) {
  // Vermijd stapelen: één banner tegelijk.
  document.querySelectorAll('.eh-redflag-banner').forEach(b => b.remove());

  const meta = getSymptomMeta(symptomKey);
  const label = meta?.label || symptomKey;

  const banner = document.createElement('div');
  banner.className = 'eh-redflag-banner';
  banner.setAttribute('role', 'alert');
  banner.innerHTML = `
    <div class="eh-redflag-banner-inner">
      <span class="eh-redflag-banner-icon" aria-hidden="true">⚠</span>
      <div class="eh-redflag-banner-text">
        <strong>Aandachtssignaal — ${escapeHtml(label)}</strong>
        Dit symptoom kan om medische aandacht vragen. Pril Leven geeft geen medisch
        advies — bij twijfel: contacteer je arts of Kind &amp; Gezin.
      </div>
      <button type="button" class="eh-redflag-banner-link" data-action="more">Lees meer</button>
      <button type="button" class="eh-redflag-banner-close" aria-label="Sluiten">×</button>
    </div>
  `;
  document.body.appendChild(banner);

  banner.querySelector('[data-action="more"]').addEventListener('click', async () => {
    await openSymptomDetailModal({ symptomKey });
  });
  banner.querySelector('.eh-redflag-banner-close').addEventListener('click', () => {
    banner.remove();
  });
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
