/* ============================================
   EERSTE HAPJES — ALLERGEEN INTRO + TIMELINE (brok H.3)
   Twee modals + één status-derivation helper in dezelfde file
   (patroon zoals phaseModal.js / articleModal.js):
     - deriveAllergenState(allergen, intros)
     - openAllergenTimelineModal({...}) — lijst van alle intros
     - openAllergenIntroModal({...})    — nieuwe intro registreren

   Allergen-status komt automatisch uit intros:
     - vermijden (handmatig) OF reactie matig/heftig → 'opvolgen'
     - 3+ intros met reactie 'geen' → 'veilig'
     - 1+ intros zonder ernstige reactie → 'probeer-opnieuw' (N/3)
     - 0 intros → 'later'
============================================ */

import { escapeHtml, showToast } from '../utils.js?v=2.15.0';
import { ALLERGEN_INTROS_TARGET } from '../content/eersteHapjes-risk-foods.js?v=2.15.0';
import {
  getAllergenIntros,
  createAllergenIntro,
  deleteAllergenIntro,
} from '../eersteHapjesApi.js?v=2.15.0';

const REACTIONS = [
  { value: 'geen',     label: 'Geen reactie', tone: 'ok'   },
  { value: 'mild',     label: 'Mild',         tone: 'soft' },
  { value: 'matig',    label: 'Matig',        tone: 'warn' },
  { value: 'heftig',   label: 'Heftig',       tone: 'bad'  },
  { value: 'onbekend', label: 'Onbekend',     tone: 'soft' },
];

const STATUS_META = {
  later:           { label: 'Later',          tone: 'neutral' },
  'probeer-opnieuw': { label: 'Probeer opnieuw', tone: 'progress' },
  veilig:          { label: 'Veilig',         tone: 'ok'      },
  opvolgen:        { label: 'Opvolgen',       tone: 'warn'    },
};

/**
 * Bereken afgeleide status op basis van child_allergens-rij + intro-logs.
 * @returns {{ status, introCount, successfulCount, reactedCount, severeReaction, target }}
 */
export function deriveAllergenState(allergen, intros) {
  const list = Array.isArray(intros) ? intros : [];
  const introCount = list.length;
  const successfulCount = list.filter((i) => i.reaction === 'geen').length;
  const reactedCount = list.filter((i) => i.reaction && i.reaction !== 'geen').length;
  const severeReaction = list.some((i) => i.reaction === 'matig' || i.reaction === 'heftig');

  const avoid = allergen?.status === 'vermijden';
  let status;
  if (avoid || severeReaction) status = 'opvolgen';
  else if (successfulCount >= ALLERGEN_INTROS_TARGET) status = 'veilig';
  else if (introCount > 0) status = 'probeer-opnieuw';
  else status = 'later';

  return {
    status,
    introCount,
    successfulCount,
    reactedCount,
    severeReaction,
    target: ALLERGEN_INTROS_TARGET,
    avoidFlagged: avoid,
  };
}

export function statusLabel(status) {
  return STATUS_META[status]?.label || '—';
}

export function statusTone(status) {
  return STATUS_META[status]?.tone || 'neutral';
}

