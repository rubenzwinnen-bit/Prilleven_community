/* ============================================
   EERSTE HAPJES — FASEN MODAL (brok F.4)
   Twee weergaven in één bestand:
   - openPhaseDetailModal({ child, phaseState }) — toont huidige fase
     met afvinkbare checklist + advance-knop.
   - openPhaseOverviewModal({ child, phaseState }) — toont alle 6 fases
     als kaartjes (locked / active / completed). Klik op een actieve
     fase opent de detail-weergave.

   Banner-render-helper (renderPhaseBanner) wordt gebruikt in
   eersteHapjes.js zonder modal te openen.
============================================ */

import { escapeHtml, showToast } from '../utils.js?v=2.20.0';
import { PHASES, getPhase } from '../content/eersteHapjes-phases.js?v=2.20.0';
import { togglePhaseCheck, advancePhase, getPhases } from '../eersteHapjesApi.js?v=2.20.0';

// ============================================================
// Banner — geen modal, gewoon HTML voor inline-render in Vandaag
// ============================================================

/**
 * Sticky banner bovenaan Vandaag. Klik opent detail-modal.
 * @param {object} phaseState — antwoord van GET /phases
 */
export function renderPhaseBanner(phaseState) {
  if (!phaseState) return '';
  const activeNumber = phaseState.activePhase;
  if (activeNumber === null || activeNumber === undefined) return '';

  const def = getPhase(activeNumber);
  if (!def) return '';

  const checks = phaseState.checks?.[activeNumber] || {};
  const total = def.checks.length;
  const done  = total === 0 ? 0 : Object.keys(checks).length;

  const isEnd = activeNumber === 5;
  const progressLabel = isEnd
    ? 'Volledig basisritme — geen volgende fase meer.'
    : `${done} van ${total} mijlpalen — geen haast`;

  const fillPct = total === 0 ? 100 : Math.round((done / total) * 100);

  return `
    <button
      class="eh-phase-banner"
      data-action="open-phase-detail"
      type="button"
      aria-label="Open fase-details"
    >
      <div class="eh-phase-banner-head">
        <span class="eh-phase-label">Fase ${activeNumber} · Actief</span>
        <span class="eh-phase-name">${escapeHtml(def.name)}</span>
      </div>
      <p class="eh-phase-desc">${escapeHtml(def.intro)}</p>
      <div class="eh-phase-progress" aria-hidden="true">
        <div class="eh-phase-progress-fill" style="width:${fillPct}%"></div>
      </div>
      <div class="eh-phase-progress-label">${escapeHtml(progressLabel)}</div>
    </button>
  `;
}

// ============================================================
// Detail modal — huidige fase
// ============================================================

/**
 * @param {object} opts
 * @param {object} opts.child — kindje-row
 * @param {object} opts.phaseState
 * @returns {Promise<{changed: boolean}>} resolves bij sluiten
 */
export function openPhaseDetailModal({ child, phaseState }) {
  return openModal({ child, phaseState, view: 'detail' });
}

// ============================================================
// Overzicht modal — alle 6 fases
// ============================================================

export function openPhaseOverviewModal({ child, phaseState }) {
  return openModal({ child, phaseState, view: 'overview' });
}

