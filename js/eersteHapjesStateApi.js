/* ============================================
   EERSTE HAPJES — STATE API (frontend wrapper)
   Praat met /api/eerste-hapjes/state + /api/eerste-hapjes/doses.
   Gebruikt het bestaande sessieToken-patroon (zelfde als eersteHapjesApi.js).
   Geen state-cache hier — caller beheert dat zelf.
============================================ */

import { sessionRefreshIfNeeded } from './supabase.js?v=2.5.2';

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

/** GET state voor 1 kind. Server-side wordt default-rij gemaakt als ontbrekend. */
export async function loadEhState(childId) {
  const data = await call(`/state?child_id=${encodeURIComponent(childId)}`);
  return data.state;
}

/** PATCH partial state. */
export async function patchEhState(childId, patch) {
  const data = await call('/state', {
    method: 'PATCH',
    body: { child_id: childId, ...patch },
  });
  return data.state;
}

/** GET alle allergeen-doses voor een kind (optioneel filter op key). */
export async function loadEhDoses(childId, allergenKey) {
  let path = `/doses?child_id=${encodeURIComponent(childId)}`;
  if (allergenKey) path += `&allergen_key=${encodeURIComponent(allergenKey)}`;
  const data = await call(path);
  return data.doses || [];
}

/** POST nieuwe dose. 409 bij dubbele dose-number per allergeen. */
export async function createEhDose(payload) {
  const data = await call('/doses', { method: 'POST', body: payload });
  return data.dose;
}

/** DELETE 1 dose op id. */
export async function deleteEhDose(doseId) {
  await call(`/doses/${encodeURIComponent(doseId)}`, { method: 'DELETE' });
  return true;
}

/* ============================================
   Helpers — afgeleide state uit doses-array
============================================ */

/**
 * Bouw allergeen-context voor de generator op basis van doses + state.
 */
export function buildAllergenContext(doses, state, ageMonths) {
  const successByKey = {};
  let lastDate = null;

  for (const d of doses) {
    if (d.reaction === 'geen') {
      successByKey[d.allergen_key] = (successByKey[d.allergen_key] || 0) + 1;
    }
    if (!lastDate || d.intro_date > lastDate) lastDate = d.intro_date;
  }

  const completed = [];
  const inProgress = {};
  for (const [key, count] of Object.entries(successByKey)) {
    if (count >= 3) completed.push(key);
    else inProgress[key] = count;
  }

  let daysSinceLastDose = 999;
  if (lastDate) {
    const last = new Date(lastDate + 'T00:00:00Z');
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    daysSinceLastDose = Math.floor((today - last) / 86400000);
  }

  const allergenState = state?.allergen_state || {};
  return {
    ageMonths,
    completed,
    inProgress,
    knownAllergies: allergenState.known_allergies || [],
    paused: !!allergenState.paused,
    daysSinceLastDose,
  };
}
