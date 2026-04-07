/* ============================================
   RECIPE DETAIL COMPONENT
   Toont de volledige details van één recept:
   - Afbeelding, naam, meta-info
   - Ingrediënten en bereidingswijze
   - Interactief beoordelingssysteem (sterren)
   - Commentaarsectie
   - Favoriet toggle

   Async patroon:
   - render() geeft een skeleton terug
   - init() haalt alle data parallel op via Promise.all
============================================ */

import * as Store from '../store.js';
import * as Router from '../router.js';
import {
  showToast, escapeHtml, formatDate,
  renderStarsDisplay, renderStarsInteractive,
  getMealMomentLabel
} from '../utils.js';

/* ----------------------------------------
   RENDER
   Geeft een skeleton terug. De echte content
   wordt door init() ingeladen.
---------------------------------------- */
export function render(recipeId) {
  return `
    <div id="recipe-detail-container">
      <div class="empty-state">
        <div class="empty-state-icon">&#9203;</div>
        <h3>Recept laden...</h3>
        <p>Een ogenblik geduld.</p>
      </div>
    </div>
  `;
}

/* ----------------------------------------
   INIT
   Haalt het recept en alles eromheen op,
   bouwt de HTML, en koppelt event listeners.
---------------------------------------- */
export async function init(recipeId) {
  const container = document.getElementById('recipe-detail-container');
  if (!container) return;

  let recipe, isFav, avgRating, userRating, comments;

  /* ---- Data parallel ophalen ---- */
  try {
    [recipe, isFav, avgRating, userRating, comments] = await Promise.all([
      Store.getRecipe(recipeId),
      Store.isFavorite(recipeId),
      Store.getAverageRating(recipeId),
      Store.getUserRating(recipeId),
      Store.getComments(recipeId),
    ]);
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">&#9888;</div>
        <h3>Fout bij laden</h3>
        <p>${err.message}</p>
      </div>`;
    return;
  }

  /* ---- Recept niet gevonden ---- */
  if (!recipe) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">&#128533;</div>
        <h3>Recept niet gevonden</h3>
        <p>Dit recept bestaat niet (meer).</p>
        <button class="btn btn-primary" onclick="location.hash='#/'">Terug naar overzicht</button>
      </div>`;
    return;
  }

  /* ---- Bouw de volledige HTML op ---- */
  container.innerHTML = buildDetailHtml(recipe, isFav, avgRating, userRating, comments);

  /* ---- Event listeners koppelen ---- */
  attachListeners(recipeId, userRating);
}

