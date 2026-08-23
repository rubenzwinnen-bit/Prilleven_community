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

import * as Store from '../store.js?v=4.0.9';
import * as Router from '../router.js?v=4.0.9';
import {
  showToast, confirm, promptInput, escapeHtml, formatDateShort,
  getMealMomentLabel, getRecipeAgeLabel, WEEKDAYS, SCHEDULE_SLOTS, getSlotLabel
} from '../utils.js?v=4.0.9';
import { promptScheduleDetails } from './scheduleDetailsDialog.js?v=4.0.9';

/* Module-level cache zodat re-renders en handlers de data delen */
let cachedFavRecipes = [];
let cachedSchedules = [];
let cachedRatings = {};
let cachedUserRatings = {};
let recipeMap = new Map();
let activeFavoritesTab = 'recipes';

/* ----------------------------------------
   RENDER
   Geeft een skeleton terug. De echte data
   wordt geladen door init().
---------------------------------------- */
export function render() {
  return `
    <div id="favorites-content">
      <div class="favorites-loading" aria-live="polite">
        <span class="favorites-loading-bar favorites-loading-bar--title"></span>
        <span class="favorites-loading-bar"></span>
        <span class="favorites-loading-bar favorites-loading-bar--short"></span>
        <span class="sr-only">Favorieten laden...</span>
      </div>
    </div>
  `;
}

/* ----------------------------------------
   BOUW FAVORIETEN HTML
   Wordt aangeroepen na het laden van data
---------------------------------------- */
function buildFavoritesHtml() {
  const recipeCount = cachedFavRecipes.length;
  const scheduleCount = cachedSchedules.length;
  const recipesActive = activeFavoritesTab === 'recipes';

  return `
    <div class="favorites-page">
      <header class="favorites-hero">
        <div class="favorites-hero-copy">
          <span class="favorites-eyebrow">Voor later bewaard</span>
          <h1>Jouw favorieten</h1>
        </div>
        <div class="favorites-summary" role="tablist" aria-label="Favorieten tonen">
          <button class="favorites-summary-item" id="favorites-tab-recipes" type="button"
                  role="tab" data-favorites-tab="recipes"
                  aria-selected="${recipesActive}" aria-controls="favorites-panel-recipes"
                  tabindex="${recipesActive ? '0' : '-1'}">
            <strong>${recipeCount}</strong>
            <span>${recipeCount === 1 ? 'recept' : 'recepten'}</span>
          </button>
          <button class="favorites-summary-item" id="favorites-tab-schedules" type="button"
                  role="tab" data-favorites-tab="schedules"
                  aria-selected="${!recipesActive}" aria-controls="favorites-panel-schedules"
                  tabindex="${recipesActive ? '-1' : '0'}">
            <strong>${scheduleCount}</strong>
            <span>${scheduleCount === 1 ? 'weekschema' : "weekschema's"}</span>
          </button>
        </div>
      </header>

    <!-- ======== FAVORIETE RECEPTEN ======== -->
    <section class="favorites-section favorites-panel" id="favorites-panel-recipes"
             role="tabpanel" aria-labelledby="favorites-tab-recipes" ${recipesActive ? '' : 'hidden'}>
      <h2 class="sr-only">Favoriete recepten</h2>
      ${recipeCount > 0
        ? `<div class="favorites-recipe-grid">${cachedFavRecipes.map(renderFavoriteRecipeCard).join('')}</div>`
        : `<div class="favorites-empty-state">
            <span class="favorites-empty-label">Nog leeg</span>
            <h3>Geen favoriete recepten</h3>
            <p>Bewaar een recept vanuit het receptenboek en je vindt het hier meteen terug.</p>
          </div>`
      }
    </section>

    <!-- ======== OPGESLAGEN WEEKSCHEMA'S ======== -->
    <section class="favorites-section favorites-panel" id="favorites-panel-schedules"
             role="tabpanel" aria-labelledby="favorites-tab-schedules" ${recipesActive ? 'hidden' : ''}>
      <h2 class="sr-only">Opgeslagen weekschema's</h2>
      ${scheduleCount > 0
        ? `<div class="saved-schedules-list">${cachedSchedules.map(renderScheduleCard).join('')}</div>`
        : `<div class="favorites-empty-state">
            <span class="favorites-empty-label">Nog leeg</span>
            <h3>Geen opgeslagen weekschema's</h3>
            <p>Sla een weekschema op en je kunt het hier later opnieuw activeren.</p>
          </div>`
      }
    </section>
    </div>
  `;
}

