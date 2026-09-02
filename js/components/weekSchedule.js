/* ============================================
   WEEK SCHEDULE COMPONENT
   Twee sub-tabs:
   1. Genereren — willekeurig weekschema samenstellen (bestaand gedrag)
   2. Actief weekschema — bekijk het actieve schema (is_active=true uit DB)
      met drie presets: Vandaag / Vandaag en morgen / Heel weekschema

   PER-GEBRUIKER:
   - Het GEGENEREERDE (nog-niet-opgeslagen) schema zit in localStorage
     onder `receptenboek_active_schedule_<username>`.
   - De gekozen sub-tab en actieve-view preset zitten ook in localStorage.

   Async patroon:
   - render() geeft een skeleton terug
   - init() haalt recepten + ratings + actief schema parallel op
   - generateSchedule/refreshSlot werken op de cache (generator sub-tab)
============================================ */

import * as Store from '../store.js?v=4.0.26';
import * as Router from '../router.js?v=4.0.26';
import {
  showToast, escapeHtml, renderStarsDisplay, ALLERGENS, WEEKDAYS,
  SCHEDULE_SLOTS, slotToMealMoment, getSlotLabel, getAllergenLabel, normalizeAllergen
} from '../utils.js?v=4.0.26';
import { promptScheduleDetails } from './scheduleDetailsDialog.js?v=4.0.26';

/* ----------------------------------------
   STATE
---------------------------------------- */
let currentSchedule = null;   // gegenereerd schema (generator sub-tab)
let activeSchedule = null;    // actief schema uit DB (active sub-tab)
let cachedRecipes = [];
let cachedUserRatings = {};
let recipeMap = new Map();
let cachedFavoriteIds = new Set();
let cookingStateListenersAttached = false;

const MIN_NON_FAVORITE_POOL = 4;

/* ----------------------------------------
   PERSISTENT PER-GEBRUIKER KEYS
---------------------------------------- */
function getUsernameOrAnon() {
  return Store.getCurrentUser() || 'anoniem';
}

function getActiveScheduleKey() {
  return `receptenboek_active_schedule_${getUsernameOrAnon()}`;
}

function getSubtabKey() {
  return `receptenboek_schedule_subtab_${getUsernameOrAnon()}`;
}

function getActivePresetKey() {
  return `receptenboek_active_preset_${getUsernameOrAnon()}`;
}

