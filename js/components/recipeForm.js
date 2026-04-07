/* ============================================
   RECIPE FORM COMPONENT
   Formulier voor het toevoegen en bewerken
   van recepten. Bevat dynamische lijsten voor
   ingrediënten en bereidingsstappen.

   Async patroon:
   - render() geeft een skeleton met formulier
   - init(recipeId) haalt het recept op (indien edit)
     en vult het formulier in
============================================ */

import * as Store from '../store.js';
import * as Router from '../router.js';
import { supabaseStorageUpload, dataUriToBlob } from '../supabase.js';
import { showToast, ALLERGENS, MEAL_MOMENTS, escapeHtml } from '../utils.js';

/* ----------------------------------------
   RENDER
   Geeft een leeg formulier terug. Als we in
   bewerk-modus zitten, vult init() het later in.
---------------------------------------- */
export function render(recipeId = null) {
  const isEdit = !!recipeId;
  const title = isEdit ? 'Recept Bewerken' : 'Nieuw Recept Toevoegen';

  return `
    <div class="recipe-form-container" id="recipe-form-wrapper">
      <h2>${title}</h2>

      <div id="form-loading" class="empty-state" style="${isEdit ? '' : 'display:none'}">
        <div class="empty-state-icon">&#9203;</div>
        <p>Recept laden...</p>
      </div>

      <form id="recipe-form" data-recipe-id="${recipeId || ''}" style="${isEdit ? 'display:none' : ''}">
        <div class="form-group">
          <label for="recipe-name">Naam van het recept *</label>
          <input type="text" class="form-control" id="recipe-name"
                 placeholder="Bijv. Spaghetti Bolognese" required>
        </div>

        <div class="form-group">
          <label>Afbeelding</label>
          <div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;margin-bottom:0.5rem">
            <label class="btn btn-secondary" style="cursor:pointer;margin:0">
              &#128247; Foto kiezen
              <input type="file" id="recipe-image-file" accept="image/*" style="display:none">
            </label>
            <span id="image-file-name" class="text-muted" style="font-size:0.85rem">Geen foto gekozen</span>
          </div>
          <input type="hidden" id="recipe-image" value="">
          <details style="margin-top:0.25rem">
            <summary class="text-muted" style="font-size:0.8rem;cursor:pointer">Of plak een URL</summary>
            <input type="url" class="form-control mt-1" id="recipe-image-url"
                   placeholder="https://voorbeeld.com/afbeelding.jpg"
                   style="font-size:0.85rem">
          </details>
        </div>

        <div id="image-preview" class="mb-2" style="display:none"></div>

        <div class="form-group">
          <label>Eetmoment(en) *</label>
          <div class="checkbox-group">
            ${MEAL_MOMENTS.map(m => `
              <label class="checkbox-label">
                <input type="checkbox" name="mealMoments" value="${m.id}">
                <span>${m.label}</span>
              </label>
            `).join('')}
          </div>
        </div>

        <div class="form-group">
          <label for="recipe-cooktime">Kooktijd (minuten) *</label>
          <input type="number" class="form-control" id="recipe-cooktime"
                 placeholder="30" min="1" required>
        </div>

        <div class="form-group">
          <label>Ingrediënten *</label>
          <div id="ingredients-list">
            ${renderIngredientRow({}, 0)}
          </div>
          <button type="button" class="btn btn-outline btn-sm mt-1" id="btn-add-ingredient">
            + Ingrediënt toevoegen
          </button>
        </div>

        <div class="form-group">
          <label>Allergenen</label>
          <div class="checkbox-group">
            ${ALLERGENS.map(a => `
              <label class="checkbox-label">
                <input type="checkbox" name="allergens" value="${a}">
                <span>${a}</span>
              </label>
            `).join('')}
          </div>
        </div>

        <div class="form-group">
          <label>Bereidingswijze *</label>
          <div id="preparation-list">
            ${renderPreparationRow('', 0)}
          </div>
          <button type="button" class="btn btn-outline btn-sm mt-1" id="btn-add-step">
            + Stap toevoegen
          </button>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-outline" id="btn-cancel-form">Annuleren</button>
          <button type="submit" class="btn btn-primary btn-lg" id="btn-submit-form">
            ${isEdit ? 'Opslaan' : 'Recept Toevoegen'}
          </button>
        </div>
      </form>
    </div>
  `;
}

