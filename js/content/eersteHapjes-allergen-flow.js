/* ============================================
   EERSTE HAPJES — ALLERGENEN-INTRODUCTIE-FLOW

   VASTE volgorde van allergeen-introducties die door de roadmap-generator
   wordt ingeweven tijdens Fase 1/2. Niet random.

   Regels:
   - Per allergeen: 3 succesvolle dosissen zonder symptomen → status 'veilig'
   - Minimum 2 dagen tussen 2 dosissen (zelfde allergeen of nieuw allergeen)
   - Allergenen NIET overslaan: ouder moet alle items doorlopen om te
     ontdekken of het kindje allergisch is.
   - Leeftijd-conditie: default vóór 12 maanden (`introBefore: 12`).
   - Bij reactie:
       * mild → ouder kan beslissen om opnieuw te proberen of als allergie
         te markeren
       * ernstig → toon zorgverlener-suggestie, flow pauzeert, allergeen
         wordt aan profiel toegevoegd via bestaande `allergenManager`.

   Admin (Anneleen / Claude): wijzig volgorde, suggesties of tekst door
   deze ene array aan te passen. Geen DB-migratie.
============================================ */

/**
 * @typedef {Object} AllergenStep
 * @property {string} key                    Stabiele ID (snake-case)
 * @property {string} label                  Display-naam
 * @property {string} icon                   Emoji
 * @property {number} order                  Priority — laagste = eerst
 * @property {Object} ageCondition           leeftijd-regel
 * @property {number} [ageCondition.introBefore]  vóór deze leeftijd (mnd)
 * @property {number} [ageCondition.introFrom]    pas vanaf deze leeftijd (mnd)
 * @property {number} repeatTarget           Aantal succesvolle dosissen voor 'veilig'
 * @property {string} suggestedFood          Suggestie hoe te introduceren
 * @property {string} [alternative]          Alternatief bij gekende allergie
 * @property {string} [note]                 Extra observatie-tip
 */

/** @type {AllergenStep[]} */
export const ALLERGEN_FLOW = [
  {
    key: 'kippen-ei',
    label: 'Kippenei',
    icon: '🥚',
    order: 1,
    ageCondition: { introBefore: 12 },
    repeatTarget: 3,
    suggestedFood: 'Hardgekookt eigeel pletten en mengen met (moeder)melk; later heel ei (wit + geel) klutsen en bakken in vetstof.',
    note: 'Begin eventueel met eigeel apart en bouw op naar heel ei.',
  },
  {
    key: 'pinda',
    label: 'Pinda',
    icon: '🥜',
    order: 2,
    ageCondition: { introBefore: 12 },
    repeatTarget: 3,
    suggestedFood: 'Mix een koffielepel pindakaas met (moeder)melk of kunstvoeding tot smeuïg. Op een lepeltje aanbieden.',
    alternative: 'Bij bekende pinda-allergie: tahini of amandelpasta later in de flow.',
    note: 'Pure pindakaas is te plakkerig — altijd verdunnen.',
  },
  {
    key: 'noten',
    label: 'Noten',
    icon: '🌰',
    order: 3,
    ageCondition: { introBefore: 12 },
    repeatTarget: 3,
    suggestedFood: 'Amandelpasta, hazelnootpasta of cashewpasta (100% noot, geen suiker). Mengen met (moeder)melk of yoghurt.',
    note: 'Hele noten zijn verstikkingsgevaar — altijd in pasta-vorm.',
  },
  {
    key: 'sesam',
    label: 'Sesam',
    icon: '🌻',
    order: 4,
    ageCondition: { introBefore: 12 },
    repeatTarget: 3,
    suggestedFood: 'Tahini (sesampasta) op een lepeltje, of mengen met groentepuree.',
  },
  {
    key: 'vis',
    label: 'Vis',
    icon: '🐟',
    order: 5,
    ageCondition: { introBefore: 12 },
    repeatTarget: 3,
    suggestedFood: 'Makreel of zalm uit blik (zonder zout) — pletten of in lange repen aanbieden.',
    note: 'Kleine vissoorten = minste vervuiling, meeste omega 3.',
  },
  {
    key: 'schaaldieren',
    label: 'Schaaldieren',
    icon: '🦐',
    order: 6,
    ageCondition: { introBefore: 12 },
    repeatTarget: 3,
    suggestedFood: 'Rivierkreeftjes of garnalen — in zijn geheel of in stukjes, goed gaar.',
  },
  {
    key: 'soja',
    label: 'Soja',
    icon: '🌱',
    order: 7,
    ageCondition: { introBefore: 12 },
    repeatTarget: 3,
    suggestedFood: 'Tofu in blokjes (zacht gestoomd), edamame zonder peul, of een lepeltje sojayoghurt.',
  },
  {
    key: 'tarwe',
    label: 'Tarwe',
    icon: '🍞',
    order: 8,
    ageCondition: { introBefore: 12 },
    repeatTarget: 3,
    suggestedFood: 'Stukje brood (zonder zout/suiker), pasta in grote vormen of fijngemalen havermout met tarwe.',
  },
  {
    key: 'koemelk',
    label: 'Koemelk',
    icon: '🥛',
    order: 9,
    ageCondition: { introBefore: 12 },
    repeatTarget: 3,
    suggestedFood: 'Volle natuuryoghurt op een lepeltje, of een slokje volle melk uit een open bekertje.',
  },
];

/** Default cooldown in dagen tussen 2 dosissen (over alle allergenen). */
export const ALLERGEN_COOLDOWN_DAYS = 2;

/**
 * Reactie-niveaus die de ouder kan markeren bij een dose.
 * - geen      → tellen als succesvolle dose
 * - mild      → flow pauzeert · ouder beslist (re-try later, of bevestig)
 * - ernstig   → flow pauzeert · zorgverlener-suggestie · bevestig allergie
 */
export const REACTION_LEVELS = {
  geen:    { key: 'geen',    label: 'Geen reactie',         counts: true,  pauses: false, escalate: false },
  mild:    { key: 'mild',    label: 'Milde reactie',        counts: false, pauses: true,  escalate: false },
  ernstig: { key: 'ernstig', label: 'Ernstige reactie',     counts: false, pauses: true,  escalate: true  },
};

/**
 * Helper: filter de flow op huidige leeftijd-conditie.
 * Items waarvan `introFrom > age` blijven achter (later beschikbaar).
 */
export function getEligibleAllergens(ageMonths) {
  return ALLERGEN_FLOW
    .filter(a => {
      if (a.ageCondition.introFrom && ageMonths < a.ageCondition.introFrom) return false;
      return true;
    })
    .sort((a, b) => a.order - b.order);
}

/**
 * Helper: status-derivatie per allergeen op basis van child-state.
 * @param {string} key
 * @param {Object} state  { completed: string[], inProgress: { [key]: doseCount }, knownAllergies: string[], paused: boolean }
 * @returns {'veilig'|'allergisch'|'paused'|'in-progress'|'wacht'|'locked-age'}
 */
export function getAllergenStatus(key, state, ageMonths) {
  if (state.knownAllergies?.includes(key)) return 'allergisch';
  if (state.completed?.includes(key)) return 'veilig';
  if (state.paused) return 'paused';
  const flow = ALLERGEN_FLOW.find(a => a.key === key);
  if (!flow) return 'wacht';
  if (flow.ageCondition.introFrom && ageMonths < flow.ageCondition.introFrom) return 'locked-age';
  if ((state.inProgress?.[key] || 0) > 0) return 'in-progress';
  return 'wacht';
}
