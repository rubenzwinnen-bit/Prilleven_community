/* ============================================
   EERSTE HAPJES — SYMPTOM LOG MODAL
   Eenvoudig: stoplicht-ernst (🟢/🟠/🔴) + tijd + notitie.
   Backend krijgt symptom_type='anders' (vereenvoudiging) en
   severity in bestaande waarden: mild | matig | heftig.
============================================ */

import { escapeHtml } from '../utils.js?v=2.5.3';
import { createSymptom } from '../eersteHapjesSymptomsApi.js?v=2.5.3';

const SEVERITY_OPTIONS = [
  { value: 'mild',   icon: '🟢', label: 'Mild',    hint: 'meestal verder doen' },
  { value: 'matig',  icon: '🟠', label: 'Twijfel', hint: 'tijdelijk pauzeren + opvolgen' },
  { value: 'heftig', icon: '🔴', label: 'Ernstig', hint: 'stoppen + medische hulp' },
];

export function openSymptomLogModal({ childId, childName }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay eh-symptom-modal-overlay';
    overlay.innerHTML = `
      <div class="modal eh-symptom-modal">
        <header class="eh-symptom-header">
          <h2>Reactie loggen</h2>
          <p class="eh-symptom-sub">
            Voor ${escapeHtml(childName || '')} —
            <span class="eh-symptom-disclaimer">
              dit vervangt geen medisch advies.
            </span>
          </p>
        </header>

        <div class="eh-symptom-form">
          <!-- Ernst (stoplicht) -->
          <div class="eh-symptom-field">
            <label>
              Ernst
              <button type="button" class="eh-symptom-info-link" data-action="open-legend">
                Wat betekenen deze? →
              </button>
            </label>
            <div class="eh-stoplight" data-group="severity">
              ${SEVERITY_OPTIONS.map(s => `
                <button type="button" class="eh-stoplight-chip eh-stoplight-chip--${s.value}" data-value="${s.value}">
                  <span class="eh-stoplight-icon">${s.icon}</span>
                  <span class="eh-stoplight-label">${escapeHtml(s.label)}</span>
                  <span class="eh-stoplight-hint">${escapeHtml(s.hint)}</span>
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Tijd -->
          <div class="eh-symptom-field">
            <label for="eh-symptom-when">Wanneer</label>
            <input type="datetime-local" id="eh-symptom-when" class="auth-input">
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

    const state = { severity: null };
    const $ = (sel) => overlay.querySelector(sel);
    const errorEl = $('[data-error]');
    const showError = (msg) => { errorEl.textContent = msg; errorEl.classList.remove('hidden'); };
    const clearError = () => errorEl.classList.add('hidden');

    $('#eh-symptom-when').value = toLocalInput(new Date());

    // Stoplicht-chips (single-select)
    overlay.querySelector('[data-group="severity"]').addEventListener('click', (e) => {
      const chip = e.target.closest('.eh-stoplight-chip');
      if (!chip) return;
      overlay.querySelectorAll('.eh-stoplight-chip').forEach(b => b.classList.remove('selected'));
      chip.classList.add('selected');
      state.severity = chip.dataset.value;
    });

    // Legend popup
    overlay.querySelector('[data-action="open-legend"]').addEventListener('click', () => {
      openStoplightLegend();
    });

    // Save
    $('[data-action="save"]').addEventListener('click', async () => {
      clearError();
      if (!state.severity) return showError('Kies een ernst.');

      const occurredAt = parseLocalInput($('#eh-symptom-when').value);
      if (!occurredAt) return showError('Kies een geldig tijdstip.');

      const notes = $('#eh-symptom-notes').value.trim();
      const buttons = overlay.querySelectorAll('.eh-symptom-actions button');
      buttons.forEach(b => b.disabled = true);

      try {
        const result = await createSymptom({
          child_id:     childId,
          symptom_type: 'anders',
          severity:     state.severity,
          occurred_at:  occurredAt,
          notes:        notes || null,
        });
        close(result);
      } catch (err) {
        buttons.forEach(b => b.disabled = false);
        showError(err.message || 'Er ging iets mis.');
      }
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

/* ============================================
   STOPLICHT-LEGEND (popup met uitleg per kleur)
============================================ */
function openStoplightLegend() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay eh-stoplight-legend-overlay';
  overlay.innerHTML = `
    <div class="modal eh-stoplight-legend">
      <header class="eh-stoplight-legend-header">
        <h2>Stoplicht — uitleg</h2>
        <p class="eh-symptom-sub">
          <span class="eh-symptom-disclaimer">Dit vervangt geen medisch advies.</span>
        </p>
      </header>

      <section class="eh-stoplight-section eh-stoplight-section--green">
        <h4>🟢 Mild — meestal verder doen</h4>
        <ul>
          <li>1–2 rode vlekjes rond mond door contact met voeding</li>
          <li>Kortdurende lichte roodheid</li>
          <li>Eenmalig losse stoelgang</li>
          <li>Wat meer windjes</li>
          <li>Licht veranderd stoelgangpatroon</li>
          <li>Klein beetje voeding teruggeven/spugen</li>
          <li>Kind eet minder van een nieuw allergeen maar is verder oké</li>
        </ul>
      </section>

      <section class="eh-stoplight-section eh-stoplight-section--orange">
        <h4>🟠 Twijfel — tijdelijk pauzeren + opvolgen</h4>
        <ul>
          <li>Herhaald braken</li>
          <li>Toenemende huiduitslag</li>
          <li>Netelroos op meerdere plaatsen</li>
          <li>Diarree meerdere keren</li>
          <li>Opvallend ongemak/huilen</li>
          <li>Symptomen die telkens terugkomen bij hetzelfde allergeen</li>
        </ul>
      </section>

      <section class="eh-stoplight-section eh-stoplight-section--red">
        <h4>🔴 Ernstig — stoppen + medische hulp</h4>
        <ul>
          <li>Moeite met ademhalen</li>
          <li>Zwelling lippen/tong/oogleden</li>
          <li>Heesheid/piepend ademhalen</li>
          <li>Sufheid/flauwvallen</li>
          <li>Ernstige herhaaldelijke braakreacties</li>
          <li>Snelle verspreiding van netelroos</li>
          <li>Combinatie van meerdere symptomen tegelijk</li>
        </ul>
      </section>

      <p class="eh-stoplight-disclaimer-foot">
        Bij twijfel: contacteer je huisarts, kinderarts of Kind &amp; Gezin.
      </p>

      <footer class="eh-stoplight-legend-actions">
        <button class="btn btn-primary" data-action="close">Sluiten</button>
      </footer>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('[data-action="close"]').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape' && document.body.contains(overlay)) {
      document.removeEventListener('keydown', escHandler);
      close();
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
