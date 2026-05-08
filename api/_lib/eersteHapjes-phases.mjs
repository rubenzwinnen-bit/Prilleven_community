// Helpers voor de Eerste Hapjes child_phases + child_phase_checks tabellen.
// Service-role omzeilt RLS — daarom expliciete eq('user_id') op elke query
// + ownership-check op child_id.
//
// Source of truth voor fase-definities = js/content/eersteHapjes-phases.js
// (frontend). Backend houdt alleen het minimum bij voor validatie.

import { supabase } from './clients.mjs';

// Spiegelt js/content/eersteHapjes-phases.js — houden in sync.
const PHASE_DEFS = [
  { number: 0, minAgeMonths: 0,  checkCount: 5 },
  { number: 1, minAgeMonths: 6,  checkCount: 5 },
  { number: 2, minAgeMonths: 7,  checkCount: 5 },
  { number: 3, minAgeMonths: 8,  checkCount: 5 },
  { number: 4, minAgeMonths: 10, checkCount: 5 },
  { number: 5, minAgeMonths: 12, checkCount: 0 }, // eindfase
];
const VALID_PHASE_NUMBERS = new Set(PHASE_DEFS.map((p) => p.number));
const AUTO_FASE5_AGE_MONTHS = 14;
const CHECK_KEY_RE = /^[a-z0-9_]{1,60}$/;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function getPhaseDef(n) {
  return PHASE_DEFS.find((p) => p.number === n);
}

