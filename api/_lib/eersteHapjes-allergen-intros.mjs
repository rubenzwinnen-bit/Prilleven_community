// Helpers voor de Eerste Hapjes allergen_intro_logs-tabel.
// Eén rij = één intro-poging van een allergeen bij een kindje.
// Service-role omzeilt RLS — daarom expliciete eq('user_id') op elke query.

import { supabase } from './clients.mjs';

// Spiegelt js/utils.js ALLERGENS + api/_lib/eersteHapjes-allergens.mjs
// (intentioneel geen DB-constraint — woordenlijst kan groeien zonder migratie).
const ALLERGEN_KEYS = new Set([
  'gluten', 'lactose', 'ei', 'noten', 'pinda',
  'soja', 'vis', 'schaaldieren', 'selderij',
  'mosterd', 'sesam', 'sulfiet', 'lupine',
]);

const REACTIONS = new Set(['geen', 'mild', 'matig', 'heftig', 'onbekend']);
const NOTES_MAX = 500;

const SELECT_COLS =
  'id, child_id, user_id, allergen_key, intro_date, reaction, notes, meal_log_id, linked_symptom_id, created_at, updated_at';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function parseDate(input, fieldLabel = 'Datum') {
  if (input === undefined || input === null || input === '') return null;
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new HttpError(422, `${fieldLabel} moet formaat JJJJ-MM-DD hebben.`);
  }
  const d = new Date(input + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) {
    throw new HttpError(422, `${fieldLabel} is geen geldige datum.`);
  }
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (d.getTime() > today.getTime() + 24 * 60 * 60 * 1000) {
    throw new HttpError(422, `${fieldLabel} kan niet in de toekomst liggen.`);
  }
  return input;
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

async function assertOwnsChild(userId, childId) {
  const { data, error } = await supabase
    .from('children').select('id')
    .eq('user_id', userId).eq('id', childId).maybeSingle();
  if (error) throw new Error('Child ownership: ' + error.message);
  if (!data) throw new HttpError(404, 'Kindje niet gevonden.');
}

async function assertOwnsMealLog(userId, mealLogId) {
  const { data, error } = await supabase
    .from('meal_logs').select('id')
    .eq('user_id', userId).eq('id', mealLogId).maybeSingle();
  if (error) throw new Error('Meal-log ownership: ' + error.message);
  if (!data) throw new HttpError(404, 'Maaltijd niet gevonden.');
}

async function assertOwnsSymptom(userId, symptomId) {
  const { data, error } = await supabase
    .from('child_symptoms').select('id')
    .eq('user_id', userId).eq('id', symptomId).maybeSingle();
  if (error) throw new Error('Symptom ownership: ' + error.message);
  if (!data) throw new HttpError(404, 'Symptoom niet gevonden.');
}

// ============================================================
// Sanitize
// ============================================================
export function sanitizeIntroLogInput(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new HttpError(422, 'Ongeldige invoer.');
  }
  if (typeof raw.child_id !== 'string' || !raw.child_id) {
    throw new HttpError(422, 'Kindje is verplicht.');
  }
  if (typeof raw.allergen_key !== 'string') {
    throw new HttpError(422, 'Allergeen is verplicht.');
  }
  const key = raw.allergen_key.toLowerCase();
  if (!ALLERGEN_KEYS.has(key)) {
    throw new HttpError(422, 'Onbekend allergeen.');
  }

  let reaction = 'geen';
  if (raw.reaction !== undefined && raw.reaction !== null && raw.reaction !== '') {
    if (!REACTIONS.has(raw.reaction)) throw new HttpError(422, 'Ongeldige reactie.');
    reaction = raw.reaction;
  }

  const intro_date = parseDate(raw.intro_date, 'Introductiedatum') || todayIso();
  const notes = sanitizeNotes(raw.notes);

  let meal_log_id = null;
  if (raw.meal_log_id !== undefined && raw.meal_log_id !== null && raw.meal_log_id !== '') {
    if (typeof raw.meal_log_id !== 'string') {
      throw new HttpError(422, 'Ongeldige meal_log_id.');
    }
    meal_log_id = raw.meal_log_id;
  }

  let linked_symptom_id = null;
  if (raw.linked_symptom_id !== undefined && raw.linked_symptom_id !== null && raw.linked_symptom_id !== '') {
    if (typeof raw.linked_symptom_id !== 'string') {
      throw new HttpError(422, 'Ongeldige linked_symptom_id.');
    }
    linked_symptom_id = raw.linked_symptom_id;
  }

  return {
    child_id: raw.child_id,
    allergen_key: key,
    intro_date,
    reaction,
    notes,
    meal_log_id,
    linked_symptom_id,
  };
}

function todayIso() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

// ============================================================
// DB
// ============================================================
export async function loadIntroLogsForChild(userId, childId, opts = {}) {
  await assertOwnsChild(userId, childId);
  let q = supabase
    .from('allergen_intro_logs')
    .select(SELECT_COLS)
    .eq('user_id', userId)
    .eq('child_id', childId)
    .order('intro_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (opts.allergenKey) q = q.eq('allergen_key', opts.allergenKey);
  const { data, error } = await q;
  if (error) throw new Error('Intro-logs load: ' + error.message);
  return data || [];
}

export async function loadIntroLogById(userId, id) {
  const { data, error } = await supabase
    .from('allergen_intro_logs')
    .select(SELECT_COLS)
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error('Intro-log load: ' + error.message);
  return data;
}

export async function createIntroLog(userId, input) {
  await assertOwnsChild(userId, input.child_id);
  if (input.meal_log_id) await assertOwnsMealLog(userId, input.meal_log_id);
  if (input.linked_symptom_id) await assertOwnsSymptom(userId, input.linked_symptom_id);

  const row = { user_id: userId, ...input };
  const { data, error } = await supabase
    .from('allergen_intro_logs')
    .insert(row)
    .select(SELECT_COLS)
    .single();
  if (error) throw new Error('Intro-log insert: ' + error.message);
  return data;
}

export async function deleteIntroLog(userId, id) {
  const existing = await loadIntroLogById(userId, id);
  if (!existing) throw new HttpError(404, 'Intro-log niet gevonden.');
  const { error } = await supabase
    .from('allergen_intro_logs')
    .delete()
    .eq('user_id', userId)
    .eq('id', id);
  if (error) throw new Error('Intro-log delete: ' + error.message);
}

export { HttpError, ALLERGEN_KEYS };