/* ----------------------------------------
   GEGENEREERD SCHEMA (localStorage)
---------------------------------------- */
function loadActiveSchedule() {
  try {
    const raw = localStorage.getItem(getActiveScheduleKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.days) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveActiveSchedule(schedule) {
  try {
    if (schedule) {
      localStorage.setItem(getActiveScheduleKey(), JSON.stringify(schedule));
    } else {
      localStorage.removeItem(getActiveScheduleKey());
    }
  } catch (err) {
    console.warn('Kon gegenereerd weekschema niet opslaan:', err);
  }
}

/* ----------------------------------------
   SUB-TAB & PRESET VOORKEUREN
---------------------------------------- */
function loadSubtab() {
  const v = localStorage.getItem(getSubtabKey());
  return (v === 'active' || v === 'generate') ? v : 'active';
}
function saveSubtab(v) {
  try { localStorage.setItem(getSubtabKey(), v); } catch {}
}
function loadActivePreset() {
  const v = localStorage.getItem(getActivePresetKey());
  return (v === 'today' || v === 'today-tomorrow' || v === 'week') ? v : 'today';
}
function saveActivePreset(v) {
  try { localStorage.setItem(getActivePresetKey(), v); } catch {}
}

/* ----------------------------------------
   DAG-HELPERS
---------------------------------------- */
function getTodayWeekdayIndex() {
  // JS Date.getDay(): Sun=0, Mon=1, ..., Sat=6
  // WEEKDAYS: maandag=0, ..., zondag=6
  return (new Date().getDay() + 6) % 7;
}

function getDaysForPreset(preset) {
  const todayIdx = getTodayWeekdayIndex();
  if (preset === 'today') return [WEEKDAYS[todayIdx]];
  if (preset === 'today-tomorrow') {
    return [WEEKDAYS[todayIdx], WEEKDAYS[(todayIdx + 1) % 7]];
  }
  // 'week' → 7 dagen startend bij vandaag (chronologisch)
  return Array.from({ length: 7 }, (_, i) => WEEKDAYS[(todayIdx + i) % 7]);
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function cookingHistoryLabel(index) {
  if (index === 0) return 'Deze week';
  if (index === 1) return 'Vorige';
  return `${index} weken`;
}

function buildCookingRhythmHtml() {
  const progress = Store.getCookingWeekProgress();
  const history = Store.getCookingRhythmHistory(4);
  const visibleDays = Math.min(progress.days, progress.target);
  const historyWeeks = history.weeks.map((week, index) => {
    const marker = week.isComplete
      ? '&#10003;'
      : week.isCurrent ? `${Math.min(week.days, week.target)}/${week.target}` : '&ndash;';
    const status = week.isComplete
      ? 'ritme bereikt'
      : week.isCurrent ? `${week.days} van ${week.target} kookdagen` : 'geen vol ritme';
    return `
      <div class="cooking-history-week${week.isComplete ? ' is-complete' : ''}${week.isCurrent ? ' is-current' : ''}"
           aria-label="${escapeHtml(cookingHistoryLabel(index))}: ${status}">
        <span class="cooking-history-marker" aria-hidden="true">${marker}</span>
        <small>${escapeHtml(cookingHistoryLabel(index))}</small>
      </div>
    `;
  }).join('');

  return `
    <section class="cooking-rhythm ${progress.isComplete ? 'is-complete' : ''}"
             aria-label="Pril Ritme: ${visibleDays} van ${progress.target} kookdagen">
      <strong class="cooking-rhythm-title">Pril Ritme</strong>
      <div class="cooking-history-weeks" aria-label="Pril Ritme van de afgelopen vier weken">
        ${historyWeeks}
      </div>
    </section>
  `;
}

/* ----------------------------------------
   RENDER (skeleton)
---------------------------------------- */
export function render() {
  return `
    <div id="schedule-page">
      <h1 class="page-title" style="margin-bottom:1rem">Weekschema</h1>
      <div class="empty-state">
        <div class="empty-state-icon">&#9203;</div>
        <h3>Laden...</h3>
        <p>Een ogenblik geduld.</p>
      </div>
    </div>
  `;
}

/* ----------------------------------------
   BOUW DE PAGINA HTML (sub-tab bar + content)
---------------------------------------- */
function buildPageHtml() {
  const subtab = loadSubtab();

  return `
    <h1 class="page-title" style="margin-bottom:1rem">Weekschema</h1>
    <div class="subtab-bar" role="tablist">
      <button class="subtab-btn ${subtab === 'active' ? 'active' : ''}"
              data-subtab="active" role="tab" type="button">
        Actief weekschema
      </button>
      <button class="subtab-btn ${subtab === 'generate' ? 'active' : ''}"
              data-subtab="generate" role="tab" type="button">
        Genereren
      </button>
    </div>
    <div id="subtab-content">
      ${subtab === 'generate' ? buildGenerateTabHtml() : buildActiveTabHtml()}
    </div>
  `;
}

/* ----------------------------------------
   TAB: GENEREREN (bestaand gedrag)
---------------------------------------- */
function buildGenerateTabHtml() {
  const hasRecipes = cachedRecipes.length > 0;

  const usedAllergens = new Set();
  cachedRecipes.forEach(r => (r.allergens || []).forEach(a => usedAllergens.add(normalizeAllergen(a))));

  if (!hasRecipes) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">&#128197;</div>
        <h3>Geen recepten beschikbaar</h3>
        <p>Voeg eerst recepten toe of importeer ze om een weekschema te genereren.</p>
        <button class="btn btn-primary" onclick="location.hash='#/add'">+ Recept Toevoegen</button>
      </div>
    `;
  }

  return `
    <!-- Allergenen filter -->
    <div class="schedule-controls">
      <h3>Allergenen uitsluiten</h3>
      <p class="text-muted mb-2" style="font-size:0.85rem">
        Dit is <strong>jouw persoonlijke</strong> weekschema generator.
        Alleen jij ziet het schema dat je hier genereert en andere
        gebruikers kunnen het niet aanpassen. Het blijft bewaard tot
        je op "Genereer Weekschema" klikt om het te vernieuwen.
        <br><br>
        Vink hieronder de allergenen aan die je wilt uitsluiten.
        Recepten met deze allergenen worden niet gebruikt.
      </p>
      <div class="checkbox-group" id="allergen-filters">
        ${ALLERGENS.filter(a => usedAllergens.has(a)).map(a => `
          <label class="checkbox-label">
            <input type="checkbox" name="exclude-allergen" value="${a}"
              ${(currentSchedule?.excludedAllergens || []).map(normalizeAllergen).includes(a) ? 'checked' : ''}>
            <span>${getAllergenLabel(a)}</span>
          </label>
        `).join('')}
        ${usedAllergens.size === 0 ? '<p class="text-muted">Geen allergenen gevonden in de recepten.</p>' : ''}
      </div>

      <div class="schedule-preferences">
        <h3>Voorkeuren</h3>
        <label class="schedule-favorite-preference ${cachedFavoriteIds.size === 0 ? 'is-disabled' : ''}">
          <input type="checkbox" id="prefer-favorites"
                 ${currentSchedule?.preferFavorites && cachedFavoriteIds.size > 0 ? 'checked' : ''}
                 ${cachedFavoriteIds.size === 0 ? 'disabled' : ''}>
          <span class="schedule-favorite-preference-copy">
            <strong>Gebruik mijn favoriete recepten</strong>
            <small>${cachedFavoriteIds.size > 0
              ? 'Favorieten krijgen vaker een plek, terwijl je weekschema gevarieerd blijft.'
              : 'Je hebt nog geen favoriete recepten.'
            }</small>
          </span>
        </label>
      </div>

      <div class="mt-2" style="display:flex;gap:0.75rem;flex-wrap:wrap">
        <button class="btn btn-primary btn-lg" id="btn-generate">
          &#127922; Genereer Weekschema
        </button>
        ${currentSchedule ? `
          <button class="btn btn-secondary" id="btn-save-schedule">
            &#128190; Opslaan in Favorieten
          </button>
        ` : ''}
      </div>
    </div>

    <!-- Weekschema weergave -->
    <div class="schedule-grid" id="schedule-grid">
      ${currentSchedule ? renderScheduleGrid(currentSchedule) : `
        <div class="empty-state">
          <div class="empty-state-icon">&#128197;</div>
          <h3>Klik op "Genereer Weekschema"</h3>
          <p>Er wordt automatisch een weekmenu samengesteld op basis van je recepten.</p>
        </div>
      `}
    </div>
  `;
}

/* ----------------------------------------
   TAB: ACTIEF WEEKSCHEMA (nieuw)
---------------------------------------- */
function buildActiveTabHtml() {
  if (!activeSchedule) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">&#128197;</div>
        <h3>Nog geen actief weekschema</h3>
        <p>
          Genereer eerst een weekschema in het tabblad <strong>Genereren</strong>,
          sla het op in Favorieten en activeer het daar.
        </p>
        <button class="btn btn-primary" id="btn-goto-generate" type="button">
          Ga naar Genereren
        </button>
      </div>
    `;
  }

  const preset = loadActivePreset();

  return `
    <div class="schedule-controls active-schedule-toolbar">
      <h3>${escapeHtml(activeSchedule.name || 'Actief weekschema')}</h3>
      <div class="day-selector-bar" id="active-preset-bar" role="group" aria-label="Dagen tonen">
        <button class="day-selector-btn ${preset === 'today' ? 'active' : ''}"
                data-preset="today" type="button">
          Vandaag
        </button>
        <button class="day-selector-btn ${preset === 'today-tomorrow' ? 'active' : ''}"
                data-preset="today-tomorrow" type="button">
          Vandaag en morgen
        </button>
        <button class="day-selector-btn ${preset === 'week' ? 'active' : ''}"
                data-preset="week" type="button">
          Heel weekschema
        </button>
      </div>
    </div>

    ${buildCookingRhythmHtml()}

    <div class="active-days-view" id="active-days-view">
      ${renderActiveDays(preset)}
    </div>
  `;
}

function renderActiveDays(preset) {
  if (!activeSchedule) return '';

  const days = getDaysForPreset(preset);
  const today = WEEKDAYS[getTodayWeekdayIndex()];

  const blocks = days.map(day => {
    const dayData = activeSchedule.days[day] || {};
    const isToday = day === today;

    const tiles = SCHEDULE_SLOTS.map(slot => {
      const recipeId = dayData[slot.id];
      const recipe = recipeId ? recipeMap.get(recipeId) : null;
      const slotLabel = getSlotLabel(slot.id);

      if (!recipe) {
        return `
          <div class="active-meal-card is-empty" aria-label="${escapeHtml(slotLabel)}: geen recept">
            <div class="active-meal-media active-meal-media-placeholder">
              <span>Geen foto</span>
            </div>
            <div class="active-meal-body">
              <span class="active-meal-slot">${escapeHtml(slotLabel)}</span>
              <span class="active-meal-empty">Geen recept gepland</span>
            </div>
          </div>
        `;
      }

      const isCooked = Store.isScheduleMealCooked(
        activeSchedule.id, day, slot.id, recipe.id
      );
      const imageHtml = recipe.image
        ? `<img class="active-meal-image" src="${escapeHtml(recipe.image)}" alt="" loading="lazy">`
        : '<span class="active-meal-image-placeholder">Geen foto</span>';

      return `
        <a href="#/recipe/${recipe.id}" class="active-meal-card ${isCooked ? 'is-cooked' : ''}"
           target="_blank" rel="noopener" title="Bekijk recept (opent in nieuw tabblad)">
          <div class="active-meal-media">
            ${imageHtml}
            ${isCooked ? '<span class="active-meal-cooked" aria-label="Gerecht gemaakt">&#10003;</span>' : ''}
          </div>
          <div class="active-meal-body">
            <span class="active-meal-slot">${escapeHtml(slotLabel)}</span>
            <strong class="active-meal-name">${escapeHtml(recipe.name)}</strong>
          </div>
        </a>
      `;
    }).join('');

    return `
      <section class="active-day-block ${isToday ? 'active-day-block-today' : ''}">
        <h4 class="active-day-header">
          ${capitalize(day)}
          ${isToday ? '<span class="active-day-today-badge">Vandaag</span>' : ''}
        </h4>
        <div class="active-day-meals">${tiles}</div>
      </section>
    `;
  }).join('');

  return blocks;
}

/* ----------------------------------------
   WEEKSCHEMA GRID RENDEREN (generator sub-tab)
---------------------------------------- */
function renderScheduleGrid(schedule) {
  const headerCells = WEEKDAYS.map(day =>
    `<th class="schedule-col-header">${day.substring(0, 2).toUpperCase()}</th>`
  ).join('');

  const rows = SCHEDULE_SLOTS.map(slot => {
    const cells = WEEKDAYS.map(day => {
      const dayData = schedule.days[day] || {};
      const recipeId = dayData[slot.id];
      const recipe = recipeId ? recipeMap.get(recipeId) : null;

      if (!recipe) {
        return `
          <td class="schedule-cell">
            <span class="schedule-cell-empty">-</span>
            <button class="refresh-btn" data-day="${day}" data-slot="${slot.id}"
                    title="Ververs dit slot">&#8635;</button>
          </td>
        `;
      }

      const userRating = cachedUserRatings[recipe.id] || 0;
      const imgSrc = recipe.image || '';

      return `
        <td class="schedule-cell schedule-cell-has-recipe"
            ${imgSrc ? `style="background-image:url('${imgSrc}')"` : ''}>
          <a href="#/recipe/${recipe.id}" class="schedule-cell-link" target="_blank"
                title="Bekijk recept (opent in nieuw tabblad)">
            <div class="schedule-recipe-overlay">
              <span class="schedule-recipe-name">${escapeHtml(recipe.name)}</span>
              ${userRating ? `<span class="schedule-recipe-rating">${renderStarsDisplay(userRating)}</span>` : ''}
            </div>
          </a>
          <button class="refresh-btn" data-day="${day}" data-slot="${slot.id}"
                  title="Ververs dit slot">&#8635;</button>
        </td>
      `;
    }).join('');

    return `
      <tr>
        <th class="schedule-row-header">${getSlotLabel(slot.id)}</th>
        ${cells}
      </tr>
    `;
  }).join('');

  return `
    <div class="schedule-table-wrapper">
      <table class="schedule-table">
        <thead>
          <tr>
            <th class="schedule-corner"></th>
            ${headerCells}
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

/* ----------------------------------------
   INIT
   Haal data op en koppel listeners
---------------------------------------- */
export async function init() {
  const page = document.getElementById('schedule-page');
  if (!page) return;

  /* ---- Laad het persoonlijke gegenereerde schema uit localStorage ---- */
  currentSchedule = loadActiveSchedule();

  /* ---- Data parallel ophalen ---- */
  try {
    const [recipes, userRatings, active, favoriteIds] = await Promise.all([
      Store.getRecipes(),
      Store.getAllUserRatings(),
      Store.getActiveSchedule(),
      Store.getFavoriteRecipeIds(),
    ]);
    cachedRecipes = recipes;
    cachedUserRatings = userRatings;
    recipeMap = new Map(recipes.map(r => [r.id, r]));
    activeSchedule = active;
    cachedFavoriteIds = new Set(favoriteIds);
  } catch (err) {
    page.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">&#9888;</div>
        <h3>Fout bij laden</h3>
        <p>${err.message}</p>
      </div>`;
    return;
  }

  /* ---- Vul de pagina ---- */
  page.innerHTML = buildPageHtml();

  /* ---- Event listeners ---- */
  attachListeners();
  attachCookingStateListeners();
}

/* ----------------------------------------
   LISTENERS KOPPELEN
---------------------------------------- */
function attachListeners() {
  /* Sub-tab wissel */
  document.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const sub = btn.dataset.subtab;
      if (!sub) return;
      saveSubtab(sub);
      rerenderPage();
    });
  });

  attachGenerateListeners();
  attachActiveListeners();
}

