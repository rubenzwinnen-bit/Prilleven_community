/* ============================================
   EERSTE HAPJES — ARTICLE MODAL (brok E + brok K)
   Twee weergaven in één bestand:
   - openArticleModal(article) — toont één artikel
   - openArticleListModal({ ageMonths }) — toont lijst per categorie,
     klik op een item opent de detail-weergave (zelfde modal).
   Brok K: search-input + categorie-chips bovenaan lijst.
============================================ */

import { escapeHtml } from '../utils.js?v=2.30.0';
import {
  getArticlesByCategory,
  getArticleBySlug,
  formatAgeRange,
} from '../eersteHapjesContent.js?v=2.30.0';
import { CATEGORY_LABEL } from '../content/eersteHapjes-content.js?v=2.30.0';

/**
 * Toon één artikel in een modal.
 */
export function openArticleModal(article) {
  return openModal(renderArticle(article));
}

/**
 * Toon een lijst van alle artikels (gegroepeerd op categorie) met
 * search + categorie-filter (brok K, multi-select OFF).
 */
export function openArticleListModal({ ageMonths } = {}) {
  // Lokale filter-state — blijft bestaan zolang de modal open is.
  const filters = { search: '', category: null };

  return openModal(renderList(ageMonths, filters), {
    onItemClick: (slug, swap) => {
      const article = getArticleBySlug(slug);
      if (article) swap(renderArticle(article, { backToList: ageMonths }));
    },
    onBack: (swap) => swap(renderList(ageMonths, filters)),
    onBound: (swap) => bindListFilters(swap, filters, ageMonths),
  });
}

// ============================================================
// Renderers
// ============================================================
function renderList(ageMonths, filters = { search: '', category: null }) {
  const grouped = getArticlesByCategory();
  const cats = Object.keys(grouped);
  const searchLow = (filters.search || '').toLowerCase().trim();
  const activeCat = filters.category || null;

  const matches = (a) => {
    if (activeCat && a.category !== activeCat) return false;
    if (!searchLow) return true;
    const hay = [
      a.title || '',
      a.summary || '',
      stripHtml(a.body || ''),
      CATEGORY_LABEL[a.category] || a.category || '',
    ].join(' ').toLowerCase();
    return hay.includes(searchLow);
  };

  // Filter binnen elke groep, drop lege groepen.
  const sections = cats.map((cat) => {
    const items = grouped[cat].filter(matches).map(a => {
      const isRelevant = typeof ageMonths === 'number'
        && ageMonths >= a.ageMinMonths
        && ageMonths <= a.ageMaxMonths;
      return `
        <button class="eh-article-list-item ${isRelevant ? 'is-relevant' : ''}" data-article-slug="${escapeHtml(a.slug)}">
          <div class="eh-article-list-item-main">
            <div class="eh-article-list-item-title">${highlight(a.title, searchLow)}</div>
            <div class="eh-article-list-item-meta">
              ${escapeHtml(formatAgeRange(a.ageMinMonths, a.ageMaxMonths))}
              ${isRelevant ? '<span class="eh-article-now-pill">Voor jou nu</span>' : ''}
            </div>
          </div>
          <span class="eh-article-list-chevron" aria-hidden="true">›</span>
        </button>
      `;
    }).join('');
    if (!items) return '';
    return `
      <section class="eh-article-list-section">
        <h3 class="eh-article-list-cat">${escapeHtml(CATEGORY_LABEL[cat] || cat)}</h3>
        <div class="eh-article-list-items">${items}</div>
      </section>
    `;
  }).join('');

  // Categorie-chips: 'alle' + één chip per categorie. Multi-select OFF.
  const chips = `
    <button class="eh-article-chip ${!activeCat ? 'selected' : ''}" data-eh-cat-chip="">Alle</button>
    ${cats.map(c => `
      <button class="eh-article-chip ${activeCat === c ? 'selected' : ''}" data-eh-cat-chip="${escapeHtml(c)}">
        ${escapeHtml(CATEGORY_LABEL[c] || c)}
      </button>
    `).join('')}
  `;

  const isFiltered = !!searchLow || !!activeCat;
  const empty = sections === '';

  return `
    <header class="eh-article-header">
      <h2>Tips & artikels</h2>
      <p class="eh-article-sub">Korte microlearnings per fase.</p>
      <div class="eh-article-search">
        <input type="search" class="eh-article-search-input" data-eh-search
               placeholder="Zoek in titel, samenvatting of inhoud..."
               value="${escapeHtml(filters.search || '')}"
               autocomplete="off">
      </div>
      <div class="eh-article-chips" data-eh-chips>${chips}</div>
    </header>
    <div class="eh-article-list">
      ${empty
        ? `<div class="eh-article-empty">${isFiltered ? 'Geen artikels gevonden voor deze filter.' : 'Nog geen artikels.'}</div>`
        : sections}
    </div>
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
// Search + chip binders (brok K)
// ============================================================
function bindListFilters(swap, filters, ageMonths) {
  const input = document.querySelector('[data-eh-search]');
  if (input) {
    input.addEventListener('input', () => {
      filters.search = input.value;
      swap(renderList(ageMonths, filters));
      // Focus + cursor terug naar input
      const next = document.querySelector('[data-eh-search]');
      if (next) {
        next.focus();
        const len = (filters.search || '').length;
        try { next.setSelectionRange(len, len); } catch { /* sommige input-types ondersteunen het niet */ }
      }
    });
  }
  document.querySelectorAll('[data-eh-cat-chip]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const cat = chip.dataset.ehCatChip || null;
      // Klik op zelfde chip → reset; klik op andere → activeer.
      filters.category = (cat === '' || filters.category === cat) ? null : cat;
      swap(renderList(ageMonths, filters));
    });
  });
}

// ============================================================
// Utility
// ============================================================
function stripHtml(html) {
  return String(html).replace(/<[^>]+>/g, ' ');
}

function highlight(text, query) {
  const safe = escapeHtml(text || '');
  if (!query) return safe;
  // Markeer matches in titel — case-insensitive, escape regex chars.
  const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${q})`, 'ig');
  return safe.replace(re, '<mark>$1</mark>');
}

// ============================================================
// Modal-shell
// ============================================================
function openModal(initialHtml, { onItemClick, onBack, onBound } = {}) {
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

      if (onBound) onBound(swap);
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