/* ----------------------------------------
   BOUW DE DETAIL HTML
---------------------------------------- */
function buildDetailHtml(recipe, isFav, avgRating, userRating, comments) {
  const { average, count } = avgRating;

  /* Afbeelding */
  const imageHtml = recipe.image
    ? `<img class="recipe-detail-image" src="${escapeHtml(recipe.image)}" alt="${escapeHtml(recipe.name)}" onerror="this.outerHTML='<div class=\\'recipe-detail-image-placeholder\\'>&#127860;</div>'">`
    : `<div class="recipe-detail-image-placeholder">&#127860;</div>`;

  /* Eetmomenten */
  const moments = (recipe.mealMoments || [])
    .map(m => `<span class="tag tag-moment">${getMealMomentLabel(m)}</span>`)
    .join('');

  /* Allergenen */
  const allergens = (recipe.allergens || [])
    .map(a => `<span class="tag tag-allergen">${escapeHtml(a)}</span>`)
    .join('');

  /* Ingrediënten */
  const ingredientItems = (recipe.ingredients || [])
    .map(ing => `
      <li>
        <span class="ingredient-name">${escapeHtml(ing.name)}</span>
        <span class="ingredient-amount">${escapeHtml(ing.amount)} ${escapeHtml(ing.unit)}</span>
      </li>
    `).join('');

  /* Bereidingsstappen */
  const prepSteps = (recipe.preparation || [])
    .map(step => `<li>${escapeHtml(step)}</li>`)
    .join('');

  /* Commentaren */
  const commentItems = (comments || [])
    .map(c => `
      <div class="comment-item">
        <div class="comment-header">
          <span class="comment-author">${escapeHtml(c.userName)}</span>
          <span class="comment-date">${formatDate(c.date)}</span>
        </div>
        <p class="comment-text">${escapeHtml(c.text)}</p>
      </div>
    `).join('');

  return `
    <div class="recipe-detail">
      <button class="btn btn-outline btn-sm mb-2" id="btn-back">&#8592; Terug</button>

      <div class="recipe-detail-header">
        ${imageHtml}
      </div>

      <h1 class="recipe-detail-title">${escapeHtml(recipe.name)}</h1>

      <div class="recipe-detail-actions">
        <button class="btn ${isFav ? 'btn-primary' : 'btn-outline'}" id="btn-toggle-fav" data-id="${recipe.id}">
          ${isFav ? '&#10084;&#65039; In favorieten' : '&#9825; Favoriet maken'}
        </button>
      </div>

      <div class="recipe-section">
        <h3>Informatie</h3>
        <div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.75rem">
          ${moments}
          <span class="tag tag-time">&#9201; ${recipe.cookingTime} min</span>
        </div>
        ${allergens ? `<div style="display:flex;flex-wrap:wrap;gap:0.5rem"><strong style="font-size:0.85rem;margin-right:0.25rem">Allergenen:</strong>${allergens}</div>` : '<p class="text-muted" style="font-size:0.85rem">Geen allergenen</p>'}
      </div>

      <div class="recipe-section">
        <h3>Ingrediënten</h3>
        <ul class="ingredient-list">
          ${ingredientItems}
        </ul>
      </div>

      <div class="recipe-section">
        <h3>Bereidingswijze</h3>
        <ol class="preparation-list">
          ${prepSteps}
        </ol>
      </div>

      <div class="recipe-section">
        <h3>Beoordeling</h3>
        <div class="mb-2">
          <strong>Gemiddelde:</strong>
          ${count > 0
            ? renderStarsDisplay(average, count)
            : '<span class="text-muted"> Nog geen beoordelingen</span>'
          }
        </div>
        <div>
          <strong>Jouw beoordeling:</strong>
          ${renderStarsInteractive(userRating, recipe.id)}
          ${userRating > 0 ? `<span class="rating-info">(${userRating}/5)</span>` : ''}
        </div>
      </div>

      <div class="recipe-section">
        <h3>Reacties (${(comments || []).length})</h3>
        <div class="comment-list" id="comment-list">
          ${commentItems || '<p class="text-muted">Nog geen reacties. Wees de eerste!</p>'}
        </div>
        <div class="comment-form mt-2">
          <textarea class="form-control" id="comment-input"
                    placeholder="Schrijf een reactie..." rows="2"></textarea>
          <button class="btn btn-primary" id="btn-add-comment" data-id="${recipe.id}">Verstuur</button>
        </div>
      </div>
    </div>
  `;
}

