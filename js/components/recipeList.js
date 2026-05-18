/* ============================================
   RECIPE LIST COMPONENT
   Toont het overzicht van alle recepten met
   zoek-, filter- en sorteerfunctionaliteit.

   Async patroon:
   - render() geeft direct een skeleton (Laden...)
   - init() haalt de data op en vult de DOM
============================================ */

import * as Store from '../store.js?v=2.5.3';
import * as Router from '../router.js?v=2.5.3';
import * as RecipeCard from './recipeCard.js?v=2.5.3';
import { showToast, confirm, MEAL_MOMENTS, ALLERGENS } from '../utils.js?v=2.5.3';

/* Cache van pre-fetched data zodat het filteren snel blijft */
let cachedRecipes = [];
let cachedFavIds = [];
let cachedRatings = {};
let cachedFavCounts = {};

/* Set van allergenen die de gebruiker wil WEGFILTEREN (verbergen).
   Een recept dat één van deze allergenen bevat valt buiten de lijst. */
let excludedAllergens = new Set();

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

        <div class="allergen-filter" id="allergen-filter">
          <button type="button" class="allergen-filter-btn" id="allergen-filter-btn" aria-expanded="false">
            <span class="allergen-filter-label">Verberg allergenen</span>
            <span class="allergen-filter-count" id="allergen-filter-count"></span>
            <span class="allergen-filter-caret">&#9662;</span>
          </button>
          <div class="allergen-filter-pop hidden" id="allergen-filter-pop">
            ${ALLERGENS.map(a => `
              <label class="allergen-filter-opt">
                <input type="checkbox" value="${a}" />
                <span>${a}</span>
              </label>
            `).join('')}
            <button type="button" class="allergen-filter-clear" id="allergen-filter-clear">Wis alles</button>
          </div>
        </div>
      </div>

      <div class="allergen-filter-chips" id="allergen-filter-chips"></div>

      <div class="toolbar-right" id="toolbar-admin">
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
    const [recipes, favIds, ratingsMap, favCounts] = await Promise.all([
      Store.getRecipes(),
      Store.getFavoriteRecipeIds(),
      Store.getAllRatings(),
      Store.getFavoriteCountsMap(),
    ]);

    cachedRecipes = recipes;
    cachedFavIds = favIds;
    cachedRatings = ratingsMap;
    cachedFavCounts = favCounts;
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

  /* ---- Admin check ---- */
  const admin = Store.isAdmin();

  /* ---- Recepten renderen ---- */
  renderGrid(cachedRecipes, admin);

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
          cachedFavCounts[id] = (cachedFavCounts[id] || 0) + 1;
        } else {
          cachedFavIds = cachedFavIds.filter(fid => fid !== id);
          cachedFavCounts[id] = Math.max(0, (cachedFavCounts[id] || 1) - 1);
        }
        /* Update de zichtbare teller op de kaart */
        const card = favBtn.closest('.recipe-card');
        const countEl = card?.querySelector('.fav-count');
        const n = cachedFavCounts[id] || 0;
        if (countEl) {
          countEl.textContent = n;
          countEl.classList.toggle('hidden', n === 0);
        }
        showToast(isFav ? 'Toegevoegd aan favorieten' : 'Verwijderd uit favorieten');
      } catch (err) {
        showToast('Fout: ' + err.message, 'error');
      } finally {
        delete favBtn.dataset.busy;
      }
      return;
    }

    /* Admin: Bewerken knop */
    const editBtn = e.target.closest('.btn-edit-recipe');
    if (editBtn) {
      e.stopPropagation();
      Router.navigate('edit/' + editBtn.dataset.id);
      return;
    }

    /* Admin: Verwijderen knop */
    const deleteBtn = e.target.closest('.btn-delete-recipe');
    if (deleteBtn) {
      e.stopPropagation();
      const id = deleteBtn.dataset.id;
      const name = deleteBtn.dataset.name;
      const ok = await confirm(`Weet je zeker dat je "${name}" wilt verwijderen?`);
      if (!ok) return;
      try {
        await Store.deleteRecipe(id);
        showToast(`"${name}" verwijderd`, 'info');
        cachedRecipes = cachedRecipes.filter(r => r.id !== id);
        renderGrid(cachedRecipes, admin);
      } catch (err) {
        showToast('Fout bij verwijderen: ' + err.message, 'error');
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

  /* Allergenen-filter: dropdown openen/sluiten */
  const filterBtn = document.getElementById('allergen-filter-btn');
  const filterPop = document.getElementById('allergen-filter-pop');
  filterBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = filterPop.classList.toggle('hidden');
    filterBtn.setAttribute('aria-expanded', String(!open));
  }, { signal: listAbort.signal });

  /* Klik buiten dropdown → sluit */
  document.addEventListener('click', (e) => {
    if (!filterPop || filterPop.classList.contains('hidden')) return;
    if (e.target.closest('#allergen-filter')) return;
    filterPop.classList.add('hidden');
    filterBtn?.setAttribute('aria-expanded', 'false');
  }, { signal: listAbort.signal });

  /* Checkbox-wijziging → update excludedAllergens + filter opnieuw */
  filterPop?.addEventListener('change', (e) => {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb) return;
    if (cb.checked) excludedAllergens.add(cb.value);
    else excludedAllergens.delete(cb.value);
    renderAllergenChipsAndCount();
    filterRecipes();
  }, { signal: listAbort.signal });

  /* "Wis alles"-knop */
  document.getElementById('allergen-filter-clear')?.addEventListener('click', (e) => {
    e.stopPropagation();
    excludedAllergens.clear();
    filterPop.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
    renderAllergenChipsAndCount();
    filterRecipes();
  }, { signal: listAbort.signal });

  /* Chip ✕ → ontvink de bijbehorende checkbox */
  document.getElementById('allergen-filter-chips')?.addEventListener('click', (e) => {
    const chipBtn = e.target.closest('.allergen-chip-x');
    if (!chipBtn) return;
    const allergen = chipBtn.dataset.allergen;
    excludedAllergens.delete(allergen);
    const cb = filterPop.querySelector(`input[type="checkbox"][value="${allergen}"]`);
    if (cb) cb.checked = false;
    renderAllergenChipsAndCount();
    filterRecipes();
  }, { signal: listAbort.signal });
}

