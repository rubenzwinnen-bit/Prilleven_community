/* ============================================
   EERSTE HAPJES — SYMPTOM LOG MODAL
   Eenvoudig: stoplicht-ernst (🟢/🟠/🔴) + tijd + notitie + context.
   Extra velden (allergeen-link verplicht, 4 enums optioneel):
     - linked_allergen_key (verplicht — 'onbekend' is geldig)
     - time_after_eating, duration, worsened, behavior (optioneel)
   Backend krijgt symptom_type='anders' (vereenvoudiging) en
   severity in bestaande waarden: mild | matig | heftig.
============================================ */

import { escapeHtml } from '../utils.js?v=2.5.10';
import { createSymptom, updateSymptom } from '../eersteHapjesSymptomsApi.js?v=2.5.10';

const SEVERITY_OPTIONS = [
  { value: 'mild',   icon: '🟢', label: 'Mild',    hint: 'meestal verder doen' },
  { value: 'matig',  icon: '🟠', label: 'Twijfel', hint: 'tijdelijk pauzeren + opvolgen' },
  { value: 'heftig', icon: '🔴', label: 'Ernstig', hint: 'stoppen + medische hulp' },
];

// Labels voor allergenen-dropdown (matcht keys in eersteHapjes-allergen-flow.js).
const ALLERGEN_LABELS = {
  'kippen-ei':    'Kippenei',
  'pinda':        'Pinda',
  'noten':        'Noten',
  'sesam':        'Sesam',
  'vis':          'Vis',
  'schaaldieren': 'Schaaldieren',
  'soja':         'Soja',
  'tarwe':        'Tarwe',
  'koemelk':      'Koemelk',
};

const TIME_AFTER_EATING_OPTIONS = [
  { value: 'direct',     label: 'Direct (<15 min)' },
  { value: 'snel',       label: 'Snel (15 min – 1 u)' },
  { value: 'later',      label: 'Later (1 – 4 u)' },
  { value: 'veel-later', label: 'Veel later (>4 u)' },
  { value: 'onbekend',   label: 'Onbekend' },
];

const DURATION_OPTIONS = [
  { value: 'kort',           label: 'Kort (<30 min)' },
  { value: 'paar-uur',       label: 'Een paar uur' },
  { value: 'halve-dag',      label: 'Een halve dag' },
  { value: 'dag-of-langer',  label: 'Een dag of langer' },
  { value: 'nog-bezig',      label: 'Nog bezig' },
];

const WORSENED_OPTIONS = [
  { value: 'stabiel',         label: 'Bleef stabiel' },
  { value: 'langzaam-erger',  label: 'Langzaam erger' },
  { value: 'snel-erger',      label: 'Snel erger' },
  { value: 'minder',          label: 'Werden minder' },
];

const BEHAVIOR_OPTIONS = [
  { value: 'normaal',       label: 'Normaal' },
  { value: 'onrustig',      label: 'Onrustig/huilerig' },
  { value: 'ongemakkelijk', label: 'Erg ongemakkelijk' },
  { value: 'suf',           label: 'Suf/lethargisch' },
];

function chipRow(group, options, { columns = 2 } = {}) {
  return `
    <div class="eh-chip-row" data-group="${group}" data-columns="${columns}">
      ${options.map(o => `
        <button type="button" class="eh-chip" data-value="${o.value}">
          ${escapeHtml(o.label)}
        </button>
      `).join('')}
    </div>
  `;
}

