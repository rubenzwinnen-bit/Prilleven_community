/* ============================================
   EERSTE HAPJES API HELPER
   Wrapt /api/eerste-hapjes/* calls met automatische
   sessie-refresh + Authorization header.
   Geeft altijd { ok, status, data, error } terug.
============================================ */

import { sessionRefreshIfNeeded } from './supabase.js?v=2.23.0';

async function call(path, { method = 'GET', body = null } = {}) {
  const session = await sessionRefreshIfNeeded();
  if (!session) {
    return { ok: false, status: 401, data: null, error: 'Niet ingelogd.' };
  }

  const res = await fetch('/api/eerste-hapjes' + path, {
    method,
    headers: {
      'Authorization': 'Bearer ' + session.access_token,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try { data = await res.json(); } catch { /* lege body ok */ }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      data,
      error: data?.error || `Server-fout (${res.status}).`,
    };
  }
  return { ok: true, status: res.status, data, error: null };
}

/* ----- Children ----- */
export const getMyChildren = ({ includeArchived = false } = {}) =>
  call('/children' + (includeArchived ? '?include_archived=1' : ''));

export const createChild = ({ name, birthdate, texture_preference = null }) =>
  call('/children', {
    method: 'POST',
    body: { name, birthdate, texture_preference },
  });

export const updateChild = (id, updates) =>
  call(`/children/${encodeURIComponent(id)}`, { method: 'PATCH', body: updates });

export const deleteChild = (id) =>
  call(`/children/${encodeURIComponent(id)}`, { method: 'DELETE' });

/* ----- Meal logs ----- */
export const getMealsForChild = (childId, { from, to } = {}) => {
  const params = new URLSearchParams({ child_id: childId });
  if (from) params.set('from', from);
  if (to)   params.set('to', to);
  return call('/meals?' + params.toString());
};

export const createMealLog = (payload) =>
  call('/meals', { method: 'POST', body: payload });

export const updateMealLog = (id, updates) =>
  call(`/meals/${encodeURIComponent(id)}`, { method: 'PATCH', body: updates });

export const deleteMealLog = (id) =>
  call(`/meals/${encodeURIComponent(id)}`, { method: 'DELETE' });

/* ----- Symptoms ----- */
export const getSymptomsForChild = (childId, { from, to } = {}) => {
  const params = new URLSearchParams({ child_id: childId });
  if (from) params.set('from', from);
  if (to)   params.set('to', to);
  return call('/symptoms?' + params.toString());
};

export const createSymptom = (payload) =>
  call('/symptoms', { method: 'POST', body: payload });

export const updateSymptom = (id, updates) =>
  call(`/symptoms/${encodeURIComponent(id)}`, { method: 'PATCH', body: updates });

export const deleteSymptom = (id) =>
  call(`/symptoms/${encodeURIComponent(id)}`, { method: 'DELETE' });

/* ----- Allergens ----- */
export const getAllergensForChild = (childId) =>
  call('/allergens?' + new URLSearchParams({ child_id: childId }).toString());

export const upsertAllergen = (payload) =>
  call('/allergens', { method: 'POST', body: payload });

export const updateAllergen = (id, updates) =>
  call(`/allergens/${encodeURIComponent(id)}`, { method: 'PATCH', body: updates });

export const deleteAllergen = (id) =>
  call(`/allergens/${encodeURIComponent(id)}`, { method: 'DELETE' });

/* ----- Allergen intro logs ----- */
export const getAllergenIntros = (childId, { allergenKey } = {}) => {
  const params = new URLSearchParams({ child_id: childId });
  if (allergenKey) params.set('allergen_key', allergenKey);
  return call('/allergen-intros?' + params.toString());
};

export const createAllergenIntro = (payload) =>
  call('/allergen-intros', { method: 'POST', body: payload });

export const deleteAllergenIntro = (id) =>
  call(`/allergen-intros/${encodeURIComponent(id)}`, { method: 'DELETE' });

/* ----- Phases ----- */
export const getPhases = (childId) =>
  call('/phases?' + new URLSearchParams({ child_id: childId }).toString());

export const togglePhaseCheck = ({ child_id, phase_number, check_key, checked }) =>
  call('/phases/check', {
    method: 'POST',
    body: { child_id, phase_number, check_key, checked },
  });

export const advancePhase = ({ child_id, from_phase }) =>
  call('/phases/advance', {
    method: 'POST',
    body: { child_id, from_phase },
  });
