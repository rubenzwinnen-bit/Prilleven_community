// Helpers voor child_symptoms — gebruikt vanuit de Allergenen-tracker.
// Service-role client omzeilt RLS — daarom op iedere query expliciet filteren
// op user_id (eigenaarschap) én ownership van child_id verifiëren bij insert.

import { supabase } from './clients.mjs';

// ============================================================
// Constants — mirror van DB-CHECK (16 symptoom-types)
// ============================================================
const SYMPTOM_TYPES = new Set([
  'huid','buik','diarree','braken','slaap',
  'koorts','jeuk','zwelling','ademhaling','anders',
  'gewicht','hoesten','verstopping','geen_eetlust','prikkelbaar','lethargie',
]);
const SEVERITIES = new Set(['mild', 'matig', 'heftig']);

// Mirror van js/content/eersteHapjes-allergen-flow.js.
// 'onbekend' is een geldige sentinel-waarde wanneer de gebruiker geen
// link kan/wil leggen, maar wel verplicht een keuze moet maken in de UI.
const ALLERGEN_KEYS = new Set([
  'kippen-ei','pinda','noten','sesam','vis','schaaldieren','soja',
  'tarwe','koemelk',
]);

// Enum-velden — UI-keuzes, opgeslagen als text in DB (nullable).
const TIME_AFTER_EATING = new Set(['direct','snel','later','veel-later','onbekend']);
const DURATION          = new Set(['kort','paar-uur','halve-dag','dag-of-langer','nog-bezig']);
const WORSENED          = new Set(['stabiel','langzaam-erger','snel-erger','minder']);
const BEHAVIOR          = new Set(['normaal','onrustig','ongemakkelijk','suf']);

// ============================================================
// Red-flag-detector — mirror van js/content/eersteHapjes-symptoms.js.
// Backend en frontend constants moeten in sync blijven (handmatig).
// ============================================================
const RED_FLAG_SEVERITIES = {
  huid:         new Set(['heftig']),
  buik:         new Set(['heftig']),
  diarree:      new Set(['heftig']),
  braken:       new Set(['matig', 'heftig']),
  slaap:        new Set(['heftig']),
  koorts:       new Set(['matig', 'heftig']),
  jeuk:         new Set(['heftig']),
  zwelling:     new Set(['matig', 'heftig']),
  ademhaling:   new Set(['mild', 'matig', 'heftig']),
  anders:       new Set(['heftig']),
  gewicht:      new Set(['matig', 'heftig']),
  hoesten:      new Set(['matig', 'heftig']),
  verstopping:  new Set(['heftig']),
  geen_eetlust: new Set(['heftig']),
  prikkelbaar:  new Set(['heftig']),
  lethargie:    new Set(['mild', 'matig', 'heftig']),
};

export function detectRedFlag(symptomType, severity) {
  const set = RED_FLAG_SEVERITIES[symptomType];
  return !!(set && set.has(severity));
}

const NOTES_MAX = 500;

const SYMPTOM_COLS =
  'id, child_id, user_id, occurred_at, symptom_type, severity, meal_log_id, notes, ' +
  'linked_allergen_key, time_after_eating, duration, worsened, behavior, ' +
  'created_at, updated_at';

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
  const max = Date.now() + 24 * 60 * 60 * 1000;
  if (d.getTime() > max) {
    throw new HttpError(422, `${fieldLabel} kan niet in de toekomst liggen.`);
  }
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

function pickEnum(raw, allowedSet, label) {
  if (raw === undefined || raw === null || raw === '') return null;
  const s = String(raw);
  if (!allowedSet.has(s)) throw new HttpError(422, `${label} ongeldig.`);
  return s;
}

function sanitizeLinkedAllergen(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const s = String(raw);
  if (s !== 'onbekend' && !ALLERGEN_KEYS.has(s)) {
    throw new HttpError(422, 'Ongeldig allergeen.');
  }
  return s;
}

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
    linked_allergen_key: sanitizeLinkedAllergen(raw.linked_allergen_key),
    time_after_eating:   pickEnum(raw.time_after_eating, TIME_AFTER_EATING, 'Tijdstip na eten'),
    duration:            pickEnum(raw.duration,          DURATION,          'Duur'),
    worsened:            pickEnum(raw.worsened,          WORSENED,          'Verloop'),
    behavior:            pickEnum(raw.behavior,          BEHAVIOR,          'Gedrag'),
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
  if (raw.linked_allergen_key !== undefined) {
    updates.linked_allergen_key = sanitizeLinkedAllergen(raw.linked_allergen_key);
  }
  if (raw.time_after_eating !== undefined) {
    updates.time_after_eating = pickEnum(raw.time_after_eating, TIME_AFTER_EATING, 'Tijdstip na eten');
  }
  if (raw.duration !== undefined) {
    updates.duration = pickEnum(raw.duration, DURATION, 'Duur');
  }
  if (raw.worsened !== undefined) {
    updates.worsened = pickEnum(raw.worsened, WORSENED, 'Verloop');
  }
  if (raw.behavior !== undefined) {
    updates.behavior = pickEnum(raw.behavior, BEHAVIOR, 'Gedrag');
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
