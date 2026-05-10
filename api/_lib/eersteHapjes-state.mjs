// Helpers voor eerste_hapjes_state + eerste_hapjes_allergen_doses.
// Service-role client → expliciete eq('user_id') overal voor RLS-equivalent.

import { supabase } from './clients.mjs';

// Lijst van 13 allergeen-keys (matcht js/content/eersteHapjes-allergen-flow.js).
// Geen DB-constraint — Anneleen kan flow uitbreiden zonder migratie.
const ALLERGEN_KEYS = new Set([
  'ei-geel', 'ei-wit', 'pinda', 'noten', 'sesam',
  'vis', 'schaaldieren', 'soja',
  'gluten-niet-tarwe', 'tarwe',
  'koemelk', 'honing', 'citrus',
]);

const REACTIONS = new Set(['geen', 'mild', 'ernstig']);
const DIETARY = new Set(['omnivoor', 'pesco', 'vegetarisch', 'vegan']);
const VARIATION = new Set(['gevarieerd', 'simpel']);
const READINESS_SIGNALS = new Set([
  'zitten', 'interesse', 'tongreflex', 'praktisch', 'geen-druk',
]);
const NOTES_MAX = 500;

const STATE_COLS =
  'id, user_id, child_id, readiness_check, current_phase, phase_started_at, ' +
  'dietary, allergen_state, current_week_seed, meals_per_day, variation_level, ' +
  'created_at, updated_at';

const DOSE_COLS =
  'id, user_id, child_id, allergen_key, dose_number, intro_date, reaction, ' +
  'notes, meal_log_id, linked_symptom_id, created_at, updated_at';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- Validation helpers ----------

function isUuid(s) {
  return typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function parseIsoDate(input, label = 'Datum') {
  if (input == null || input === '') return null;
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new HttpError(422, `${label} moet formaat JJJJ-MM-DD hebben.`);
  }
  const d = new Date(input + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) throw new HttpError(422, `${label} is geen geldige datum.`);
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  if (d.getTime() > today.getTime() + 24 * 60 * 60 * 1000) {
    throw new HttpError(422, `${label} kan niet in de toekomst liggen.`);
  }
  return input;
}

function sanitizeNotes(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') throw new HttpError(422, 'Notitie is ongeldig.');
  const t = raw.trim();
  if (!t) return null;
  if (t.length > NOTES_MAX) throw new HttpError(422, `Notitie max ${NOTES_MAX} tekens.`);
  return t;
}

async function assertChildOwned(userId, childId) {
  if (!isUuid(childId)) throw new HttpError(422, 'child_id is ongeldig.');
  const { data, error } = await supabase
    .from('children').select('id').eq('id', childId).eq('user_id', userId).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(404, 'Kindje niet gevonden.');
}

// ---------- State CRUD ----------

export async function loadState(userId, childId) {
  await assertChildOwned(userId, childId);
  const { data, error } = await supabase
    .from('eerste_hapjes_state')
    .select(STATE_COLS)
    .eq('user_id', userId).eq('child_id', childId).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (data) return data;

  // Eerste keer → row aanmaken met defaults
  const { data: created, error: insErr } = await supabase
    .from('eerste_hapjes_state')
    .insert({ user_id: userId, child_id: childId })
    .select(STATE_COLS).single();
  if (insErr) throw new HttpError(500, insErr.message);
  return created;
}

/**
 * Patch fields op eerste_hapjes_state. Velden die niet meegegeven zijn blijven onaangeroerd.
 * Toegelaten fields:
 *   - readiness_check (object)
 *   - current_phase (0/1/2/3/4)
 *   - phase_started_at (iso)
 *   - dietary
 *   - allergen_state (object — wordt deep-merged met bestaand)
 *   - current_week_seed
 *   - meals_per_day
 *   - variation_level
 */
