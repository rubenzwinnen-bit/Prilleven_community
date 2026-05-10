/* ============================================
   EERSTE HAPJES — MEAL LOG MODAL
   Eén-staps modal om een maaltijd te loggen.
   Velden: type, tijdstip, voeding (recept-typeahead OF
   vrije tekst), hoeveelheid, reactie, notitie.
   Returnt Promise<meal|null>.
============================================ */

import { escapeHtml } from '../utils.js?v=2.26.0';
import { createMealLog } from '../eersteHapjesApi.js?v=2.26.0';
import { getRecipes } from '../store.js?v=2.26.0';
import { scanRecipeForRisks } from '../content/eersteHapjes-risk-foods.js?v=2.26.0';
import { ageMonthsFromBirthdate } from '../eersteHapjesContent.js?v=2.26.0';

const MEAL_TYPES = [
  { value: 'ontbijt', label: 'Ontbijt' },
  { value: 'lunch',   label: 'Lunch'   },
  { value: 'diner',   label: 'Diner'   },
  { value: 'snack',   label: 'Snack'   },
];

const AMOUNTS = [
  { value: 'klein',  label: 'Klein'  },
  { value: 'medium', label: 'Medium' },
  { value: 'groot',  label: 'Groot'  },
];

const REACTIONS = [
  { value: 'positief',  label: 'Positief',  emoji: '😋' },
  { value: 'neutraal',  label: 'Neutraal',  emoji: '😐' },
  { value: 'afwijzing', label: 'Afwijzing', emoji: '😖' },
];

/**
 * Toon de maaltijd-log modal.
 * @param {object} opts
 * @param {string} opts.childId  — verplicht
 * @param {string} opts.childName — voor titel
 * @param {string} [opts.childBirthdate] — voor risk-food scan (leeftijdsdrempels)
 * @param {Array}  [opts.childAllergens] — voor recept-warning
 * @param {Array}  [opts.todayMeals] — voor max-1-nieuw-guard (brok H.7)
 * @returns {Promise<object|null>} aangemaakte meal-rij of null
 */
