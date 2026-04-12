/* ============================================
   RECIPE CARD COMPONENT
   Geeft een enkele receptkaart weer in het grid.
   Bevat afbeelding, naam, eetmomenten, kooktijd,
   beoordeling en favoriet-knop.
============================================ */

import { escapeHtml, renderStarsDisplay, getMealMomentLabel } from '../utils.js';

/* ----------------------------------------
   RENDER
   Genereer HTML voor één receptkaart.

   BELANGRIJK: deze functie roept GEEN Store
   meer aan. De aanroeper geeft de pre-fetched
   data mee zodat we niet per kaart een aparte
   server-call moeten doen (N+1 probleem).

   Parameters:
     recipe     - het recept object
     favIds     - array van favoriete recept IDs (optioneel)
     ratingsMap - object {recipeId: {average, count}} (optioneel)
     admin      - boolean, toon beheer-knoppen (optioneel)
---------------------------------------- */
export function render(recipe, favIds = [], ratingsMap = {}, admin = false) {
  const isFav = favIds.includes(recipe.id);
  const { average, count } = ratingsMap[recipe.id] || { average: 0, count: 0 };

  /* Afbeelding of placeholder */
  const imageHtml = recipe.image
    ? `<img class="recipe-card-image" src="${escapeHtml(recipe.image)}" alt="${escapeHtml(recipe.name)}" loading="lazy" onerror="this.outerHTML='<div class=\\'recipe-card-image-placeholder\\'>&#127860;</div>'">`
    : `<div class="recipe-card-image-placeholder">&#127860;</div>`;

  /* Eetmoment-tags */
  const momentTags = (recipe.mealMoments || [])
    .map(m => `<span class="tag tag-moment">${getMealMomentLabel(m)}</span>`)
    .join('');

  /* Allergeen-tags (max 3 tonen) */
  const allergenTags = (recipe.allergens || [])
    .slice(0, 3)
    .map(a => `<span class="tag tag-allergen">${escapeHtml(a)}</span>`)
    .join('');
  const moreAllergens = (recipe.allergens || []).length > 3
    ? `<span class="tag tag-allergen">+${recipe.allergens.length - 3}</span>`
    : '';

  return `
    <article class="recipe-card" data-recipe-id="${recipe.id}">
      <!-- Favoriet knop -->
      <button class="fav-btn ${isFav ? 'active' : ''}" data-fav-id="${recipe.id}" title="${isFav ? 'Verwijder uit favorieten' : 'Voeg toe aan favorieten'}">
        ${isFav ? '&#10084;&#65039;' : '&#9825;'}
      </button>

      <!-- Afbeelding -->
      ${imageHtml}

      <!-- Kaart inhoud -->
      <div class="recipe-card-body">
        <h3 class="recipe-card-title">${escapeHtml(recipe.name)}</h3>
        <div class="recipe-card-meta">
          ${momentTags}
          <span class="tag tag-time">&#9201; ${recipe.cookingTime} min</span>
          <span class="tag tag-portions">&#127869; ${recipe.portions || 1}</span>
        </div>
        <div class="recipe-card-meta">
          ${allergenTags}${moreAllergens}
        </div>
      </div>

      <!-- Footer met beoordeling -->
      <div class="recipe-card-footer">
        <div>${renderStarsDisplay(average, count)}</div>
        ${admin ? `
          <div style="display:flex;gap:0.4rem">
            <button class="btn btn-outline btn-sm btn-edit-recipe" data-id="${recipe.id}" title="Bewerken">&#9998;</button>
            <button class="btn btn-danger btn-sm btn-delete-recipe" data-id="${recipe.id}" data-name="${escapeHtml(recipe.name)}" title="Verwijderen">&#128465;</button>
          </div>
        ` : ''}
      </div>
    </article>
  `;
}