function attachGenerateListeners() {
  /* Genereer weekschema */
  document.getElementById('btn-generate')?.addEventListener('click', generateSchedule);

  /* Opslaan in favorieten */
  document.getElementById('btn-save-schedule')?.addEventListener('click', saveSchedule);

  /* Ververs individueel slot */
  document.getElementById('schedule-grid')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.refresh-btn');
    if (!btn) return;

    const day = btn.dataset.day;
    const slot = btn.dataset.slot;
    refreshSlot(day, slot);
  });
}

function attachActiveListeners() {
  /* Empty-state: "Ga naar Genereren" knop */
  document.getElementById('btn-goto-generate')?.addEventListener('click', () => {
    saveSubtab('generate');
    rerenderPage();
  });

  /* Preset-knoppen in Actief-tab */
  document.getElementById('active-preset-bar')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.day-selector-btn');
    if (!btn) return;
    const preset = btn.dataset.preset;
    if (!preset) return;

    saveActivePreset(preset);

    /* Update actieve staat van de preset-knoppen */
    document.querySelectorAll('#active-preset-bar .day-selector-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.preset === preset);
    });

    /* Re-render enkel de dagen-view */
    const view = document.getElementById('active-days-view');
    if (view) view.innerHTML = renderActiveDays(preset);
  });
}

