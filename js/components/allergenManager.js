/* ============================================
   EERSTE HAPJES — ALLERGEN MANAGER (brok D)
   Modal met alle allergenen uit de vocabulaire,
   per allergeen kan je status/reactie/datum/notitie
   instellen. Upsert per rij via API.
   Returnt Promise<void> — caller herlaadt zelf.
============================================ */

import { escapeHtml, ALLERGENS, showToast } from '../utils.js?v=2.8.0';
import {
  getAllergensForChild,
  upsertAllergen,
  deleteAllergen,
} from '../eersteHapjesApi.js?v=2.8.0';

const STATUSES = [
  { value: 'gepland',    label: 'Gepland'    },
  { value: 'geprobeerd', label: 'Geprobeerd' },
  { value: 'vermijden',  label: 'Vermijden'  },
];

const REACTIONS = [
  { value: 'geen',     label: 'Geen reactie' },
  { value: 'mild',     label: 'Mild'         },
  { value: 'matig',    label: 'Matig'        },
  { value: 'heftig',   label: 'Heftig'       },
  { value: 'onbekend', label: 'Onbekend'     },
];

const STATUS_LABEL_SHORT = {
  gepland: 'Gepland',
  geprobeerd: 'Geprobeerd',
  vermijden: 'Vermijden',
};

/**
 * Open de allergen manager.
 * @param {object} opts
 * @param {string} opts.childId
 * @param {string} opts.childName
 * @returns {Promise<void>}
 */