/** Volledige maanden tussen geboortedatum (YYYY-MM-DD) en vandaag. */
function ageMonthsFromBirthdate(birthdate) {
  if (!birthdate) return 0;
  const bd = new Date(birthdate + 'T00:00:00Z');
  if (Number.isNaN(bd.getTime())) return 0;
  const now = new Date();
  let months = (now.getUTCFullYear() - bd.getUTCFullYear()) * 12
    + (now.getUTCMonth() - bd.getUTCMonth());
  if (now.getUTCDate() < bd.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

async function assertOwnsChild(userId, childId) {
  const { data, error } = await supabase
    .from('children').select('id, birthdate')
    .eq('user_id', userId).eq('id', childId).maybeSingle();
  if (error) throw new Error('Child ownership: ' + error.message);
  if (!data) throw new HttpError(404, 'Kindje niet gevonden.');
  return data;
}

// ============================================================
// Init
// ============================================================

/**
 * Init bij eerste keer: bouw rijen op basis van leeftijd.
 * - kindje ≥ 14 mnd → fases 0..4 als 'completed' inserten + fase 5 actief
 * - anders          → enkel fase 0 actief
 */
async function initPhasesForChild(userId, childId, ageMonths) {
  const now = new Date().toISOString();
  const rows = [];
  if (ageMonths >= AUTO_FASE5_AGE_MONTHS) {
    for (let n = 0; n <= 4; n += 1) {
      rows.push({
        user_id: userId, child_id: childId,
        phase_number: n, unlocked_at: now, completed_at: now,
      });
    }
    rows.push({
      user_id: userId, child_id: childId,
      phase_number: 5, unlocked_at: now, completed_at: null,
    });
  } else {
    rows.push({
      user_id: userId, child_id: childId,
      phase_number: 0, unlocked_at: now, completed_at: null,
    });
  }
  const { error } = await supabase
    .from('child_phases')
    .insert(rows);
  if (error) {
    // Race-condition: een andere tab heeft net geïnitialiseerd. Negeer 'duplicate'.
    if (error.code !== '23505') throw new Error('Phase init: ' + error.message);
  }
}

// ============================================================
// Load
// ============================================================

/**
 * Haal volledige fase-state op voor een kindje.
 * Auto-initialiseert als er nog geen rijen zijn.
 *
 * Returnt: {
 *   activePhase: number,            // hoogste niet-completed fase die unlocked is
 *   phases: [
 *     { number, status: 'locked'|'active'|'completed', unlockedAt, completedAt }
 *   ],
 *   checks: { [phaseNumber]: { [checkKey]: checkedAtISO } },
 *   ageMonths: number,
 *   minAgeMonths: { [phaseNumber]: number }
 * }
 */
export async function loadPhaseState(userId, childId) {
  const child = await assertOwnsChild(userId, childId);
  const ageMonths = ageMonthsFromBirthdate(child.birthdate);

  // 1. Phases ophalen
  let { data: phaseRows, error: pErr } = await supabase
    .from('child_phases')
    .select('phase_number, unlocked_at, completed_at')
    .eq('user_id', userId)
    .eq('child_id', childId);
  if (pErr) throw new Error('Phase load: ' + pErr.message);

  // 2. Auto-init bij eerste keer
  if (!phaseRows || phaseRows.length === 0) {
    await initPhasesForChild(userId, childId, ageMonths);
    const reload = await supabase
      .from('child_phases')
      .select('phase_number, unlocked_at, completed_at')
      .eq('user_id', userId)
      .eq('child_id', childId);
    if (reload.error) throw new Error('Phase reload: ' + reload.error.message);
    phaseRows = reload.data || [];
  }

  // 3. Checks ophalen
  const { data: checkRows, error: cErr } = await supabase
    .from('child_phase_checks')
    .select('phase_number, check_key, checked_at')
    .eq('user_id', userId)
    .eq('child_id', childId);
  if (cErr) throw new Error('Phase checks load: ' + cErr.message);

  // 4. Build response
  const byNum = new Map(phaseRows.map((r) => [r.phase_number, r]));
  const phases = PHASE_DEFS.map((def) => {
    const row = byNum.get(def.number);
    let status = 'locked';
    if (row) {
      status = row.completed_at ? 'completed' : 'active';
    }
    return {
      number: def.number,
      status,
      unlockedAt: row?.unlocked_at || null,
      completedAt: row?.completed_at || null,
    };
  });

  const checks = {};
  for (const r of (checkRows || [])) {
    if (!checks[r.phase_number]) checks[r.phase_number] = {};
    checks[r.phase_number][r.check_key] = r.checked_at;
  }

  // Active phase = laagste 'active' (er kan er normaal maar één zijn).
  const active = phases.find((p) => p.status === 'active');
  const activePhase = active ? active.number : null;

  const minAgeMonths = {};
  for (const def of PHASE_DEFS) minAgeMonths[def.number] = def.minAgeMonths;

  return {
    activePhase,
    phases,
    checks,
    ageMonths,
    minAgeMonths,
  };
}

// ============================================================
// Toggle check
// ============================================================

export function sanitizeCheckInput(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new HttpError(422, 'Ongeldige invoer.');
  }
  if (typeof raw.child_id !== 'string' || !raw.child_id) {
    throw new HttpError(422, 'Kindje is verplicht.');
  }
  if (!VALID_PHASE_NUMBERS.has(raw.phase_number)) {
    throw new HttpError(422, 'Ongeldig fase-nummer.');
  }
  if (typeof raw.check_key !== 'string' || !CHECK_KEY_RE.test(raw.check_key)) {
    throw new HttpError(422, 'Ongeldige check_key.');
  }
  if (typeof raw.checked !== 'boolean') {
    throw new HttpError(422, 'checked moet boolean zijn.');
  }
  return {
    child_id: raw.child_id,
    phase_number: raw.phase_number,
    check_key: raw.check_key,
    checked: raw.checked,
  };
}

/**
 * Vink een checklist-item aan/uit. Mag alleen voor de actieve fase
 * (niet voor locked of completed fases).
 */
export async function togglePhaseCheck(userId, input) {
  await assertOwnsChild(userId, input.child_id);

  // Verifieer dat fase actief is
  const { data: phaseRow, error: pErr } = await supabase
    .from('child_phases')
    .select('phase_number, completed_at')
    .eq('user_id', userId)
    .eq('child_id', input.child_id)
    .eq('phase_number', input.phase_number)
    .maybeSingle();
  if (pErr) throw new Error('Phase verify: ' + pErr.message);
  if (!phaseRow) throw new HttpError(409, 'Fase is nog niet ontgrendeld.');
  if (phaseRow.completed_at) throw new HttpError(409, 'Fase is al afgerond.');

  if (input.checked) {
    // Insert; ON CONFLICT = no-op (al aangevinkt)
    const { error } = await supabase
      .from('child_phase_checks')
      .insert({
        user_id: userId,
        child_id: input.child_id,
        phase_number: input.phase_number,
        check_key: input.check_key,
      });
    if (error && error.code !== '23505') {
      throw new Error('Check insert: ' + error.message);
    }
  } else {
    const { error } = await supabase
      .from('child_phase_checks')
      .delete()
      .eq('user_id', userId)
      .eq('child_id', input.child_id)
      .eq('phase_number', input.phase_number)
      .eq('check_key', input.check_key);
    if (error) throw new Error('Check delete: ' + error.message);
  }
}

// ============================================================
// Advance
// ============================================================

export function sanitizeAdvanceInput(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new HttpError(422, 'Ongeldige invoer.');
  }
  if (typeof raw.child_id !== 'string' || !raw.child_id) {
    throw new HttpError(422, 'Kindje is verplicht.');
  }
  if (!VALID_PHASE_NUMBERS.has(raw.from_phase)) {
    throw new HttpError(422, 'Ongeldig fase-nummer.');
  }
  return {
    child_id: raw.child_id,
    from_phase: raw.from_phase,
  };
}

