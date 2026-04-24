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

import * as Store from '../store.js';
import * as Router from '../router.js';
import {
  showToast, escapeHtml, promptInput, renderStarsDisplay, ALLERGENS, WEEKDAYS,
  SCHEDULE_SLOTS, slotToMealMoment, getSlotLabel
} from '../utils.js';

/* ----------------------------------------
   STATE
---------------------------------------- */
let currentSchedule = null;   // gegenereerd schema (generator sub-tab)
let activeSchedule = null;    // actief schema uit DB (active sub-tab)
let cachedRecipes = [];
let cachedUserRatings = {};
let recipeMap = new Map();

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
  return (v === 'active' || v === 'generate') ? v : 'generate';
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

/* ----------------------------------------
   RENDER (skeleton)
---------------------------------------- */
export function render() {
  return `
    <div id="schedule-page">
      <h1 style="margin-bottom:1rem">Weekschema</h1>
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
    <h1 style="margin-bottom:1rem">Weekschema</h1>
    <div class="subtab-bar" role="tablist">
      <button class="subtab-btn ${subtab === 'generate' ? 'active' : ''}"
              data-subtab="generate" role="tab" type="button">
        Genereren
      </button>
      <button class="subtab-btn ${subtab === 'active' ? 'active' : ''}"
              data-subtab="active" role="tab" type="button">
        Actief weekschema
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
  cachedRecipes.forEach(r => (r.allergens || []).forEach(a => usedAllergens.add(a)));

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
              ${currentSchedule?.excludedAllergens?.includes(a) ? 'checked' : ''}>
            <span>${a}</span>
          </label>
        `).join('')}
        ${usedAllergens.size === 0 ? '<p class="text-muted">Geen allergenen gevonden in de recepten.</p>' : ''}
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
    <div class="schedule-controls">
      <h3>${escapeHtml(activeSchedule.name || 'Actief weekschema')}</h3>
      <p class="text-muted mb-2" style="font-size:0.85rem">
        Kies welke dagen je wilt zien. Je keuze wordt onthouden.
      </p>
      <div class="day-selector-bar" id="active-preset-bar">
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

    <div id="active-days-view">
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

    const rows = SCHEDULE_SLOTS.map(slot => {
      const recipeId = dayData[slot.id];
      const recipe = recipeId ? recipeMap.get(recipeId) : null;

      if (!recipe) {
        return `
          <div class="active-day-row">
            <span class="active-day-slot">${getSlotLabel(slot.id)}</span>
            <span class="active-day-recipe-empty">—</span>
          </div>
        `;
      }

      const userRating = cachedUserRatings[recipe.id] || 0;
      return `
        <div class="active-day-row">
          <span class="active-day-slot">${getSlotLabel(slot.id)}</span>
          <a href="#/recipe/${recipe.id}" class="active-day-recipe" target="_blank" rel="noopener"
             title="Bekijk recept (opent in nieuw tabblad)">
            <span class="active-day-recipe-name">${escapeHtml(recipe.name)}</span>
            ${userRating ? `<span class="active-day-rating">${renderStarsDisplay(userRating)}</span>` : ''}
          </a>
        </div>
      `;
    }).join('');

    return `
      <div class="active-day-block ${isToday ? 'active-day-block-today' : ''}">
        <h4 class="active-day-header">
          ${capitalize(day)}
          ${isToday ? '<span class="active-day-today-badge">Vandaag</span>' : ''}
        </h4>
        ${rows}
      </div>
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
    const [recipes, userRatings, active] = await Promise.all([
      Store.getRecipes(),
      Store.getAllUserRatings(),
      Store.getActiveSchedule(),
    ]);
    cachedRecipes = recipes;
    cachedUserRatings = userRatings;
    recipeMap = new Map(recipes.map(r => [r.id, r]));
    activeSchedule = active;
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

/* ----------------------------------------
   WEEKSCHEMA GENEREREN
---------------------------------------- */
function generateSchedule() {
  /* Haal uitgesloten allergenen op */
  const excluded = Array.from(
    document.querySelectorAll('input[name="exclude-allergen"]:checked')
  ).map(cb => cb.value);

  /* Filter recepten op allergenen (gebruik cache) */
  const availableRecipes = cachedRecipes.filter(recipe => {
    return !(recipe.allergens || []).some(a => excluded.includes(a));
  });

  if (availableRecipes.length === 0) {
    showToast('Geen recepten beschikbaar met deze filters!', 'error');
    return;
  }

  /* Genereer het schema */
  const days = {};

  WEEKDAYS.forEach(day => {
    days[day] = {};
    SCHEDULE_SLOTS.forEach(slot => {
      const mealMoment = slotToMealMoment(slot.id);
      const suitable = availableRecipes.filter(r =>
        (r.mealMoments || []).includes(mealMoment)
      );

      if (suitable.length > 0) {
        const random = suitable[Math.floor(Math.random() * suitable.length)];
        days[day][slot.id] = random.id;
      } else {
        days[day][slot.id] = null;
      }
    });
  });

  currentSchedule = {
    days,
    excludedAllergens: excluded,
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

  const excluded = currentSchedule.excludedAllergens || [];

  const availableRecipes = cachedRecipes.filter(recipe => {
    return !(recipe.allergens || []).some(a => excluded.includes(a));
  });

  const mealMoment = slotToMealMoment(slotId);
  const suitable = availableRecipes.filter(r =>
    (r.mealMoments || []).includes(mealMoment)
  );

  /* Probeer een ander recept te kiezen dan het huidige */
  const currentId = currentSchedule.days[day]?.[slotId];
  const alternatives = suitable.filter(r => r.id !== currentId);
  const pool = alternatives.length > 0 ? alternatives : suitable;

  if (pool.length > 0) {
    const random = pool[Math.floor(Math.random() * pool.length)];
    currentSchedule.days[day][slotId] = random.id;
  } else {
    currentSchedule.days[day][slotId] = null;
  }

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

  const name = await promptInput(
    'Geef dit weekschema een naam:',
    `Weekschema ${new Date().toLocaleDateString('nl-BE')}`
  );
  if (!name) return;

  try {
    await Store.saveSchedule({
      name: name,
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
}
