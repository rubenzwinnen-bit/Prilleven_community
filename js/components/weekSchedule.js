/* ============================================
   WEEK SCHEDULE COMPONENT
   Genereert een weekschema (ma-zo) met 5 slots
   per dag (ochtend, fruit moment, middag, snack, avond).
   Recepten worden willekeurig gekozen uit de pool,
   gefilterd op allergenen en eetmoment.

   PER-GEBRUIKER:
   Elke gebruiker heeft een eigen "actief" weekschema.
   Dit wordt bewaard in localStorage onder de key
   `receptenboek_active_schedule_<username>` zodat
   het zichtbaar blijft bij terugkeer en tussen
   sessies, tot de gebruiker het opnieuw genereert.

   Async patroon:
   - render() geeft een skeleton terug
   - init() haalt recepten + ratings parallel op
   - generateSchedule/refreshSlot werken op de cache
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
let currentSchedule = null;
let cachedRecipes = [];
let cachedUserRatings = {};
let recipeMap = new Map();

/* ----------------------------------------
   PERSISTENT PER-GEBRUIKER OPSLAG
   Het actieve (gegenereerde) weekschema wordt
   per gebruiker bewaard in localStorage zodat
   het niet verdwijnt bij navigatie of refresh.
---------------------------------------- */
function getActiveScheduleKey() {
  const user = Store.getCurrentUser() || 'anoniem';
  return `receptenboek_active_schedule_${user}`;
}

function loadActiveSchedule() {
  try {
    const raw = localStorage.getItem(getActiveScheduleKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    /* Sanity check op de structuur */
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
    console.warn('Kon actief weekschema niet opslaan:', err);
  }
}

/* ----------------------------------------
   RENDER (skeleton)
---------------------------------------- */
export function render() {
  return `
    <div id="schedule-page">
      <h1 style="margin-bottom:1rem">Weekschema Generator</h1>
      <div class="empty-state">
        <div class="empty-state-icon">&#9203;</div>
        <h3>Recepten laden...</h3>
        <p>Een ogenblik geduld.</p>
      </div>
    </div>
  `;
}

/* ----------------------------------------
   BOUW DE PAGINA HTML
---------------------------------------- */
function buildPageHtml() {
  const hasRecipes = cachedRecipes.length > 0;

  /* Verzamel alle unieke allergenen uit bestaande recepten */
  const usedAllergens = new Set();
  cachedRecipes.forEach(r => (r.allergens || []).forEach(a => usedAllergens.add(a)));

  return `
    <h1 style="margin-bottom:1rem">Weekschema Generator</h1>

    ${!hasRecipes ? `
      <div class="empty-state">
        <div class="empty-state-icon">&#128197;</div>
        <h3>Geen recepten beschikbaar</h3>
        <p>Voeg eerst recepten toe of importeer ze om een weekschema te genereren.</p>
        <button class="btn btn-primary" onclick="location.hash='#/add'">+ Recept Toevoegen</button>
      </div>
    ` : `
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
    `}
  `;
}

/* ----------------------------------------
   WEEKSCHEMA GRID RENDEREN
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

  /* ---- Laad het persoonlijke actieve schema uit localStorage ---- */
  currentSchedule = loadActiveSchedule();

  /* ---- Data parallel ophalen ---- */
  try {
    const [recipes, userRatings] = await Promise.all([
      Store.getRecipes(),
      Store.getAllUserRatings(),
    ]);
    cachedRecipes = recipes;
    cachedUserRatings = userRatings;
    recipeMap = new Map(recipes.map(r => [r.id, r]));
  } catch (err) {
    page.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">&#9888;</div>
        <h3>Fout bij laden</h3>
        <p>${err.message}</p>
      </div>`;
    return;
  }

  /* ---- Als het opgeslagen schema nog recept-IDs bevat die niet meer
          bestaan (verwijderd), dan blijft de cel gewoon leeg. ---- */

  /* ---- Vul de pagina ---- */
  page.innerHTML = buildPageHtml();

  /* ---- Event listeners ---- */
  attachListeners();
}

/* ----------------------------------------
   LISTENERS KOPPELEN
---------------------------------------- */
function attachListeners() {
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

  /* Herrender de pagina */
  const page = document.getElementById('schedule-page');
  if (page) {
    page.innerHTML = buildPageHtml();
    attachListeners();
  }

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
}
