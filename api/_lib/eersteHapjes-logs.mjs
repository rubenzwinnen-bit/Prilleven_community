// Helpers voor de Eerste Hapjes log-tabellen: meal_logs + child_symptoms.
// Service-role client omzeilt RLS — daarom op iedere query expliciet filteren
// op user_id (eigenaarschap) én ownership van child_id verifiëren bij insert.

import { supabase } from './clients.mjs';

// ============================================================
// Constants
// ============================================================
const MEAL_TYPES   = new Set(['ontbijt', 'lunch', 'diner', 'snack']);
const AMOUNTS      = new Set(['klein', 'medium', 'groot']);
const REACTIONS    = new Set(['positief', 'neutraal', 'afwijzing']);
const SYMPTOM_TYPES = new Set([
  'huid','buik','diarree','braken','slaap',
  'koorts','jeuk','zwelling','ademhaling','anders',
]);
const SEVERITIES   = new Set(['mild', 'matig', 'heftig']);

const FOOD_MIN  = 1;
const FOOD_MAX  = 200;
const NOTES_MAX = 500;

const MEAL_COLS =
  'id, child_id, user_id, eaten_at, meal_type, amount, reaction, food_text, recipe_id, notes, created_at, updated_at';
const SYMPTOM_COLS =
  'id, child_id, user_id, occurred_at, symptom_type, severity, meal_log_id, notes, created_at, updated_at';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ============================================================
// Shared helpers
// ============================================================
function parseTimestamp(input, fieldLabel) {
  if (input === undefined || input === null || input === '') return null;
  if (typeof input !== 'string') {
    throw new HttpError(422, `${fieldLabel} is geen geldige datum.`);
  }
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) {
    throw new HttpError(422, `${fieldLabel} is geen geldige datum.`);
  }
  // Niet meer dan 1 dag in de toekomst (tijdzone-marge).
  const max = Date.now() + 24 * 60 * 60 * 1000;
  if (d.getTime() > max) {
    throw new HttpError(422, `${fieldLabel} kan niet in de toekomst liggen.`);
  }
  // Niet ouder dan 5 jaar.
  const min = Date.now() - 5 * 365 * 24 * 60 * 60 * 1000;
  if (d.getTime() < min) {
    throw new HttpError(422, `${fieldLabel} ligt te ver in het verleden.`);
  }
  return d.toISOString();
}

function sanitizeNotes(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new HttpError(422, 'Notitie is ongeldig.');
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > NOTES_MAX) {
    throw new HttpError(422, `Notitie mag maximaal ${NOTES_MAX} tekens zijn.`);
  }
  return trimmed;
}

/**
 * Ownership-check: het opgegeven child_id moet van userId zijn.
 * Gooit HttpError(404) als niet.
 */
async function assertOwnsChild(userId, childId) {
  const { data, error } = await supabase
    .from('children')
    .select('id')
    .eq('user_id', userId)
    .eq('id', childId)
    .maybeSingle();
  if (error) throw new Error('Child ownership: ' + error.message);
  if (!data) throw new HttpError(404, 'Kindje niet gevonden.');
}

/**
 * Ownership-check: het opgegeven meal_log_id moet van userId zijn.
 * Gooit HttpError(404) als niet.
 */
async function assertOwnsMealLog(userId, mealLogId) {
  const { data, error } = await supabase
    .from('meal_logs')
    .select('id')
    .eq('user_id', userId)
    .eq('id', mealLogId)
    .maybeSingle();
  if (error) throw new Error('Meal-log ownership: ' + error.message);
  if (!data) throw new HttpError(404, 'Maaltijd-log niet gevonden.');
}

