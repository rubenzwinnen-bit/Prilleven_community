/* ============================================
   FAVORITES COMPONENT
   Toont twee secties:
   1. Favoriete recepten (met kaarten)
   2. Opgeslagen weekschema's (met acties:
      bekijken, boodschappenlijst, verwijderen)

   Async patroon:
   - render() geeft een skeleton terug
   - init() haalt favorieten + schema's parallel op
   - alle benodigde recepten worden vooraf in een Map
     gecached zodat het schema-detail snel rendert
============================================ */

import * as Store from '../store.js?v=2.0.1';
import * as Router from '../router.js?v=2.0.1';
import * as RecipeCard from './recipeCard.js?v=2.0.1';
import {
  showToast, confirm, promptInput, escapeHtml, formatDateShort, renderStarsDisplay,
  WEEKDAYS, SCHEDULE_SLOTS, getSlotLabel
} from '../utils.js?v=2.0.1';

/* Module-level cache zodat re-renders en handlers de data delen */
let cachedFavRecipes = [];
let cachedSchedules = [];
let cachedFavIds = [];
let cachedRatings = {};
let cachedUserRatings = {};
let recipeMap = new Map();

/* ----------------------------------------
   RENDER
   Geeft een skeleton terug. De echte data
   wordt geladen door init().
---------------------------------------- */
export function render() {
  return `
    <div id="favorites-content">
      <div class="empty-state">
        <div class="empty-state-icon">&#9203;</div>
        <h3>Favorieten laden...</h3>
        <p>Een ogenblik geduld.</p>
      </div>
    </div>
  `;
}

/* ----------------------------------------
   BOUW FAVORIETEN HTML
   Wordt aangeroepen na het laden van data
---------------------------------------- */
function buildFavoritesHtml() {
  return `
    <!-- ======== FAVORIETE RECEPTEN ======== -->
    <div class="favorites-section">
      <h2>&#10084;&#65039; Favoriete Recepten (${cachedFavRecipes.length})</h2>
      ${cachedFavRecipes.length > 0
        ? `<div class="recipe-grid">${cachedFavRecipes.map(r => RecipeCard.render(r, cachedFavIds, cachedRatings)).join('')}</div>`
        : `<div class="empty-state">
            <div class="empty-state-icon">&#9825;</div>
            <h3>Geen favoriete recepten</h3>
            <p>Klik op het hartje bij een recept om het als favoriet te markeren.</p>
          </div>`
      }
    </div>

    <!-- ======== OPGESLAGEN WEEKSCHEMA'S ======== -->
    <div class="favorites-section">
      <h2>&#128197; Opgeslagen Weekschema's (${cachedSchedules.length})</h2>
      ${cachedSchedules.length > 0
        ? cachedSchedules.map(schedule => renderScheduleCard(schedule)).join('')
        : `<div class="empty-state">
            <div class="empty-state-icon">&#128197;</div>
            <h3>Geen opgeslagen weekschema's</h3>
            <p>Genereer een weekschema en sla het op om het hier te zien.</p>
          </div>`
      }
    </div>
  `;
}

/* ----------------------------------------
   WEEKSCHEMA KAART RENDEREN
---------------------------------------- */
function renderScheduleCard(schedule) {
  /* Tel het totaal aantal recepten in het schema */
  let totalMeals = 0;
  WEEKDAYS.forEach(day => {
    SCHEDULE_SLOTS.forEach(slot => {
      if (schedule.days?.[day]?.[slot.id]) totalMeals++;
    });
  });

  /* Compacte dagweergave */
  const daysPreview = WEEKDAYS.map(day => {
    const dayData = schedule.days?.[day] || {};
    const mealCount = SCHEDULE_SLOTS.filter(s => dayData[s.id]).length;
    return `<span class="tag tag-moment" title="${day}">${day.substring(0, 2).toUpperCase()} (${mealCount})</span>`;
  }).join('');

  return `
    <div class="saved-schedule-card ${schedule.isActive ? 'schedule-card-active' : ''}" data-schedule-id="${schedule.id}">
      <div class="saved-schedule-header">
        <div>
          <span class="saved-schedule-name">${escapeHtml(schedule.name)}</span>
          <span class="saved-schedule-date">${formatDateShort(schedule.createdAt)}</span>
          ${schedule.isActive ? `<span class="active-schedule-badge">Actief &middot; ${schedule.persons} personen</span>` : ''}
        </div>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
          ${schedule.isActive
            ? `<button class="btn btn-sm btn-outline btn-deactivate-schedule" data-id="${schedule.id}">Deactiveren</button>`
            : `<button class="btn btn-sm btn-activate-schedule" data-id="${schedule.id}">Activeren</button>`
          }
          <button class="btn btn-sm btn-outline toggle-schedule-detail" data-id="${schedule.id}">
            &#128065; Details
          </button>
          ${schedule.isActive
            ? `<button class="btn btn-sm btn-secondary btn-shopping" data-id="${schedule.id}">
                &#128722; Boodschappenlijst
              </button>`
            : ''
          }
          <button class="btn btn-sm btn-danger btn-delete-schedule" data-id="${schedule.id}">
            &#128465; Verwijderen
          </button>
        </div>
      </div>
      <div style="display:flex;gap:0.35rem;flex-wrap:wrap">
        ${daysPreview}
        <span class="text-muted" style="font-size:0.8rem;align-self:center;margin-left:0.5rem">${totalMeals} maaltijden</span>
      </div>

      <!-- Detail weergave (verborgen) -->
      <div class="schedule-detail-view hidden" id="schedule-detail-${schedule.id}">
        ${renderScheduleDetail(schedule)}
      </div>
    </div>
  `;
}