function rerenderPage() {
  const page = document.getElementById('schedule-page');
  if (!page) return;
  page.innerHTML = buildPageHtml();
  attachListeners();
}

function attachCookingStateListeners() {
  if (cookingStateListenersAttached) return;
  cookingStateListenersAttached = true;

  const refreshCookingState = event => {
    if (event.type === 'storage' && event.key !== Store.getCookingStateStorageKey()) return;
    if (!document.getElementById('schedule-page') || !activeSchedule) return;
    rerenderPage();
  };

  window.addEventListener('storage', refreshCookingState);
  window.addEventListener('prilleven:cooking-state-changed', refreshCookingState);
}

/* ----------------------------------------
   WEEKSCHEMA GENEREREN
---------------------------------------- */
function getFavoriteSelectionSettings(availableRecipes) {
  const favoriteCount = availableRecipes.filter(recipe => cachedFavoriteIds.has(recipe.id)).length;

  if (favoriteCount === 0) return { favoriteCount: 0, probability: 0, maxPreferredSlots: 0 };
  if (favoriteCount <= 2) return { favoriteCount, probability: 0.2, maxPreferredSlots: 2 };
  if (favoriteCount <= 5) return { favoriteCount, probability: 0.3, maxPreferredSlots: 4 };
  return { favoriteCount, probability: 0.35, maxPreferredSlots: 7 };
}

