/* ============================================
   EERSTE HAPJES — ARTICLE MODAL (brok E)
   Twee weergaven in één bestand:
   - openArticleModal(article) — toont één artikel
   - openArticleListModal({ ageMonths }) — toont lijst per categorie,
     klik op een item opent de detail-weergave (zelfde modal).
============================================ */

import { escapeHtml } from '../utils.js?v=2.8.0';
import {
  getArticlesByCategory,
  getArticleBySlug,
  formatAgeRange,
} from '../eersteHapjesContent.js?v=2.8.0';
import { CATEGORY_LABEL } from '../content/eersteHapjes-content.js?v=2.8.0';

/**
 * Toon één artikel in een modal.
 * @param {object} article
 * @returns {Promise<void>}
 */
export function openArticleModal(article) {
  return openModal(renderArticle(article));
}

/**
 * Toon een lijst van alle artikels (gegroepeerd op categorie).
 * Klik op item opent de detail-weergave in plaats van de lijst.
 * @param {object} [opts]
 * @param {number} [opts.ageMonths] — wordt gebruikt voor "voor jou nu"-pill
 * @returns {Promise<void>}
 */
export function openArticleListModal({ ageMonths } = {}) {
  return openModal(renderList(ageMonths), {
    onItemClick: (slug, swap) => {
      const article = getArticleBySlug(slug);
      if (article) swap(renderArticle(article, { backToList: ageMonths }));
    },
    onBack: (swap) => swap(renderList(ageMonths)),
  });
}

// ============================================================
// Renderers
// ============================================================
function renderList(ageMonths) {
  const grouped = getArticlesByCategory();
  const cats = Object.keys(grouped);

  const sections = cats.map(cat => {
    const items = grouped[cat].map(a => {
      const isRelevant = typeof ageMonths === 'number'
        && ageMonths >= a.ageMinMonths
        && ageMonths <= a.ageMaxMonths;
      return `
        <button class="eh-article-list-item ${isRelevant ? 'is-relevant' : ''}" data-article-slug="${escapeHtml(a.slug)}">
          <div class="eh-article-list-item-main">
            <div class="eh-article-list-item-title">${escapeHtml(a.title)}</div>
            <div class="eh-article-list-item-meta">
              ${escapeHtml(formatAgeRange(a.ageMinMonths, a.ageMaxMonths))}
              ${isRelevant ? '<span class="eh-article-now-pill">Voor jou nu</span>' : ''}
            </div>
          </div>
          <span class="eh-article-list-chevron" aria-hidden="true">›</span>
        </button>
      `;
    }).join('');
    return `
      <section class="eh-article-list-section">
        <h3 class="eh-article-list-cat">${escapeHtml(CATEGORY_LABEL[cat] || cat)}</h3>
        <div class="eh-article-list-items">${items}</div>
      </section>
    `;
  }).join('');

  return `
    <header class="eh-article-header">
      <h2>Tips & artikels</h2>
      <p class="eh-article-sub">Korte microlearnings per fase.</p>
    </header>
    <div class="eh-article-list">${sections}</div>
    <footer class="eh-article-actions">
      <button class="btn btn-primary" data-action="close">Sluiten</button>
    </footer>
  `;
}

function renderArticle(article, { backToList } = {}) {
  return `
    <header class="eh-article-header">
      ${typeof backToList === 'number'
        ? `<button class="eh-article-back" data-action="back" aria-label="Terug naar lijst">‹ Terug</button>`
        : ''}
      <div class="eh-article-meta-pills">
        <span class="eh-article-pill">${escapeHtml(CATEGORY_LABEL[article.category] || article.category)}</span>
        <span class="eh-article-pill eh-article-pill-age">${escapeHtml(formatAgeRange(article.ageMinMonths, article.ageMaxMonths))}</span>
      </div>
      <h2>${escapeHtml(article.title)}</h2>
      <p class="eh-article-summary">${escapeHtml(article.summary)}</p>
    </header>
    <article class="eh-article-body">${article.body}</article>
    <footer class="eh-article-actions">
      <button class="btn btn-primary" data-action="close">Sluiten</button>
    </footer>
  `;
}

// ============================================================
// Modal-shell
// ============================================================
function openModal(initialHtml, { onItemClick, onBack } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay eh-article-overlay';
    overlay.innerHTML = `
      <div class="modal eh-article-modal" data-content-host>
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
        host.querySelectorAll('[data-article-slug]').forEach(btn => {
          btn.addEventListener('click', () => onItemClick(btn.dataset.articleSlug, swap));
        });
      }
    }

    function swap(html) {
      host.innerHTML = html;
      // Scroll naar boven bij wissel
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