/* ----------------------------------------
   INGREDIËNT RIJ RENDEREN
---------------------------------------- */
function renderIngredientRow(ingredient = {}, index = 0) {
  return `
    <div class="dynamic-list-item" data-index="${index}">
      <input type="text" class="form-control ing-name"
             placeholder="Ingrediënt" value="${escapeHtml(ingredient.name || '')}">
      <input type="text" class="form-control ing-amount" style="max-width:100px"
             placeholder="Hoev." value="${escapeHtml(ingredient.amount || '')}">
      <input type="text" class="form-control ing-unit" style="max-width:100px"
             placeholder="Eenheid" value="${escapeHtml(ingredient.unit || '')}">
      <button type="button" class="btn-remove" title="Verwijderen">&#10005;</button>
    </div>
  `;
}

/* ----------------------------------------
   BEREIDINGSSTAP RIJ RENDEREN
---------------------------------------- */
function renderPreparationRow(step = '', index = 0) {
  return `
    <div class="dynamic-list-item" data-index="${index}">
      <span style="font-weight:bold;color:var(--color-primary);min-width:24px">${index + 1}.</span>
      <textarea class="form-control prep-step" rows="2"
                placeholder="Beschrijf deze stap...">${escapeHtml(step)}</textarea>
      <button type="button" class="btn-remove" title="Verwijderen">&#10005;</button>
    </div>
  `;
}

/* ----------------------------------------
   INIT
   Vult formulier (bij edit) en koppelt listeners
---------------------------------------- */
export async function init(recipeId = null) {
  const form = document.getElementById('recipe-form');
  if (!form) return;

  /* ---- Bewerk-modus: laad het bestaande recept ---- */
  if (recipeId) {
    try {
      const recipe = await Store.getRecipe(recipeId);
      if (!recipe) {
        document.getElementById('recipe-form-wrapper').innerHTML = `
          <div class="empty-state">
            <h3>Recept niet gevonden</h3>
            <button class="btn btn-primary" onclick="location.hash='#/'">Terug</button>
          </div>`;
        return;
      }
      fillForm(recipe);
    } catch (err) {
      showToast('Fout bij laden: ' + err.message, 'error');
      return;
    }

    document.getElementById('form-loading').style.display = 'none';
    form.style.display = '';
  }

  /* ---- Event listeners ---- */
  form.addEventListener('submit', handleSubmit);

  document.getElementById('btn-cancel-form')?.addEventListener('click', () => {
    const id = form.dataset.recipeId;
    Router.navigate(id ? 'recipe/' + id : '');
  });

  document.getElementById('btn-add-ingredient')?.addEventListener('click', () => {
    const list = document.getElementById('ingredients-list');
    const index = list.children.length;
    list.insertAdjacentHTML('beforeend', renderIngredientRow({}, index));
  });

  document.getElementById('btn-add-step')?.addEventListener('click', () => {
    const list = document.getElementById('preparation-list');
    const index = list.children.length;
    list.insertAdjacentHTML('beforeend', renderPreparationRow('', index));
    updateStepNumbers();
  });

  document.getElementById('ingredients-list')?.addEventListener('click', (e) => {
    if (e.target.closest('.btn-remove')) {
      e.target.closest('.dynamic-list-item').remove();
    }
  });

  document.getElementById('preparation-list')?.addEventListener('click', (e) => {
    if (e.target.closest('.btn-remove')) {
      e.target.closest('.dynamic-list-item').remove();
      updateStepNumbers();
    }
  });

  document.getElementById('recipe-image-file')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    resizeImage(file, 800, 0.7).then(dataUrl => {
      document.getElementById('recipe-image').value = dataUrl;
      document.getElementById('image-file-name').textContent = file.name;
      document.getElementById('recipe-image-url').value = '';

      const preview = document.getElementById('image-preview');
      preview.innerHTML = `<img src="${dataUrl}" style="max-height:200px;border-radius:8px;width:100%;object-fit:cover;">`;
      preview.style.display = 'block';

      if (!document.getElementById('btn-remove-image')) {
        const fileNameEl = document.getElementById('image-file-name');
        fileNameEl.insertAdjacentHTML('afterend',
          `<button type="button" class="btn btn-outline btn-sm" id="btn-remove-image" style="color:var(--color-danger)">&#10005; Verwijderen</button>`
        );
        attachRemoveImageHandler();
      }

      showToast('Foto gekozen!');
    }).catch(err => {
      console.error('Fout bij verwerken afbeelding:', err);
      showToast('Fout bij verwerken van de afbeelding', 'error');
    });
  });

  document.getElementById('recipe-image-url')?.addEventListener('input', (e) => {
    const url = e.target.value.trim();
    const preview = document.getElementById('image-preview');
    if (url) {
      document.getElementById('recipe-image').value = url;
      document.getElementById('image-file-name').textContent = '';
      preview.innerHTML = `<img src="${escapeHtml(url)}" style="max-height:200px;border-radius:8px;width:100%;object-fit:cover;" onerror="this.parentElement.style.display='none'">`;
      preview.style.display = 'block';
    } else {
      if (!document.getElementById('recipe-image').value.startsWith('data:')) {
        document.getElementById('recipe-image').value = '';
        preview.style.display = 'none';
      }
    }
  });

  attachRemoveImageHandler();
}