function createSelectionState(availableRecipes, preferFavorites) {
  const settings = getFavoriteSelectionSettings(availableRecipes);
  return {
    preferFavorites: Boolean(preferFavorites && settings.favoriteCount > 0),
    ...settings,
    recipeUsage: new Map(),
    favoriteSelections: 0,
    preferredSlots: 0,
  };
}

function randomFrom(pool) {
  return pool[Math.floor(Math.random() * pool.length)] || null;
}

function leastUsedRandom(pool, recipeUsage) {
  if (pool.length === 0) return null;
  const lowestUsage = Math.min(...pool.map(recipe => recipeUsage.get(recipe.id) || 0));
  return randomFrom(pool.filter(recipe => (recipeUsage.get(recipe.id) || 0) === lowestUsage));
}

function recordSelection(state, recipe, usedPreference = false) {
  if (!recipe) return;
  state.recipeUsage.set(recipe.id, (state.recipeUsage.get(recipe.id) || 0) + 1);
  if (cachedFavoriteIds.has(recipe.id)) state.favoriteSelections += 1;
  if (usedPreference) state.preferredSlots += 1;
}

function removeSelection(state, recipeId) {
  if (!recipeId) return;
  const currentUsage = state.recipeUsage.get(recipeId) || 0;
  if (currentUsage > 1) state.recipeUsage.set(recipeId, currentUsage - 1);
  else state.recipeUsage.delete(recipeId);

  if (cachedFavoriteIds.has(recipeId)) {
    state.favoriteSelections = Math.max(0, state.favoriteSelections - 1);
    state.preferredSlots = Math.max(0, state.preferredSlots - 1);
  }
}