export function openAllergenManager({ childId, childName }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay eh-allergen-overlay';
    overlay.innerHTML = `
      <div class="modal eh-allergen-modal">
        <header class="eh-allergen-header">
          <h2>Allergenen</h2>
          <p class="eh-allergen-sub">
            Voor ${escapeHtml(childName || '')} —
            houd hier bij wat geprobeerd is en hoe ${escapeHtml(childName || 'je kindje')} reageerde.
          </p>
        </header>

        <div class="eh-allergen-list" data-list>
          <div class="eh-allergen-loading">Even laden…</div>
        </div>

        <footer class="eh-allergen-actions">
          <button class="btn btn-primary" data-action="close">Klaar</button>
        </footer>
      </div>
    `;
    document.body.appendChild(overlay);

    const listEl = overlay.querySelector('[data-list]');

    // Per-allergen state (huidige rij in DB) — keyed by allergen_key
    const byKey = {};

    init();

    async function init() {
      const { ok, data, error } = await getAllergensForChild(childId);
      if (!ok) {
        listEl.innerHTML = `<div class="eh-allergen-error">${escapeHtml(error || 'Kon allergenen niet laden.')}</div>`;
        return;
      }
      (data.allergens || []).forEach(a => { byKey[a.allergen_key] = a; });
      renderList();
    }

    function renderList() {
      listEl.innerHTML = ALLERGENS.map(key => {
        const cur = byKey[key];
        return `
          <div class="eh-allergen-row" data-row="${key}">
            <button class="eh-allergen-row-head" data-toggle="${key}" type="button">
              <span class="eh-allergen-name">${escapeHtml(capitalize(key))}</span>
              <span class="eh-allergen-status-pill ${cur ? 'eh-allergen-status-' + cur.status : 'eh-allergen-status-empty'}">
                ${cur ? escapeHtml(STATUS_LABEL_SHORT[cur.status]) : '—'}
                ${cur && cur.reaction && cur.reaction !== 'geen' && cur.reaction !== 'onbekend'
                    ? ` · ${escapeHtml(cur.reaction)}`
                    : ''}
              </span>
              <span class="eh-allergen-chevron" aria-hidden="true">▾</span>
            </button>
            <div class="eh-allergen-row-body hidden" data-body="${key}"></div>
          </div>
        `;
      }).join('');

      // Bind toggle
      listEl.querySelectorAll('.eh-allergen-row-head').forEach(head => {
        head.addEventListener('click', () => {
          const key = head.dataset.toggle;
          toggleRow(key);
        });
      });
    }

    function toggleRow(key) {
      const body = listEl.querySelector(`[data-body="${key}"]`);
      const isOpen = !body.classList.contains('hidden');
      // Sluit alle andere
      listEl.querySelectorAll('.eh-allergen-row-body').forEach(b => b.classList.add('hidden'));
      listEl.querySelectorAll('.eh-allergen-row').forEach(r => r.classList.remove('open'));
      if (isOpen) return; // was open → toggle dicht
      body.classList.remove('hidden');
      body.parentElement.classList.add('open');
      renderRowBody(key, body);
    }

    function renderRowBody(key, body) {
      const cur = byKey[key];
      const status = cur?.status || '';
      const reaction = cur?.reaction || '';
      const date = cur?.intro_date || '';
      const notes = cur?.notes || '';

      body.innerHTML = `
        <div class="eh-allergen-edit">
          <div class="eh-allergen-field">
            <label>Status</label>
            <div class="eh-allergen-chips" data-group="status">
              ${STATUSES.map(s => `
                <button type="button" class="eh-allergen-chip ${s.value === status ? 'selected' : ''}" data-value="${s.value}">
                  ${escapeHtml(s.label)}
                </button>
              `).join('')}
            </div>
          </div>

          <div class="eh-allergen-field eh-allergen-reaction-field ${status === 'geprobeerd' ? '' : 'hidden'}">
            <label>Reactie</label>
            <div class="eh-allergen-chips" data-group="reaction">
              ${REACTIONS.map(r => `
                <button type="button" class="eh-allergen-chip ${r.value === reaction ? 'selected' : ''}" data-value="${r.value}">
                  ${escapeHtml(r.label)}
                </button>
              `).join('')}
            </div>
          </div>

          <div class="eh-allergen-field eh-allergen-date-field ${status === 'geprobeerd' ? '' : 'hidden'}">
            <label for="eh-al-date-${key}">Datum eerste introductie</label>
            <input type="date" id="eh-al-date-${key}" class="auth-input" value="${escapeHtml(date)}" max="${todayStr()}">
          </div>

          <div class="eh-allergen-field">
            <label for="eh-al-notes-${key}">Notitie <span class="eh-allergen-optional">(optioneel)</span></label>
            <textarea id="eh-al-notes-${key}" class="auth-input eh-allergen-textarea" rows="2" maxlength="500" placeholder="bv. eerste keer klein stukje brood, geen bijzonderheden">${escapeHtml(notes)}</textarea>
          </div>

          <div class="eh-allergen-row-error hidden" data-row-error></div>

          <div class="eh-allergen-row-actions">
            ${cur ? '<button class="eh-allergen-link-btn" data-action="clear">Verwijderen</button>' : ''}
            <button class="btn btn-primary" data-action="save">Opslaan</button>
          </div>
        </div>
      `;

      // Local edit state
      const local = { status, reaction, date, notes };

      // Status-chips
      body.querySelector('[data-group="status"]').addEventListener('click', (e) => {
        const btn = e.target.closest('.eh-allergen-chip');
        if (!btn) return;
        body.querySelectorAll('[data-group="status"] .eh-allergen-chip').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        local.status = btn.dataset.value;
        // toon/verberg reactie + datum
        body.querySelector('.eh-allergen-reaction-field').classList.toggle('hidden', local.status !== 'geprobeerd');
        body.querySelector('.eh-allergen-date-field').classList.toggle('hidden', local.status !== 'geprobeerd');
      });

      // Reactie-chips
      body.querySelector('[data-group="reaction"]').addEventListener('click', (e) => {
        const btn = e.target.closest('.eh-allergen-chip');
        if (!btn) return;
        const wasSel = btn.classList.contains('selected');
        body.querySelectorAll('[data-group="reaction"] .eh-allergen-chip').forEach(b => b.classList.remove('selected'));
        if (!wasSel) {
          btn.classList.add('selected');
          local.reaction = btn.dataset.value;
        } else {
          local.reaction = '';
        }
      });

      const errorEl = body.querySelector('[data-row-error]');
      const showRowError = (msg) => { errorEl.textContent = msg; errorEl.classList.remove('hidden'); };
      const clearRowError = () => errorEl.classList.add('hidden');

      // Save
      body.querySelector('[data-action="save"]').addEventListener('click', async () => {
        clearRowError();
        if (!local.status) return showRowError('Kies een status.');

        const dateInput = body.querySelector(`#eh-al-date-${key}`);
        local.date = dateInput.value || '';
        local.notes = body.querySelector(`#eh-al-notes-${key}`).value.trim();

        const buttons = body.querySelectorAll('button');
        buttons.forEach(b => b.disabled = true);

        const payload = {
          child_id: childId,
          allergen_key: key,
          status: local.status,
          reaction: local.status === 'geprobeerd' ? (local.reaction || null) : null,
          intro_date: local.status === 'geprobeerd' ? (local.date || null) : null,
          notes: local.notes || null,
        };

        const { ok, data, error } = await upsertAllergen(payload);
        buttons.forEach(b => b.disabled = false);

        if (!ok) return showRowError(error || 'Opslaan mislukt.');

        byKey[key] = data.allergen;
        showToast(`${capitalize(key)} bijgewerkt.`, 'success');
        renderList();
      });

      // Verwijderen
      const clearBtn = body.querySelector('[data-action="clear"]');
      if (clearBtn) {
        clearBtn.addEventListener('click', async () => {
          if (!cur) return;
          if (!window.confirm(`Allergeen "${capitalize(key)}" verwijderen?`)) return;
          clearRowError();
          const buttons = body.querySelectorAll('button');
          buttons.forEach(b => b.disabled = true);
          const { ok, error } = await deleteAllergen(cur.id);
          if (!ok) {
            buttons.forEach(b => b.disabled = false);
            return showRowError(error || 'Verwijderen mislukt.');
          }
          delete byKey[key];
          showToast(`${capitalize(key)} verwijderd.`, 'success');
          renderList();
        });
      }
    }

    overlay.querySelector('[data-action="close"]').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape' && document.body.contains(overlay)) {
        document.removeEventListener('keydown', escHandler);
        close();
      }
    });

    function close() {
      overlay.remove();
      resolve();
    }
  });
}

function capitalize(s) {
  if (!s) return '';
  return s[0].toUpperCase() + s.slice(1);
}

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
