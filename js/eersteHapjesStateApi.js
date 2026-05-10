/* ============================================
   EERSTE HAPJES — STATE API (frontend wrapper)
   Praat met /api/eerste-hapjes/state + /api/eerste-hapjes/doses.
   Geen state-cache hier — caller beheert dat zelf.
============================================ */

import { supabaseFetch } from './supabase.js?v=2.25.0';

/** GET state voor 1 kind. Server-side wordt default-rij gemaakt als ontbrekend. */
export async function loadEhState(childId) {
  const r = await supabaseFetch(`/api/eerste-hapjes/state?child_id=${encodeURIComponent(childId)}`);
  if (!r.ok) throw new Error(`state load: ${r.status}`);
  const j = await r.json();
  return j.state;
}

/** PATCH partial state. */
export async function patchEhState(childId, patch) {
  const r = await supabaseFetch('/api/eerste-hapjes/state', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ child_id: childId, ...patch }),
  });
  if (!r.ok) throw new Error(`state patch: ${r.status}`);
  const j = await r.json();
  return j.state;
}

/** GET alle allergeen-doses voor een kind (optioneel filter op key). */
export async function loadEhDoses(childId, allergenKey) {
  let url = `/api/eerste-hapjes/doses?child_id=${encodeURIComponent(childId)}`;
  if (allergenKey) url += `&allergen_key=${encodeURIComponent(allergenKey)}`;
  const r = await supabaseFetch(url);
  if (!r.ok) throw new Error(`doses load: ${r.status}`);
  const j = await r.json();
  return j.doses || [];
}

/** POST nieuwe dose. 409 bij dubbele dose-number per allergeen. */
export async function createEhDose(payload) {
  const r = await supabaseFetch('/api/eerste-hapjes/doses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`dose create: ${r.status} ${txt}`);
  }
  const j = await r.json();
  return j.dose;
}

/** DELETE 1 dose op id. */
export async function deleteEhDose(doseId) {
  const r = await supabaseFetch(`/api/eerste-hapjes/doses/${encodeURIComponent(doseId)}`, {
    method: 'DELETE',
  });
  if (!r.ok) throw new Error(`dose delete: ${r.status}`);
  return true;
}

/* ============================================
   Helpers — afgeleide state uit doses-array
============================================ */

/**
 * Bouw allergeen-context voor de generator op basis van doses + state.
 * @param {Array} doses    — alle doses voor het kindje
 * @param {Object} state   — eerste_hapjes_state
 * @param {number} ageMonths
 * @returns {{
 *   ageMonths, completed, inProgress, knownAllergies, paused, daysSinceLastDose
 * }}
 */
export function buildAllergenContext(doses, state, ageMonths) {
  // Tel succesvolle doses (reaction === 'geen') per allergeen
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
