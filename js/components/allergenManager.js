/* ============================================
   EERSTE HAPJES — ALLERGEN MANAGER (brok D + brok H.3)
   Modal met alle 13 allergenen uit de vocabulaire.
   Per rij: afgeleide status-pill + voortgangsbalk N/3
   (uit allergen_intro_logs). Body bevat:
     - "Bekijk tijdlijn" + "+ Intro registreren" knoppen
     - "Markeer als vermijden"-toggle
     - Notitie
     - Verwijderen uit lijst
   Reactie/datum zijn verschoven naar intro-modal (brok H.3).
============================================ */

import { escapeHtml, ALLERGENS, showToast } from '../utils.js?v=2.9.0';
import {
  getAllergensForChild,
  upsertAllergen,
  deleteAllergen,
  getAllergenIntros,
} from '../eersteHapjesApi.js?v=2.9.0';
import {
  deriveAllergenState,
  statusLabel,
  statusTone,
  openAllergenTimelineModal,
  openAllergenIntroModal,
} from './allergenIntroModal.js?v=2.9.0';

/**
 * Open de allergen manager.
 * @param {object} opts
 * @param {string} opts.childId
 * @param {string} opts.childName
 * @returns {Promise<{changed: boolean}>}
 */
export function openAllergenManager({ childId, childName }) {
  return new Promise((resolve) => {
    let changedAny = false;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay eh-allergen-overlay';
    overlay.innerHTML = `
      <div class="modal eh-allergen-modal">
        <header class="eh-allergen-header">
          <h2>Allergenen</h2>
          <p class="eh-allergen-sub">
            Voor ${escapeHtml(childName || '')} — registreer per allergeen elke intro-poging.
            Drie keer zonder reactie = veilig.
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

    // Per-allergen state — keyed by allergen_key
    const byKey = {};        // child_allergens-rij (mag null zijn)
    const introsByKey = {};  // array van intro-logs per allergen_key

    init();

    async function init() {
      const [allergensRes, introsRes] = await Promise.all([
        getAllergensForChild(childId),
        getAllergenIntros(childId),
      ]);

      if (!allergensRes.ok) {
        listEl.innerHTML = `<div class="eh-allergen-error">${escapeHtml(allergensRes.error || 'Kon allergenen niet laden.')}</div>`;
        return;
      }
      (allergensRes.data?.allergens || []).forEach((a) => { byKey[a.allergen_key] = a; });

      if (introsRes.ok) {
        (introsRes.data?.intros || []).forEach((i) => {
          if (!introsByKey[i.allergen_key]) introsByKey[i.allergen_key] = [];
          introsByKey[i.allergen_key].push(i);
        });
      }

      renderList();
    }

    async function reloadIntros(key) {
      const { ok, data } = await getAllergenIntros(childId, { allergenKey: key });
      if (ok) introsByKey[key] = data?.intros || [];
    }

    function renderList() {
      listEl.innerHTML = ALLERGENS.map((key) => renderRow(key)).join('');

      listEl.querySelectorAll('.eh-allergen-row-head').forEach((head) => {
        head.addEventListener('click', () => toggleRow(head.dataset.toggle));
      });
    }

    function renderRow(key) {
      const cur = byKey[key];
      const intros = introsByKey[key] || [];
      const state = deriveAllergenState(cur, intros);
      const showProgress = state.status === 'probeer-opnieuw' || state.status === 'veilig';
      const pct = Math.min(100, Math.round((state.successfulCount / state.target) * 100));

      return `
        <div class="eh-allergen-row" data-row="${escapeHtml(key)}">
          <button class="eh-allergen-row-head" data-toggle="${escapeHtml(key)}" type="button">
            <span class="eh-allergen-name">${escapeHtml(capitalize(key))}</span>
            <span class="eh-allergen-status-pill eh-tone-${escapeHtml(statusTone(state.status))}">
              ${escapeHtml(statusLabel(state.status))}
              ${showProgress ? ` · ${state.successfulCount}/${state.target}` : ''}
            </span>
            <span class="eh-allergen-chevron" aria-hidden="true">▾</span>
          </button>
          ${showProgress ? `
            <div class="eh-allergen-progress">
              <div class="eh-allergen-progress-fill eh-tone-${escapeHtml(statusTone(state.status))}" style="width:${pct}%"></div>
            </div>
          ` : ''}
          <div class="eh-allergen-row-body hidden" data-body="${escapeHtml(key)}"></div>
        </div>
      `;
    }

    function toggleRow(key) {
      const safeKey = cssEscape(key);
      const body = listEl.querySelector(`[data-body="${safeKey}"]`);
      if (!body) return;
      const isOpen = !body.classList.contains('hidden');
      listEl.querySelectorAll('.eh-allergen-row-body').forEach((b) => b.classList.add('hidden'));
      listEl.querySelectorAll('.eh-allergen-row').forEach((r) => r.classList.remove('open'));
      if (isOpen) return;
      body.classList.remove('hidden');
      body.parentElement.classList.add('open');
      renderRowBody(key, body);
    }

    function renderRowBody(key, body) {
      const cur = byKey[key];
      const intros = introsByKey[key] || [];
      const isAvoid = cur?.status === 'vermijden';
      const notes = cur?.notes || '';
      const safeKey = cssEscape(key);

      body.innerHTML = `
        <div class="eh-allergen-edit">
          <div class="eh-allergen-edit-quick">
            <button class="btn btn-secondary btn-small" data-action="timeline">
              Bekijk tijdlijn ${intros.length ? `(${intros.length})` : ''}
            </button>
            <button class="btn btn-primary btn-small" data-action="intro">+ Intro registreren</button>
          </div>

          <label class="eh-allergen-avoid-toggle">
            <input type="checkbox" data-field="avoid" ${isAvoid ? 'checked' : ''}>
            <span>Markeer als vermijden (allergie bevestigd of familie-historie)</span>
          </label>

          <div class="eh-allergen-field">
            <label for="eh-al-notes-${safeKey}">Notitie <span class="eh-allergen-optional">(optioneel)</span></label>
            <textarea id="eh-al-notes-${safeKey}" class="auth-input eh-allergen-textarea" rows="2" maxlength="500" placeholder="bv. enkel kleine porties geven, altijd in combinatie met groente">${escapeHtml(notes)}</textarea>
          </div>

          <div class="eh-allergen-row-error hidden" data-row-error></div>

          <div class="eh-allergen-row-actions">
            ${cur ? '<button class="eh-allergen-link-btn" data-action="clear">Verwijder uit lijst</button>' : ''}
            <button class="btn btn-primary" data-action="save">Opslaan</button>
          </div>
        </div>
      `;

      body.querySelector('[data-action="timeline"]').addEventListener('click', async () => {
        const result = await openAllergenTimelineModal({
          childId,
          allergenKey: key,
          allergenLabel: capitalize(key),
          allergen: byKey[key] || null,
        });
        if (result?.changed) {
          changedAny = true;
          await reloadIntros(key);
          renderList();
        }
      });

      body.querySelector('[data-action="intro"]').addEventListener('click', async () => {
        const result = await openAllergenIntroModal({
          childId,
          allergenKey: key,
          allergenLabel: capitalize(key),
        });
        if (result?.created) {
          changedAny = true;
          await reloadIntros(key);
          renderList();
        }
      });

      const errorEl = body.querySelector('[data-row-error]');
      const showRowError = (msg) => { errorEl.textContent = msg; errorEl.classList.remove('hidden'); };
      const clearRowError = () => errorEl.classList.add('hidden');

      body.querySelector('[data-action="save"]').addEventListener('click', async () => {
        clearRowError();
        const avoid = body.querySelector('[data-field="avoid"]').checked;
        const notesVal = body.querySelector(`#eh-al-notes-${safeKey}`).value.trim();

        const buttons = body.querySelectorAll('button');
        buttons.forEach((b) => (b.disabled = true));

        const payload = {
          child_id: childId,
          allergen_key: key,
          status: avoid ? 'vermijden' : 'gepland',
          reaction: null,
          intro_date: null,
          notes: notesVal || null,
        };

        const { ok, data, error } = await upsertAllergen(payload);
        buttons.forEach((b) => (b.disabled = false));

        if (!ok) return showRowError(error || 'Opslaan mislukt.');

        byKey[key] = data.allergen;
        changedAny = true;
        showToast(`${capitalize(key)} bijgewerkt.`, 'success');
        renderList();
      });

      const clearBtn = body.querySelector('[data-action="clear"]');
      if (clearBtn) {
        clearBtn.addEventListener('click', async () => {
          if (!cur) return;
          if (!window.confirm(`"${capitalize(key)}" uit de lijst verwijderen? De tijdlijn met intro-pogingen blijft staan.`)) return;
          clearRowError();
          const buttons = body.querySelectorAll('button');
          buttons.forEach((b) => (b.disabled = true));
          const { ok, error } = await deleteAllergen(cur.id);
          if (!ok) {
            buttons.forEach((b) => (b.disabled = false));
            return showRowError(error || 'Verwijderen mislukt.');
          }
          delete byKey[key];
          changedAny = true;
          showToast(`${capitalize(key)} verwijderd uit lijst.`, 'success');
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
      resolve({ changed: changedAny });
    }
  });
}

function capitalize(s) {
  if (!s) return '';
  return s[0].toUpperCase() + s.slice(1);
}

// ALLERGENS-keys zijn allemaal a-z (snake_case) — safe pass-through.
function cssEscape(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '');
}