function selectRecipeForSlot(suitableRecipes, state, avoidRecipeId = null) {
  const alternatives = suitableRecipes.filter(recipe => recipe.id !== avoidRecipeId);
  const candidates = alternatives.length > 0 ? alternatives : suitableRecipes;
  if (candidates.length === 0) return { recipe: null, usedPreference: false };

  /* Zonder voorkeur blijft de bestaande uniforme random-keuze exact behouden. */
  if (!state.preferFavorites) {
    return { recipe: randomFrom(candidates), usedPreference: false };
  }

  const favorites = candidates.filter(recipe => cachedFavoriteIds.has(recipe.id));
  const nonFavorites = candidates.filter(recipe => !cachedFavoriteIds.has(recipe.id));

  /* Als de niet-favoriete pool te klein is, negeren we het onderscheid volledig.
     Zo worden 1-3 overige recepten niet de hele week geforceerd herhaald wanneer
     iemand bijna alle recepten van dit eetmoment als favoriet markeerde. */
  if (nonFavorites.length < MIN_NON_FAVORITE_POOL) {
    return {
      recipe: leastUsedRandom(candidates, state.recipeUsage),
      usedPreference: false,
    };
  }

  const usableFavorites = favorites.filter(recipe => (state.recipeUsage.get(recipe.id) || 0) < 2);
  const canPreferFavorite = usableFavorites.length > 0 &&
    state.preferredSlots < state.maxPreferredSlots;

  if (canPreferFavorite && Math.random() < state.probability) {
    return {
      recipe: leastUsedRandom(usableFavorites, state.recipeUsage),
      usedPreference: true,
    };
  }

  return {
    recipe: leastUsedRandom(nonFavorites, state.recipeUsage),
    usedPreference: false,
  };
}

function ensureFavoriteAppears(days, availableRecipes, state) {
  if (!state.preferFavorites || state.favoriteSelections > 0) return;

  const possibleSlots = [];
  WEEKDAYS.forEach(day => {
    SCHEDULE_SLOTS.forEach(slot => {
      const mealMoment = slotToMealMoment(slot.id);
      const favorites = availableRecipes.filter(recipe =>
        cachedFavoriteIds.has(recipe.id) && (recipe.mealMoments || []).includes(mealMoment)
      );
      if (favorites.length > 0) possibleSlots.push({ day, slotId: slot.id, favorites });
    });
  });

  const target = randomFrom(possibleSlots);
  if (!target) return;

  const previousId = days[target.day]?.[target.slotId];
  removeSelection(state, previousId);
  const favorite = leastUsedRandom(target.favorites, state.recipeUsage);
  days[target.day][target.slotId] = favorite.id;
  recordSelection(state, favorite, true);
}

function buildSelectionStateFromSchedule(schedule, availableRecipes) {
  const state = createSelectionState(availableRecipes, schedule.preferFavorites);

  WEEKDAYS.forEach(day => {
    SCHEDULE_SLOTS.forEach(slot => {
      const recipeId = schedule.days?.[day]?.[slot.id];
      const recipe = recipeId ? recipeMap.get(recipeId) : null;
      recordSelection(state, recipe, cachedFavoriteIds.has(recipeId));
    });
  });

  return state;
}

