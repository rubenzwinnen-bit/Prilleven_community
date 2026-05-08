// Helpers voor de Eerste Hapjes child_allergens-tabel.
// Service-role omzeilt RLS — daarom expliciete eq('user_id') op elke query
// + ownership-check op child_id en optioneel linked_symptom_id.

import { supabase } from './clients.mjs';

// Vocabulaire — match exact met js/utils.js ALLERGENS-constante.
// Houd deze synced. (Bewust geen DB-constraint zodat woordenlijst client-side
// flexibel blijft zonder migratie nodig.)
const ALLERGEN_KEYS = new Set([
  'gluten', 'lactose', 'ei', 'noten', 'pinda',
  'soja', 'vis', 'schaaldieren', 'selderij',
  'mosterd', 'sesam', 'sulfiet', 'lupine',
]);

const STATUSES  = new Set(['gepland', 'geprobeerd', 'vermijden']);
const REACTIONS = new Set(['geen', 'mild', 'matig', 'heftig', 'onbekend']);
const NOTES_MAX = 500;

const SELECT_COLS =
  'id, child_id, user_id, allergen_key, status, reaction, intro_date, notes, linked_symptom_id, created_at, updated_at';

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
  // Niet meer dan 1 dag in de toekomst (tijdzone-marge).
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
export function sanitizeAllergenInput(raw) {
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
  if (typeof raw.status !== 'string' || !STATUSES.has(raw.status)) {
    throw new HttpError(422, 'Ongeldige status.');
  }

  let reaction = null;
  if (raw.reaction !== undefined && raw.reaction !== null && raw.reaction !== '') {
    if (!REACTIONS.has(raw.reaction)) throw new HttpError(422, 'Ongeldige reactie.');
    reaction = raw.reaction;
  }

  const intro_date = parseDate(raw.intro_date, 'Introductiedatum');
  const notes = sanitizeNotes(raw.notes);

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
    status: raw.status,
    reaction,
    intro_date,
    notes,
    linked_symptom_id,
  };
}

export function sanitizeAllergenPatch(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new HttpError(422, 'Ongeldige invoer.');
  }
  const updates = {};

  if (raw.status !== undefined) {
    if (!STATUSES.has(raw.status)) throw new HttpError(422, 'Ongeldige status.');
    updates.status = raw.status;
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
  if (raw.intro_date !== undefined) {
    if (raw.intro_date === null || raw.intro_date === '') {
      updates.intro_date = null;
    } else {
      updates.intro_date = parseDate(raw.intro_date, 'Introductiedatum');
    }
  }
  if (raw.notes !== undefined) {
    updates.notes = sanitizeNotes(raw.notes);
  }
  if (raw.linked_symptom_id !== undefined) {
    if (raw.linked_symptom_id === null || raw.linked_symptom_id === '') {
      updates.linked_symptom_id = null;
    } else if (typeof raw.linked_symptom_id === 'string') {
      updates.linked_symptom_id = raw.linked_symptom_id;
    } else {
      throw new HttpError(422, 'Ongeldige linked_symptom_id.');
    }
  }

  if (Object.keys(updates).length === 0) {
    throw new HttpError(422, 'Geen wijzigingen meegegeven.');
  }
  return updates;
}

// ============================================================
// DB
// ============================================================
export async function loadAllergensForChild(userId, childId) {
  await assertOwnsChild(userId, childId);
  const { data, error } = await supabase
    .from('child_allergens')
    .select(SELECT_COLS)
    .eq('user_id', userId)
    .eq('child_id', childId)
    .order('allergen_key', { ascending: true });
  if (error) throw new Error('Allergen load: ' + error.message);
  return data || [];
}

export async function loadAllergenById(userId, id) {
  const { data, error } = await supabase
    .from('child_allergens')
    .select(SELECT_COLS)
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error('Allergen load: ' + error.message);
  return data;
}

/**
 * Upsert per (child_id, allergen_key). Vervangt bestaande rij.
 * Doet ownership-check op child_id én optioneel linked_symptom_id.
 */
export async function upsertAllergen(userId, input) {
  await assertOwnsChild(userId, input.child_id);
  if (input.linked_symptom_id) {
    await assertOwnsSymptom(userId, input.linked_symptom_id);
  }

  const row = { user_id: userId, ...input };
  const { data, error } = await supabase
    .from('child_allergens')
    .upsert(row, { onConflict: 'child_id,allergen_key' })
    .select(SELECT_COLS)
    .single();
  if (error) throw new Error('Allergen upsert: ' + error.message);
  return data;
}

export async function updateAllergen(userId, id, updates) {
  if (updates.linked_symptom_id) {
    await assertOwnsSymptom(userId, updates.linked_symptom_id);
  }
  const { data, error } = await supabase
    .from('child_allergens')
    .update(updates)
    .eq('user_id', userId)
    .eq('id', id)
    .select(SELECT_COLS)
    .maybeSingle();
  if (error) throw new Error('Allergen update: ' + error.message);
  if (!data) throw new HttpError(404, 'Allergeen niet gevonden.');
  return data;
}

export async function deleteAllergen(userId, id) {
  const existing = await loadAllergenById(userId, id);
  if (!existing) throw new HttpError(404, 'Allergeen niet gevonden.');
  const { error } = await supabase
    .from('child_allergens')
    .delete()
    .eq('user_id', userId)
    .eq('id', id);
  if (error) throw new Error('Allergen delete: ' + error.message);
}

export { HttpError, ALLERGEN_KEYS };
