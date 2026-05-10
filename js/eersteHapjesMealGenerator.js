/* ============================================
   EERSTE HAPJES — MAALTIJD-GENERATOR (warme maaltijd v1)

   Bouwt week-plannen voor één warme maaltijd per dag op basis van:
   - voedingsstijl (omnivoor / pesco / vegetarisch / vegan)
   - allergenen die vermeden moeten worden
   - variatie-niveau (gevarieerd vs simpel)
   - optionele excludeKeys (door ouder uitgesloten ingrediënten)
   - optionele seed (deterministisch — bv. child_id + week-nummer)

   Werkt op verhoudingen, geen grammen. Output bevat een `ratioLabel`
   ("3 gelijke porties groente · ⅓ portie kip · 1 lepel olijfolie").

   Geen leeftijd-filter hier — fase-gating in de roadmap regelt wanneer
   deze generator beschikbaar wordt (vanaf Fase 1).

   Risk-foods (kerstomaat, druif, …) → warnings via riskFoodKey-koppeling,
   niet via hard filter. Verstikkingsgevaar wordt als waarschuwing in de
   meal-output meegegeven.
============================================ */

import {
  CATEGORIES,
  INGREDIENTS,
  CATEGORY_ORDER,
  FRUIT_CATEGORIES,
  FRUIT_INGREDIENTS,
} from './content/eersteHapjes-meal-ingredients.js';
import {
  ALLERGEN_FLOW,
  ALLERGEN_COOLDOWN_DAYS,
} from './content/eersteHapjes-allergen-flow.js';

// ---------- RNG (mulberry32, seedable) ----------