/* ----------------------------------------
   FAVORIETEN TAB ACTIVEREN
---------------------------------------- */
function setActiveFavoritesTab(tabName, focusTab = false) {
  if (!['recipes', 'schedules'].includes(tabName)) return;
  activeFavoritesTab = tabName;

  document.querySelectorAll('[data-favorites-tab]').forEach(button => {
    const selected = button.dataset.favoritesTab === tabName;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (selected && focusTab) button.focus();
  });

  const recipesPanel = document.getElementById('favorites-panel-recipes');
  const schedulesPanel = document.getElementById('favorites-panel-schedules');
  if (recipesPanel) recipesPanel.hidden = tabName !== 'recipes';
  if (schedulesPanel) schedulesPanel.hidden = tabName !== 'schedules';
}

/* ----------------------------------------
   FAVORIET RECEPT RENDEREN
   Eigen, rustige variant voor deze pagina:
   geen emoji's of pictogrammen in de kaart.
---------------------------------------- */
function renderFavoriteRecipeCard(recipe) {
  const imageHtml = recipe.image
    ? `<img class="favorite-recipe-image" src="${escapeHtml(recipe.image)}" alt="${escapeHtml(recipe.name)}" loading="lazy" onerror="this.outerHTML='<div class=\'favorite-recipe-image-placeholder\'>Geen foto beschikbaar</div>'">`
    : `<div class="favorite-recipe-image-placeholder">Geen foto beschikbaar</div>`;
  const mealMoments = (recipe.mealMoments || [])
    .map(moment => `<span>${escapeHtml(getMealMomentLabel(moment))}</span>`)
    .join('');
  const ageLabel = getRecipeAgeLabel(recipe);
  const { average = 0, count = 0 } = cachedRatings[recipe.id] || {};
  const ratingLabel = count > 0
    ? `${Number(average).toFixed(1).replace('.', ',')} op 5 · ${count} ${count === 1 ? 'beoordeling' : 'beoordelingen'}`
    : 'Nog niet beoordeeld';

  return `
    <article class="favorite-recipe-card" data-recipe-id="${recipe.id}">
      <div class="favorite-recipe-media">
        ${imageHtml}
        <button class="favorite-recipe-remove" data-fav-id="${recipe.id}" type="button">
          Verwijderen
        </button>
      </div>
      <div class="favorite-recipe-body">
        <div class="favorite-recipe-heading">
          <div>
            <span class="favorite-recipe-label">Bewaard recept</span>
            <h3>${escapeHtml(recipe.name)}</h3>
          </div>
          ${ageLabel ? `<span class="favorite-recipe-age">${escapeHtml(ageLabel)}</span>` : ''}
        </div>
        ${mealMoments ? `<div class="favorite-recipe-moments">${mealMoments}</div>` : ''}
        <dl class="favorite-recipe-facts">
          <div>
            <dt>Bereiding</dt>
            <dd>${escapeHtml(String(recipe.cookingTime || '—'))}${recipe.cookingTime ? ' min' : ''}</dd>
          </div>
          <div>
            <dt>Porties</dt>
            <dd>${escapeHtml(String(recipe.portions || 1))}</dd>
          </div>
        </dl>
        <div class="favorite-recipe-footer">
          <span>${ratingLabel}</span>
          <button class="favorite-recipe-open" type="button">Bekijk recept</button>
        </div>
      </div>
    </article>
  `;
}