export function openMealLogModal({
  childId, childName, childBirthdate = null,
  childAllergens = [], todayMeals = [],
}) {
  const ageMonths = childBirthdate ? ageMonthsFromBirthdate(childBirthdate) : null;
  // Set van allergeen-keys die als 'gepland' staan (kandidaten voor "nieuw")
  const plannedSet = new Set(
    (childAllergens || [])
      .filter((a) => a.status === 'gepland')
      .map((a) => a.allergen_key.toLowerCase())
  );
  // Reken één keer uit welke allergens een waarschuwing geven:
  // 'vermijden' of 'geprobeerd' met reactie matig/heftig.
  const warnSet = new Set(
    (childAllergens || [])
      .filter(a =>
        a.status === 'vermijden'
        || (a.status === 'geprobeerd' && (a.reaction === 'matig' || a.reaction === 'heftig'))
      )
      .map(a => a.allergen_key.toLowerCase())
  );
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay eh-meal-modal-overlay';
    overlay.innerHTML = `
      <div class="modal eh-meal-modal">
        <header class="eh-meal-header">
          <h2>Maaltijd loggen</h2>
          <p class="eh-meal-sub">Voor ${escapeHtml(childName || '')}</p>
        </header>

        <div class="eh-meal-form">
          <!-- Type -->
          <div class="eh-meal-field">
            <label>Soort</label>
            <div class="eh-meal-chips" data-group="meal_type">
              ${MEAL_TYPES.map(t => `
                <button type="button" class="eh-meal-chip" data-value="${t.value}">
                  ${escapeHtml(t.label)}
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Tijd -->
          <div class="eh-meal-field">
            <label for="eh-meal-when">Wanneer</label>
            <input type="datetime-local" id="eh-meal-when" class="auth-input">
          </div>

          <!-- Voeding -->
          <div class="eh-meal-field eh-meal-food">
            <label for="eh-meal-food">Wat heeft ${escapeHtml(childName || 'je kindje')} gegeten?</label>
            <input
              type="text"
              id="eh-meal-food"
              class="auth-input"
              placeholder="bv. pompoen-puree met kip"
              maxlength="200"
              autocomplete="off"
            >
            <div class="eh-meal-suggestions hidden" data-suggestions></div>
            <div class="eh-meal-recipe-pill hidden" data-recipe-pill>
              <span class="eh-meal-pill-label" data-pill-label></span>
              <button type="button" class="eh-meal-pill-clear" data-pill-clear aria-label="Recept loskoppelen">×</button>
            </div>
            <div class="eh-meal-risk-warning hidden" data-risk-warning></div>
            <div class="eh-meal-allergen-warning hidden" data-allergen-warning></div>
            <div class="eh-meal-newguard-warning hidden" data-newguard-warning></div>
          </div>

          <!-- Hoeveelheid -->
          <div class="eh-meal-field">
            <label>Hoeveelheid <span class="eh-meal-optional">(optioneel)</span></label>
            <div class="eh-meal-chips" data-group="amount">
              ${AMOUNTS.map(a => `
                <button type="button" class="eh-meal-chip" data-value="${a.value}">
                  ${escapeHtml(a.label)}
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Reactie -->
          <div class="eh-meal-field">
            <label>Reactie <span class="eh-meal-optional">(optioneel)</span></label>
            <div class="eh-meal-chips eh-meal-chips-emoji" data-group="reaction">
              ${REACTIONS.map(r => `
                <button type="button" class="eh-meal-chip eh-meal-chip-emoji" data-value="${r.value}">
                  <span class="eh-meal-emoji">${r.emoji}</span>
                  <span>${escapeHtml(r.label)}</span>
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Notitie -->
          <div class="eh-meal-field">
            <label for="eh-meal-notes">Notitie <span class="eh-meal-optional">(optioneel)</span></label>
            <textarea
              id="eh-meal-notes"
              class="auth-input eh-meal-textarea"
              maxlength="500"
              rows="2"
              placeholder="bv. trok eerst een vies gezicht maar at toch alles op"
            ></textarea>
          </div>

          <div class="eh-meal-error hidden" data-error></div>
        </div>

        <footer class="eh-meal-actions">
          <button class="btn btn-outline" data-action="cancel">Annuleren</button>
          <button class="btn btn-primary" data-action="save">Opslaan</button>
        </footer>
      </div>
    `;
    document.body.appendChild(overlay);

    // ----- state -----
    const state = {
      meal_type: null,
      amount: null,
      reaction: null,
      recipe_id: null,
    };

    const $ = (sel) => overlay.querySelector(sel);
    const errorEl = $('[data-error]');
    const showError = (msg) => { errorEl.textContent = msg; errorEl.classList.remove('hidden'); };
    const clearError = () => errorEl.classList.add('hidden');

    // Default: meal_type = beste match op huidig uur
    $('#eh-meal-when').value = toLocalInput(new Date());
    const guess = guessMealType(new Date());
    overlay.querySelectorAll('[data-group="meal_type"] .eh-meal-chip').forEach(b => {
      if (b.dataset.value === guess) {
        b.classList.add('selected');
        state.meal_type = guess;
      }
    });

    // Chip-groepen (single-select per groep)
    overlay.querySelectorAll('.eh-meal-chips').forEach(group => {
      group.addEventListener('click', (e) => {
        const btn = e.target.closest('.eh-meal-chip');
        if (!btn) return;
        const groupName = group.dataset.group;
        const wasSelected = btn.classList.contains('selected');
        group.querySelectorAll('.eh-meal-chip').forEach(b => b.classList.remove('selected'));
        if (!wasSelected) {
          btn.classList.add('selected');
          state[groupName] = btn.dataset.value;
        } else {
          // tweede klik = deselect (alleen voor optionele groepen)
          if (groupName !== 'meal_type') state[groupName] = null;
          else btn.classList.add('selected'); // type is verplicht — herselect
        }
      });
    });

    // Recept-typeahead
    const foodInput = $('#eh-meal-food');
    const suggBox = $('[data-suggestions]');
    const recipePill = $('[data-recipe-pill]');
    const pillLabel = $('[data-pill-label]');
    const pillClear = $('[data-pill-clear]');

    let recipesCache = null;
    let suggestionTimer = null;

    const warningEl = $('[data-allergen-warning]');
    const riskEl = $('[data-risk-warning]');
    const newguardEl = $('[data-newguard-warning]');
    const hideSuggestions = () => suggBox.classList.add('hidden');

    // Bouw de "vandaag al geïntroduceerd"-set lazy: pas wanneer
    // recipes-cache beschikbaar is (na eerste typeahead/lookup).
    let todayIntroducedSet = null;
    function buildTodayIntroducedSet(recipes) {
      if (todayIntroducedSet) return todayIntroducedSet;
      const set = new Set();
      const recipeMap = new Map((recipes || []).map((r) => [r.id, r]));
      for (const meal of (todayMeals || [])) {
        if (!meal.recipe_id) continue;
        const r = recipeMap.get(meal.recipe_id);
        if (!r) continue;
        for (const al of (r.allergens || [])) {
          const k = String(al).toLowerCase();
          if (plannedSet.has(k)) set.add(k);
        }
      }
      todayIntroducedSet = set;
      return set;
    }
    const setRecipe = (recipe) => {
      state.recipe_id = recipe.id;
      foodInput.value = recipe.name;
      pillLabel.textContent = '🍲 ' + recipe.name;
      recipePill.classList.remove('hidden');
      hideSuggestions();
      // Allergeen-warning?
      const recipeAllergens = (recipe.allergens || []).map(a => String(a).toLowerCase());
      const hits = recipeAllergens.filter(a => warnSet.has(a));
      if (hits.length > 0) {
        warningEl.innerHTML =
          `<span class="eh-meal-warn-icon" aria-hidden="true">⚠️</span> ` +
          `Dit recept bevat <strong>${hits.map(escapeHtml).join(', ')}</strong>. ` +
          `Je hebt aangegeven dat ${escapeHtml(childName || 'je kindje')} dit beter vermijdt.`;
        warningEl.classList.remove('hidden');
      } else {
        warningEl.classList.add('hidden');
      }
      // Risicovoeding-scan op basis van leeftijd
      if (ageMonths !== null) {
        const risks = scanRecipeForRisks(recipe, ageMonths);
        if (risks.length > 0) {
          const labels = risks.map(r => `${r.icon || ''} ${escapeHtml(r.label)}`).join(', ');
          riskEl.innerHTML =
            `<span class="eh-meal-warn-icon" aria-hidden="true">⚠️</span> ` +
            `Mogelijk te jong voor: <strong>${labels}</strong>. ` +
            `Bekijk per item of het veilig is voor ${escapeHtml(childName || 'je kindje')}.`;
          riskEl.classList.remove('hidden');
        } else {
          riskEl.classList.add('hidden');
        }
      } else {
        riskEl.classList.add('hidden');
      }
      // Max-1-nieuw-guard (brok H.7): waarschuw als recept een gepland-allergeen
      // bevat dat vandaag nog niet is geïntroduceerd, en er vandaag al een
      // ander gepland-allergeen is gelogd.
      const introduced = buildTodayIntroducedSet(recipesCache);
      const recipeAlsLower = recipeAllergens; // al lowercase
      const newPlanned = recipeAlsLower.filter((k) => plannedSet.has(k) && !introduced.has(k));
      if (newPlanned.length > 0 && introduced.size > 0) {
        const already = [...introduced].map(escapeHtml).join(', ');
        const incoming = newPlanned.map(escapeHtml).join(', ');
        newguardEl.innerHTML =
          `<span class="eh-meal-warn-icon" aria-hidden="true">⏳</span> ` +
          `Vandaag al geïntroduceerd: <strong>${already}</strong>. ` +
          `Wacht 2-3 dagen voor je <strong>${incoming}</strong> probeert — zo blijft het traceerbaar bij een reactie.`;
        newguardEl.classList.remove('hidden');
      } else {
        newguardEl.classList.add('hidden');
      }
    };
    const clearRecipe = () => {
      state.recipe_id = null;
      recipePill.classList.add('hidden');
      pillLabel.textContent = '';
      warningEl.classList.add('hidden');
      riskEl.classList.add('hidden');
      newguardEl.classList.add('hidden');
    };

    pillClear.addEventListener('click', () => clearRecipe());

    foodInput.addEventListener('input', () => {
      // Bij typen vervalt eerdere recept-koppeling
      if (state.recipe_id) clearRecipe();
      if (suggestionTimer) clearTimeout(suggestionTimer);
      suggestionTimer = setTimeout(() => runSuggestions(), 150);
    });
    foodInput.addEventListener('blur', () => {
      // delay zodat klik op suggestie kan landen
      setTimeout(hideSuggestions, 150);
    });
    foodInput.addEventListener('focus', () => {
      if (foodInput.value.trim().length >= 2) runSuggestions();
    });

    async function runSuggestions() {
      const q = foodInput.value.trim().toLowerCase();
      if (q.length < 2) { hideSuggestions(); return; }
      try {
        if (!recipesCache) recipesCache = await getRecipes();
      } catch {
        // Negeer: typeahead is niet kritiek.
        recipesCache = [];
      }
      const matches = recipesCache
        .filter(r => r.name && r.name.toLowerCase().includes(q))
        .slice(0, 8);
      if (matches.length === 0) { hideSuggestions(); return; }
      suggBox.innerHTML = matches.map(r => `
        <button type="button" class="eh-meal-suggestion" data-id="${escapeHtml(r.id)}">
          ${escapeHtml(r.name)}
        </button>
      `).join('');
      suggBox.classList.remove('hidden');
      suggBox.querySelectorAll('.eh-meal-suggestion').forEach(b => {
        b.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const recipe = matches.find(r => r.id === b.dataset.id);
          if (recipe) setRecipe(recipe);
        });
      });
    }

    // Save
    $('[data-action="save"]').addEventListener('click', async () => {
      clearError();
      if (!state.meal_type) return showError('Kies een soort maaltijd.');
      const food = foodInput.value.trim();
      if (!food) return showError('Vul in wat er gegeten is.');
      if (food.length > 200) return showError('Voedseltekst mag maximaal 200 tekens zijn.');

      const eatenAt = parseLocalInput($('#eh-meal-when').value);
      if (!eatenAt) return showError('Kies een geldig tijdstip.');

      const notes = $('#eh-meal-notes').value.trim();

      const buttons = overlay.querySelectorAll('.eh-meal-actions button');
      buttons.forEach(b => b.disabled = true);

      const { ok, data, error } = await createMealLog({
        child_id:   childId,
        meal_type:  state.meal_type,
        eaten_at:   eatenAt,
        food_text:  food,
        recipe_id:  state.recipe_id || null,
        amount:     state.amount,
        reaction:   state.reaction,
        notes:      notes || null,
      });

      if (!ok) {
        buttons.forEach(b => b.disabled = false);
        return showError(error || 'Er ging iets mis.');
      }
      close(data.meal);
    });

    $('[data-action="cancel"]').addEventListener('click', () => close(null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape' && document.body.contains(overlay)) {
        document.removeEventListener('keydown', escHandler);
        close(null);
      }
    });

    function close(result) {
      overlay.remove();
      resolve(result);
    }
  });
}

// ============================================================
// Helpers
// ============================================================
function guessMealType(date) {
  const h = date.getHours();
  if (h < 10) return 'ontbijt';
  if (h < 14) return 'lunch';
  if (h < 17) return 'snack';
  if (h < 21) return 'diner';
  return 'snack';
}

/** Date → "YYYY-MM-DDTHH:mm" voor input[type=datetime-local] (lokale tijd) */
function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "YYYY-MM-DDTHH:mm" → ISO-string in lokale tz */
function parseLocalInput(s) {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