// ============================================================
// Modal-shell met state
// ============================================================
function openModal(initial) {
  return new Promise((resolve) => {
    let state = { ...initial, changed: false };

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay eh-phase-overlay';
    overlay.innerHTML = `
      <div class="modal eh-phase-modal" data-content-host>
        ${render(state)}
      </div>
    `;
    document.body.appendChild(overlay);

    const host = overlay.querySelector('[data-content-host]');

    function rerender() {
      host.innerHTML = render(state);
      host.scrollTop = 0;
      bind();
    }

    async function reloadState() {
      const { ok, data } = await getPhases(state.child.id);
      if (ok) state.phaseState = data;
    }

    function bind() {
      const closeBtn = host.querySelector('[data-action="close"]');
      if (closeBtn) closeBtn.addEventListener('click', close);

      const backBtn = host.querySelector('[data-action="back-to-overview"]');
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          state.view = 'overview';
          rerender();
        });
      }

      const toOverviewBtn = host.querySelector('[data-action="open-overview"]');
      if (toOverviewBtn) {
        toOverviewBtn.addEventListener('click', () => {
          state.view = 'overview';
          rerender();
        });
      }

      // In overzicht: klik op actieve kaart → detail
      host.querySelectorAll('[data-open-phase]').forEach((btn) => {
        btn.addEventListener('click', () => {
          state.view = 'detail';
          rerender();
        });
      });

      // Checklist toggle — optimistic update (geen wait op API).
      host.querySelectorAll('[data-check-key]').forEach((cb) => {
        cb.addEventListener('change', () => {
          const key = cb.dataset.checkKey;
          const phaseNumber = Number(cb.dataset.phaseNumber);
          const checked = cb.checked;

          // 1. Lokale state direct muteren zodat advance-knop e.d.
          //    onmiddellijk reageren op de nieuwe stand.
          if (!state.phaseState) state.phaseState = { checks: {} };
          if (!state.phaseState.checks) state.phaseState.checks = {};
          if (!state.phaseState.checks[phaseNumber]) state.phaseState.checks[phaseNumber] = {};
          const phaseChecks = state.phaseState.checks[phaseNumber];
          if (checked) {
            phaseChecks[key] = new Date().toISOString();
          } else {
            delete phaseChecks[key];
          }
          state.changed = true;

          // 2. Direct re-renderen — geen network-wait.
          rerender();

          // 3. API call in achtergrond. Bij fail: revert + toast + re-render.
          togglePhaseCheck({
            child_id: state.child.id,
            phase_number: phaseNumber,
            check_key: key,
            checked,
          }).then(({ ok, error }) => {
            if (ok) return;
            // Rollback
            if (checked) {
              delete phaseChecks[key];
            } else {
              phaseChecks[key] = new Date().toISOString();
            }
            showToast(error || 'Aanvinken mislukt.', 'error');
            rerender();
          }).catch((err) => {
            console.error('[phase-check]', err);
            // Idem rollback
            if (checked) {
              delete phaseChecks[key];
            } else {
              phaseChecks[key] = new Date().toISOString();
            }
            showToast('Netwerkfout — probeer opnieuw.', 'error');
            rerender();
          });
        });
      });

      // Advance
      const advBtn = host.querySelector('[data-action="advance"]');
      if (advBtn) {
        advBtn.addEventListener('click', async () => {
          const fromPhase = Number(advBtn.dataset.fromPhase);
          advBtn.disabled = true;
          const { ok, error } = await advancePhase({
            child_id: state.child.id,
            from_phase: fromPhase,
          });
          if (!ok) {
            showToast(error || 'Doorzetten mislukt.', 'error');
            advBtn.disabled = false;
            return;
          }
          showToast(`Fase ${fromPhase + 1} ontgrendeld.`, 'success');
          state.changed = true;
          await reloadState();
          rerender();
        });
      }
    }

    bind();

    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape' && document.body.contains(overlay)) {
        document.removeEventListener('keydown', escHandler);
        close();
      }
    });

    function close() {
      overlay.remove();
      resolve({ changed: state.changed });
    }
  });
}

// ============================================================
// Renderers
// ============================================================
function render(state) {
  if (state.view === 'detail') return renderDetail(state);
  return renderOverview(state);
}