/* ----------------------------------------
   WEEKSCHEMA KAART RENDEREN
---------------------------------------- */
function renderScheduleCard(schedule) {
  return `
    <article class="saved-schedule-card ${schedule.isActive ? 'schedule-card-active' : ''}" data-schedule-id="${schedule.id}">
      <div class="saved-schedule-header">
        <div class="saved-schedule-heading">
          <div class="saved-schedule-label-row">
            <span class="saved-schedule-label">Weekschema</span>
            ${schedule.isActive ? `<span class="active-schedule-badge">Actief</span>` : ''}
          </div>
          <h3 class="saved-schedule-name">${escapeHtml(schedule.name)}</h3>
          <span class="saved-schedule-date">Opgeslagen ${formatDateShort(schedule.createdAt)}</span>
        </div>
        <span class="saved-schedule-persons">${schedule.persons || 4} personen</span>
      </div>

      <div class="saved-schedule-actions">
        <div class="saved-schedule-main-actions">
          ${schedule.isActive
            ? `<button class="favorites-action favorites-action--primary btn-shopping" data-id="${schedule.id}">Boodschappenlijst</button>`
            : `<button class="favorites-action favorites-action--primary btn-activate-schedule" data-id="${schedule.id}">Activeren</button>`
          }
          <button class="favorites-action favorites-action--secondary toggle-schedule-detail"
                  data-id="${schedule.id}" aria-expanded="false" aria-controls="schedule-detail-${schedule.id}">
            Details bekijken
          </button>
          <button class="favorites-action favorites-action--secondary btn-edit-schedule" data-id="${schedule.id}">
            Bewerken
          </button>
          ${schedule.isActive
            ? `<button class="favorites-action favorites-action--secondary btn-deactivate-schedule" data-id="${schedule.id}">Deactiveren</button>`
            : ''
          }
        </div>
        <button class="favorites-delete-action btn-delete-schedule" data-id="${schedule.id}">Verwijderen</button>
      </div>

      <!-- Detail weergave (verborgen) -->
      <div class="schedule-detail-view hidden" id="schedule-detail-${schedule.id}">
        ${renderScheduleDetail(schedule)}
      </div>
    </article>
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
              ${userRating ? `<span class="schedule-recipe-rating">${userRating} op 5</span>` : ''}
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
    const [favRecipes, schedules, ratingsMap, userRatings] = await Promise.all([
      Store.getFavoriteRecipes(),
      Store.getSavedSchedules(),
      Store.getAllRatings(),
      Store.getAllUserRatings(),
    ]);

    cachedFavRecipes = favRecipes;
    cachedSchedules = schedules;
    cachedRatings = ratingsMap;
    cachedUserRatings = userRatings;
  } catch (err) {
    container.innerHTML = `
      <div class="favorites-empty-state favorites-empty-state--error">
        <span class="favorites-empty-label">Laden mislukt</span>
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
    /* Wissel tussen favoriete recepten en opgeslagen weekschema's */
    const favoritesTab = e.target.closest('[data-favorites-tab]');
    if (favoritesTab) {
      setActiveFavoritesTab(favoritesTab.dataset.favoritesTab);
      return;
    }

    /* Favoriet toggle op receptkaarten */
    const favBtn = e.target.closest('.favorite-recipe-remove');
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
          <div class="favorites-loading" aria-live="polite">
            <span class="favorites-loading-bar favorites-loading-bar--title"></span>
            <span class="favorites-loading-bar"></span>
            <span class="sr-only">Favorieten vernieuwen...</span>
          </div>`;
        await init();
      } catch (err) {
        showToast('Fout: ' + err.message, 'error');
        delete favBtn.dataset.busy;
      }
      return;
    }

    /* Klik op receptkaart */
    const card = e.target.closest('.favorite-recipe-card');
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
        const isHidden = detail.classList.contains('hidden');
        toggleBtn.textContent = isHidden ? 'Details bekijken' : 'Details verbergen';
        toggleBtn.setAttribute('aria-expanded', String(!isHidden));
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

    /* Naam en aantal personen bewerken */
    const editBtn = e.target.closest('.btn-edit-schedule');
    if (editBtn) {
      await handleEditSchedule(editBtn.dataset.id);
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

  content.addEventListener('keydown', (e) => {
    const currentTab = e.target.closest('[data-favorites-tab]');
    if (!currentTab) return;

    const tabs = [...content.querySelectorAll('[data-favorites-tab]')];
    const currentIndex = tabs.indexOf(currentTab);
    let nextIndex = currentIndex;

    if (e.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = tabs.length - 1;
    else return;

    e.preventDefault();
    setActiveFavoritesTab(tabs[nextIndex].dataset.favoritesTab, true);
  }, { signal: favAbort.signal });
}

/* ----------------------------------------
   WEEKSCHEMA BEWERKEN
---------------------------------------- */
async function handleEditSchedule(scheduleId) {
  const schedule = cachedSchedules.find(s => s.id === scheduleId);
  if (!schedule) return;

  const details = await promptScheduleDetails({
    title: 'Weekschema bewerken',
    name: schedule.name,
    persons: schedule.persons || 4,
    submitLabel: 'Wijzigingen opslaan',
  });
  if (!details) return;

  try {
    await Store.updateSchedule(scheduleId, details);
    showToast('Weekschema bijgewerkt');

    const container = document.getElementById('favorites-content');
    if (container) {
      container.innerHTML = `
        <div class="favorites-loading" aria-live="polite">
          <span class="favorites-loading-bar favorites-loading-bar--title"></span>
          <span class="favorites-loading-bar"></span>
          <span class="sr-only">Favorieten vernieuwen...</span>
        </div>`;
      await init();
    }
  } catch (err) {
    showToast('Fout: ' + err.message, 'error');
  }
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
        <div class="favorites-loading" aria-live="polite">
          <span class="favorites-loading-bar favorites-loading-bar--title"></span>
          <span class="favorites-loading-bar"></span>
          <span class="sr-only">Favorieten vernieuwen...</span>
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
        <div class="favorites-loading" aria-live="polite">
          <span class="favorites-loading-bar favorites-loading-bar--title"></span>
          <span class="favorites-loading-bar"></span>
          <span class="sr-only">Favorieten vernieuwen...</span>
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
        <div class="favorites-loading" aria-live="polite">
          <span class="favorites-loading-bar favorites-loading-bar--title"></span>
          <span class="favorites-loading-bar"></span>
          <span class="sr-only">Favorieten vernieuwen...</span>
        </div>`;
      await init();
    }
  } catch (err) {
    showToast('Fout: ' + err.message, 'error');
  }
}
