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

import { escapeHtml, ALLERGENS, showToast } from '../utils.js?v=2.19.0';
import {
  getAllergensForChild,
  getAllergenIntros,
  deleteAllergenIntro,
} from '../eersteHapjesApi.js?v=2.19.0';
import {
  deriveAllergenState,
  statusLabel,
  statusTone,
  openAllergenIntroModal,
} from './allergenIntroModal.js?v=2.19.0';

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
      // Inline tijdlijn van intros + één "+ Intro registreren"-knop.
      // Geen vermijden-toggle, geen notes, geen "verwijder uit lijst"-knop —
      // bewust schoon gehouden (gebruiker-feedback).
      renderInlineTimeline(key, body);
    }

    function renderInlineTimeline(key, body) {
      const intros = introsByKey[key] || [];
      const safeKey = cssEscape(key);
      const list = intros.length === 0
        ? `<div class="eh-allergen-inline-empty">Nog geen intro-pogingen voor ${escapeHtml(capitalize(key))}.</div>`
        : `<ul class="eh-allergen-inline-list">
            ${intros.map((i) => renderInlineIntroItem(i)).join('')}
          </ul>`;

      body.innerHTML = `
        <div class="eh-allergen-edit">
          ${list}
          <div class="eh-allergen-row-actions">
            <button class="btn btn-primary btn-small" data-action="intro">+ Intro registreren</button>
          </div>
        </div>
      `;

      // Delete-knoppen per intro
      body.querySelectorAll('[data-del-intro]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.delIntro;
          if (!window.confirm('Deze intro-poging verwijderen?')) return;
          btn.disabled = true;
          const { ok, error } = await deleteAllergenIntro(id);
          if (!ok) {
            btn.disabled = false;
            showToast(error || 'Verwijderen mislukt.', 'error');
            return;
          }
          await reloadIntros(key);
          changedAny = true;
          renderList();
          // Re-open dezelfde rij na herrender
          const reopenBody = listEl.querySelector(`[data-body="${safeKey}"]`);
          if (reopenBody) {
            reopenBody.classList.remove('hidden');
            reopenBody.parentElement?.classList.add('open');
            renderRowBody(key, reopenBody);
          }
        });
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
          const reopenBody = listEl.querySelector(`[data-body="${safeKey}"]`);
          if (reopenBody) {
            reopenBody.classList.remove('hidden');
            reopenBody.parentElement?.classList.add('open');
            renderRowBody(key, reopenBody);
          }
        }
      });
    }

    function renderInlineIntroItem(i) {
      const reactionMap = {
        geen: 'Geen reactie',
        mild: 'Mild',
        matig: 'Matig',
        heftig: 'Heftig',
        onbekend: 'Onbekend',
      };
      const reactionLabel = reactionMap[i.reaction] || i.reaction || 'Geen reactie';
      const tone = (i.reaction === 'matig' || i.reaction === 'heftig') ? 'warn'
                 : i.reaction === 'mild' ? 'soft'
                 : 'ok';
      return `
        <li class="eh-allergen-inline-item">
          <div class="eh-allergen-inline-main">
            <div class="eh-allergen-inline-date">${formatIntroDate(i.intro_date)}</div>
            <div class="eh-allergen-inline-reaction eh-tone-${tone}">${escapeHtml(reactionLabel)}</div>
            ${i.notes ? `<div class="eh-allergen-inline-notes">${escapeHtml(i.notes)}</div>` : ''}
          </div>
          <button class="eh-allergen-inline-del" data-del-intro="${escapeHtml(i.id)}" type="button" aria-label="Verwijderen">×</button>
        </li>
      `;
    }

    function formatIntroDate(iso) {
      if (!iso) return '—';
      const d = new Date(iso + 'T00:00:00Z');
      if (Number.isNaN(d.getTime())) return iso;
      const today = new Date(); today.setUTCHours(0, 0, 0, 0);
      const days = Math.round((today.getTime() - d.getTime()) / (24 * 60 * 60 * 1000));
      if (days === 0) return 'Vandaag';
      if (days === 1) return 'Gisteren';
      if (days < 7) return `${days} dagen geleden`;
      return d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' });
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