/* ============================================
   TIMELINE MODAL
============================================ */
export function openAllergenTimelineModal({
  childId,
  allergenKey,
  allergenLabel,
  allergen = null,
}) {
  return new Promise((resolve) => {
    let changed = false;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay eh-allergen-intro-overlay';
    overlay.innerHTML = `
      <div class="modal eh-allergen-intro-modal">
        <header class="eh-allergen-intro-head">
          <h2>${escapeHtml(allergenLabel || capitalize(allergenKey))}</h2>
          <p class="eh-allergen-intro-sub">Tijdlijn van introducties en reacties.</p>
        </header>

        <div class="eh-allergen-intro-progress" data-progress>
          <div class="eh-allergen-intro-progress-bar"><div class="eh-allergen-intro-progress-fill" data-progress-fill></div></div>
          <div class="eh-allergen-intro-progress-text" data-progress-text>—</div>
        </div>

        <div class="eh-allergen-intro-list" data-list>
          <div class="eh-allergen-intro-loading">Even laden…</div>
        </div>

        <footer class="eh-allergen-intro-footer">
          <button class="btn btn-secondary" data-action="add">+ Intro registreren</button>
          <button class="btn btn-primary" data-action="close">Klaar</button>
        </footer>
      </div>
    `;
    document.body.appendChild(overlay);

    const listEl = overlay.querySelector('[data-list]');
    const progressFill = overlay.querySelector('[data-progress-fill]');
    const progressText = overlay.querySelector('[data-progress-text]');

    let intros = [];

    refresh();

    async function refresh() {
      const { ok, data, error } = await getAllergenIntros(childId, { allergenKey });
      if (!ok) {
        listEl.innerHTML = `<div class="eh-allergen-intro-error">${escapeHtml(error || 'Kon tijdlijn niet laden.')}</div>`;
        return;
      }
      intros = data?.intros || [];
      renderProgress();
      renderList();
    }

    function renderProgress() {
      const state = deriveAllergenState(allergen, intros);
      const pct = Math.min(100, Math.round((state.successfulCount / state.target) * 100));
      progressFill.style.width = pct + '%';
      progressFill.dataset.tone = statusTone(state.status);

      let text;
      if (state.status === 'veilig') {
        text = `${state.successfulCount}/${state.target} — Veilig ✓`;
      } else if (state.status === 'opvolgen') {
        text = state.severeReaction
          ? 'Reactie genoteerd — overleg met je arts'
          : 'Gemarkeerd als vermijden';
      } else if (state.status === 'probeer-opnieuw') {
        const remain = state.target - state.successfulCount;
        text = `${state.successfulCount}/${state.target} — nog ${remain} intro${remain === 1 ? '' : "'s"} zonder reactie nodig`;
      } else {
        text = 'Nog niet geïntroduceerd.';
      }
      progressText.textContent = text;
    }

    function renderList() {
      if (intros.length === 0) {
        listEl.innerHTML = `<div class="eh-allergen-intro-empty">Nog geen intro's geregistreerd voor dit allergeen.</div>`;
        return;
      }
      listEl.innerHTML = intros.map((i) => {
        const reactionMeta = REACTIONS.find((r) => r.value === i.reaction) || REACTIONS[0];
        return `
          <div class="eh-allergen-intro-item" data-id="${escapeHtml(i.id)}">
            <div class="eh-allergen-intro-item-main">
              <div class="eh-allergen-intro-item-date">${formatDate(i.intro_date)}</div>
              <div class="eh-allergen-intro-item-reaction eh-tone-${reactionMeta.tone}">
                ${escapeHtml(reactionMeta.label)}
              </div>
              ${i.notes ? `<div class="eh-allergen-intro-item-notes">${escapeHtml(i.notes)}</div>` : ''}
            </div>
            <button class="eh-allergen-intro-item-del" data-del="${escapeHtml(i.id)}" type="button" aria-label="Verwijderen">×</button>
          </div>
        `;
      }).join('');

      listEl.querySelectorAll('[data-del]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.del;
          if (!window.confirm('Deze intro-poging verwijderen?')) return;
          btn.disabled = true;
          const { ok, error } = await deleteAllergenIntro(id);
          if (!ok) {
            btn.disabled = false;
            return showToast(error || 'Verwijderen mislukt.', 'error');
          }
          changed = true;
          showToast('Verwijderd.', 'success');
          await refresh();
        });
      });
    }

    overlay.querySelector('[data-action="add"]').addEventListener('click', async () => {
      const result = await openAllergenIntroModal({
        childId, allergenKey, allergenLabel,
      });
      if (result?.created) {
        changed = true;
        await refresh();
      }
    });

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
      resolve({ changed });
    }
  });
}

