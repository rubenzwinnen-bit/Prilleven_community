/* ============================================
   EERSTE HAPJES — RECIPE ELIGIBILITY (brok J)
   Gedeelde helpers voor recipeList (filter-toggle)
   en recipeDetail (alternatieven-sectie).
============================================ */

import { scanRecipeForRisks } from './content/eersteHapjes-risk-foods.js?v=2.26.0';

/**
 * Is dit recept geschikt voor het kindje (geen risk-foods voor leeftijd
 * + geen vermijden-allergeen)?
 * @param {object} recipe
 * @param {object} ctx
 * @param {number} [ctx.ageMonths]
 * @param {Set<string>} [ctx.vermijdenSet] — lowercase allergeen-keys
 * @returns {boolean}
 */
export function isRecipeSafeForChild(recipe, { ageMonths = null, vermijdenSet = null } = {}) {
  if (!recipe) return false;
  if (typeof ageMonths === 'number') {
    const risks = scanRecipeForRisks(recipe, ageMonths);
    if (risks.length > 0) return false;
  }
  if (vermijdenSet && vermijdenSet.size > 0) {
    const recAllergens = (recipe.allergens || []).map((a) => String(a).toLowerCase());
    if (recAllergens.some((a) => vermijdenSet.has(a))) return false;
  }
  return true;
}

/**
 * Geef tot N alternatieve recepten terug die geschikt zijn voor het kindje
 * en thematisch overlappen met het huidige recept (zelfde mealMoment).
 * @param {object} currentRecipe
 * @param {Array}  allRecipes
 * @param {object} ctx — zelfde signature als isRecipeSafeForChild
 * @param {number} [limit=3]
 */
export function getRecipeAlternatives(currentRecipe, allRecipes, ctx, limit = 3) {
  if (!currentRecipe || !Array.isArray(allRecipes)) return [];
  const moments = new Set(currentRecipe.mealMoments || []);

  // Eerst: zelfde meal-moment + safe.
  const primary = allRecipes.filter((r) =>
    r && r.id && r.id !== currentRecipe.id
    && (moments.size === 0 || (r.mealMoments || []).some((m) => moments.has(m)))
    && isRecipeSafeForChild(r, ctx)
  );

  if (primary.length >= limit) {
    return shuffleStable(primary, currentRecipe.id).slice(0, limit);
  }

  // Aanvullen: safe-recepten zonder meal-moment-match.
  const seen = new Set(primary.map((r) => r.id));
  const fallback = allRecipes.filter((r) =>
    r && r.id && r.id !== currentRecipe.id
    && !seen.has(r.id)
    && isRecipeSafeForChild(r, ctx)
  );

  return [...primary, ...shuffleStable(fallback, currentRecipe.id)].slice(0, limit);
}

// Deterministische "random" volgorde per recipe-id zodat rendering stabiel
// is binnen dezelfde sessie maar verschilt per huidig recept.
function shuffleStable(arr, seedStr) {
  const out = arr.slice();
  let seed = 0;
  for (const c of String(seedStr || '')) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
