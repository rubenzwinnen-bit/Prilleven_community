/* ============================================
   SHOPPING LIST COMPONENT
   Genereert een boodschappenlijst vanuit een
   opgeslagen weekschema. De gebruiker kan:
   - Hele dagen aanvinken/uitvinken
   - Per dag individuele eetmomenten selecteren
   - De ingrediënten worden samengevoegd
   - De lijst kan worden afgedrukt

   Async patroon:
   - render() geeft een skeleton terug
   - init() haalt het schema + alle gerelateerde
     recepten parallel op en bouwt de UI op
============================================ */

import * as Store from '../store.js?v=2.0.1';
import * as Router from '../router.js?v=2.0.1';
import {
  showToast, escapeHtml, WEEKDAYS, SCHEDULE_SLOTS, getSlotLabel
} from '../utils.js?v=2.0.1';

/* ----------------------------------------
   STATE / CACHE
---------------------------------------- */
let cachedSchedule = null;
let recipeMap = new Map();

/* ----------------------------------------
   RENDER (skeleton)
---------------------------------------- */
export function render(scheduleId) {
  return `
    <div id="shopping-page" data-schedule-id="${scheduleId || ''}">
      <div class="empty-state">
        <div class="empty-state-icon">&#9203;</div>
        <h3>Boodschappenlijst laden...</h3>
        <p>Een ogenblik geduld.</p>
      </div>
    </div>
  `;
}

/* ----------------------------------------
   INIT
---------------------------------------- */
export async function init(scheduleId) {
  const page = document.getElementById('shopping-page');
  if (!page) return;

  /* ---- Schema ophalen ---- */
  try {
    cachedSchedule = await Store.getSchedule(scheduleId);
  } catch (err) {
    page.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">&#9888;</div>
        <h3>Fout bij laden</h3>
        <p>${err.message}</p>
      </div>`;
    return;
  }

  if (!cachedSchedule) {
    page.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">&#128722;</div>
        <h3>Weekschema niet gevonden</h3>
        <p>Dit weekschema bestaat niet (meer).</p>
        <button class="btn btn-primary" onclick="location.hash='#/favorites'">Terug naar favorieten</button>
      </div>
    `;
    return;
  }

  /* ---- Verzamel alle recipe-IDs en haal ze parallel op ---- */
  const recipeIds = new Set();
  WEEKDAYS.forEach(day => {
    SCHEDULE_SLOTS.forEach(slot => {
      const rid = cachedSchedule.days?.[day]?.[slot.id];
      if (rid) recipeIds.add(rid);
    });
  });

  recipeMap = new Map();
  if (recipeIds.size > 0) {
    try {
      /* Eén batch-call i.p.v. N losse Store.getRecipe() calls */
      const recipes = await Store.getRecipesByIds([...recipeIds]);
      recipes.forEach(r => { if (r) recipeMap.set(r.id, r); });
    } catch (err) {
      console.warn('Fout bij ophalen recepten:', err);
    }
  }

  /* ---- Bouw de pagina ---- */
  page.innerHTML = buildPageHtml(cachedSchedule);

  /* ---- Listeners ---- */
  attachListeners(scheduleId);
}