/* ----------------------------------------
   FORMULIER VULLEN MET BESTAAND RECEPT
---------------------------------------- */
function fillForm(recipe) {
  document.getElementById('recipe-name').value = recipe.name || '';
  document.getElementById('recipe-cooktime').value = recipe.cookingTime || '';
  document.getElementById('recipe-image').value = recipe.image || '';

  /* Eetmomenten */
  (recipe.mealMoments || []).forEach(m => {
    const cb = document.querySelector(`input[name="mealMoments"][value="${m}"]`);
    if (cb) cb.checked = true;
  });

  /* Allergenen */
  (recipe.allergens || []).forEach(a => {
    const cb = document.querySelector(`input[name="allergens"][value="${a}"]`);
    if (cb) cb.checked = true;
  });

  /* Ingrediënten */
  if (recipe.ingredients && recipe.ingredients.length > 0) {
    const list = document.getElementById('ingredients-list');
    list.innerHTML = recipe.ingredients
      .map((ing, i) => renderIngredientRow(ing, i))
      .join('');
  }

  /* Bereidingsstappen */
  if (recipe.preparation && recipe.preparation.length > 0) {
    const list = document.getElementById('preparation-list');
    list.innerHTML = recipe.preparation
      .map((step, i) => renderPreparationRow(step, i))
      .join('');
  }

  /* Afbeelding preview */
  if (recipe.image) {
    const preview = document.getElementById('image-preview');
    preview.innerHTML = `<img src="${escapeHtml(recipe.image)}" style="max-height:200px;border-radius:8px;width:100%;object-fit:cover;" onerror="this.parentElement.style.display='none'">`;
    preview.style.display = 'block';

    document.getElementById('image-file-name').textContent = recipe.image.startsWith('data:') ? 'Foto al gekozen' : '';

    if (recipe.image && !recipe.image.startsWith('data:')) {
      document.getElementById('recipe-image-url').value = recipe.image;
    }

    if (!document.getElementById('btn-remove-image')) {
      const fileNameEl = document.getElementById('image-file-name');
      fileNameEl.insertAdjacentHTML('afterend',
        `<button type="button" class="btn btn-outline btn-sm" id="btn-remove-image" style="color:var(--color-danger)">&#10005; Verwijderen</button>`
      );
    }
  }
}

/* ----------------------------------------
   VERWIJDER AFBEELDING HANDLER
---------------------------------------- */
function attachRemoveImageHandler() {
  document.getElementById('btn-remove-image')?.addEventListener('click', () => {
    document.getElementById('recipe-image').value = '';
    document.getElementById('recipe-image-url').value = '';
    document.getElementById('recipe-image-file').value = '';
    document.getElementById('image-file-name').textContent = 'Geen foto gekozen';
    document.getElementById('image-preview').style.display = 'none';
    document.getElementById('btn-remove-image')?.remove();
    showToast('Foto verwijderd');
  });
}