function renderDetail(state) {
  const ps = state.phaseState;
  const activeNumber = ps?.activePhase;
  if (activeNumber === null || activeNumber === undefined) {
    return `
      <header class="eh-phase-header">
        <h2>Fasen</h2>
      </header>
      <div class="eh-phase-empty">
        <p>Geen actieve fase. Open het overzicht om alle fases te zien.</p>
      </div>
      <footer class="eh-phase-actions">
        <button class="btn btn-secondary" data-action="open-overview">Overzicht</button>
        <button class="btn btn-primary" data-action="close">Sluiten</button>
      </footer>
    `;
  }

  const def = getPhase(activeNumber);
  const checks = ps.checks?.[activeNumber] || {};
  const total = def.checks.length;
  const done  = total === 0 ? 0 : Object.keys(checks).length;
  const allDone = total === 0 || done >= total;

  const ageMonths = ps.ageMonths;
  const nextDef = getPhase(activeNumber + 1);
  const ageOk = !nextDef || ageMonths >= nextDef.minAgeMonths;

  let advanceBlock = '';
  if (def.advanceLabel) {
    if (allDone) {
      const disabled = !ageOk;
      const subtitle = disabled
        ? `Ten vroegste vanaf ${nextDef.minAgeMonths} maanden — geen haast.`
        : `Klaar om door te gaan? Je kindje bepaalt nog steeds het tempo.`;
      advanceBlock = `
        <div class="eh-phase-advance">
          <p class="eh-phase-advance-sub">${escapeHtml(subtitle)}</p>
          <button
            class="btn btn-primary eh-phase-advance-btn"
            data-action="advance"
            data-from-phase="${activeNumber}"
            ${disabled ? 'disabled' : ''}
          >${escapeHtml(def.advanceLabel)}</button>
        </div>
      `;
    } else {
      advanceBlock = `
        <p class="eh-phase-advance-hint">
          Vink alle ${total} mijlpalen aan om door te kunnen naar de volgende fase.
        </p>
      `;
    }
  } else if (activeNumber === 5) {
    advanceBlock = `
      <div class="eh-phase-end">
        <p>Dit is de eindfase. Vanaf hier verbreed en verfijn je het basisritme.</p>
      </div>
    `;
  }

  const checklistBlock = total === 0 ? '' : `
    <div class="eh-phase-checks">
      ${def.checks.map((c) => {
        const isChecked = !!checks[c.key];
        return `
          <label class="eh-phase-check ${isChecked ? 'is-checked' : ''}">
            <input
              type="checkbox"
              data-check-key="${escapeHtml(c.key)}"
              data-phase-number="${activeNumber}"
              ${isChecked ? 'checked' : ''}
            />
            <span class="eh-phase-check-box" aria-hidden="true"></span>
            <span class="eh-phase-check-label">${escapeHtml(c.label)}</span>
          </label>
        `;
      }).join('')}
    </div>
  `;

  const progressLabel = total === 0
    ? 'Eindfase'
    : `${done} van ${total} mijlpalen — geen haast`;
  const fillPct = total === 0 ? 100 : Math.round((done / total) * 100);

  return `
    <header class="eh-phase-header">
      <button class="eh-phase-back" data-action="back-to-overview" aria-label="Terug naar overzicht">‹ Mijn fasen</button>
      <div class="eh-phase-pill">Fase ${activeNumber} · Actief</div>
      <h2>${escapeHtml(def.name)}</h2>
      <p class="eh-phase-sub">${escapeHtml(def.label)}</p>
    </header>

    <div class="eh-phase-body">
      <p class="eh-phase-intro">${escapeHtml(def.intro)}</p>

      <div class="eh-phase-progress eh-phase-progress--lg" aria-hidden="true">
        <div class="eh-phase-progress-fill" style="width:${fillPct}%"></div>
      </div>
      <div class="eh-phase-progress-label">${escapeHtml(progressLabel)}</div>

      ${checklistBlock}
      ${advanceBlock}
    </div>

    <footer class="eh-phase-actions">
      <button class="btn btn-primary" data-action="close">Sluiten</button>
    </footer>
  `;
}

function renderOverview(state) {
  const ps = state.phaseState;

  const cards = PHASES.map((def) => {
    const phase = ps.phases.find((p) => p.number === def.number);
    const status = phase?.status || 'locked';
    const minAge = ps.minAgeMonths?.[def.number] ?? def.minAgeMonths;
    const ageOk  = ps.ageMonths >= minAge;

    let footMeta;
    if (status === 'completed') {
      footMeta = '<span class="eh-phase-card-tick">✓ Afgerond</span>';
    } else if (status === 'active') {
      const total = def.checks.length;
      const done  = total === 0 ? 0 : Object.keys(ps.checks?.[def.number] || {}).length;
      footMeta = total === 0
        ? '<span class="eh-phase-card-now">Eindfase</span>'
        : `<span class="eh-phase-card-now">Bezig — ${done}/${total}</span>`;
    } else {
      footMeta = ageOk
        ? `<span class="eh-phase-card-locked">Ten vroegste vanaf ${minAge} mnd</span>`
        : `<span class="eh-phase-card-locked">Ten vroegste vanaf ${minAge} mnd</span>`;
    }

    const isClickable = status === 'active';
    const tag = isClickable ? 'button' : 'div';
    const attrs = isClickable
      ? `data-open-phase="${def.number}" type="button"`
      : '';

    return `
      <${tag}
        class="eh-phase-card eh-phase-card-${status}"
        ${attrs}
      >
        <div class="eh-phase-card-num">Fase ${def.number}</div>
        <div class="eh-phase-card-title">${escapeHtml(def.name)}</div>
        <div class="eh-phase-card-sub">${escapeHtml(def.label)}</div>
        <div class="eh-phase-card-foot">${footMeta}</div>
      </${tag}>
    `;
  }).join('');

  return `
    <header class="eh-phase-header">
      <h2>Mijn fasen</h2>
      <p class="eh-phase-sub">Het tempo van ${escapeHtml(state.child.name)} bepaalt — geen prestatiedruk.</p>
    </header>
    <div class="eh-phase-grid">${cards}</div>
    <footer class="eh-phase-actions">
      <button class="btn btn-primary" data-action="close">Sluiten</button>
    </footer>
  `;
}