export function sanitizeStatePatch(input) {
  if (!input || typeof input !== 'object') throw new HttpError(400, 'Body ongeldig.');
  const out = {};

  if (input.dietary !== undefined) {
    if (!DIETARY.has(input.dietary)) throw new HttpError(422, 'dietary ongeldig.');
    out.dietary = input.dietary;
  }
  if (input.current_phase !== undefined) {
    const n = Number(input.current_phase);
    if (!Number.isInteger(n) || n < 0 || n > 4) throw new HttpError(422, 'current_phase 0-4.');
    out.current_phase = n;
  }
  if (input.meals_per_day !== undefined) {
    const n = Number(input.meals_per_day);
    if (!Number.isInteger(n) || n < 1 || n > 2) throw new HttpError(422, 'meals_per_day 1-2.');
    out.meals_per_day = n;
  }
  if (input.variation_level !== undefined) {
    if (!VARIATION.has(input.variation_level)) throw new HttpError(422, 'variation_level ongeldig.');
    out.variation_level = input.variation_level;
  }
  if (input.current_week_seed !== undefined) {
    if (input.current_week_seed === null) {
      out.current_week_seed = null;
    } else {
      const s = String(input.current_week_seed).trim();
      if (!s || s.length > 80) throw new HttpError(422, 'current_week_seed ongeldig.');
      out.current_week_seed = s;
    }
  }
  if (input.phase_started_at !== undefined) {
    out.phase_started_at = input.phase_started_at; // optioneel: iso-string of null
  }

  if (input.readiness_check !== undefined) {
    const rc = input.readiness_check;
    if (!rc || typeof rc !== 'object' || Array.isArray(rc)) {
      throw new HttpError(422, 'readiness_check moet een object zijn.');
    }
    const signals = Array.isArray(rc.signals) ? rc.signals : [];
    const cleanSignals = [];
    for (const s of signals) {
      if (!READINESS_SIGNALS.has(s)) throw new HttpError(422, `Onbekend signal: ${s}`);
      if (!cleanSignals.includes(s)) cleanSignals.push(s);
    }
    out.readiness_check = {
      signals: cleanSignals,
      completed_at: cleanSignals.length === READINESS_SIGNALS.size
        ? (rc.completed_at || new Date().toISOString())
        : null,
    };
  }

  if (input.allergen_state !== undefined) {
    const a = input.allergen_state;
    if (!a || typeof a !== 'object' || Array.isArray(a)) {
      throw new HttpError(422, 'allergen_state moet een object zijn.');
    }
    const known = Array.isArray(a.known_allergies) ? a.known_allergies : [];
    for (const k of known) {
      if (!ALLERGEN_KEYS.has(k)) throw new HttpError(422, `Onbekende allergeen-key: ${k}`);
    }
    const excluded = Array.isArray(a.excluded_keys) ? a.excluded_keys : [];
    out.allergen_state = {
      paused: !!a.paused,
      paused_reason: a.paused_reason ? String(a.paused_reason).slice(0, 200) : null,
      paused_allergen: a.paused_allergen && ALLERGEN_KEYS.has(a.paused_allergen) ? a.paused_allergen : null,
      known_allergies: [...new Set(known)],
      excluded_keys: [...new Set(excluded.map(s => String(s).slice(0, 60)))],
    };
  }

  return out;
}

export async function patchState(userId, childId, patch) {
  await assertChildOwned(userId, childId);
  // Zorg dat row bestaat
  await loadState(userId, childId);

  const { data, error } = await supabase
    .from('eerste_hapjes_state')
    .update(patch)
    .eq('user_id', userId).eq('child_id', childId)
    .select(STATE_COLS).single();
  if (error) throw new HttpError(500, error.message);
  return data;
}

// ---------- Doses CRUD ----------

export async function loadDoses(userId, childId, { allergenKey } = {}) {
  await assertChildOwned(userId, childId);
  let q = supabase.from('eerste_hapjes_allergen_doses')
    .select(DOSE_COLS)
    .eq('user_id', userId).eq('child_id', childId)
    .order('intro_date', { ascending: false })
    .order('dose_number', { ascending: false });
  if (allergenKey) q = q.eq('allergen_key', allergenKey);
  const { data, error } = await q;
  if (error) throw new HttpError(500, error.message);
  return data || [];
}

export function sanitizeDoseInput(body) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Body ongeldig.');
  const childId = body.child_id;
  const allergenKey = body.allergen_key;
  const doseNumber = Number(body.dose_number);
  const reaction = body.reaction || 'geen';

  if (!isUuid(childId)) throw new HttpError(422, 'child_id ongeldig.');
  if (typeof allergenKey !== 'string' || !ALLERGEN_KEYS.has(allergenKey)) {
    throw new HttpError(422, 'allergen_key ongeldig.');
  }
  if (!Number.isInteger(doseNumber) || doseNumber < 1 || doseNumber > 3) {
    throw new HttpError(422, 'dose_number moet 1, 2 of 3 zijn.');
  }
  if (!REACTIONS.has(reaction)) throw new HttpError(422, 'reaction ongeldig.');

  return {
    child_id: childId,
    allergen_key: allergenKey,
    dose_number: doseNumber,
    intro_date: parseIsoDate(body.intro_date, 'intro_date') || null,
    reaction,
    notes: sanitizeNotes(body.notes),
    meal_log_id: body.meal_log_id && isUuid(body.meal_log_id) ? body.meal_log_id : null,
    linked_symptom_id: body.linked_symptom_id && isUuid(body.linked_symptom_id) ? body.linked_symptom_id : null,
  };
}

export async function createDose(userId, clean) {
  await assertChildOwned(userId, clean.child_id);
  const row = { user_id: userId, ...clean };
  if (!row.intro_date) delete row.intro_date; // db default = today
  const { data, error } = await supabase
    .from('eerste_hapjes_allergen_doses')
    .insert(row).select(DOSE_COLS).single();
  if (error) {
    // Unique constraint violation = dose-number bestaat al voor dit allergeen+kind
    if (String(error.code) === '23505') {
      throw new HttpError(409, 'Deze dose is al geregistreerd voor dit allergeen.');
    }
    throw new HttpError(500, error.message);
  }
  return data;
}

export async function deleteDose(userId, doseId) {
  if (!isUuid(doseId)) throw new HttpError(422, 'dose_id ongeldig.');
  const { error } = await supabase
    .from('eerste_hapjes_allergen_doses')
    .delete()
    .eq('user_id', userId).eq('id', doseId);
  if (error) throw new HttpError(500, error.message);
  return { ok: true };
}

// ---------- Public exports ----------

export const ALLERGEN_KEYS_LIST = Array.from(ALLERGEN_KEYS);
