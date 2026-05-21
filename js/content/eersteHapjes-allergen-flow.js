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
 * @property {string} suggestedFood          Korte suggestie (gebruikt in setup-tegel, nextup-banner, dose-modal)
 * @property {Object} [content]              Uitgebreide introductie-tips per textuur
 * @property {string[]} [content.puree]      Tips voor gepureerde voeding
 * @property {string[]} [content.pieces]     Tips voor stukjes
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
    suggestedFood: 'Gebakken/gekookt eitje gemengd met vaste voeding.',
    content: {
      puree: [
        'Gebakken/gekookt eitje samen mixen met vaste voeding of mixen en apart aanbieden met een lepeltje',
      ],
      pieces: [
        'Reepjes omelet',
        'Hardgekookt ei in kleine stukjes of geplet',
        'Geen lopend of rauw ei aanbieden',
      ],
    },
  },
  {
    key: 'pinda',
    label: 'Pinda',
    icon: '🥜',
    order: 2,
    ageCondition: { introBefore: 12 },
    repeatTarget: 3,
    suggestedFood: 'Verdunde 100% pindakaas op een lepeltje of als dipje.',
    content: {
      puree: [
        '100% pindakaas mengen met een beetje moedermelk, kunstvoeding of water zodat het niet plakkerig is',
      ],
      pieces: [
        'Geen volledige pinda\u2019s',
        'Dun laagje verdunde pindakaas op crackers of als dipje',
      ],
    },
  },
  {
    key: 'noten',
    label: 'Noten',
    icon: '🌰',
    order: 3,
    ageCondition: { introBefore: 12 },
    repeatTarget: 3,
    suggestedFood: 'Verdunde notenpasta (amandel, cashew, hazelnoot).',
    content: {
      puree: [
        '100% notenpasta (amandel, cashew, hazelnoot \u2026) mengen onder de maaltijd of apart met een lepeltje',
        'Mengen met een beetje moedermelk, kunstvoeding of water zodat het niet plakkerig is',
      ],
      pieces: [
        'Geen volledige noten of grove stukken',
        'Dun laagje notenpasta op cracker of als dip',
        'Fijn gemalen noten verwerkt in havermout, pannenkoekjes of muffins',
      ],
    },
  },
  {
    key: 'sesam',
    label: 'Sesam',
    icon: '🌻',
    order: 4,
    ageCondition: { introBefore: 12 },
    repeatTarget: 3,
    suggestedFood: 'Verdunde tahin onder puree, of hummus als dipje.',
    content: {
      puree: [
        'Tahin (sesampasta) mengen onder puree, of verdunnen met moedermelk/kunstvoeding/water zodat het niet plakt',
        'Hummus',
      ],
      pieces: [
        'Geen losse sesamzaadjes in grote hoeveelheden',
        'Hummus als dip',
      ],
    },
  },
  {
    key: 'vis',
    label: 'Vis',
    icon: '🐟',
    order: 5,
    ageCondition: { introBefore: 12 },
    repeatTarget: 3,
    suggestedFood: 'Goed gegaarde vis, graten volledig verwijderd.',
    content: {
      puree: [
        'Goed gegaarde vis mengen onder groentepap',
        'Graten volledig verwijderen',
      ],
      pieces: [
        'Stukje gebakken vis',
        'Goed uit elkaar halen zodat er geen harde stukken of graten aanwezig zijn',
      ],
    },
  },
  {
    key: 'schaaldieren',
    label: 'Schaaldieren',
    icon: '🦐',
    order: 6,
    ageCondition: { introBefore: 12 },
    repeatTarget: 3,
    suggestedFood: 'Goed gegaarde garnalen of rivierkreeftjes.',
    content: {
      puree: [
        'Garnaaltjes of rivierkreeftjes mixen door vaste voeding',
        'Goed gaar aanbieden',
      ],
      pieces: [
        'Garnaaltjes of rivierkreeftjes zo aanbieden',
        'Goed gaar aanbieden',
      ],
    },
  },
  {
    key: 'soja',
    label: 'Soja',
    icon: '🌱',
    order: 7,
    ageCondition: { introBefore: 12 },
    repeatTarget: 3,
    suggestedFood: 'Tofu of sojayoghurt.',
    content: {
      puree: [
        'Tofu gepureerd onder groenten',
        'Sojayoghurt',
      ],
      pieces: [
        'Zachte tofureepjes',
      ],
    },
  },
  {
    key: 'tarwe',
    label: 'Tarwe',
    icon: '🍞',
    order: 8,
    ageCondition: { introBefore: 12 },
    repeatTarget: 3,
    suggestedFood: 'Volkoren pasta of zuurdesembrood.',
    content: {
      puree: [
        '(Volkoren) pasta met saus mixen',
        'Zuurdesembrood (geen gist) geweekt in soep',
      ],
      pieces: [
        'Geroosterde zuurdesem broodreepjes',
        'Volkoren pasta',
        'Pannenkoekjes of muffins o.b.v. bloem',
      ],
    },
  },
  {
    key: 'koemelk',
    label: 'Koemelk',
    icon: '🥛',
    order: 9,
    ageCondition: { introBefore: 12 },
    repeatTarget: 3,
    suggestedFood: 'Volle yoghurt op een lepeltje, of boter/ghee onder de voeding.',
    content: {
      puree: [
        'Boter of ghee onder vaste voeding, hapje volle yoghurt met een lepeltje aanbieden',
      ],
      pieces: [
        'Lepeltje met volle yoghurt',
        'Geen grote harde stukken kaas',
      ],
    },
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
