// Helpers rond de Eerste Hapjes 'children'-tabel.
// Service-role client omzeilt RLS — dus user_id wordt EXPLICIET meegefilterd
// op iedere query om eigenaarschap af te dwingen.

import { supabase } from './clients.mjs';

const TEXTURE_VALUES = new Set(['puree', 'stukjes', 'combi']);
const NAME_MIN = 1;
const NAME_MAX = 50;
const MAX_AGE_YEARS = 10;

const SELECT_COLS =
  'id, user_id, name, birthdate, texture_preference, archived_at, created_at, updated_at';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/**
 * Valideer + normaliseer ruwe input voor INSERT.
 * Vereist: name, birthdate. Optioneel: texture_preference.
 * Gooit HttpError(422) bij invalide input.
 */
export function sanitizeChildInput(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new HttpError(422, 'Ongeldige invoer.');
  }

  // name
  if (typeof raw.name !== 'string') {
    throw new HttpError(422, 'Naam is verplicht.');
  }
  const name = raw.name.trim().replace(/\s+/g, ' ');
  if (name.length < NAME_MIN) {
    throw new HttpError(422, 'Naam is verplicht.');
  }
  if (name.length > NAME_MAX) {
    throw new HttpError(422, `Naam mag maximaal ${NAME_MAX} tekens lang zijn.`);
  }

  // birthdate (YYYY-MM-DD)
  const birthdate = parseBirthdate(raw.birthdate);

  // texture_preference (optioneel)
  let texture_preference = null;
  if (raw.texture_preference !== undefined && raw.texture_preference !== null && raw.texture_preference !== '') {
    if (!TEXTURE_VALUES.has(raw.texture_preference)) {
      throw new HttpError(422, 'Ongeldige structuurvoorkeur.');
    }
    texture_preference = raw.texture_preference;
  }

  return { name, birthdate, texture_preference };
}

/**
 * Valideer + normaliseer ruwe input voor PATCH (partial update).
 * Alleen meegestuurde velden worden gevalideerd. Returnt object met
 * uitsluitend de te wijzigen kolommen (geen lege objecten).
 */
export function sanitizeChildPatch(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new HttpError(422, 'Ongeldige invoer.');
  }
  const updates = {};

  if (raw.name !== undefined) {
    if (typeof raw.name !== 'string') throw new HttpError(422, 'Naam is verplicht.');
    const name = raw.name.trim().replace(/\s+/g, ' ');
    if (name.length < NAME_MIN) throw new HttpError(422, 'Naam is verplicht.');
    if (name.length > NAME_MAX) throw new HttpError(422, `Naam mag maximaal ${NAME_MAX} tekens lang zijn.`);
    updates.name = name;
  }

  if (raw.birthdate !== undefined) {
    updates.birthdate = parseBirthdate(raw.birthdate);
  }

  if (raw.texture_preference !== undefined) {
    if (raw.texture_preference === null || raw.texture_preference === '') {
      updates.texture_preference = null;
    } else if (TEXTURE_VALUES.has(raw.texture_preference)) {
      updates.texture_preference = raw.texture_preference;
    } else {
      throw new HttpError(422, 'Ongeldige structuurvoorkeur.');
    }
  }

  // archived_at: alleen toggle ondersteunen (true/false), geen vrije timestamp.
  if (raw.archived !== undefined) {
    updates.archived_at = raw.archived ? new Date().toISOString() : null;
  }

  if (Object.keys(updates).length === 0) {
    throw new HttpError(422, 'Geen wijzigingen meegegeven.');
  }
  return updates;
}

function parseBirthdate(input) {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new HttpError(422, 'Geboortedatum moet formaat JJJJ-MM-DD hebben.');
  }
  const d = new Date(input + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) {
    throw new HttpError(422, 'Geboortedatum is geen geldige datum.');
  }
  // Niet in de toekomst, niet meer dan 10 jaar terug.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (d.getTime() > today.getTime()) {
    throw new HttpError(422, 'Geboortedatum kan niet in de toekomst liggen.');
  }
  const minDate = new Date(today);
  minDate.setUTCFullYear(minDate.getUTCFullYear() - MAX_AGE_YEARS);
  if (d.getTime() < minDate.getTime()) {
    throw new HttpError(422, `Geboortedatum mag maximaal ${MAX_AGE_YEARS} jaar terug liggen.`);
  }
  return input;
}

/**
 * Lijst van eigen kindjes. Standaard exclusief gearchiveerde.
 * Sortering: actieven eerst, daarna op birthdate (jongste eerst).
 */
export async function loadMyChildren(userId, { includeArchived = false } = {}) {
  let q = supabase
    .from('children')
    .select(SELECT_COLS)
    .eq('user_id', userId)
    .order('archived_at', { ascending: true, nullsFirst: true })
    .order('birthdate', { ascending: false });
  if (!includeArchived) q = q.is('archived_at', null);
  const { data, error } = await q;
  if (error) throw new Error('Children load: ' + error.message);
  return data || [];
}

/** Eén kindje ophalen, eigenaarschap-check op user_id. Returnt null als niet gevonden. */
export async function loadChildById(userId, id) {
  const { data, error } = await supabase
    .from('children')
    .select(SELECT_COLS)
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error('Child load: ' + error.message);
  return data;
}

/** Nieuw kindje aanmaken voor user. */
export async function createChild(userId, input) {
  const row = { user_id: userId, ...input };
  const { data, error } = await supabase
    .from('children')
    .insert(row)
    .select(SELECT_COLS)
    .single();
  if (error) throw new Error('Child create: ' + error.message);
  return data;
}

/** Kindje updaten. Gooit HttpError(404) als kindje niet van user is. */
export async function updateChild(userId, id, updates) {
  const { data, error } = await supabase
    .from('children')
    .update(updates)
    .eq('user_id', userId)
    .eq('id', id)
    .select(SELECT_COLS)
    .maybeSingle();
  if (error) throw new Error('Child update: ' + error.message);
  if (!data) throw new HttpError(404, 'Kindje niet gevonden.');
  return data;
}

/** Kindje permanent verwijderen. Gooit HttpError(404) als niet van user. */
export async function deleteChild(userId, id) {
  // Eerst bestaan + ownership checken zodat we 404 kunnen geven.
  const existing = await loadChildById(userId, id);
  if (!existing) throw new HttpError(404, 'Kindje niet gevonden.');
  const { error } = await supabase
    .from('children')
    .delete()
    .eq('user_id', userId)
    .eq('id', id);
  if (error) throw new Error('Child delete: ' + error.message);
}

export { HttpError };