// ============================================================
// MEAL LOGS — sanitize
// ============================================================
export function sanitizeMealInput(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new HttpError(422, 'Ongeldige invoer.');
  }

  // child_id (verplicht, ownership wordt later in createMealLog gecheckt)
  if (typeof raw.child_id !== 'string' || !raw.child_id) {
    throw new HttpError(422, 'Kindje is verplicht.');
  }

  // meal_type (verplicht)
  if (typeof raw.meal_type !== 'string' || !MEAL_TYPES.has(raw.meal_type)) {
    throw new HttpError(422, 'Ongeldig maaltijdtype.');
  }

  // food_text (verplicht)
  if (typeof raw.food_text !== 'string') {
    throw new HttpError(422, 'Wat is er gegeten? Vul iets in.');
  }
  const food_text = raw.food_text.trim().replace(/\s+/g, ' ');
  if (food_text.length < FOOD_MIN) {
    throw new HttpError(422, 'Wat is er gegeten? Vul iets in.');
  }
  if (food_text.length > FOOD_MAX) {
    throw new HttpError(422, `Voedseltekst mag maximaal ${FOOD_MAX} tekens zijn.`);
  }

  // eaten_at (optioneel, default = nu via DB)
  const eaten_at = parseTimestamp(raw.eaten_at, 'Tijdstip');

  // amount (optioneel)
  let amount = null;
  if (raw.amount !== undefined && raw.amount !== null && raw.amount !== '') {
    if (!AMOUNTS.has(raw.amount)) throw new HttpError(422, 'Ongeldige hoeveelheid.');
    amount = raw.amount;
  }

  // reaction (optioneel)
  let reaction = null;
  if (raw.reaction !== undefined && raw.reaction !== null && raw.reaction !== '') {
    if (!REACTIONS.has(raw.reaction)) throw new HttpError(422, 'Ongeldige reactie.');
    reaction = raw.reaction;
  }

  // recipe_id (optioneel, vrije text-id naar recipes.id)
  let recipe_id = null;
  if (raw.recipe_id !== undefined && raw.recipe_id !== null && raw.recipe_id !== '') {
    if (typeof raw.recipe_id !== 'string' || raw.recipe_id.length > 64) {
      throw new HttpError(422, 'Ongeldige recipe_id.');
    }
    recipe_id = raw.recipe_id;
  }

  // notes (optioneel)
  const notes = sanitizeNotes(raw.notes);

  const out = {
    child_id: raw.child_id,
    meal_type: raw.meal_type,
    food_text,
    amount,
    reaction,
    recipe_id,
    notes,
  };
  if (eaten_at) out.eaten_at = eaten_at;
  return out;
}

export function sanitizeMealPatch(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new HttpError(422, 'Ongeldige invoer.');
  }
  const updates = {};

  if (raw.meal_type !== undefined) {
    if (!MEAL_TYPES.has(raw.meal_type)) throw new HttpError(422, 'Ongeldig maaltijdtype.');
    updates.meal_type = raw.meal_type;
  }
  if (raw.food_text !== undefined) {
    if (typeof raw.food_text !== 'string') throw new HttpError(422, 'Wat is er gegeten? Vul iets in.');
    const food = raw.food_text.trim().replace(/\s+/g, ' ');
    if (food.length < FOOD_MIN) throw new HttpError(422, 'Wat is er gegeten? Vul iets in.');
    if (food.length > FOOD_MAX) throw new HttpError(422, `Voedseltekst mag maximaal ${FOOD_MAX} tekens zijn.`);
    updates.food_text = food;
  }
  if (raw.eaten_at !== undefined) {
    const ts = parseTimestamp(raw.eaten_at, 'Tijdstip');
    if (!ts) throw new HttpError(422, 'Tijdstip is ongeldig.');
    updates.eaten_at = ts;
  }
  if (raw.amount !== undefined) {
    if (raw.amount === null || raw.amount === '') {
      updates.amount = null;
    } else if (AMOUNTS.has(raw.amount)) {
      updates.amount = raw.amount;
    } else {
      throw new HttpError(422, 'Ongeldige hoeveelheid.');
    }
  }
  if (raw.reaction !== undefined) {
    if (raw.reaction === null || raw.reaction === '') {
      updates.reaction = null;
    } else if (REACTIONS.has(raw.reaction)) {
      updates.reaction = raw.reaction;
    } else {
      throw new HttpError(422, 'Ongeldige reactie.');
    }
  }
  if (raw.recipe_id !== undefined) {
    if (raw.recipe_id === null || raw.recipe_id === '') {
      updates.recipe_id = null;
    } else if (typeof raw.recipe_id === 'string' && raw.recipe_id.length <= 64) {
      updates.recipe_id = raw.recipe_id;
    } else {
      throw new HttpError(422, 'Ongeldige recipe_id.');
    }
  }
  if (raw.notes !== undefined) {
    updates.notes = sanitizeNotes(raw.notes);
  }

  if (Object.keys(updates).length === 0) {
    throw new HttpError(422, 'Geen wijzigingen meegegeven.');
  }
  return updates;
}

