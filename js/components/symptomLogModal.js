/* ============================================
   EERSTE HAPJES — SYMPTOM LOG MODAL
   Eén-staps modal om een symptoom te loggen.
   Velden: type (grid van 10 met icoon+label), ernst,
   tijdstip, optionele koppeling aan maaltijd, notitie.
   Returnt Promise<symptom|null>.
============================================ */

import { escapeHtml } from '../utils.js?v=2.27.0';
import { createSymptom, getMealsForChild } from '../eersteHapjesApi.js?v=2.27.0';
import { SYMPTOMS, SEVERITIES, getSymptom } from '../content/eersteHapjes-symptoms.js?v=2.27.0';
import { openSymptomDetailModal } from './symptomDetailModal.js?v=2.27.0';

/**
 * Toon de symptoom-log modal.
 * @param {object} opts
 * @param {string} opts.childId
 * @param {string} opts.childName
 * @returns {Promise<{symptom: object, red_flag: boolean}|null>}
 */
export function openSymptomLogModal({ childId, childName }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay eh-symptom-modal-overlay';
    overlay.innerHTML = `
      <div class="modal eh-symptom-modal">
        <header class="eh-symptom-header">
          <h2>Symptoom loggen</h2>
          <p class="eh-symptom-sub">
            Voor ${escapeHtml(childName || '')} —
            <span class="eh-symptom-disclaimer">
              dit vervangt geen medisch advies.
            </span>
          </p>
        </header>

        <div class="eh-symptom-form">
          <!-- Type -->
          <div class="eh-symptom-field">
            <label>
              Soort
              <button type="button" class="eh-symptom-info-link" data-action="open-symptom-list">
                Wat betekenen deze? →
              </button>
            </label>
            <div class="eh-symptom-grid" data-group="symptom_type">
              ${SYMPTOMS.map(t => `
                <button type="button" class="eh-symptom-tile" data-value="${t.key}">
                  <span class="eh-symptom-info" data-symptom-info="${t.key}" aria-label="Uitleg ${escapeHtml(t.label)}">i</span>
                  <span class="eh-symptom-label">${escapeHtml(t.label)}</span>
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Ernst -->
          <div class="eh-symptom-field">
            <label>Ernst</label>
            <div class="eh-symptom-chips" data-group="severity">
              ${SEVERITIES.map(s => `
                <button type="button" class="eh-symptom-chip" data-value="${s.value}">
                  ${escapeHtml(s.label)}
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Tijd -->
          <div class="eh-symptom-field">
            <label for="eh-symptom-when">Wanneer</label>
            <input type="datetime-local" id="eh-symptom-when" class="auth-input">
          </div>

          <!-- Koppelen aan maaltijd -->
          <div class="eh-symptom-field">
            <label for="eh-symptom-meal">Koppelen aan een maaltijd <span class="eh-symptom-optional">(optioneel)</span></label>
            <select id="eh-symptom-meal" class="auth-input">
              <option value="">— Geen koppeling —</option>
            </select>
          </div>

          <!-- Notitie -->
          <div class="eh-symptom-field">
            <label for="eh-symptom-notes">Notitie <span class="eh-symptom-optional">(optioneel)</span></label>
            <textarea
              id="eh-symptom-notes"
              class="auth-input eh-symptom-textarea"
              maxlength="500"
              rows="2"
              placeholder="bv. rode vlekjes op wangen, ongeveer 1u na het eten"
            ></textarea>
          </div>

          <div class="eh-symptom-error hidden" data-error></div>
        </div>

        <footer class="eh-symptom-actions">
          <button class="btn btn-outline" data-action="cancel">Annuleren</button>
          <button class="btn btn-primary" data-action="save">Opslaan</button>
        </footer>
      </div>
    `;
    document.body.appendChild(overlay);

    // ----- state -----
    const state = { symptom_type: null, severity: null };

    const $ = (sel) => overlay.querySelector(sel);
    const errorEl = $('[data-error]');
    const showError = (msg) => { errorEl.textContent = msg; errorEl.classList.remove('hidden'); };
    const clearError = () => errorEl.classList.add('hidden');

    // Default: tijd = nu
    $('#eh-symptom-when').value = toLocalInput(new Date());

    // Type-grid (single-select) — info-knop opent detail-modal voor één symptoom.
    overlay.querySelector('[data-group="symptom_type"]').addEventListener('click', async (e) => {
      const info = e.target.closest('[data-symptom-info]');
      if (info) {
        e.stopPropagation();
        const sym = getSymptom(info.dataset.symptomInfo);
        if (sym) await openSymptomDetailModal({ symptomKey: sym.key });
        return;
      }
      const tile = e.target.closest('.eh-symptom-tile');
      if (!tile) return;
      overlay.querySelectorAll('.eh-symptom-tile').forEach(b => b.classList.remove('selected'));
      tile.classList.add('selected');
      state.symptom_type = tile.dataset.value;
    });

    // "Wat betekenen deze?"-link → lijst-weergave.
    overlay.querySelector('[data-action="open-symptom-list"]').addEventListener('click', async () => {
      await openSymptomDetailModal({ listMode: true });
    });

    // Ernst-chips (single-select)
    overlay.querySelector('[data-group="severity"]').addEventListener('click', (e) => {
      const chip = e.target.closest('.eh-symptom-chip');
      if (!chip) return;
      overlay.querySelectorAll('[data-group="severity"] .eh-symptom-chip').forEach(b => b.classList.remove('selected'));
      chip.classList.add('selected');
      state.severity = chip.dataset.value;
    });

    // Maaltijden van afgelopen 48u laden voor koppeling-dropdown
    loadRecentMeals();

    async function loadRecentMeals() {
      const fromIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const { ok, data } = await getMealsForChild(childId, { from: fromIso });
      if (!ok || !data?.meals) return;
      const select = $('#eh-symptom-meal');
      data.meals.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        const t = new Date(m.eaten_at);
        const timeLabel = t.toLocaleString('nl-BE', {
          weekday: 'short', hour: '2-digit', minute: '2-digit',
        });
        opt.textContent = `${timeLabel} — ${m.food_text}`;
        select.appendChild(opt);
      });
    }

    // Save
    $('[data-action="save"]').addEventListener('click', async () => {
      clearError();
      if (!state.symptom_type) return showError('Kies een soort symptoom.');
      if (!state.severity) return showError('Kies een ernst.');

      const occurredAt = parseLocalInput($('#eh-symptom-when').value);
      if (!occurredAt) return showError('Kies een geldig tijdstip.');

      const mealLogId = $('#eh-symptom-meal').value || null;
      const notes = $('#eh-symptom-notes').value.trim();

      const buttons = overlay.querySelectorAll('.eh-symptom-actions button');
      buttons.forEach(b => b.disabled = true);

      const { ok, data, error } = await createSymptom({
        child_id:     childId,
        symptom_type: state.symptom_type,
        severity:     state.severity,
        occurred_at:  occurredAt,
        meal_log_id:  mealLogId,
        notes:        notes || null,
      });

      if (!ok) {
        buttons.forEach(b => b.disabled = false);
        return showError(error || 'Er ging iets mis.');
      }
      close({ symptom: data.symptom, red_flag: !!data.red_flag });
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

function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function parseLocalInput(s) {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
