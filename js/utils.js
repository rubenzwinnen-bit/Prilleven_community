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

/* ----------------------------------------
   RELATIEVE TIJD (NL)
   "net" / "5 min" / "2 u" / "3 d" / "12 mei"
---------------------------------------- */
export function formatRelativeTime(isoString) {
  if (!isoString) return '';
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 30)            return 'net';
  if (diffSec < 60)            return 'minder dan 1 min';
  if (diffSec < 3600)          return Math.floor(diffSec / 60) + ' min';
  if (diffSec < 86400)         return Math.floor(diffSec / 3600) + ' u';
  if (diffSec < 86400 * 7)     return Math.floor(diffSec / 86400) + ' d';
  return new Date(isoString).toLocaleDateString('nl-BE', {
    day: 'numeric',
    month: 'short',
  });
}

/* ----------------------------------------
   AVATAR-KLEUR & INITIALEN op basis van een seed
   Roteert tussen bestaande --color-* accent-vars.
---------------------------------------- */
const _AVATAR_COLORS = [
  'var(--color-primary)',
  'var(--color-secondary-dark)',
  'var(--color-info)',
  'var(--color-warning)',
  'var(--color-primary-dark)',
  'var(--color-secondary)',
];
export function colorFromSeed(seed) {
  const s = String(seed || '');
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return _AVATAR_COLORS[hash % _AVATAR_COLORS.length];
}
export function initialsFromName(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/[\s_-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/* ----------------------------------------
   NL2BR — bewaar regelafbrekingen na escapeHtml
---------------------------------------- */
export function nl2br(escapedText) {
  return String(escapedText || '').replace(/\n/g, '<br>');
}

/* ----------------------------------------
   PROCESS IMAGE FOR UPLOAD
   - Verwijdert EXIF (locatie, telefoon-info, ...)
   - Schaalt naar max 1920px lange zijde
   - Re-encoded als JPEG q=0.85
   Returnt { blob, width, height } of throwt bij ongeldige input.
---------------------------------------- */
const MAX_IMAGE_DIM = 1920;
const IMAGE_QUALITY = 0.85;

export async function processImageForUpload(file) {
  if (!file || !(file instanceof Blob)) {
    throw new Error('Geen bestand geselecteerd.');
  }
  if (!file.type.startsWith('image/')) {
    throw new Error('Alleen afbeeldingen zijn toegestaan.');
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new Error('Afbeelding is te groot (max 15MB).');
  }

  // createImageBitmap is breed ondersteund + sneller dan <img> + crossOrigin
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Kon afbeelding niet lezen.');
  }

  // Schaal indien groter dan max
  const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width  * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      b => b ? resolve(b) : reject(new Error('Kon afbeelding niet exporteren.')),
      'image/jpeg',
      IMAGE_QUALITY,
    )
  );

  return { blob, width: w, height: h };
}
