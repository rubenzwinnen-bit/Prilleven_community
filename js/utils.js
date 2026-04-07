/* ============================================
   UTILS MODULE
   Herbruikbare hulpfuncties voor de hele applicatie:
   - Toast notificaties
   - Bevestigingsdialogen
   - Datumformattering
   - Sterren-weergave
   - Allergenen-lijst
   - Eetmomenten-lijst
============================================ */

/* ----------------------------------------
   CONSTANTEN
   Lijsten van beschikbare allergenen en eetmomenten
---------------------------------------- */
export const ALLERGENS = [
  'gluten', 'lactose', 'ei', 'noten', 'pinda',
  'soja', 'vis', 'schaaldieren', 'selderij',
  'mosterd', 'sesam', 'sulfiet', 'lupine'
];

export const MEAL_MOMENTS = [
  { id: 'ochtend', label: 'Ochtend' },
  { id: 'fruit moment', label: 'Fruit Moment' },
  { id: 'middag', label: 'Middag' },
  { id: 'snack', label: 'Snack' },
  { id: 'avond', label: 'Avond' }
];

/* Eetmomenten voor het weekschema (5 slots per dag) */
export const SCHEDULE_SLOTS = [
  { id: 'ochtend', label: 'Ochtend' },
  { id: 'snack1', label: 'Fruit Moment' },
  { id: 'middag', label: 'Middag' },
  { id: 'snack2', label: 'Snack' },
  { id: 'avond', label: 'Avond' }
];

export const WEEKDAYS = [
  'maandag', 'dinsdag', 'woensdag', 'donderdag',
  'vrijdag', 'zaterdag', 'zondag'
];

/* ----------------------------------------
   TOAST NOTIFICATIES
   Toon een korte melding onderaan het scherm
---------------------------------------- */
export function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  /* Verwijder de toast na 3 seconden */
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/* ----------------------------------------
   BEVESTIGINGSDIALOOG
   Toon een "Weet je het zeker?" dialoog
   Geeft een Promise terug (true/false)
---------------------------------------- */
export function confirm(message) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-dialog';
    overlay.innerHTML = `
      <div class="confirm-dialog-box">
        <p>${message}</p>
        <div class="confirm-dialog-actions">
          <button class="btn btn-outline confirm-cancel">Annuleren</button>
          <button class="btn btn-danger confirm-ok">Bevestigen</button>
        </div>
      </div>
    `;

    overlay.querySelector('.confirm-cancel').addEventListener('click', () => {
      overlay.remove();
      resolve(false);
    });

    overlay.querySelector('.confirm-ok').addEventListener('click', () => {
      overlay.remove();
      resolve(true);
    });

    document.body.appendChild(overlay);
  });
}

/* ----------------------------------------
   INVOERDIALOOG
   Toon een dialoog met een tekstveld
   Geeft een Promise terug (string of null)
---------------------------------------- */
export function promptInput(message, defaultValue = '') {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-dialog';
    overlay.innerHTML = `
      <div class="confirm-dialog-box">
        <p>${message}</p>
        <input type="text" class="form-control prompt-input" value="${escapeHtml(defaultValue)}" style="margin-bottom:1rem">
        <div class="confirm-dialog-actions">
          <button class="btn btn-outline confirm-cancel">Annuleren</button>
          <button class="btn btn-primary confirm-ok">Opslaan</button>
        </div>
      </div>
    `;

    const input = overlay.querySelector('.prompt-input');

    overlay.querySelector('.confirm-cancel').addEventListener('click', () => {
      overlay.remove();
      resolve(null);
    });

    overlay.querySelector('.confirm-ok').addEventListener('click', () => {
      const value = input.value.trim();
      overlay.remove();
      resolve(value || null);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const value = input.value.trim();
        overlay.remove();
        resolve(value || null);
      }
    });

    document.body.appendChild(overlay);
    input.focus();
    input.select();
  });
}

/* ----------------------------------------
   DATUMFORMATTERING
   Formatteer een ISO datum naar leesbaar Nederlands
---------------------------------------- */
export function formatDate(isoString) {
  const date = new Date(isoString);
  return date.toLocaleDateString('nl-BE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function formatDateShort(isoString) {
  const date = new Date(isoString);
  return date.toLocaleDateString('nl-BE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

/* ----------------------------------------
   STERREN HTML GENEREREN
   Genereer HTML voor een sterren-weergave (alleen lezen)
---------------------------------------- */
export function renderStarsDisplay(rating, count = 0) {
  let html = '<span class="stars stars-display">';
  for (let i = 1; i <= 5; i++) {
    html += `<span class="star ${i <= Math.round(rating) ? 'filled' : ''}">&#9733;</span>`;
  }
  html += '</span>';
  if (count > 0) {
    html += `<span class="rating-info">${rating}/5 (${count})</span>`;
  }
  return html;
}

/* ----------------------------------------
   INTERACTIEVE STERREN GENEREREN
   Genereer HTML voor klikbare sterren
---------------------------------------- */
export function renderStarsInteractive(currentRating, recipeId) {
  let html = `<span class="stars stars-interactive" data-recipe-id="${recipeId}">`;
  for (let i = 1; i <= 5; i++) {
    html += `<button class="star ${i <= currentRating ? 'filled' : ''}" data-rating="${i}">&#9733;</button>`;
  }
  html += '</span>';
  return html;
}

/* ----------------------------------------
   EETMOMENT LABEL OPHALEN
   Geeft de Nederlandse naam van een eetmoment terug
---------------------------------------- */
export function getMealMomentLabel(id) {
  const found = MEAL_MOMENTS.find(m => m.id === id);
  return found ? found.label : id;
}

/* ----------------------------------------
   SLOT LABEL OPHALEN (voor weekschema)
---------------------------------------- */
export function getSlotLabel(id) {
  const found = SCHEDULE_SLOTS.find(s => s.id === id);
  return found ? found.label : id;
}

/* ----------------------------------------
   SLOT NAAR EETMOMENT MAPPING
   Koppelt weekschema slots aan recept eetmomenten
---------------------------------------- */
export function slotToMealMoment(slotId) {
  const mapping = {
    'ochtend': 'ochtend',
    'snack1': 'fruit moment',
    'middag': 'middag',
    'snack2': 'snack',
    'avond': 'avond'
  };
  return mapping[slotId] || slotId;
}

/* ----------------------------------------
   ESCAPING VOOR HTML
   Voorkom XSS door speciale tekens te escapen
---------------------------------------- */
export function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