/* ----------------------------------------
   SCHEMA DETAIL RENDEREN
   Gebruikt de pre-fetched recipeMap zodat we
   geen extra Store-calls per cel hoeven te doen
---------------------------------------- */
function renderScheduleDetail(schedule) {
  const headerCells = WEEKDAYS.map(day =>
    `<th class="schedule-col-header">${day.substring(0, 2).toUpperCase()}</th>`
  ).join('');

  const rows = SCHEDULE_SLOTS.map(slot => {
    const cells = WEEKDAYS.map(day => {
      const dayData = schedule.days?.[day] || {};
      const recipeId = dayData[slot.id];
      const recipe = recipeId ? recipeMap.get(recipeId) : null;
      if (!recipe) {
        return `<td class="schedule-cell"><span class="schedule-cell-empty">-</span></td>`;
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
        </td>
      `;
    }).join('');

    return `<tr><th class="schedule-row-header">${getSlotLabel(slot.id)}</th>${cells}</tr>`;
  }).join('');

  return `
    <div class="schedule-table-wrapper mt-2">
      <table class="schedule-table">
        <thead><tr><th class="schedule-corner"></th>${headerCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

/* ----------------------------------------
   INIT
   Haalt alle data parallel op, vult de DOM
   en koppelt event listeners.
---------------------------------------- */
let favAbort = null;

export async function init() {
  const container = document.getElementById('favorites-content');
  if (!container) return;

  /* ---- Verwijder vorige listener als die bestaat ---- */
  if (favAbort) favAbort.abort();
  favAbort = new AbortController();

  /* ---- Data parallel ophalen ---- */
  try {
    const [favRecipes, schedules, favIds, ratingsMap, userRatings] = await Promise.all([
      Store.getFavoriteRecipes(),
      Store.getSavedSchedules(),
      Store.getFavoriteRecipeIds(),
      Store.getAllRatings(),
      Store.getAllUserRatings(),
    ]);

    cachedFavRecipes = favRecipes;
    cachedSchedules = schedules;
    cachedFavIds = favIds;
    cachedRatings = ratingsMap;
    cachedUserRatings = userRatings;
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">&#9888;</div>
        <h3>Fout bij laden</h3>
        <p>${err.message}</p>
      </div>`;
    return;
  }

  /* ---- Verzamel alle recipe-IDs uit de schema's en fetch ze ---- */
  const scheduleRecipeIds = new Set();
  cachedSchedules.forEach(schedule => {
    WEEKDAYS.forEach(day => {
      SCHEDULE_SLOTS.forEach(slot => {
        const rid = schedule.days?.[day]?.[slot.id];
        if (rid) scheduleRecipeIds.add(rid);
      });
    });
  });

  recipeMap = new Map();
  /* Voeg eerst de favorieten toe (die hebben we al) */
  cachedFavRecipes.forEach(r => recipeMap.set(r.id, r));
  /* Haal de overige recepten in één batch op (geen N+1 calls) */
  const missingIds = [...scheduleRecipeIds].filter(id => !recipeMap.has(id));
  if (missingIds.length > 0) {
    try {
      const fetched = await Store.getRecipesByIds(missingIds);
      fetched.forEach(r => { if (r) recipeMap.set(r.id, r); });
    } catch (err) {
      console.warn('Kon enkele schema-recepten niet laden:', err);
    }
  }

  /* ---- Vul de DOM ---- */
  container.innerHTML = buildFavoritesHtml();

  /* ---- Event listeners ---- */
  const content = document.getElementById('app-content');

  content.addEventListener('click', async (e) => {
    /* Favoriet toggle op receptkaarten */
    const favBtn = e.target.closest('.fav-btn');
    if (favBtn) {
      e.stopPropagation();
      /* Voorkom dubbel-klikken die race conditions veroorzaken */
      if (favBtn.dataset.busy === '1') return;
      favBtn.dataset.busy = '1';

      const id = favBtn.dataset.favId;
      try {
        await Store.toggleFavorite(id);
        showToast('Verwijderd uit favorieten');
        /* Herlaad de favorieten-pagina */
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">&#9203;</div>
            <p>Vernieuwen...</p>
          </div>`;
        await init();
      } catch (err) {
        showToast('Fout: ' + err.message, 'error');
        delete favBtn.dataset.busy;
      }
      return;
    }

    /* Klik op receptkaart */
    const card = e.target.closest('.recipe-card');
    if (card) {
      Router.navigate('recipe/' + card.dataset.recipeId);
      return;
    }

    /* Toggle schema details */
    const toggleBtn = e.target.closest('.toggle-schedule-detail');
    if (toggleBtn) {
      const id = toggleBtn.dataset.id;
      const detail = document.getElementById('schedule-detail-' + id);
      if (detail) {
        detail.classList.toggle('hidden');
        toggleBtn.innerHTML = detail.classList.contains('hidden')
          ? '&#128065; Details'
          : '&#128065; Verbergen';
      }
      return;
    }

    /* Boodschappenlijst */
    const shopBtn = e.target.closest('.btn-shopping');
    if (shopBtn) {
      const id = shopBtn.dataset.id;
      Router.navigate('shopping/' + id);
      return;
    }

    /* Weekschema activeren */
    const activateBtn = e.target.closest('.btn-activate-schedule');
    if (activateBtn) {
      await handleActivateSchedule(activateBtn.dataset.id);
      return;
    }

    /* Weekschema deactiveren */
    const deactivateBtn = e.target.closest('.btn-deactivate-schedule');
    if (deactivateBtn) {
      await handleDeactivateSchedule(deactivateBtn.dataset.id);
      return;
    }

    /* Weekschema verwijderen */
    const deleteBtn = e.target.closest('.btn-delete-schedule');
    if (deleteBtn) {
      await handleDeleteSchedule(deleteBtn.dataset.id);
    }
  }, { signal: favAbort.signal });
}

/* ----------------------------------------
   WEEKSCHEMA ACTIVEREN
---------------------------------------- */
async function handleActivateSchedule(scheduleId) {
  const schedule = cachedSchedules.find(s => s.id === scheduleId);
  const defaultPersons = schedule?.persons || 4;

  const input = await promptInput(
    'Voor hoeveel personen wil je dit weekschema activeren?',
    String(defaultPersons)
  );
  if (!input) return;

  const persons = parseInt(input);
  if (!persons || persons < 1) {
    showToast('Voer een geldig aantal personen in (minimaal 1)', 'error');
    return;
  }

  try {
    await Store.setActiveSchedule(scheduleId, persons);
    showToast(`Weekschema geactiveerd voor ${persons} personen!`);

    const container = document.getElementById('favorites-content');
    if (container) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">&#9203;</div>
          <p>Vernieuwen...</p>
        </div>`;
      await init();
    }
  } catch (err) {
    showToast('Fout: ' + err.message, 'error');
  }
}

/* ----------------------------------------
   WEEKSCHEMA DEACTIVEREN
---------------------------------------- */
async function handleDeactivateSchedule(scheduleId) {
  try {
    await Store.deactivateSchedule(scheduleId);
    showToast('Weekschema gedeactiveerd');

    const container = document.getElementById('favorites-content');
    if (container) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">&#9203;</div>
          <p>Vernieuwen...</p>
        </div>`;
      await init();
    }
  } catch (err) {
    showToast('Fout: ' + err.message, 'error');
  }
}

/* ----------------------------------------
   WEEKSCHEMA VERWIJDEREN
---------------------------------------- */
async function handleDeleteSchedule(scheduleId) {
  const ok = await confirm('Weet je zeker dat je dit weekschema wilt verwijderen?');
  if (!ok) return;

  try {
    await Store.deleteSchedule(scheduleId);
    showToast('Weekschema verwijderd', 'info');

    const container = document.getElementById('favorites-content');
    if (container) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">&#9203;</div>
          <p>Vernieuwen...</p>
        </div>`;
      await init();
    }
  } catch (err) {
    showToast('Fout: ' + err.message, 'error');
  }
}