/* ----------------------------------------
   ALLERGEN-CHIPS + COUNT UPDATEN
---------------------------------------- */
function renderAllergenChipsAndCount() {
  const chipsEl = document.getElementById('allergen-filter-chips');
  const countEl = document.getElementById('allergen-filter-count');
  if (!chipsEl || !countEl) return;

  const n = excludedAllergens.size;
  countEl.textContent = n > 0 ? `(${n})` : '';

  if (n === 0) {
    chipsEl.innerHTML = '';
    return;
  }
  chipsEl.innerHTML = [...excludedAllergens].map(a => `
    <span class="allergen-chip">
      <span class="allergen-chip-label">geen ${a}</span>
      <button type="button" class="allergen-chip-x" data-allergen="${a}" aria-label="Verwijder filter ${a}">&times;</button>
    </span>
  `).join('');
}

/* ----------------------------------------
   GRID RENDEREN
   Vult het grid met de gegeven recepten
---------------------------------------- */
function renderGrid(recipes, admin = false) {
  const grid = document.getElementById('recipe-grid');
  if (!grid) return;

  if (recipes.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1">
        <div class="empty-state-icon">&#128214;</div>
        <h3>Nog geen recepten</h3>
        <p>Importeer recepten via de CSV import om te beginnen.</p>
        ${admin ? `<button class="btn btn-primary" onclick="location.hash='#/import'">Recepten Importeren</button>` : ''}
      </div>
    `;
    return;
  }

  grid.innerHTML = recipes
    .map(r => RecipeCard.render(r, cachedFavIds, cachedRatings, admin, cachedFavCounts))
    .join('');
}

/* ----------------------------------------
   FILTER RECEPTEN
   Past zoek- en filterwaarden toe op de cache
---------------------------------------- */
function filterRecipes() {
  const searchVal = (document.getElementById('recipe-search')?.value || '').toLowerCase();
  const momentVal = document.getElementById('filter-moment')?.value || '';

  const filtered = cachedRecipes.filter(recipe => {
    const matchesSearch = !searchVal ||
      recipe.name.toLowerCase().includes(searchVal) ||
      (recipe.ingredients || []).some(i => i.name.toLowerCase().includes(searchVal));

    const matchesMoment = !momentVal ||
      (recipe.mealMoments || []).includes(momentVal);

    /* Recept WEGFILTEREN als het minstens één van de uitgesloten
       allergenen bevat. Lege set → alle recepten zichtbaar. */
    const recipeAllergens = recipe.allergens || [];
    const passesAllergens = excludedAllergens.size === 0 ||
      !recipeAllergens.some(a => excludedAllergens.has(a));

    return matchesSearch && matchesMoment && passesAllergens;
  });

  const grid = document.getElementById('recipe-grid');
  if (!grid) return;

  if (filtered.length > 0) {
    grid.innerHTML = filtered
      .map(r => RecipeCard.render(r, cachedFavIds, cachedRatings, Store.isAdmin(), cachedFavCounts))
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
