/* ============================================
   EERSTE HAPJES — RISICOVOEDINGEN LIJST + DETAIL (brok H.5)
   Eén modal-shell met lijst-view en detail-view.
   - openRiskFoodsListModal(opts) — overzicht alle items
   - openRiskFoodDetailModal({ riskKey, ageMonths? })
   Patroon zoals articleModal.js / symptomDetailModal.js.

   Lijst is gegroepeerd per tag (verstikking, microbieel, ...)
   en toont per item een leeftijdsdrempel. Bij `ageMonths` worden
   relevante items (kindje nog te jong) gemarkeerd.
============================================ */

import { escapeHtml } from '../utils.js?v=2.28.0';
import {
  RISK_FOODS,
  RISK_TAGS,
  getRiskFood,
  formatAgeLimit,
  tagLabel,
} from '../content/eersteHapjes-risk-foods.js?v=2.28.0';

/* ============================================
   LIJST-MODAL
============================================ */
export function openRiskFoodsListModal({ ageMonths = null } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay eh-risk-overlay';
    overlay.innerHTML = `
      <div class="modal eh-risk-modal">
        <header class="eh-risk-head">
          <h2>Risicovoedingen</h2>
          <p class="eh-risk-sub">Voedingsmiddelen die op een bepaalde leeftijd niet (of niet in deze vorm) veilig zijn.</p>
        </header>
        <div class="eh-risk-body" data-body></div>
        <footer class="eh-risk-footer">
          <p class="eh-risk-disclaimer">
            Algemene richtlijn — geen medisch advies. Twijfel je? Bespreek met je arts of K&G.
          </p>
          <button class="btn btn-primary" data-action="close">Klaar</button>
        </footer>
      </div>
    `;
    document.body.appendChild(overlay);

    const bodyEl = overlay.querySelector('[data-body]');

    function renderList() {
      // Groepeer per (eerste) tag
      const groups = {};
      for (const item of RISK_FOODS) {
        const tag = (item.tags && item.tags[0]) || 'overig';
        if (!groups[tag]) groups[tag] = [];
        groups[tag].push(item);
      }

      const tagOrder = ['verstikking', 'microbieel', 'botulisme', 'kwik', 'nutrient', 'overig'];
      const sortedTags = Object.keys(groups).sort(
        (a, b) => (tagOrder.indexOf(a) === -1 ? 99 : tagOrder.indexOf(a))
                - (tagOrder.indexOf(b) === -1 ? 99 : tagOrder.indexOf(b))
      );

      bodyEl.innerHTML = sortedTags.map((tag) => {
        const items = groups[tag];
        return `
          <section class="eh-risk-group">
            <h3 class="eh-risk-group-title">${escapeHtml(tagLabel(tag))}</h3>
            <ul class="eh-risk-items">
              ${items.map((it) => renderListItem(it, ageMonths)).join('')}
            </ul>
          </section>
        `;
      }).join('');

      bodyEl.querySelectorAll('[data-key]').forEach((btn) => {
        btn.addEventListener('click', () => {
          showDetail(btn.dataset.key);
        });
      });
    }

    function showDetail(key) {
      const item = getRiskFood(key);
      if (!item) return;
      const isRelevant = ageMonths !== null && ageMonths < item.maxAgeMonths;

      bodyEl.innerHTML = `
        <button class="eh-risk-back" data-action="back" type="button">← Terug naar lijst</button>
        <div class="eh-risk-detail">
          <div class="eh-risk-detail-head">
            <span class="eh-risk-detail-icon" aria-hidden="true">${item.icon || ''}</span>
            <div>
              <h3 class="eh-risk-detail-title">${escapeHtml(item.label)}</h3>
              <div class="eh-risk-detail-meta">
                <span class="eh-risk-pill">${escapeHtml(formatAgeLimit(item.maxAgeMonths))}</span>
                ${(item.tags || []).map((t) =>
                  `<span class="eh-risk-tag">${escapeHtml(tagLabel(t))}</span>`
                ).join('')}
                ${isRelevant ? '<span class="eh-risk-relevant">Geldt nu voor jouw kindje</span>' : ''}
              </div>
            </div>
          </div>
          <p class="eh-risk-detail-intro">${escapeHtml(item.intro || '')}</p>
          <div class="eh-risk-detail-body">${item.body || ''}</div>
        </div>
      `;

      bodyEl.querySelector('[data-action="back"]').addEventListener('click', () => {
        renderList();
      });
    }

    renderList();

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

function renderListItem(item, ageMonths) {
  const isRelevant = ageMonths !== null && ageMonths < item.maxAgeMonths;
  return `
    <li class="eh-risk-item ${isRelevant ? 'is-relevant' : ''}">
      <button class="eh-risk-item-btn" data-key="${escapeHtml(item.key)}" type="button">
        <span class="eh-risk-item-icon" aria-hidden="true">${item.icon || ''}</span>
        <span class="eh-risk-item-main">
          <span class="eh-risk-item-label">${escapeHtml(item.label)}</span>
          <span class="eh-risk-item-intro">${escapeHtml(item.intro || '')}</span>
        </span>
        <span class="eh-risk-item-age">${escapeHtml(formatAgeLimit(item.maxAgeMonths))}</span>
      </button>
    </li>
  `;
}

/* ============================================
   DETAIL-MODAL (zelfstandig — bv. vanuit warning-banner)
============================================ */
export function openRiskFoodDetailModal({ riskKey, ageMonths = null }) {
  return new Promise((resolve) => {
    const item = getRiskFood(riskKey);
    if (!item) { resolve(); return; }
    const isRelevant = ageMonths !== null && ageMonths < item.maxAgeMonths;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay eh-risk-overlay';
    overlay.innerHTML = `
      <div class="modal eh-risk-modal">
        <header class="eh-risk-head">
          <h2>${item.icon || ''} ${escapeHtml(item.label)}</h2>
          <p class="eh-risk-sub">${escapeHtml(formatAgeLimit(item.maxAgeMonths))}${isRelevant ? ' — geldt nu voor jouw kindje' : ''}</p>
        </header>
        <div class="eh-risk-body">
          <div class="eh-risk-detail">
            <p class="eh-risk-detail-intro">${escapeHtml(item.intro || '')}</p>
            <div class="eh-risk-detail-body">${item.body || ''}</div>
          </div>
        </div>
        <footer class="eh-risk-footer">
          <button class="btn btn-primary" data-action="close">Sluiten</button>
        </footer>
      </div>
    `;
    document.body.appendChild(overlay);

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