/* ============================================
   INTRO REGISTRATION MODAL
============================================ */
export function openAllergenIntroModal({
  childId,
  allergenKey,
  allergenLabel,
  defaults = {},
}) {
  return new Promise((resolve) => {
    const today = todayStr();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay eh-allergen-intro-overlay';
    overlay.innerHTML = `
      <div class="modal eh-allergen-intro-modal eh-allergen-intro-form">
        <header class="eh-allergen-intro-head">
          <h2>Intro registreren — ${escapeHtml(allergenLabel || capitalize(allergenKey))}</h2>
          <p class="eh-allergen-intro-sub">Drie keer zonder reactie? Dan staat dit allergeen op "Veilig".</p>
        </header>

        <div class="eh-allergen-intro-fields">
          <div class="eh-allergen-intro-field">
            <label for="eh-intro-date">Datum</label>
            <input type="date" id="eh-intro-date" class="auth-input" max="${today}" value="${defaults.date || today}">
          </div>

          <div class="eh-allergen-intro-field">
            <label>Reactie</label>
            <div class="eh-allergen-intro-chips" data-group="reaction">
              ${REACTIONS.map((r) => `
                <button type="button" class="eh-allergen-intro-chip eh-tone-${r.tone} ${r.value === (defaults.reaction || 'geen') ? 'selected' : ''}" data-value="${r.value}">
                  ${escapeHtml(r.label)}
                </button>
              `).join('')}
            </div>
          </div>

          <div class="eh-allergen-intro-field">
            <label for="eh-intro-notes">Notitie <span class="eh-allergen-intro-optional">(optioneel)</span></label>
            <textarea id="eh-intro-notes" class="auth-input eh-allergen-intro-textarea" rows="3" maxlength="500" placeholder="bv. klein stukje brood bij ontbijt, geen bijzonderheden">${escapeHtml(defaults.notes || '')}</textarea>
          </div>

          <div class="eh-allergen-intro-error hidden" data-error></div>
        </div>

        <footer class="eh-allergen-intro-footer">
          <button class="btn btn-secondary" data-action="cancel">Annuleer</button>
          <button class="btn btn-primary" data-action="save">Opslaan</button>
        </footer>
      </div>
    `;
    document.body.appendChild(overlay);

    let reaction = defaults.reaction || 'geen';

    overlay.querySelector('[data-group="reaction"]').addEventListener('click', (e) => {
      const btn = e.target.closest('.eh-allergen-intro-chip');
      if (!btn) return;
      overlay.querySelectorAll('[data-group="reaction"] .eh-allergen-intro-chip').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      reaction = btn.dataset.value;
    });

    const errorEl = overlay.querySelector('[data-error]');

    overlay.querySelector('[data-action="save"]').addEventListener('click', async () => {
      errorEl.classList.add('hidden');
      const date = overlay.querySelector('#eh-intro-date').value || today;
      const notes = overlay.querySelector('#eh-intro-notes').value.trim();

      overlay.querySelectorAll('button').forEach((b) => (b.disabled = true));

      const { ok, data, error } = await createAllergenIntro({
        child_id: childId,
        allergen_key: allergenKey,
        intro_date: date,
        reaction,
        notes: notes || null,
        meal_log_id: defaults.mealLogId || null,
      });

      if (!ok) {
        overlay.querySelectorAll('button').forEach((b) => (b.disabled = false));
        errorEl.textContent = error || 'Opslaan mislukt.';
        errorEl.classList.remove('hidden');
        return;
      }

      showToast('Intro geregistreerd.', 'success');
      close({ created: true, intro: data?.intro });
    });

    overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => close({ created: false }));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close({ created: false }); });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape' && document.body.contains(overlay)) {
        document.removeEventListener('keydown', escHandler);
        close({ created: false });
      }
    });

    function close(result) {
      overlay.remove();
      resolve(result);
    }
  });
}

/* ============================================
   helpers
============================================ */
function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return iso;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - d.getTime()) / (24 * 60 * 60 * 1000));
  if (days === 0) return 'Vandaag';
  if (days === 1) return 'Gisteren';
  if (days < 7) return `${days} dagen geleden`;
  return d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' });
}

function capitalize(s) {
  if (!s) return '';
  return s[0].toUpperCase() + s.slice(1);
}
