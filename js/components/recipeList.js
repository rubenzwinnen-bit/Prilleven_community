/* ============================================
   RECIPE LIST COMPONENT
   Toont het overzicht van alle recepten met
   zoek-, filter- en sorteerfunctionaliteit.

   Async patroon:
   - render() geeft direct een skeleton (Laden...)
   - init() haalt de data op en vult de DOM
============================================ */

import * as Store from '../store.js';
import * as Router from '../router.js';
import * as RecipeCard from './recipeCard.js';
import { showToast, MEAL_MOMENTS, ALLERGENS } from '../utils.js';

/* Cache van pre-fetched data zodat het filteren snel blijft */
let cachedRecipes = [];
let cachedFavIds = [];
let cachedRatings = {};

/* AbortController om vorige listeners op te ruimen wanneer de pagina
   opnieuw wordt geïnitialiseerd. Voorkomt dat dezelfde click-handler
   meerdere keren op #app-content blijft staan, wat anders zorgt voor
   N parallelle Store.toggleFavorite() calls -> 409 Conflict. */
let listAbort = null;

/* ----------------------------------------
   RENDER
   Geeft een skeleton terug. De echte data
   wordt geladen in init().
---------------------------------------- */
export function render() {
  return `
    <!-- Toolbar met zoeken en filteren -->
    <div class="toolbar">
      <div class="toolbar-left">
        <div class="search-bar">
          <input type="text" id="recipe-search" placeholder="Zoek recepten..." value="">
        </div>

        <select class="filter-select" id="filter-moment">
          <option value="">Alle eetmomenten</option>
          ${MEAL_MOMENTS.map(m => `<option value="${m.id}">${m.label}</option>`).join('')}
        </select>

        <select class="filter-select" id="filter-allergen">
          <option value="">Alle allergenen</option>
          ${ALLERGENS.map(a => `<option value="${a}">${a}</option>`).join('')}
        </select>
      </div>

      <div class="toolbar-right">
      </div>
    </div>

    <!-- Recepten grid met laad-status -->
    <div id="recipe-grid" class="recipe-grid">
      <div class="empty-state" style="grid-column: 1 / -1">
        <div class="empty-state-icon">&#9203;</div>
        <h3>Recepten laden...</h3>
        <p>Een ogenblik geduld.</p>
      </div>
    </div>
  `;
}

/* ----------------------------------------
   INIT
   Haal data op en koppel event listeners.
---------------------------------------- */
export async function init() {
  const content = document.getElementById('app-content');
  const grid = document.getElementById('recipe-grid');

  /* ---- Verwijder eventuele eerdere listeners ---- */
  if (listAbort) listAbort.abort();
  listAbort = new AbortController();

  /* ---- Data ophalen (parallel voor snelheid) ---- */
  try {
    const [recipes, favIds, ratingsMap] = await Promise.all([
      Store.getRecipes(),
      Store.getFavoriteRecipeIds(),
      Store.getAllRatings(),
    ]);

    cachedRecipes = recipes;
    cachedFavIds = favIds;
    cachedRatings = ratingsMap;
  } catch (err) {
    console.error('Fout bij laden recepten:', err);
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1">
        <div class="empty-state-icon">&#9888;</div>
        <h3>Fout bij laden</h3>
        <p>${err.message}</p>
      </div>`;
    return;
  }

  /* ---- Recepten renderen ---- */
  renderGrid(cachedRecipes);

  /* ---- Klik handlers (met AbortController signal) ---- */
  content.addEventListener('click', async (e) => {
    /* Favoriet knop klik */
    const favBtn = e.target.closest('.fav-btn');
    if (favBtn) {
      e.stopPropagation();
      /* Voorkom dubbel-klikken die race conditions kunnen veroorzaken */
      if (favBtn.dataset.busy === '1') return;
      favBtn.dataset.busy = '1';

      const id = favBtn.dataset.favId;
      try {
        const isFav = await Store.toggleFavorite(id);
        favBtn.classList.toggle('active', isFav);
        favBtn.innerHTML = isFav ? '&#10084;&#65039;' : '&#9825;';
        favBtn.title = isFav ? 'Verwijder uit favorieten' : 'Voeg toe aan favorieten';
        /* Update lokale cache zodat filteren juist blijft */
        if (isFav) {
          if (!cachedFavIds.includes(id)) cachedFavIds.push(id);
        } else {
          cachedFavIds = cachedFavIds.filter(fid => fid !== id);
        }
        showToast(isFav ? 'Toegevoegd aan favorieten' : 'Verwijderd uit favorieten');
      } catch (err) {
        showToast('Fout: ' + err.message, 'error');
      } finally {
        delete favBtn.dataset.busy;
      }
      return;
    }

    /* Recept kaart klik */
    const card = e.target.closest('.recipe-card');
    if (card) {
      const id = card.dataset.recipeId;
      Router.navigate('recipe/' + id);
      return;
    }
  }, { signal: listAbort.signal });

  /* Zoekfunctie (deze elementen zitten binnen het herrenderde grid,
     dus stapelen niet, maar koppelen we via dezelfde signal voor
     consistentie) */
  document.getElementById('recipe-search')?.addEventListener('input', filterRecipes, { signal: listAbort.signal });
  document.getElementById('filter-moment')?.addEventListener('change', filterRecipes, { signal: listAbort.signal });
  document.getElementById('filter-allergen')?.addEventListener('change', filterRecipes, { signal: listAbort.signal });
}

/* ----------------------------------------
   GRID RENDEREN
   Vult het grid met de gegeven recepten
---------------------------------------- */
function renderGrid(recipes) {
  const grid = document.getElementById('recipe-grid');
  if (!grid) return;

  if (recipes.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1">
        <div class="empty-state-icon">&#128214;</div>
        <h3>Nog geen recepten</h3>
        <p>Importeer recepten via de CSV import om te beginnen.</p>
        <button class="btn btn-primary" onclick="location.hash='#/import'">Recepten Importeren</button>
      </div>
    `;
    return;
  }

  grid.innerHTML = recipes
    .map(r => RecipeCard.render(r, cachedFavIds, cachedRatings))
    .join('');
}

/* ----------------------------------------
   FILTER RECEPTEN
   Past zoek- en filterwaarden toe op de cache
---------------------------------------- */
function filterRecipes() {
  const searchVal = (document.getElementById('recipe-search')?.value || '').toLowerCase();
  const momentVal = document.getElementById('filter-moment')?.value || '';
  const allergenVal = document.getElementById('filter-allergen')?.value || '';

  const filtered = cachedRecipes.filter(recipe => {
    const matchesSearch = !searchVal ||
      recipe.name.toLowerCase().includes(searchVal) ||
      (recipe.ingredients || []).some(i => i.name.toLowerCase().includes(searchVal));

    const matchesMoment = !momentVal ||
      (recipe.mealMoments || []).includes(momentVal);

    const matchesAllergen = !allergenVal ||
      (recipe.allergens || []).includes(allergenVal);

    return matchesSearch && matchesMoment && matchesAllergen;
  });

  const grid = document.getElementById('recipe-grid');
  if (!grid) return;

  if (filtered.length > 0) {
    grid.innerHTML = filtered
      .map(r => RecipeCard.render(r, cachedFavIds, cachedRatings))
      .join('');
  } else {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1">
        <div class="empty-state-icon">&#128270;</div>
        <h3>Geen resultaten</h3>
        <p>Pas je zoek- of filtercriteria aan.</p>
      </div>
    `;
  }
}
