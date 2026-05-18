/* ============================================
   EERSTE HAPJES — SYMPTOMS API (frontend wrapper)
   Praat met /api/eerste-hapjes/symptoms (+ /[id]).
   Patroon identiek aan eersteHapjesStateApi.js.
============================================ */

import { sessionRefreshIfNeeded } from './supabase.js?v=2.5.7';

async function call(path, { method = 'GET', body = null } = {}) {
  const session = await sessionRefreshIfNeeded();
  if (!session) throw new Error('Niet ingelogd.');

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
    throw new Error(data?.error || `Server-fout (${res.status}).`);
  }
  return data;
}

/**
 * GET symptomen voor een kindje.
 * @param {string} childId
 * @param {{from?: string, to?: string}} [opts]
 * @returns {Promise<Array>}
 */
export async function loadSymptomsForChild(childId, { from, to } = {}) {
  let path = `/symptoms?child_id=${encodeURIComponent(childId)}`;
  if (from) path += `&from=${encodeURIComponent(from)}`;
  if (to)   path += `&to=${encodeURIComponent(to)}`;
  const data = await call(path);
  return data.symptoms || [];
}

/**
 * POST nieuw symptoom. Server geeft red_flag = boolean terug.
 * @param {object} payload — { child_id, symptom_type, severity, occurred_at?, meal_log_id?, notes? }
 * @returns {Promise<{symptom: object, red_flag: boolean}>}
 */
export async function createSymptom(payload) {
  const data = await call('/symptoms', { method: 'POST', body: payload });
  return { symptom: data.symptom, red_flag: !!data.red_flag };
}

/** PATCH symptoom op id. */
export async function updateSymptom(id, patch) {
  const data = await call(`/symptoms/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: patch,
  });
  return data.symptom;
}

/** DELETE symptoom op id. */
export async function deleteSymptom(id) {
  await call(`/symptoms/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return true;
}