function makeRng(seed) {
  let s = (seed >>> 0) || (Date.now() >>> 0);
  return function rng() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

// ---------- Filtering ----------

function passesDietary(item, category, dietary) {
  // Categorie-niveau:
  if (category === 'vlees_vis') {
    if (dietary === 'vegetarisch' || dietary === 'vegan') return false;
  }
  if (category === 'vegetarisch') {
    if (dietary === 'vegan' && item.key === 'kippenei') return false;
  }
  // Item-niveau:
  if (Array.isArray(item.dietary) && !item.dietary.includes(dietary)) {
    return false;
  }
  return true;
}

function passesAllergens(item, avoidAllergens) {
  if (!Array.isArray(item.allergens) || item.allergens.length === 0) return true;
  return !item.allergens.some(a => avoidAllergens.includes(a));
}

function buildPool(category, opts) {
  const list = INGREDIENTS[category] || [];
  return list.filter(item => {
    if (opts.excludeKeys.includes(item.key)) return false;
    if (!passesDietary(item, category, opts.dietary)) return false;
    if (!passesAllergens(item, opts.avoidAllergens)) return false;
    return true;
  });
}

// ---------- Pick-strategie ----------

/**
 * Kies een ingrediënt uit een pool, met voorkeur voor de minst-gebruikte
 * binnen het variatie-budget.
 */
function pickFromPool(pool, usage, rng, maxRepeat) {
  if (!pool.length) return null;

  // Filter eruit wat al >= maxRepeat keer gekozen is
  let candidates = pool.filter(it => (usage[it.key] || 0) < maxRepeat);
  if (!candidates.length) candidates = pool; // forceer als alles op maxRepeat zit

  // Voorkeur voor minst-gebruikt
  const minUsed = candidates.reduce(
    (m, it) => Math.min(m, usage[it.key] || 0),
    Infinity
  );
  const leastUsed = candidates.filter(it => (usage[it.key] || 0) === minUsed);

  const chosen = leastUsed[Math.floor(rng() * leastUsed.length)];
  if (chosen) usage[chosen.key] = (usage[chosen.key] || 0) + 1;
  return chosen;
}

// ---------- Eiwit-keuze ----------

/**
 * Beslis of we deze maaltijd een vlees/vis-eiwit of een vegetarisch eiwit kiezen.
 * - omnivoor / pesco: 70% vlees-vis, 30% vegetarisch (variatie)
 * - vegetarisch / vegan: altijd vegetarisch
 * Fallback: als gekozen pool leeg is, probeer de andere.
 */
function pickProtein(pools, dietary, usage, rng, maxRepeat) {
  const veg = pools.vegetarisch;
  const fish = pools.vlees_vis;

  if (dietary === 'vegetarisch' || dietary === 'vegan') {
    const it = pickFromPool(veg, usage, rng, maxRepeat);
    return it ? { ...it, cat: 'vegetarisch' } : null;
  }

  // omnivoor of pesco
  const preferVeg = rng() < 0.30 && veg.length > 0;
  if (preferVeg) {
    const it = pickFromPool(veg, usage, rng, maxRepeat);
    if (it) return { ...it, cat: 'vegetarisch' };
  }
  const fishIt = pickFromPool(fish, usage, rng, maxRepeat);
  if (fishIt) return { ...fishIt, cat: 'vlees_vis' };

  // fallback de andere kant op
  const vegIt = pickFromPool(veg, usage, rng, maxRepeat);
  return vegIt ? { ...vegIt, cat: 'vegetarisch' } : null;
}

// ---------- Ratio-label ----------

function buildRatioLabel(ingredients) {
  const parts = ['3 gelijke porties groente'];
  const eiwit = ingredients.eiwit;
  if (eiwit) {
    const label = CATEGORIES[eiwit.cat]?.portionLabel || '⅓ portie';
    parts.push(`${label} ${eiwit.name.toLowerCase()}`);
  }
  if (ingredients.vet) {
    parts.push(`1 lepel ${ingredients.vet.name.toLowerCase()}`);
  }
  return parts.join(' · ');
}

// ---------- Risk-warnings (lichtgewicht koppeling) ----------

function collectWarnings(ingredients) {
  const out = [];
  for (const slot of ['groen', 'kleurrijk', 'knol', 'eiwit', 'vet']) {
    const it = ingredients[slot];
    if (!it) continue;
    if (it.riskFoodKey) {
      out.push({ ingredient: it.name, riskFoodKey: it.riskFoodKey });
    }
    if (it.note) {
      out.push({ ingredient: it.name, note: it.note });
    }
  }
  return out;
}

// ---------- Allergeen-intro planning ----------

/**
 * Plan dag-voor-dag wanneer er een allergeen-intro-dose is.
 * Vaste flow uit ALLERGEN_FLOW. Niet random.
 *
 * @param {number} daysCount
 * @param {Object} ctx
 * @param {number} ctx.ageMonths
 * @param {string[]} ctx.completed       allergeen-keys die 3/3 succesvol zijn
 * @param {Object<string, number>} ctx.inProgress  key → aantal doses al gedaan
 * @param {string[]} ctx.knownAllergies  ouder heeft bevestigd dat kindje allergisch is
 * @param {boolean}  ctx.paused          flow staat op pauze (bv. na milde reactie)
 * @param {number}   ctx.daysSinceLastDose  cooldown-teller (default 999 = mag direct)
 * @returns {(null|{ key, label, icon, dose, doseTarget, isFirstDose, suggestedFood, note?, alternative? })[]}
 */
function planAllergenIntros(daysCount, ctx) {
  const result = new Array(daysCount).fill(null);
  if (ctx.paused) return result;

  // Lokale kopie zodat we niets buiten muteren
  const completed = new Set(ctx.completed || []);
  const inProgress = { ...(ctx.inProgress || {}) };
  const known = new Set(ctx.knownAllergies || []);
  let daysSinceLast = Number.isFinite(ctx.daysSinceLastDose) ? ctx.daysSinceLastDose : 999;

  // Beschikbare flow: gefilterd op leeftijd + niet al voltooid + niet bevestigd-allergisch
  const queue = ALLERGEN_FLOW
    .filter(a => !completed.has(a.key))
    .filter(a => !known.has(a.key))
    .filter(a => {
      if (a.ageCondition.introFrom && ctx.ageMonths < a.ageCondition.introFrom) return false;
      return true;
    })
    .slice()
    .sort((a, b) => a.order - b.order);

  for (let d = 0; d < daysCount; d++) {
    daysSinceLast++;
    if (daysSinceLast < ALLERGEN_COOLDOWN_DAYS) continue;
    if (queue.length === 0) break;

    const next = queue[0];
    const doseDone = inProgress[next.key] || 0;
    const dose = doseDone + 1;
    const target = next.repeatTarget || 3;

    result[d] = {
      key: next.key,
      label: next.label,
      icon: next.icon,
      dose,
      doseTarget: target,
      isFirstDose: dose === 1,
      suggestedFood: next.suggestedFood,
      note: next.note,
      alternative: next.alternative,
    };

    inProgress[next.key] = dose;
    if (dose >= target) {
      completed.add(next.key);
      queue.shift();
    }
    daysSinceLast = 0;
  }

  return result;
}

// ---------- Public API ----------

/**
 * @param {object} opts
 * @param {'omnivoor'|'pesco'|'vegetarisch'|'vegan'} [opts.dietary='omnivoor']
 * @param {string[]} [opts.avoidAllergens=[]]   bv. ['ei','koemelk','vis']
 * @param {number}   [opts.daysCount=7]
 * @param {number}   [opts.mealsPerDay=1]       v1: alleen 1 (warm)
 * @param {'gevarieerd'|'simpel'} [opts.variationLevel='gevarieerd']
 * @param {string[]} [opts.excludeKeys=[]]      ingrediënt-keys die de ouder uitsluit
 * @param {number|string} [opts.seed]           deterministisch — bv. child_id + week
 * @param {Object} [opts.allergenContext]       state voor de vaste allergenen-flow
 * @param {number} [opts.allergenContext.ageMonths]
 * @param {string[]} [opts.allergenContext.completed]
 * @param {Object<string,number>} [opts.allergenContext.inProgress]
 * @param {string[]} [opts.allergenContext.knownAllergies]
 * @param {boolean} [opts.allergenContext.paused]
 * @param {number}  [opts.allergenContext.daysSinceLastDose]
 * @returns {{
 *   days: Array<{ day: number, meals: Array<{...}>, allergenIntro: object|null }>,
 *   meta: object
 * }}
 */
export function generateWeekPlan(opts = {}) {
  const dietary = opts.dietary || 'omnivoor';
  const avoidAllergens = Array.isArray(opts.avoidAllergens) ? opts.avoidAllergens : [];
  const daysCount = Math.max(1, Math.min(14, opts.daysCount || 7));
  const mealsPerDay = Math.max(1, Math.min(3, opts.mealsPerDay || 1));
  const variationLevel = opts.variationLevel === 'simpel' ? 'simpel' : 'gevarieerd';
  const excludeKeys = Array.isArray(opts.excludeKeys) ? opts.excludeKeys : [];

  const seedNum = typeof opts.seed === 'number'
    ? opts.seed
    : typeof opts.seed === 'string'
      ? hashString(opts.seed)
      : Date.now() >>> 0;
  const rng = makeRng(seedNum);

  // Pools per categorie (eenmalig opbouwen)
  const filterOpts = { dietary, avoidAllergens, excludeKeys };
  const pools = {};
  for (const cat of CATEGORY_ORDER) {
    pools[cat] = buildPool(cat, filterOpts);
  }

  // Variatie-budget: hoe vaak mag een ingrediënt voorkomen in de hele week?
  // - gevarieerd: 1× (zoveel mogelijk uniek)
  // - simpel:     3× (toelating tot herhaling)
  const maxRepeat = variationLevel === 'simpel' ? 3 : 1;
  const usage = {};

  // Allergeen-intro plan (parallel aan de maaltijd-generatie)
  const allergenPlan = opts.allergenContext
    ? planAllergenIntros(daysCount, opts.allergenContext)
    : new Array(daysCount).fill(null);

  const days = [];
  for (let d = 1; d <= daysCount; d++) {
    const meals = [];
    for (let m = 0; m < mealsPerDay; m++) {
      const groen     = pickFromPool(pools.groen,     usage, rng, maxRepeat);
      const kleurrijk = pickFromPool(pools.kleurrijk, usage, rng, maxRepeat);
      const knol      = pickFromPool(pools.knol,      usage, rng, maxRepeat);
      const eiwit     = pickProtein(pools, dietary,   usage, rng, maxRepeat);
      const vet       = pickFromPool(pools.vet,       usage, rng, maxRepeat);

      const ingredients = { groen, kleurrijk, knol, eiwit, vet };

      const missing = [];
      if (!groen)     missing.push('groen');
      if (!kleurrijk) missing.push('kleurrijk');
      if (!knol)      missing.push('knol');
      if (!eiwit)     missing.push('eiwit');
      if (!vet)       missing.push('vet');

      meals.push({
        type: 'warm',
        ingredients,
        ratioLabel: buildRatioLabel(ingredients),
        warnings: collectWarnings(ingredients),
        missing,
      });
    }
    days.push({
      day: d,
      meals,
      allergenIntro: allergenPlan[d - 1] || null,
    });
  }

  return {
    days,
    meta: { dietary, daysCount, mealsPerDay, variationLevel, seed: seedNum },
  };
}

/**
 * Convenience: regenereer 1 specifieke maaltijd binnen een bestaand plan
 * (bv. wanneer de ouder zegt "wissel deze ene"). Gebruikt dezelfde filters
 * maar een ander seed-segment zodat het resultaat verschilt.
 */
export function regenerateMeal(planMeta, dayIndex, mealIndex) {
  const subSeed = (planMeta.seed >>> 0) ^ ((dayIndex * 31 + mealIndex * 7) >>> 0) ^ 0xA5A5A5A5;
  const single = generateWeekPlan({
    dietary: planMeta.dietary,
    avoidAllergens: planMeta.avoidAllergens || [],
    daysCount: 1,
    mealsPerDay: 1,
    variationLevel: planMeta.variationLevel,
    excludeKeys: planMeta.excludeKeys || [],
    seed: subSeed,
  });
  return single.days[0]?.meals[0] || null;
}

/* ============================================
   FRUIT-MAALTIJD GENERATOR (Fase 3)
   3 categorieën: fruit (~150g) + groente (50g+) + vetstof.
   Geen vlees/eiwit nodig — pure fruit-maaltijd.
============================================ */

function buildFruitPool(category, opts) {
  const list = FRUIT_INGREDIENTS[category] || [];
  return list.filter((item) => {
    if (opts.excludeKeys.includes(item.key)) return false;
    if (!Array.isArray(item.allergens)) return true;
    return !item.allergens.some((a) => opts.avoidAllergens.includes(a));
  });
}

/**
 * Genereer 1 fruit-maaltijd. Single-meal output, vergelijkbaar met
 * de warme-maaltijd-output structuur.
 *
 * @param {object} opts
 * @param {string[]} [opts.avoidAllergens=[]]
 * @param {string[]} [opts.excludeKeys=[]]
 * @param {number|string} [opts.seed]
 * @returns {{
 *   type: 'fruit',
 *   ingredients: { fruit, groen, vet },
 *   ratioLabel: string,
 *   warnings: Array,
 *   missing: string[]
 * }}
 */
export function generateFruitMeal(opts = {}) {
  const avoidAllergens = Array.isArray(opts.avoidAllergens) ? opts.avoidAllergens : [];
  const excludeKeys = Array.isArray(opts.excludeKeys) ? opts.excludeKeys : [];
  const seedNum = typeof opts.seed === 'number'
    ? opts.seed
    : typeof opts.seed === 'string'
      ? hashString(opts.seed)
      : Date.now() >>> 0;
  const rng = makeRng(seedNum);

  const filterOpts = { avoidAllergens, excludeKeys };
  const pools = {
    fruit:       buildFruitPool('fruit', filterOpts),
    fruit_groen: buildFruitPool('fruit_groen', filterOpts),
    fruit_vet:   buildFruitPool('fruit_vet', filterOpts),
  };

  // Random pick (geen variatie-budget — single-meal)
  function pick(pool) {
    if (!pool.length) return null;
    return pool[Math.floor(rng() * pool.length)];
  }

  const fruit = pick(pools.fruit);
  const groen = pick(pools.fruit_groen);
  const vet   = pick(pools.fruit_vet);

  const ingredients = { fruit, groen, vet };
  const missing = [];
  if (!fruit) missing.push('fruit');
  if (!groen) missing.push('groen');
  if (!vet)   missing.push('vet');

  const ratioLabel = buildFruitRatioLabel(ingredients);
  const warnings = collectFruitWarnings(ingredients);

  return {
    type: 'fruit',
    ingredients,
    ratioLabel,
    warnings,
    missing,
  };
}

function buildFruitRatioLabel(ingredients) {
  const parts = [];
  if (ingredients.fruit) parts.push(`1 stuk ${ingredients.fruit.name.toLowerCase()}`);
  if (ingredients.groen) parts.push(`⅓ portie ${ingredients.groen.name.toLowerCase()}`);
  if (ingredients.vet)   parts.push(`1 lepel ${ingredients.vet.name.toLowerCase()}`);
  return parts.join(' · ');
}

function collectFruitWarnings(ingredients) {
  const out = [];
  for (const slot of ['fruit', 'groen', 'vet']) {
    const it = ingredients[slot];
    if (!it) continue;
    if (it.riskFoodKey) out.push({ ingredient: it.name, riskFoodKey: it.riskFoodKey });
    if (it.note) out.push({ ingredient: it.name, note: it.note });
  }
  return out;
}

/**
 * Genereer fruit-maaltijden voor 7 opeenvolgende dagen, met variatie
 * (max 1 herhaling per ingrediënt). Returns array van fruit-meals.
 */
export function generateFruitWeek(opts = {}) {
  const seedBase = typeof opts.seed === 'string'
    ? hashString(opts.seed)
    : (typeof opts.seed === 'number' ? opts.seed : Date.now() >>> 0);

  const meals = [];
  const usedFruit = new Set();
  const usedGroen = new Set();

  for (let d = 0; d < 7; d++) {
    const dailySeed = (seedBase >>> 0) ^ ((d * 113) >>> 0) ^ 0xC0FFEE;
    const meal = generateFruitMeal({
      ...opts,
      // Sluit ingrediënten uit die deze week al gebruikt zijn
      excludeKeys: [
        ...(opts.excludeKeys || []),
        ...usedFruit,
        ...usedGroen,
      ],
      seed: dailySeed,
    });
    if (meal.ingredients.fruit) usedFruit.add(meal.ingredients.fruit.key);
    if (meal.ingredients.groen) usedGroen.add(meal.ingredients.groen.key);
    meals.push(meal);
  }
  return meals;
}