/* ----------------------------------------
   BOUW DE PAGINA HTML
---------------------------------------- */
function buildPageHtml(schedule) {
  /* Header rij met dag-checkboxen */
  const headerCells = WEEKDAYS.map(day => {
    const dayData = schedule.days?.[day] || {};
    const filledSlots = SCHEDULE_SLOTS.filter(s => dayData[s.id] && recipeMap.has(dayData[s.id])).length;

    return `
      <th class="schedule-col-header shopping-col-header">
        <label class="shopping-day-toggle-compact">
          <input type="checkbox" class="day-checkbox"
                 data-day="${day}"
                 ${filledSlots > 0 ? 'checked' : 'disabled'}>
          <span>${day.substring(0, 2).toUpperCase()}</span>
        </label>
      </th>
    `;
  }).join('');

  /* Een rij per eetmoment */
  const tableRows = SCHEDULE_SLOTS.map(slot => {
    const cells = WEEKDAYS.map(day => {
      const dayData = schedule.days?.[day] || {};
      const recipeId = dayData[slot.id];
      const recipe = recipeId ? recipeMap.get(recipeId) : null;

      if (!recipe) {
        return `
          <td class="schedule-cell shopping-cell shopping-cell-empty">
            <input type="checkbox" class="slot-checkbox"
                   data-day="${day}" data-slot="${slot.id}"
                   disabled style="display:none">
            <span class="schedule-cell-empty">-</span>
          </td>
        `;
      }

      return `
        <td class="schedule-cell shopping-cell">
          <label class="shopping-cell-label">
            <input type="checkbox" class="slot-checkbox"
                   data-day="${day}" data-slot="${slot.id}"
                   data-recipe-id="${recipe.id}"
                   checked>
            <span class="shopping-cell-recipe">${escapeHtml(recipe.name)}</span>
          </label>
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

  const daySelectionHtml = `
    <div class="schedule-table-wrapper">
      <table class="schedule-table shopping-table">
        <thead>
          <tr>
            <th class="schedule-corner"></th>
            ${headerCells}
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>
  `;

  return `
    <div class="shopping-list-container">
      <button class="btn btn-outline btn-sm mb-2" id="btn-back-fav">&#8592; Terug naar favorieten</button>

      <h1 style="margin-bottom:0.5rem">&#128722; Boodschappenlijst</h1>
      <p class="text-muted mb-3">Schema: <strong>${escapeHtml(schedule.name)}</strong></p>

      <div class="shopping-recipe-select">
        <h3 style="margin-bottom:0.75rem">Selecteer dagen & eetmomenten</h3>
        <p class="text-muted mb-2" style="font-size:0.85rem">
          Vink hele dagen aan of kies per dag specifieke eetmomenten.
        </p>

        <div style="margin-bottom:1rem;display:flex;gap:0.5rem;flex-wrap:wrap">
          <button class="btn btn-sm btn-outline" id="btn-select-all">Alles selecteren</button>
          <button class="btn btn-sm btn-outline" id="btn-deselect-all">Niets selecteren</button>
          <button class="btn btn-sm btn-outline" id="btn-select-weekdays">Enkel weekdagen</button>
          <button class="btn btn-sm btn-outline" id="btn-select-weekend">Enkel weekend</button>
        </div>

        ${daySelectionHtml}
      </div>

      <div class="text-center mb-3">
        <button class="btn btn-primary btn-lg" id="btn-generate-list">
          &#128196; Genereer Boodschappenlijst
        </button>
      </div>

      <div id="shopping-result"></div>
    </div>
  `;
}

/* ----------------------------------------
   LISTENERS KOPPELEN
---------------------------------------- */
function attachListeners(scheduleId) {
  document.getElementById('btn-back-fav')?.addEventListener('click', () => {
    Router.navigate('favorites');
  });

  document.getElementById('btn-select-all')?.addEventListener('click', () => {
    setAllCheckboxes(true);
  });

  document.getElementById('btn-deselect-all')?.addEventListener('click', () => {
    setAllCheckboxes(false);
  });

  document.getElementById('btn-select-weekdays')?.addEventListener('click', () => {
    const weekdayNames = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag'];
    setAllCheckboxes(false);
    weekdayNames.forEach(day => setDayCheckboxes(day, true));
  });

  document.getElementById('btn-select-weekend')?.addEventListener('click', () => {
    const weekendNames = ['zaterdag', 'zondag'];
    setAllCheckboxes(false);
    weekendNames.forEach(day => setDayCheckboxes(day, true));
  });

  document.querySelectorAll('.day-checkbox').forEach(dayCb => {
    dayCb.addEventListener('change', (e) => {
      const day = e.target.dataset.day;
      const checked = e.target.checked;
      setDaySlots(day, checked);
    });
  });

  document.querySelectorAll('.slot-checkbox').forEach(slotCb => {
    slotCb.addEventListener('change', (e) => {
      const day = e.target.dataset.day;
      updateDayCheckboxState(day);
    });
  });

  document.getElementById('btn-generate-list')?.addEventListener('click', () => {
    generateShoppingList();
  });
}

/* ============================================
   CHECKBOX HULPFUNCTIES
============================================ */

function setAllCheckboxes(checked) {
  document.querySelectorAll('.day-checkbox:not(:disabled)').forEach(cb => {
    cb.checked = checked;
  });
  document.querySelectorAll('.slot-checkbox:not(:disabled)').forEach(cb => {
    cb.checked = checked;
  });
}

function setDaySlots(day, checked) {
  document.querySelectorAll(`.slot-checkbox[data-day="${day}"]:not(:disabled)`).forEach(cb => {
    cb.checked = checked;
  });
}

function setDayCheckboxes(day, checked) {
  const dayCb = document.querySelector(`.day-checkbox[data-day="${day}"]`);
  if (dayCb && !dayCb.disabled) {
    dayCb.checked = checked;
    dayCb.indeterminate = false;
    setDaySlots(day, checked);
  }
}

function updateDayCheckboxState(day) {
  const dayCb = document.querySelector(`.day-checkbox[data-day="${day}"]`);
  if (!dayCb) return;

  const slots = document.querySelectorAll(`.slot-checkbox[data-day="${day}"]:not(:disabled)`);
  const checkedSlots = document.querySelectorAll(`.slot-checkbox[data-day="${day}"]:not(:disabled):checked`);

  if (checkedSlots.length === 0) {
    dayCb.checked = false;
    dayCb.indeterminate = false;
  } else if (checkedSlots.length === slots.length) {
    dayCb.checked = true;
    dayCb.indeterminate = false;
  } else {
    dayCb.checked = false;
    dayCb.indeterminate = true;
  }
}

/* ============================================
   BOODSCHAPPENLIJST GENEREREN
   Werkt op de cache (recipeMap) — geen extra
   netwerk-aanroepen nodig
============================================ */
function generateShoppingList() {
  if (!cachedSchedule) return;

  const checkedSlots = document.querySelectorAll('.slot-checkbox:checked:not(:disabled)');

  if (checkedSlots.length === 0) {
    showToast('Selecteer minstens één eetmoment', 'error');
    return;
  }

  /* Tel hoe vaak elk recept voorkomt in de selectie */
  const recipeCounts = {};
  const selectedRecipeIds = new Set();

  checkedSlots.forEach(cb => {
    const recipeId = cb.dataset.recipeId;
    if (recipeId) {
      recipeCounts[recipeId] = (recipeCounts[recipeId] || 0) + 1;
      selectedRecipeIds.add(recipeId);
    }
  });

  if (selectedRecipeIds.size === 0) {
    showToast('Geen recepten gevonden in de selectie', 'error');
    return;
  }

  /* Verzamel en merge ingrediënten */
  const ingredientMap = new Map();

  /* Bereken de vermenigvuldiger X per recept op basis van personen
     Alleen toepassen als het schema geactiveerd is */
  const persons = cachedSchedule.persons || 4;
  const isActive = cachedSchedule.isActive || false;

  for (const [recipeId, count] of Object.entries(recipeCounts)) {
    const recipe = recipeMap.get(recipeId);
    if (!recipe) continue;

    const X = isActive
      ? Math.max(1, Math.ceil(persons / (recipe.portions || 1)))
      : 1;

    (recipe.ingredients || []).forEach(ing => {
      const unitNorm = (ing.unit || '').toLowerCase().trim();
      const key = ing.name.toLowerCase().trim() + '|' + unitNorm;
      if (!ingredientMap.has(key)) {
        ingredientMap.set(key, {
          name: ing.name,
          totalAmount: 0,
          unit: ing.unit,
          isNumeric: false
        });
      }

      const entry = ingredientMap.get(key);
      const amount = parseFloat(ing.amount);

      if (!isNaN(amount)) {
        entry.totalAmount += amount * X * count;
        entry.isNumeric = true;
      }
    });
  }

  const sortedIngredients = Array.from(ingredientMap.values())
    .sort((a, b) => a.name.localeCompare(b.name));

  /* Bouw samenvatting van de selectie */
  const summaryParts = [];
  WEEKDAYS.forEach(day => {
    const daySlots = document.querySelectorAll(`.slot-checkbox[data-day="${day}"]:checked:not(:disabled)`);
    if (daySlots.length > 0) {
      const dayLabel = day.charAt(0).toUpperCase() + day.slice(1);
      const slotLabels = Array.from(daySlots).map(cb => getSlotLabel(cb.dataset.slot));
      summaryParts.push(`<strong>${dayLabel}</strong>: ${slotLabels.join(', ')}`);
    }
  });

  const result = document.getElementById('shopping-result');
  result.innerHTML = `
    <div class="shopping-ingredient-list">
      <div class="flex-between mb-2">
        <h3 style="margin-bottom:0">Boodschappenlijst (${sortedIngredients.length} items${isActive ? ` &middot; ${persons} personen` : ''})</h3>
        <button class="btn btn-primary no-print" id="btn-print-list">&#128424; Afdrukken</button>
      </div>

      <div class="mb-2" style="font-size:0.85rem;line-height:1.8">
        <p class="text-muted mb-1"><strong>Geselecteerd:</strong></p>
        ${summaryParts.map(s => `<span style="display:inline-block;margin-right:1rem">${s}</span>`).join('')}
      </div>

      <p class="text-muted mb-2" style="font-size:0.85rem">
        ${selectedRecipeIds.size} recept(en), ${checkedSlots.length} maaltijd(en) uit "${escapeHtml(cachedSchedule.name)}"
      </p>

      <ul>
        ${sortedIngredients.map(ing => `
          <li>
            <strong>${escapeHtml(ing.name)}</strong>
            ${ing.isNumeric
              ? `<span class="text-muted"> &mdash; ${formatAmount(ing.totalAmount)} ${escapeHtml(ing.unit)}</span>`
              : `<span class="text-muted"> &mdash; ${escapeHtml(ing.unit)}</span>`
            }
          </li>
        `).join('')}
      </ul>
    </div>
  `;

  document.getElementById('btn-print-list')?.addEventListener('click', () => {
    window.print();
  });

  result.scrollIntoView({ behavior: 'smooth', block: 'start' });

  showToast('Boodschappenlijst gegenereerd!');
}

/* ----------------------------------------
   HOEVEELHEID FORMATTEREN
---------------------------------------- */
function formatAmount(num) {
  if (Number.isInteger(num)) return num.toString();
  return num.toFixed(1).replace('.', ',');
}