// ============================================================
// MEAL LOGS — DB
// ============================================================
/**
 * Lijst maaltijd-logs per kindje. Filters: from/to (ISO-datums optioneel).
 * Owner-check via expliciete eq('user_id', userId).
 */
export async function loadMealsForChild(userId, childId, { from, to, limit = 200 } = {}) {
  // Eerst ownership van kindje verifiëren — anders zou een vreemde child_id ook 0 rows geven (verwarrend).
  await assertOwnsChild(userId, childId);

  let q = supabase
    .from('meal_logs')
    .select(MEAL_COLS)
    .eq('user_id', userId)
    .eq('child_id', childId)
    .order('eaten_at', { ascending: false })
    .limit(Math.min(limit, 500));

  if (from) q = q.gte('eaten_at', from);
  if (to)   q = q.lte('eaten_at', to);

  const { data, error } = await q;
  if (error) throw new Error('Meal load: ' + error.message);
  return data || [];
}

export async function loadMealById(userId, id) {
  const { data, error } = await supabase
    .from('meal_logs')
    .select(MEAL_COLS)
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error('Meal load: ' + error.message);
  return data;
}

export async function createMealLog(userId, input) {
  // Ownership van child_id verifiëren vóór insert.
  await assertOwnsChild(userId, input.child_id);

  const row = { user_id: userId, ...input };
  const { data, error } = await supabase
    .from('meal_logs')
    .insert(row)
    .select(MEAL_COLS)
    .single();
  if (error) throw new Error('Meal create: ' + error.message);
  return data;
}

export async function updateMealLog(userId, id, updates) {
  const { data, error } = await supabase
    .from('meal_logs')
    .update(updates)
    .eq('user_id', userId)
    .eq('id', id)
    .select(MEAL_COLS)
    .maybeSingle();
  if (error) throw new Error('Meal update: ' + error.message);
  if (!data) throw new HttpError(404, 'Maaltijd-log niet gevonden.');
  return data;
}

export async function deleteMealLog(userId, id) {
  const existing = await loadMealById(userId, id);
  if (!existing) throw new HttpError(404, 'Maaltijd-log niet gevonden.');
  const { error } = await supabase
    .from('meal_logs')
    .delete()
    .eq('user_id', userId)
    .eq('id', id);
  if (error) throw new Error('Meal delete: ' + error.message);
}

// ============================================================
// SYMPTOMS — sanitize
// ============================================================
export function sanitizeSymptomInput(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new HttpError(422, 'Ongeldige invoer.');
  }

  if (typeof raw.child_id !== 'string' || !raw.child_id) {
    throw new HttpError(422, 'Kindje is verplicht.');
  }
  if (typeof raw.symptom_type !== 'string' || !SYMPTOM_TYPES.has(raw.symptom_type)) {
    throw new HttpError(422, 'Ongeldig symptoomtype.');
  }
  if (typeof raw.severity !== 'string' || !SEVERITIES.has(raw.severity)) {
    throw new HttpError(422, 'Ongeldige ernst.');
  }

  const occurred_at = parseTimestamp(raw.occurred_at, 'Tijdstip');

  let meal_log_id = null;
  if (raw.meal_log_id !== undefined && raw.meal_log_id !== null && raw.meal_log_id !== '') {
    if (typeof raw.meal_log_id !== 'string') {
      throw new HttpError(422, 'Ongeldige meal_log_id.');
    }
    meal_log_id = raw.meal_log_id;
  }

  const notes = sanitizeNotes(raw.notes);

  const out = {
    child_id: raw.child_id,
    symptom_type: raw.symptom_type,
    severity: raw.severity,
    meal_log_id,
    notes,
  };
  if (occurred_at) out.occurred_at = occurred_at;
  return out;
}

