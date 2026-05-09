/* ============================================
   EERSTE HAPJES — SUGGESTION ENGINE (brok I.1)
   Pure rule-functies die op basis van child + state een lijst
   van suggesties bouwen. Statisch — geen DB-call.

   Elke rule produceert 0 of 1 suggestie-objecten:
     {
       key:       stabiele identifier voor dedupe
       icon:      emoji
       label:     korte titel
       sub:       1-regelige toelichting
       action:    { kind, ... }
                  kind ∈ 'open-intro' | 'open-recipe' | 'open-meal-log'
                       | 'open-phase-detail' | 'show-info'
     }

   Dedupe met H.6-reminders gebeurt in eersteHapjes.js via key-prefix.
============================================ */

import { ageMonthsFromBirthdate } from './eersteHapjesContent.js?v=2.11.0';
import { PHASES } from './content/eersteHapjes-phases.js?v=2.11.0';
import { getSymptomMeta } from './content/eersteHapjes-symptoms.js?v=2.11.0';

const MIN_DAYS_BETWEEN_INTROS = 2;        // a
const NO_LOG_DAYS_THRESHOLD = 5;          // e
const REJECTION_COUNT_THRESHOLD = 3;      // d
const SYMPTOM_PATTERN_THRESHOLD = 3;      // g
const RECIPE_REPEAT_DAYS = 7;             // c (skip recently logged)
const ALLERGEN_INTRO_MIN_AGE_MONTHS = 6;  // a (basisdrempel — geen specifiek per allergeen)

/**
 * @param {object} ctx
 * @param {object} ctx.child            { id, name, birthdate, texture_preference }
 * @param {Array}  ctx.allergens        child_allergens-rijen
 * @param {object} ctx.allergenIntrosByKey  { [key]: [intro, ...] }  (gesorteerd desc op intro_date)
 * @param {Array}  ctx.todayMeals       meals van vandaag
 * @param {Array}  ctx.recentMeals      meals van laatste 7 dagen
 * @param {Array}  ctx.symptoms         symptomen laatste 7 dagen
 * @param {object} ctx.phaseState       { activePhase, phases, ... }
 * @param {Array}  ctx.recipes          recipes-cache
 * @returns {Array} suggestion-objecten
 */
export function buildSuggestions(ctx) {
  const ageMonths = ctx.child?.birthdate ? ageMonthsFromBirthdate(ctx.child.birthdate) : null;
  if (ageMonths === null) return [];

  const out = [];
  out.push(...ruleAllergenIntroDay(ctx, ageMonths));
  out.push(...rulePhaseAdvance(ctx, ageMonths));
  out.push(...ruleRecipeDiscovery(ctx, ageMonths));
  out.push(...ruleRejectionPattern(ctx));
  out.push(...ruleNoRecentLog(ctx));
  out.push(...ruleDuplicateMealType(ctx));
  out.push(...ruleSymptomPattern(ctx));
  return out;
}

/* ============================================
   Rules
============================================ */

// (a) Goede dag voor allergeen-intro
function ruleAllergenIntroDay(ctx, ageMonths) {
  if (ageMonths < ALLERGEN_INTRO_MIN_AGE_MONTHS) return [];
  const out = [];
  for (const a of (ctx.allergens || [])) {
    if (a.status === 'vermijden') continue;
    const intros = ctx.allergenIntrosByKey?.[a.allergen_key] || [];
    // Skip als al 'veilig' (3+ geen-reactie) — gerelateerd aan ALLERGEN_INTROS_TARGET=3
    const successful = intros.filter((i) => i.reaction === 'geen').length;
    if (successful >= 3) continue;
    // Skip als severe reactie (opvolgen)
    const severe = intros.some((i) => i.reaction === 'matig' || i.reaction === 'heftig');
    if (severe) continue;

    const lastIntro = intros[0]; // sorted desc
    const days = lastIntro ? daysSinceIsoDate(lastIntro.intro_date) : Infinity;
    if (days < MIN_DAYS_BETWEEN_INTROS) continue;

    out.push({
      key: `suggest-allergen-${a.allergen_key}`,
      icon: '💡',
      label: `Goede dag voor ${capitalize(a.allergen_key)}`,
      sub: intros.length === 0
        ? 'Nog niet geprobeerd — eerste introductie kan vandaag.'
        : `Laatste poging ${days}d geleden — herhalen mag.`,
      action: { kind: 'open-intro', allergenKey: a.allergen_key },
    });
  }
  return out;
}

// (b) Klaar voor volgende fase?
function rulePhaseAdvance(ctx, ageMonths) {
  const ps = ctx.phaseState;
  if (!ps || typeof ps.activePhase !== 'number') return [];
  if (ps.activePhase >= 5) return [];
  const next = PHASES.find((p) => p.number === ps.activePhase + 1);
  if (!next) return [];
  if (ageMonths < next.minAgeMonths) return [];
  return [{
    key: `suggest-phase-${ps.activePhase}`,
    icon: '💡',
    label: `Klaar voor fase ${next.number}?`,
    sub: `${ctx.child?.name || 'Je kindje'} is ${ageMonths} mnd — ${next.label} kan starten.`,
    action: { kind: 'open-phase-detail' },
  }];
}