function generateSchedule() {
  /* Haal uitgesloten allergenen op */
  const excluded = Array.from(
    document.querySelectorAll('input[name="exclude-allergen"]:checked')
  ).map(cb => cb.value);
  const preferFavorites = Boolean(
    document.getElementById('prefer-favorites')?.checked && cachedFavoriteIds.size > 0
  );

  /* Filter recepten op allergenen (gebruik cache).
     Normaliseer recept-waarden zodat legacy-namen blijven matchen. */
  const availableRecipes = cachedRecipes.filter(recipe => {
    return !(recipe.allergens || []).some(a => excluded.includes(normalizeAllergen(a)));
  });

  if (availableRecipes.length === 0) {
    showToast('Geen recepten beschikbaar met deze filters!', 'error');
    return;
  }

  /* Genereer het schema. Met favorietenvoorkeur bewaken we tegelijk variatie;
     zonder voorkeur blijft de bestaande uniforme random-selectie behouden. */
  const days = {};
  const selectionState = createSelectionState(availableRecipes, preferFavorites);

  WEEKDAYS.forEach(day => {
    days[day] = {};
    SCHEDULE_SLOTS.forEach(slot => {
      const mealMoment = slotToMealMoment(slot.id);
      const suitable = availableRecipes.filter(r =>
        (r.mealMoments || []).includes(mealMoment)
      );

      const selection = selectRecipeForSlot(suitable, selectionState);
      days[day][slot.id] = selection.recipe?.id || null;
      recordSelection(selectionState, selection.recipe, selection.usedPreference);
    });
  });

  /* De aangevinkte optie moet merkbaar zijn als er minstens één passend
     favoriet recept bestaat, ook wanneer alle random-kansen net missen. */
  ensureFavoriteAppears(days, availableRecipes, selectionState);

  currentSchedule = {
    days,
    excludedAllergens: excluded,
    preferFavorites,
    generatedAt: new Date().toISOString(),
  };

  /* Persisteer per gebruiker */
  saveActiveSchedule(currentSchedule);

  /* Herrender de pagina (blijft op huidige sub-tab) */
  rerenderPage();

  showToast('Weekschema gegenereerd!');
}

/* ----------------------------------------
   INDIVIDUEEL SLOT VERVERSEN
---------------------------------------- */
function refreshSlot(day, slotId) {
  if (!currentSchedule) return;

  /* Normaliseer beide kanten zodat legacy-namen blijven matchen. */
  const excluded = (currentSchedule.excludedAllergens || []).map(normalizeAllergen);

  const availableRecipes = cachedRecipes.filter(recipe => {
    return !(recipe.allergens || []).some(a => excluded.includes(normalizeAllergen(a)));
  });

  const mealMoment = slotToMealMoment(slotId);
  const suitable = availableRecipes.filter(r =>
    (r.mealMoments || []).includes(mealMoment)
  );

  /* Probeer een ander recept te kiezen dan het huidige */
  const currentId = currentSchedule.days[day]?.[slotId];
  const selectionState = buildSelectionStateFromSchedule(currentSchedule, availableRecipes);
  removeSelection(selectionState, currentId);
  const selection = selectRecipeForSlot(suitable, selectionState, currentId);
  currentSchedule.days[day][slotId] = selection.recipe?.id || null;

  /* Persisteer de wijziging zodat ook een ververst slot blijft staan */
  saveActiveSchedule(currentSchedule);

  /* Update alleen het grid */
  const grid = document.getElementById('schedule-grid');
  if (grid) grid.innerHTML = renderScheduleGrid(currentSchedule);
}

/* ----------------------------------------
   WEEKSCHEMA OPSLAAN IN FAVORIETEN
---------------------------------------- */
async function saveSchedule() {
  if (!currentSchedule) return;

  const details = await promptScheduleDetails({
    title: 'Weekschema opslaan',
    name: `Weekschema ${new Date().toLocaleDateString('nl-BE')}`,
    persons: activeSchedule?.persons || 4,
  });
  if (!details) return;

  try {
    await Store.saveSchedule({
      name: details.name,
      persons: details.persons,
      days: currentSchedule.days,
      excludedAllergens: currentSchedule.excludedAllergens
    });
    showToast('Weekschema opgeslagen in favorieten!');
    Router.navigate('favorites');
  } catch (err) {
    showToast('Fout bij opslaan: ' + err.message, 'error');
  }
}

/* ----------------------------------------
   RESET
---------------------------------------- */
export function reset() {
  /* In-memory state leeggooien zodat een volgende bezoek
     opnieuw uit localStorage leest (kan een andere gebruiker zijn). */
  currentSchedule = null;
  activeSchedule = null;
  cachedFavoriteIds = new Set();
}
