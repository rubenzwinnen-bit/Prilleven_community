/* ============================================
   EERSTE HAPJES — CONTENT HELPERS (brok E)
   Zoek- en sorteer-functies bovenop de statische
   ARTICLES-array. Pure helpers, geen state.
============================================ */

import { ARTICLES } from './content/eersteHapjes-content.js?v=2.27.0';

/**
 * Bereken leeftijd in maanden uit een ISO-datum (YYYY-MM-DD).
 * Gebruikt kalender-logica zodat '5m + 2 dagen' niet rond afrondt naar 5.5.
 */
export function ageMonthsFromBirthdate(birthdateIso) {
  if (!birthdateIso) return 0;
  const today = new Date();
  const bd = new Date(birthdateIso + 'T00:00:00');
  let months = (today.getFullYear() - bd.getFullYear()) * 12
             + (today.getMonth() - bd.getMonth());
  if (today.getDate() < bd.getDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * Alle artikels relevant voor een bepaalde leeftijd.
 * @param {number} ageMonths
 * @param {object} [opts]
 * @param {string} [opts.category] — filter op categorie
 * @returns {Array}
 */
export function getRelevantArticles(ageMonths, { category } = {}) {
  return ARTICLES
    .filter(a => ageMonths >= a.ageMinMonths && ageMonths <= a.ageMaxMonths)
    .filter(a => !category || a.category === category)
    .sort((a, b) => a.ageMinMonths - b.ageMinMonths);
}

/**
 * Het meest relevante artikel voor de "Volgende stap"-card.
 * Strategie: pak het artikel waarvan ageMinMonths het dichtst bij de
 * huidige leeftijd ligt (zonder die te overschrijden) — dat is meestal
 * het artikel dat 'nu' relevant is. Veiligheid skipt deze omdat dat
 * niet leeftijds-specifiek is.
 */
export function getNextStepArticle(ageMonths) {
  const candidates = ARTICLES
    .filter(a => a.category !== 'veiligheid')
    .filter(a => ageMonths >= a.ageMinMonths && ageMonths <= a.ageMaxMonths)
    .sort((a, b) => b.ageMinMonths - a.ageMinMonths);
  return candidates[0] || null;
}

/**
 * Volledige lijst, gegroepeerd per categorie. Gebruikt voor de "Alle tips"-modal.
 */
export function getArticlesByCategory() {
  const grouped = {};
  for (const a of ARTICLES) {
    if (!grouped[a.category]) grouped[a.category] = [];
    grouped[a.category].push(a);
  }
  // Sorteer elke categorie op leeftijd oplopend
  for (const k of Object.keys(grouped)) {
    grouped[k].sort((a, b) => a.ageMinMonths - b.ageMinMonths);
  }
  return grouped;
}

export function getArticleBySlug(slug) {
  return ARTICLES.find(a => a.slug === slug) || null;
}

/**
 * Format leeftijdsrange voor weergave.
 * Bv. (4, 6) → "4-6 mnd", (4, 36) → "4 mnd - 3 jaar"
 */
export function formatAgeRange(min, max) {
  const fmt = (m) => m >= 12 ? `${Math.floor(m/12)}j${m%12 ? ' ' + (m%12) + 'm' : ''}` : `${m}m`;
  if (min === max) return fmt(min);
  return `${fmt(min)} – ${fmt(max)}`;
}