// (c) Recept-suggestie (random uit cache, niet recent gelogd)
function ruleRecipeDiscovery(ctx, _ageMonths) {
  const recipes = ctx.recipes || [];
  if (recipes.length === 0) return [];
  const recentRecipeIds = new Set(
    (ctx.recentMeals || [])
      .filter((m) => m.recipe_id && daysSinceIsoDate(toDateIso(m.eaten_at || m.occurred_at || m.created_at)) <= RECIPE_REPEAT_DAYS)
      .map((m) => m.recipe_id)
  );
  const candidates = recipes.filter((r) =>
    r && r.id && !recentRecipeIds.has(r.id)
    && (typeof r.cookingTime !== 'number' || r.cookingTime <= 45)
  );
  if (candidates.length === 0) return [];
  // Deterministisch per dag: pak op basis van (vandaag + child_id)-hash zodat
  // de suggestie elke dag verandert maar binnen één dag stabiel blijft.
  const seed = todayIsoString() + (ctx.child?.id || '');
  const idx = stableIndex(seed, candidates.length);
  const pick = candidates[idx];
  return [{
    key: `suggest-recipe-${pick.id}`,
    icon: '💡',
    label: `Probeer: ${pick.name}`,
    sub: 'Een receptje dat je deze week nog niet gegeven hebt.',
    action: { kind: 'open-recipe', recipeId: pick.id },
  }];
}

// (d) Afwijzing-patroon
function ruleRejectionPattern(ctx) {
  const meals = ctx.recentMeals || [];
  const counts = new Map();
  for (const m of meals) {
    if (m.reaction !== 'afwijzing') continue;
    const k = m.recipe_id || m.food_text || null;
    if (!k) continue;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const out = [];
  for (const [key, n] of counts.entries()) {
    if (n < REJECTION_COUNT_THRESHOLD) continue;
    const firstMatch = meals.find((m) => (m.recipe_id || m.food_text) === key);
    const label = firstMatch?.recipe_name || firstMatch?.food_text || 'dit recept';
    out.push({
      key: `suggest-rejection-${String(key).slice(0, 40)}`,
      icon: '💡',
      label: `${n}× afwijzing voor ${label}`,
      sub: 'Overweeg een andere textuur of bereiding.',
      action: { kind: 'show-info', infoKey: 'rejection', recipe: label, count: n },
    });
  }
  return out;
}

// (e) 5+ dagen geen log
function ruleNoRecentLog(ctx) {
  const meals = ctx.recentMeals || [];
  if (meals.length === 0) {
    return [{
      key: 'suggest-no-log',
      icon: '💡',
      label: 'Nog niets gelogd deze week',
      sub: 'Tijd voor een nieuwe maaltijd-log?',
      action: { kind: 'open-meal-log' },
    }];
  }
  // Pak meest recente datum
  const lastIso = meals
    .map((m) => toDateIso(m.eaten_at || m.occurred_at || m.created_at))
    .filter(Boolean)
    .sort()
    .pop();
  if (!lastIso) return [];
  const days = daysSinceIsoDate(lastIso);
  if (days < NO_LOG_DAYS_THRESHOLD) return [];
  return [{
    key: 'suggest-no-log',
    icon: '💡',
    label: `${days} dagen niets gelogd`,
    sub: 'Alles ok? Tijd voor een nieuwe maaltijd-log?',
    action: { kind: 'open-meal-log' },
  }];
}

// (f) Vandaag dubbele entry
function ruleDuplicateMealType(ctx) {
  const meals = ctx.todayMeals || [];
  const counts = new Map();
  for (const m of meals) {
    const t = m.meal_type;
    if (!t) continue;
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  const out = [];
  for (const [type, n] of counts.entries()) {
    if (n < 2) continue;
    out.push({
      key: `suggest-dup-${type}`,
      icon: '💡',
      label: `Vandaag al ${n} × ${capitalize(type)}`,
      sub: 'Dubbele entry? Check je maaltijd-lijst hierboven.',
      action: { kind: 'show-info', infoKey: 'duplicate', mealType: type, count: n },
    });
  }
  return out;
}

// (g) Symptoom-patroon
function ruleSymptomPattern(ctx) {
  const symptoms = ctx.symptoms || [];
  const counts = new Map();
  for (const s of symptoms) {
    const t = s.symptom_type;
    if (!t) continue;
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  const out = [];
  for (const [type, n] of counts.entries()) {
    if (n < SYMPTOM_PATTERN_THRESHOLD) continue;
    const meta = getSymptomMeta(type);
    const label = meta?.label || type;
    out.push({
      key: `suggest-symptom-${type}`,
      icon: '💡',
      label: `${label} ${n}× deze week`,
      sub: 'Mogelijk patroon — bekijk welke maaltijden eraan voorafgingen.',
      action: { kind: 'show-info', infoKey: 'symptom-pattern', symptomType: type, count: n },
    });
  }
  return out;
}

/* ============================================
   Helpers
============================================ */

function daysSinceIsoDate(iso) {
  if (!iso) return Infinity;
  const d = new Date(iso + 'T00:00:00Z').getTime();
  if (Number.isNaN(d)) return Infinity;
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today.getTime() - d) / (24 * 60 * 60 * 1000)));
}

function toDateIso(input) {
  if (!input) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function todayIsoString() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function stableIndex(seed, len) {
  if (!len) return 0;
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return h % len;
}

function capitalize(s) {
  if (!s) return '';
  return s[0].toUpperCase() + s.slice(1);
}