export function openSymptomLogModal({ childId, childName, introducedKeys = [], existing = null }) {
  const isEdit = !!existing;
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay eh-symptom-modal-overlay';
    overlay.innerHTML = `
      <div class="modal eh-symptom-modal">
        <header class="eh-symptom-header">
          <h2>${isEdit ? 'Reactie bewerken' : 'Reactie loggen'}</h2>
          <p class="eh-symptom-sub">
            Voor ${escapeHtml(childName || '')} —
            <span class="eh-symptom-disclaimer">
              dit vervangt geen medisch advies.
            </span>
          </p>
        </header>

        <div class="eh-symptom-form">
          <!-- Allergeen-link (verplicht, met 'Onbekend' als fallback) -->
          <div class="eh-symptom-field">
            <label for="eh-symptom-allergen">Welk allergeen?</label>
            <select id="eh-symptom-allergen" class="auth-input eh-symptom-select">
              <option value="">— kies een allergeen —</option>
              ${introducedKeys.map(k => `
                <option value="${k}">${escapeHtml(ALLERGEN_LABELS[k] || k)}</option>
              `).join('')}
            </select>
            ${introducedKeys.length === 0 ? `
              <p class="eh-symptom-empty-hint">
                Er zijn nog geen allergenen geïntroduceerd voor dit kindje.
                Log eerst een dose vóór je een symptoom registreert.
              </p>
            ` : ''}
          </div>

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

          <!-- Optionele context-velden -->
          <div class="eh-symptom-field">
            <label>Hoe snel na eten? <span class="eh-symptom-optional">(optioneel)</span></label>
            ${chipRow('time_after_eating', TIME_AFTER_EATING_OPTIONS, { columns: 2 })}
          </div>

          <div class="eh-symptom-field">
            <label>Hoe lang duurde het? <span class="eh-symptom-optional">(optioneel)</span></label>
            ${chipRow('duration', DURATION_OPTIONS, { columns: 2 })}
          </div>

          <div class="eh-symptom-field">
            <label>Werden symptomen erger? <span class="eh-symptom-optional">(optioneel)</span></label>
            ${chipRow('worsened', WORSENED_OPTIONS, { columns: 2 })}
          </div>

          <div class="eh-symptom-field">
            <label>Hoe gedroeg kindje zich? <span class="eh-symptom-optional">(optioneel)</span></label>
            ${chipRow('behavior', BEHAVIOR_OPTIONS, { columns: 2 })}
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

    const state = {
      severity: isEdit ? (existing.severity || null) : null,
      time_after_eating: isEdit ? (existing.time_after_eating || null) : null,
      duration: isEdit ? (existing.duration || null) : null,
      worsened: isEdit ? (existing.worsened || null) : null,
      behavior: isEdit ? (existing.behavior || null) : null,
    };
    const $ = (sel) => overlay.querySelector(sel);
    const errorEl = $('[data-error]');
    const showError = (msg) => { errorEl.textContent = msg; errorEl.classList.remove('hidden'); };
    const clearError = () => errorEl.classList.add('hidden');

    if (isEdit) {
      const sel = $('#eh-symptom-allergen');
      if (sel && existing.linked_allergen_key) {
        // Voeg bestaande key toe als ie niet in dropdown staat (bv. nu niet meer introduced)
        if (!Array.from(sel.options).some(o => o.value === existing.linked_allergen_key)) {
          const opt = document.createElement('option');
          opt.value = existing.linked_allergen_key;
          opt.textContent = ALLERGEN_LABELS[existing.linked_allergen_key] || existing.linked_allergen_key;
          sel.appendChild(opt);
        }
        sel.value = existing.linked_allergen_key;
      }
      $('#eh-symptom-when').value = existing.occurred_at
        ? toLocalInput(new Date(existing.occurred_at))
        : toLocalInput(new Date());
      $('#eh-symptom-notes').value = existing.notes || '';

      // Voorgeselecteerde chips markeren
      if (state.severity) {
        const chip = overlay.querySelector(`.eh-stoplight-chip[data-value="${state.severity}"]`);
        if (chip) chip.classList.add('selected');
      }
      for (const group of ['time_after_eating', 'duration', 'worsened', 'behavior']) {
        if (!state[group]) continue;
        const chip = overlay.querySelector(
          `.eh-chip-row[data-group="${group}"] .eh-chip[data-value="${state[group]}"]`
        );
        if (chip) chip.classList.add('selected');
      }
    } else {
      $('#eh-symptom-when').value = toLocalInput(new Date());
    }

    // Stoplicht-chips (single-select)
    overlay.querySelector('[data-group="severity"]').addEventListener('click', (e) => {
      const chip = e.target.closest('.eh-stoplight-chip');
      if (!chip) return;
      overlay.querySelectorAll('.eh-stoplight-chip').forEach(b => b.classList.remove('selected'));
      chip.classList.add('selected');
      state.severity = chip.dataset.value;
    });

    // Enum chip-rijen (single-select per groep, klik-nogmaals = deselecteer)
    overlay.querySelectorAll('.eh-chip-row').forEach(row => {
      const group = row.dataset.group;
      row.addEventListener('click', (e) => {
        const chip = e.target.closest('.eh-chip');
        if (!chip) return;
        const wasSelected = chip.classList.contains('selected');
        row.querySelectorAll('.eh-chip').forEach(b => b.classList.remove('selected'));
        if (wasSelected) {
          state[group] = null;
        } else {
          chip.classList.add('selected');
          state[group] = chip.dataset.value;
        }
      });
    });

    // Legend popup
    overlay.querySelector('[data-action="open-legend"]').addEventListener('click', () => {
      openStoplightLegend();
    });

    // Save
    $('[data-action="save"]').addEventListener('click', async () => {
      clearError();
      const allergenKey = $('#eh-symptom-allergen').value;
      if (!allergenKey) return showError('Kies een allergeen.');
      if (!state.severity) return showError('Kies een ernst.');

      const occurredAt = parseLocalInput($('#eh-symptom-when').value);
      if (!occurredAt) return showError('Kies een geldig tijdstip.');

      const notes = $('#eh-symptom-notes').value.trim();
      const buttons = overlay.querySelectorAll('.eh-symptom-actions button');
      buttons.forEach(b => b.disabled = true);

      try {
        if (isEdit) {
          const symptom = await updateSymptom(existing.id, {
            severity:            state.severity,
            occurred_at:         occurredAt,
            notes:               notes || null,
            linked_allergen_key: allergenKey,
            time_after_eating:   state.time_after_eating,
            duration:            state.duration,
            worsened:            state.worsened,
            behavior:            state.behavior,
          });
          close({ symptom, red_flag: false, updated: true });
        } else {
          const result = await createSymptom({
            child_id:            childId,
            symptom_type:        'anders',
            severity:            state.severity,
            occurred_at:         occurredAt,
            notes:               notes || null,
            linked_allergen_key: allergenKey,
            time_after_eating:   state.time_after_eating,
            duration:            state.duration,
            worsened:            state.worsened,
            behavior:            state.behavior,
          });
          close(result);
        }
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