/**
 * Markeer huidige fase als afgerond en ontgrendel de volgende.
 * Vereist: alle checks gedaan + leeftijd ≥ minAgeMonths van volgende fase.
 */
export async function advancePhase(userId, input) {
  const child = await assertOwnsChild(userId, input.child_id);
  const ageMonths = ageMonthsFromBirthdate(child.birthdate);

  const fromDef = getPhaseDef(input.from_phase);
  const toNumber = input.from_phase + 1;
  const toDef = getPhaseDef(toNumber);
  if (!toDef) {
    throw new HttpError(409, 'Geen volgende fase beschikbaar.');
  }

  // Huidige fase bestaat + niet completed?
  const { data: fromRow, error: fErr } = await supabase
    .from('child_phases')
    .select('phase_number, completed_at')
    .eq('user_id', userId)
    .eq('child_id', input.child_id)
    .eq('phase_number', input.from_phase)
    .maybeSingle();
  if (fErr) throw new Error('Phase verify: ' + fErr.message);
  if (!fromRow) throw new HttpError(409, 'Fase is nog niet ontgrendeld.');
  if (fromRow.completed_at) throw new HttpError(409, 'Fase is al afgerond.');

  // Alle checks gedaan?
  if (fromDef.checkCount > 0) {
    const { count, error: cErr } = await supabase
      .from('child_phase_checks')
      .select('check_key', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('child_id', input.child_id)
      .eq('phase_number', input.from_phase);
    if (cErr) throw new Error('Check count: ' + cErr.message);
    if ((count || 0) < fromDef.checkCount) {
      throw new HttpError(409, 'Niet alle mijlpalen zijn aangevinkt.');
    }
  }

  // Leeftijd ≥ minAgeMonths volgende fase?
  if (ageMonths < toDef.minAgeMonths) {
    throw new HttpError(409,
      `Volgende fase is ten vroegste vanaf ${toDef.minAgeMonths} maanden.`);
  }

  // Volgende rij bestaat al? (idempotent maken)
  const { data: existingNext } = await supabase
    .from('child_phases')
    .select('phase_number')
    .eq('user_id', userId)
    .eq('child_id', input.child_id)
    .eq('phase_number', toNumber)
    .maybeSingle();

  // Markeer huidige als completed
  const nowIso = new Date().toISOString();
  const { error: uErr } = await supabase
    .from('child_phases')
    .update({ completed_at: nowIso })
    .eq('user_id', userId)
    .eq('child_id', input.child_id)
    .eq('phase_number', input.from_phase);
  if (uErr) throw new Error('Phase complete: ' + uErr.message);

  if (!existingNext) {
    const { error: iErr } = await supabase
      .from('child_phases')
      .insert({
        user_id: userId,
        child_id: input.child_id,
        phase_number: toNumber,
      });
    if (iErr && iErr.code !== '23505') {
      throw new Error('Phase next insert: ' + iErr.message);
    }
  }
}

export { HttpError };
