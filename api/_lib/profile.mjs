// Helpers rond chat_user_profiles.

import { supabase } from './clients.mjs';

const ALLOWED_DIET = new Set([
  'vegetarisch', 'veganistisch', 'glutenvrij', 'lactosevrij',
  'halal', 'kosher', 'pescotarisch', 'geen-varken', 'geen-rund',
]);

/**
 * Laad het profiel van een user.
 *
 * Kindjes komen sinds batch 3 uit `public.children` (single source of truth,
 * beheerd via profielmodal en Eerste Hapjes-flow). De legacy
 * `chat_user_profiles.children` JSONB-kolom wordt genegeerd voor uitlees-
 * doeleinden — bestaande writes laten we ongewijzigd voor backwards compat
 * tot de eerste-hapjes-merge naar main.
 *
 * Returnt een geconsolideerd profile-object of null als er noch een profiel
 * noch kindjes zijn.
 */
export async function loadUserProfile(userId) {
  const [profileRes, childrenRes, statesRes, dosesRes] = await Promise.all([
    supabase.from('chat_user_profiles').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('children').select('id, name, birthdate, archived_at')
      .eq('user_id', userId).is('archived_at', null)
      .order('birthdate', { ascending: false }),
    // Per-kind state — bevat allergen_state.known_allergies (bevestigde allergieën).
    supabase.from('eerste_hapjes_state').select('child_id, allergen_state')
      .eq('user_id', userId),
    // Per-allergeen doses — voor afleiding van "in progress" (1-2 succesvolle doses).
    supabase.from('eerste_hapjes_allergen_doses').select('child_id, allergen_key, reaction')
      .eq('user_id', userId),
  ]);
  if (profileRes.error) throw new Error('Profile load: ' + profileRes.error.message);
  if (childrenRes.error) throw new Error('Children load: ' + childrenRes.error.message);
  if (statesRes.error) throw new Error('Eerste hapjes state load: ' + statesRes.error.message);
  if (dosesRes.error) throw new Error('Allergen doses load: ' + dosesRes.error.message);

  const profile = profileRes.data;
  const kids = childrenRes.data || [];

  // Bouw allergensByChild op nieuwe structuur:
  //  - vermijden: bevestigde allergieën (uit allergen_state.known_allergies)
  //  - gepland:   in progress — 1 of 2 succesvolle doses, nog niet "veilig" (3/3)
  const allergensByChild = {};
  for (const s of (statesRes.data || [])) {
    allergensByChild[s.child_id] = {
      vermijden: Array.isArray(s.allergen_state?.known_allergies)
        ? s.allergen_state.known_allergies
        : [],
      gepland: [],
    };
  }
  const successCount = {}; // `${childId}::${key}` -> aantal succesvolle doses
  for (const d of (dosesRes.data || [])) {
    if (d.reaction !== 'geen') continue;
    const k = `${d.child_id}::${d.allergen_key}`;
    successCount[k] = (successCount[k] || 0) + 1;
  }
  for (const [k, count] of Object.entries(successCount)) {
    if (count <= 0 || count >= 3) continue;
    const [childId, allergenKey] = k.split('::');
    if (!allergensByChild[childId]) {
      allergensByChild[childId] = { vermijden: [], gepland: [] };
    }
    if (!allergensByChild[childId].gepland.includes(allergenKey)) {
      allergensByChild[childId].gepland.push(allergenKey);
    }
  }

  const childrenList = kids.map((c) => ({
    id: c.id,
    name: c.name,
    birthdate: c.birthdate,
    // `allergies` (te vermijden) — voor backwards compat met formatProfileForPrompt
    allergies: allergensByChild[c.id]?.vermijden || [],
    // `allergens_in_progress` — wordt nog geïntroduceerd, geen "vermijden" maar
    // wel relevant voor de prompt (bv. "we proberen ei voorzichtig").
    allergens_in_progress: allergensByChild[c.id]?.gepland || [],
    notes: null,
  }));

  if (!profile && childrenList.length === 0) return null;

  const base = profile || {
    user_id: userId,
    display_name: null,
    diet: [],
    allergies: [],
    notes: null,
    memory_enabled: true,
  };
  return { ...base, children: childrenList };
}