export function sanitizeSymptomPatch(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new HttpError(422, 'Ongeldige invoer.');
  }
  const updates = {};

  if (raw.symptom_type !== undefined) {
    if (!SYMPTOM_TYPES.has(raw.symptom_type)) throw new HttpError(422, 'Ongeldig symptoomtype.');
    updates.symptom_type = raw.symptom_type;
  }
  if (raw.severity !== undefined) {
    if (!SEVERITIES.has(raw.severity)) throw new HttpError(422, 'Ongeldige ernst.');
    updates.severity = raw.severity;
  }
  if (raw.occurred_at !== undefined) {
    const ts = parseTimestamp(raw.occurred_at, 'Tijdstip');
    if (!ts) throw new HttpError(422, 'Tijdstip is ongeldig.');
    updates.occurred_at = ts;
  }
  if (raw.meal_log_id !== undefined) {
    if (raw.meal_log_id === null || raw.meal_log_id === '') {
      updates.meal_log_id = null;
    } else if (typeof raw.meal_log_id === 'string') {
      updates.meal_log_id = raw.meal_log_id;
    } else {
      throw new HttpError(422, 'Ongeldige meal_log_id.');
    }
  }
  if (raw.notes !== undefined) {
    updates.notes = sanitizeNotes(raw.notes);
  }

  if (Object.keys(updates).length === 0) {
    throw new HttpError(422, 'Geen wijzigingen meegegeven.');
  }
  return updates;
}

// ============================================================
// SYMPTOMS — DB
// ============================================================
export async function loadSymptomsForChild(userId, childId, { from, to, limit = 200 } = {}) {
  await assertOwnsChild(userId, childId);

  let q = supabase
    .from('child_symptoms')
    .select(SYMPTOM_COLS)
    .eq('user_id', userId)
    .eq('child_id', childId)
    .order('occurred_at', { ascending: false })
    .limit(Math.min(limit, 500));

  if (from) q = q.gte('occurred_at', from);
  if (to)   q = q.lte('occurred_at', to);

  const { data, error } = await q;
  if (error) throw new Error('Symptom load: ' + error.message);
  return data || [];
}

export async function loadSymptomById(userId, id) {
  const { data, error } = await supabase
    .from('child_symptoms')
    .select(SYMPTOM_COLS)
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error('Symptom load: ' + error.message);
  return data;
}

export async function createSymptom(userId, input) {
  await assertOwnsChild(userId, input.child_id);
  if (input.meal_log_id) {
    await assertOwnsMealLog(userId, input.meal_log_id);
  }

  const row = { user_id: userId, ...input };
  const { data, error } = await supabase
    .from('child_symptoms')
    .insert(row)
    .select(SYMPTOM_COLS)
    .single();
  if (error) throw new Error('Symptom create: ' + error.message);
  return data;
}

export async function updateSymptom(userId, id, updates) {
  if (updates.meal_log_id) {
    await assertOwnsMealLog(userId, updates.meal_log_id);
  }
  const { data, error } = await supabase
    .from('child_symptoms')
    .update(updates)
    .eq('user_id', userId)
    .eq('id', id)
    .select(SYMPTOM_COLS)
    .maybeSingle();
  if (error) throw new Error('Symptom update: ' + error.message);
  if (!data) throw new HttpError(404, 'Symptoom niet gevonden.');
  return data;
}

export async function deleteSymptom(userId, id) {
  const existing = await loadSymptomById(userId, id);
  if (!existing) throw new HttpError(404, 'Symptoom niet gevonden.');
  const { error } = await supabase
    .from('child_symptoms')
    .delete()
    .eq('user_id', userId)
    .eq('id', id);
  if (error) throw new Error('Symptom delete: ' + error.message);
}

export { HttpError };