/* ----------------------------------------
   AFBEELDING VERKLEINEN (canvas trick)
---------------------------------------- */
function resizeImage(file, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round(height * (maxWidth / width));
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Kon afbeelding niet laden'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Kon bestand niet lezen'));
    reader.readAsDataURL(file);
  });
}

/* ----------------------------------------
   STAPNUMMERS BIJWERKEN
---------------------------------------- */
function updateStepNumbers() {
  const items = document.querySelectorAll('#preparation-list .dynamic-list-item');
  items.forEach((item, i) => {
    const numEl = item.querySelector('span');
    if (numEl) numEl.textContent = (i + 1) + '.';
  });
}

/* ----------------------------------------
   FORMULIER VERSTUREN
   - Verzamel alle data
   - Upload eventueel de afbeelding naar Supabase
   - Sla het recept op
---------------------------------------- */
async function handleSubmit(e) {
  e.preventDefault();

  const form = document.getElementById('recipe-form');
  const recipeId = form.dataset.recipeId;
  const submitBtn = document.getElementById('btn-submit-form');

  /* Naam */
  const name = document.getElementById('recipe-name').value.trim();
  if (!name) {
    showToast('Vul een naam in voor het recept', 'error');
    return;
  }

  /* Afbeelding */
  let image = document.getElementById('recipe-image').value.trim();

  /* Eetmomenten */
  const mealMoments = Array.from(document.querySelectorAll('input[name="mealMoments"]:checked'))
    .map(cb => cb.value);
  if (mealMoments.length === 0) {
    showToast('Selecteer minstens één eetmoment', 'error');
    return;
  }

  /* Kooktijd */
  const cookingTime = parseInt(document.getElementById('recipe-cooktime').value) || 0;
  if (cookingTime <= 0) {
    showToast('Vul een geldige kooktijd in', 'error');
    return;
  }

  /* Ingrediënten */
  const ingredients = [];
  document.querySelectorAll('#ingredients-list .dynamic-list-item').forEach(row => {
    const ingName = row.querySelector('.ing-name').value.trim();
    const amount = row.querySelector('.ing-amount').value.trim();
    const unit = row.querySelector('.ing-unit').value.trim();
    if (ingName) {
      ingredients.push({ name: ingName, amount, unit });
    }
  });
  if (ingredients.length === 0) {
    showToast('Voeg minstens één ingrediënt toe', 'error');
    return;
  }

  /* Allergenen */
  const allergens = Array.from(document.querySelectorAll('input[name="allergens"]:checked'))
    .map(cb => cb.value);

  /* Bereidingsstappen */
  const preparation = [];
  document.querySelectorAll('#preparation-list .prep-step').forEach(textarea => {
    const step = textarea.value.trim();
    if (step) preparation.push(step);
  });
  if (preparation.length === 0) {
    showToast('Voeg minstens één bereidingsstap toe', 'error');
    return;
  }

  /* ---- Upload de afbeelding naar Supabase Storage als het een data-URI is ---- */
  if (image && image.startsWith('data:')) {
    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Foto uploaden...';

      const blob = dataUriToBlob(image);
      const safeName = name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-]/g, '').toLowerCase();
      const fileName = `${Date.now()}-${safeName}.jpg`;
      image = await supabaseStorageUpload(`recipes/${fileName}`, blob);
    } catch (err) {
      showToast('Fout bij uploaden afbeelding: ' + err.message, 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = recipeId ? 'Opslaan' : 'Recept Toevoegen';
      return;
    }
  }

  /* ---- Data object ---- */
  const recipeData = {
    name,
    image,
    mealMoments,
    cookingTime,
    ingredients,
    allergens,
    preparation,
  };

  /* ---- Opslaan of bijwerken ---- */
  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Opslaan...';

    if (recipeId) {
      await Store.updateRecipe(recipeId, recipeData);
      showToast('Recept bijgewerkt!');
      Router.navigate('recipe/' + recipeId);
    } else {
      const newRecipe = await Store.addRecipe(recipeData);
      showToast('Recept toegevoegd!');
      Router.navigate('recipe/' + newRecipe.id);
    }
  } catch (err) {
    showToast('Fout bij opslaan: ' + err.message, 'error');
    submitBtn.disabled = false;
    submitBtn.textContent = recipeId ? 'Opslaan' : 'Recept Toevoegen';
  }
}
