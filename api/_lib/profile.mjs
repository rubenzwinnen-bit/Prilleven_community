// Helpers rond gebruikersprofiel-context voor de RAG-bot.
//
// Sinds de profiel-opschoning halen we de context NIET meer uit
// chat_user_profiles.{children,diet,notes}, maar uit:
//   - public.children          (niet-gearchiveerde kinderen)
//   - community_profiles       (nickname + family_diet)
//   - chat_user_profiles       (alleen nog voor memory_enabled-vlag)

import { supabase } from './clients.mjs';
import { ALLERGEN_KEYS_LIST } from './eersteHapjes-state.mjs';

/**
 * Laad alle profiel-context voor één user.
 * Returnt altijd een object (nooit null) zodat de caller eenvoudig kan blijven.
 */
export async function loadUserProfile(userId) {
  const [chatRow, communityRow, childrenRows] = await Promise.all([
    supabase
      .from('chat_user_profiles')
      .select('memory_enabled')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('community_profiles')
      .select('nickname, family_diet')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('children')
      .select('id, name, birthdate, known_allergies, previous_reactions, notes')
      .eq('user_id', userId)
      .is('archived_at', null)
      .order('created_at', { ascending: true }),
  ]);

  if (chatRow.error)      throw new Error('Profile (chat): ' + chatRow.error.message);
  if (communityRow.error) throw new Error('Profile (community): ' + communityRow.error.message);
  if (childrenRows.error) throw new Error('Profile (children): ' + childrenRows.error.message);

  // Allergeen-context per kind, parity met website computeIntroducedKeys():
  //   geïntroduceerd = union(doses, pre_introduced, known_allergies)
  //   nog niet       = de 9 hoofdallergenen MIN geïntroduceerd MIN overgeslagen (arts-toezicht)
  // Bronnen: eerste_hapjes_allergen_doses (doses) + eerste_hapjes_state.allergen_state.
  let introMap = {};   // child_id → Set van keys met ≥1 dose
  let stateMap = {};   // child_id → allergen_state-object
  const children = childrenRows.data || [];
  if (children.length > 0) {
    const childIds = children.map(c => c.id);
    const [doseRes, stateRes] = await Promise.all([
      supabase
        .from('eerste_hapjes_allergen_doses')
        .select('child_id, allergen_key')
        .in('child_id', childIds),
      supabase
        .from('eerste_hapjes_state')
        .select('child_id, allergen_state')
        .eq('user_id', userId)
        .in('child_id', childIds),
    ]);
    if (doseRes.error)  throw new Error('Profile (doses): ' + doseRes.error.message);
    if (stateRes.error) throw new Error('Profile (state): ' + stateRes.error.message);
    for (const d of (doseRes.data || [])) {
      if (!introMap[d.child_id]) introMap[d.child_id] = new Set();
      introMap[d.child_id].add(d.allergen_key);
    }
    for (const s of (stateRes.data || [])) {
      stateMap[s.child_id] = s.allergen_state || {};
    }
  }

  return {
    memory_enabled: chatRow.data?.memory_enabled !== false, // default true
    display_name: communityRow.data?.nickname || null,
    diet: communityRow.data?.family_diet || [],
    children: children.map(c => {
      const astate = stateMap[c.id] || {};
      const childKnown = Array.isArray(c.known_allergies) ? c.known_allergies : [];
      // Union van alle "reeds geïntroduceerd/bekend"-bronnen.
      const introducedSet = new Set([
        ...(introMap[c.id] || []),
        ...(Array.isArray(astate.pre_introduced) ? astate.pre_introduced : []),
        ...(Array.isArray(astate.known_allergies) ? astate.known_allergies : []),
        ...childKnown,
      ]);
      const excludedSet = new Set(
        Array.isArray(astate.excluded_keys) ? astate.excluded_keys : []
      );
      const introduced = ALLERGEN_KEYS_LIST.filter(k => introducedSet.has(k));
      // "Nog niet geïntroduceerd" is enkel relevant zodra het kind aan vaste voeding
      // kan beginnen (~4 maanden). Daaronder of zonder geboortedatum: leeg laten,
      // anders zou de bot bij een pasgeborene 9 allergenen gaan opsommen.
      const age = ageMonths(c.birthdate);
      const notIntroduced = (age !== null && age >= 4)
        ? ALLERGEN_KEYS_LIST.filter(k => !introducedSet.has(k) && !excludedSet.has(k))
        : [];
      return {
        name: c.name,
        birthdate: c.birthdate,
        allergies: childKnown,
        previous_reactions: c.previous_reactions || null,
        notes: c.notes || null,
        introduced_allergens: introduced,
        not_introduced_allergens: notIntroduced,
      };
    }),
  };
}

/** Zet/onset memory_enabled in chat_user_profiles. */
export async function setMemoryEnabled(userId, enabled) {
  const { data, error } = await supabase
    .from('chat_user_profiles')
    .upsert(
      { user_id: userId, memory_enabled: !!enabled },
      { onConflict: 'user_id' }
    )
    .select('memory_enabled')
    .single();
  if (error) throw new Error('Memory toggle: ' + error.message);
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
          pieces.push(`allergie voor ${c.allergies.join('/')}`);
        }
        if (Array.isArray(c.introduced_allergens) && c.introduced_allergens.length > 0) {
          pieces.push(`reeds geïntroduceerde allergenen: ${c.introduced_allergens.join(', ')}`);
        }
        if (Array.isArray(c.not_introduced_allergens) && c.not_introduced_allergens.length > 0) {
          pieces.push(`nog niet geïntroduceerde allergenen: ${c.not_introduced_allergens.join(', ')}`);
        }
        if (c.previous_reactions) pieces.push(`eerdere reacties: ${c.previous_reactions}`);
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
