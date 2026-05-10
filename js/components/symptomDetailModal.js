/* ============================================
   EERSTE HAPJES — SYMPTOM DETAIL MODAL (brok G.4)
   Twee weergaven in één bestand, zelfde patroon als articleModal.js:
   - openSymptomDetailModal({ symptomKey })  → detail één symptoom
   - openSymptomDetailModal({ listMode: true }) → lijst van alle symptomen,
     klik = detail (zelfde modal swap).
============================================ */

import { escapeHtml } from '../utils.js?v=2.27.0';
import { SYMPTOMS, getSymptom } from '../content/eersteHapjes-symptoms.js?v=2.27.0';

/**
 * @param {object} opts
 * @param {string} [opts.symptomKey] — open meteen op detail van deze key
 * @param {boolean} [opts.listMode]  — open op de lijst-weergave
 * @returns {Promise<void>}
 */
export function openSymptomDetailModal({ symptomKey, listMode } = {}) {
  if (listMode) {
    return openModal(renderList(), {
      onItemClick: (key, swap) => swap(renderDetail(getSymptom(key), { backToList: true })),
      onBack: (swap) => swap(renderList()),
    });
  }
  const sym = getSymptom(symptomKey);
  if (!sym) return Promise.resolve();
  return openModal(renderDetail(sym, { backToList: false }));
}

// ============================================================
// Renderers
// ============================================================
function renderList() {
  const items = SYMPTOMS.map(s => `
    <button class="eh-sym-list-item" data-symptom-key="${escapeHtml(s.key)}">
      <span class="eh-sym-list-main">
        <span class="eh-sym-list-title">${escapeHtml(s.label)}</span>
        <span class="eh-sym-list-intro">${escapeHtml(s.intro)}</span>
      </span>
      <span class="eh-sym-list-chevron" aria-hidden="true">›</span>
    </button>
  `).join('');

  return `
    <header class="eh-sym-header">
      <h2>Symptomen — uitleg</h2>
      <p class="eh-sym-sub">
        Korte info en signalen per symptoom.
        <span class="eh-sym-disclaimer">Dit vervangt geen medisch advies.</span>
      </p>
    </header>
    <div class="eh-sym-list">${items}</div>
    <footer class="eh-sym-actions">
      <button class="btn btn-primary" data-action="close">Sluiten</button>
    </footer>
  `;
}

function renderDetail(sym, { backToList } = {}) {
  const flagsHtml = sym.redFlags && sym.redFlags.length
    ? `
      <section class="eh-sym-redflags">
        <h4>Wanneer raadpleeg je een arts?</h4>
        <ul>
          ${sym.redFlags.map(f => `<li>${escapeHtml(f)}</li>`).join('')}
        </ul>
      </section>
    `
    : '';

  return `
    <header class="eh-sym-header">
      ${backToList
        ? `<button class="eh-sym-back" data-action="back" aria-label="Terug naar lijst">‹ Terug</button>`
        : ''}
      <div class="eh-sym-detail-top">
        <div>
          <h2>${escapeHtml(sym.label)}</h2>
          <p class="eh-sym-detail-intro">${escapeHtml(sym.intro)}</p>
        </div>
      </div>
    </header>
    <article class="eh-sym-body">${sym.body}</article>
    ${flagsHtml}
    <p class="eh-sym-disclaimer-foot">
      Pril Leven geeft geen medisch advies. Bij twijfel over de gezondheid van je
      kindje: contacteer je huisarts, kinderarts of Kind &amp; Gezin.
    </p>
    <footer class="eh-sym-actions">
      <button class="btn btn-primary" data-action="close">Sluiten</button>
    </footer>
  `;
}

// ============================================================
// Modal-shell (zelfde patroon als articleModal.js)
// ============================================================
function openModal(initialHtml, { onItemClick, onBack } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay eh-sym-overlay';
    overlay.innerHTML = `
      <div class="modal eh-sym-modal" data-content-host>
        ${initialHtml}
      </div>
    `;
    document.body.appendChild(overlay);

    const host = overlay.querySelector('[data-content-host]');

    function bind() {
      const closeBtn = host.querySelector('[data-action="close"]');
      if (closeBtn) closeBtn.addEventListener('click', close);

      const backBtn = host.querySelector('[data-action="back"]');
      if (backBtn && onBack) backBtn.addEventListener('click', () => onBack(swap));

      if (onItemClick) {
        host.querySelectorAll('[data-symptom-key]').forEach(btn => {
          btn.addEventListener('click', () => onItemClick(btn.dataset.symptomKey, swap));
        });
      }
    }

    function swap(html) {
      host.innerHTML = html;
      host.scrollTop = 0;
      bind();
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
      resolve();
    }
  });
}