/** Valideer & sanitize input voor PUT /api/profile. */
export function sanitizeProfileInput(input) {
  const out = {
    display_name: null,
    children: [],
    diet: [],
    allergies: [],
    notes: null,
    memory_enabled: true,
  };

  if (typeof input?.display_name === 'string') {
    out.display_name = input.display_name.trim().slice(0, 80) || null;
  }

  if (Array.isArray(input?.children)) {
    out.children = input.children
      .filter(c => c && typeof c === 'object')
      .slice(0, 10) // max 10 kinderen
      .map(c => {
        const name = typeof c.name === 'string' ? c.name.trim().slice(0, 50) : '';
        const birthdate = typeof c.birthdate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.birthdate) ? c.birthdate : null;
        const notes = typeof c.notes === 'string' ? c.notes.trim().slice(0, 200) : null;
        const allergies = Array.isArray(c.allergies)
          ? c.allergies
              .map(v => typeof v === 'string' ? v.toLowerCase().trim().slice(0, 30) : '')
              .filter(Boolean)
              .slice(0, 20)
          : [];
        if (!name && !birthdate) return null;
        return { name, birthdate, notes, allergies };
      })
      .filter(Boolean);
  }

  if (Array.isArray(input?.diet)) {
    out.diet = input.diet
      .map(v => typeof v === 'string' ? v.toLowerCase().trim() : '')
      .filter(v => ALLOWED_DIET.has(v))
      .slice(0, 10);
  }

  if (Array.isArray(input?.allergies)) {
    out.allergies = input.allergies
      .map(v => typeof v === 'string' ? v.toLowerCase().trim().slice(0, 30) : '')
      .filter(Boolean)
      .slice(0, 30);
  }

  if (typeof input?.notes === 'string') {
    out.notes = input.notes.trim().slice(0, 500) || null;
  }

  if (typeof input?.memory_enabled === 'boolean') {
    out.memory_enabled = input.memory_enabled;
  }

  return out;
}

/** Upsert het profiel voor deze user. */
export async function upsertUserProfile(userId, profile) {
  const row = { user_id: userId, ...profile };
  const { data, error } = await supabase
    .from('chat_user_profiles')
    .upsert(row, { onConflict: 'user_id' })
    .select('*')
    .single();
  if (error) throw new Error('Profile upsert: ' + error.message);
  return data;
}

/** Bereken leeftijd in maanden op basis van geboortedatum + today. */
export function ageMonths(birthdate, today = new Date()) {
  if (!birthdate) return null;
  const b = new Date(birthdate + 'T00:00:00Z');
  if (Number.isNaN(b.getTime())) return null;
  const diffDays = (today.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);
  return Math.floor(diffDays / 30.4375);
}

/**
 * Vorm een compacte NL-tekst samenvatting van het profiel voor in de system prompt.
 * Returnt null als er niets nuttigs is.
 */
export function formatProfileForPrompt(profile) {
  if (!profile) return null;
  const lines = [];

  if (Array.isArray(profile.children) && profile.children.length > 0) {
    const kidBits = profile.children
      .map(c => {
        const age = ageMonths(c.birthdate);
        const pieces = [];
        if (c.name) pieces.push(c.name);
        if (age !== null) pieces.push(age < 24 ? `${age} maanden` : `${Math.floor(age / 12)} jaar`);
        if (Array.isArray(c.allergies) && c.allergies.length > 0) {
          pieces.push(`vermijden: ${c.allergies.join('/')}`);
        }
        if (Array.isArray(c.allergens_in_progress) && c.allergens_in_progress.length > 0) {
          pieces.push(`introductie loopt: ${c.allergens_in_progress.join('/')}`);
        }
        if (c.notes) pieces.push(`"${c.notes}"`);
        return pieces.length ? pieces.join(', ') : null;
      })
      .filter(Boolean);
    if (kidBits.length > 0) {
      lines.push(`Kind(eren): ${kidBits.join('; ')}.`);
    }
  }
  if (Array.isArray(profile.diet) && profile.diet.length > 0) {
    lines.push(`Dieet in het gezin: ${profile.diet.join(', ')}.`);
  }
  if (profile.notes) {
    lines.push(`Notities van de ouder: ${profile.notes}`);
  }

  if (lines.length === 0) return null;
  return lines.join(' ');
}

/**
 * Bepaal de "primaire" baby-leeftijd om te gebruiken als filterAge voor chunk-retrieval.
 * Heuristiek: jongste kind met geldige birthdate.
 */
export function primaryChildAgeMonths(profile) {
  if (!profile?.children?.length) return null;
  const ages = profile.children
    .map(c => ageMonths(c.birthdate))
    .filter(a => a !== null);
  if (!ages.length) return null;
  return Math.min(...ages);
}