/* ----------------------------------------
   EVENT LISTENERS KOPPELEN
   `initialRating` wordt door init() doorgegeven
   en in een closure-variabele gehouden zodat
   mouseleave geen netwerk-call meer hoeft te doen.
---------------------------------------- */
function attachListeners(recipeId, initialRating = 0) {
  /* Lokale state voor de huidige rating van deze gebruiker */
  let currentUserRating = initialRating;

  /* Terug knop */
  document.getElementById('btn-back')?.addEventListener('click', () => {
    Router.navigate('');
  });

  /* Favoriet toggle */
  document.getElementById('btn-toggle-fav')?.addEventListener('click', async (e) => {
    const id = e.currentTarget.dataset.id;
    try {
      const isFav = await Store.toggleFavorite(id);
      e.currentTarget.className = `btn ${isFav ? 'btn-primary' : 'btn-outline'}`;
      e.currentTarget.innerHTML = isFav ? '&#10084;&#65039; In favorieten' : '&#9825; Favoriet maken';
      showToast(isFav ? 'Toegevoegd aan favorieten' : 'Verwijderd uit favorieten');
    } catch (err) {
      showToast('Fout: ' + err.message, 'error');
    }
  });

  /* Sterren beoordeling - klik op ster */
  document.querySelectorAll('.stars-interactive .star').forEach(star => {
    star.addEventListener('click', async (e) => {
      const rating = parseInt(e.target.dataset.rating);
      const container = e.target.closest('.stars-interactive');
      const rid = container.dataset.recipeId;

      try {
        await Store.rateRecipe(rid, rating);
        /* Werk de lokale state bij zodat mouseleave geen call hoeft */
        currentUserRating = rating;

        /* Update sterren visueel */
        container.querySelectorAll('.star').forEach(s => {
          s.classList.toggle('filled', parseInt(s.dataset.rating) <= rating);
        });

        /* Update gemiddelde */
        const { average, count } = await Store.getAverageRating(rid);
        const avgSection = container.closest('.recipe-section');
        const avgDisplay = avgSection.querySelector('.mb-2');
        avgDisplay.innerHTML = `<strong>Gemiddelde:</strong> ${renderStarsDisplay(average, count)}`;

        /* Update eigen rating info */
        const ratingInfo = container.parentElement.querySelector('.rating-info');
        if (ratingInfo) {
          ratingInfo.textContent = `(${rating}/5)`;
        } else {
          container.insertAdjacentHTML('afterend', `<span class="rating-info">(${rating}/5)</span>`);
        }

        showToast(`Beoordeling: ${rating}/5 sterren`);
      } catch (err) {
        showToast('Fout: ' + err.message, 'error');
      }
    });

    /* Hover effect op sterren */
    star.addEventListener('mouseenter', (e) => {
      const rating = parseInt(e.target.dataset.rating);
      const container = e.target.closest('.stars-interactive');
      container.querySelectorAll('.star').forEach(s => {
        s.classList.toggle('filled', parseInt(s.dataset.rating) <= rating);
      });
    });

    /* Mouseleave: herstel naar de huidige rating uit closure-state.
       GEEN netwerkcall meer per hover. */
    star.addEventListener('mouseleave', () => {
      const container = star.closest('.stars-interactive');
      container.querySelectorAll('.star').forEach(s => {
        s.classList.toggle('filled', parseInt(s.dataset.rating) <= currentUserRating);
      });
    });
  });

  /* Commentaar toevoegen */
  document.getElementById('btn-add-comment')?.addEventListener('click', async () => {
    const input = document.getElementById('comment-input');
    const text = input.value.trim();
    if (!text) {
      showToast('Schrijf eerst een reactie', 'error');
      return;
    }

    try {
      const comment = await Store.addComment(recipeId, text);
      if (comment) {
        input.value = '';

        const list = document.getElementById('comment-list');
        const emptyMsg = list.querySelector('.text-muted');
        if (emptyMsg) emptyMsg.remove();

        list.insertAdjacentHTML('beforeend', `
          <div class="comment-item">
            <div class="comment-header">
              <span class="comment-author">${escapeHtml(comment.userName)}</span>
              <span class="comment-date">${formatDate(comment.date)}</span>
            </div>
            <p class="comment-text">${escapeHtml(comment.text)}</p>
          </div>
        `);

        /* Update de titel met het aantal reacties */
        const title = list.closest('.recipe-section').querySelector('h3');
        const allComments = await Store.getComments(recipeId);
        title.textContent = `Reacties (${allComments.length})`;

        showToast('Reactie geplaatst!');
      }
    } catch (err) {
      showToast('Fout: ' + err.message, 'error');
    }
  });

  /* Enter toets in commentaar veld */
  document.getElementById('comment-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.getElementById('btn-add-comment')?.click();
    }
  });
}
