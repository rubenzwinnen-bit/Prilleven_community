/* ============================================
   EERSTE HAPJES — MAALTIJD-INGREDIËNTEN
   Statische ingrediëntenlijsten voor de maaltijd-generator (warme maaltijd v1).

   Bron: "Gids eerste hapjes" (Pril Leven) — categorieën + verhoudingen voor
   een gebalanceerde warme maaltijd. We werken op verhoudingen, niet op grammen.

   Admin (Anneleen / Claude): voeg ingrediënten toe door 1 array uit te breiden.
   Geen DB-migratie nodig.

   Geen `minAge` op ingrediënten — fase-gating in de roadmap regelt
   wanneer de generator beschikbaar wordt. Risk-foods (honing, kerstomaat,
   druif, …) blijven via `eersteHapjes-risk-foods.js` lopen — dat geeft
   bereidings-warnings ipv hard filteren.
============================================ */

/**
 * 6 categorieën. Verhouding (ratio) is uitgedrukt t.o.v. één porte groente (1.0).
 * - groen / kleurrijk / knol = 1 portie elk (3 gelijke porties groenten)
 * - vlees_vis = ⅖ portie  (30g op 75g groente in de gids)
 * - vegetarisch = ⅘ portie (60g op 75g groente)
 * - vet = snufje, ~1 lepel
 *
 * Gebruikers zien NOOIT grammen — alleen `portionLabel`.
 */
export const CATEGORIES = {
  groen: {
    key: 'groen',
    label: 'Groene groente',
    icon: '🥦',
    ratio: 1.0,
    portionLabel: '1 portie',
  },
  kleurrijk: {
    key: 'kleurrijk',
    label: 'Kleurrijke groente',
    icon: '🥕',
    ratio: 1.0,
    portionLabel: '1 portie',
  },
  knol: {
    key: 'knol',
    label: 'Knol of graan',
    icon: '🥔',
    ratio: 1.0,
    portionLabel: '1 portie',
  },
  vlees_vis: {
    key: 'vlees_vis',
    label: 'Vlees of vis',
    icon: '🐟',
    ratio: 0.4,
    portionLabel: '⅓ portie',
  },
  vegetarisch: {
    key: 'vegetarisch',
    label: 'Vegetarisch eiwit',
    icon: '🌱',
    ratio: 0.8,
    portionLabel: 'iets minder dan 1 portie',
  },
  vet: {
    key: 'vet',
    label: 'Vetstof',
    icon: '🫒',
    ratio: 0.07,
    portionLabel: '1 eetlepel',
  },
};

/**
 * Per ingrediënt:
 * - key:       snake-case stabiele ID
 * - name:      NL display-naam
 * - allergens: optioneel — keys uit het allergenen-systeem (zie allergenManager).
 *              Als een allergeen door ouder op "vermijden" gezet is, valt
 *              dit ingrediënt automatisch weg in de generator.
 * - dietary:   optioneel — beperking tot bepaalde voedingsstijlen.
 *              Default (geen veld) = beschikbaar voor álle stijlen.
 * - tag:       optioneel — bv. 'orgaan' voor orgaanvlees/lever.
 *              Generator kan hiermee variatie sturen.
 * - riskFoodKey: optioneel — koppeling naar `eersteHapjes-risk-foods.js`
 *              (bv. tomaat → risk-key 'kerstomaten' voor verstikkings-warning).
 * - note:      optioneel — korte bereidingshint die bij output wordt getoond.
 */
export const INGREDIENTS = {
  groen: [
    { key: 'broccoli',         name: 'Broccoli' },
    { key: 'spinazie',         name: 'Spinazie' },
    { key: 'erwtjes',          name: 'Erwtjes' },
    { key: 'spruitjes',        name: 'Spruitjes' },
    { key: 'groene-asperges',  name: 'Groene asperges' },
    { key: 'prinsessenbonen',  name: 'Prinsessenbonen' },
    { key: 'courgette',        name: 'Courgette' },
    { key: 'artisjok',         name: 'Artisjok' },
    { key: 'selder',           name: 'Selder',   allergens: ['selderij'] },
    { key: 'andijvie',         name: 'Andijvie' },
  ],

  kleurrijk: [
    { key: 'bloemkool',        name: 'Bloemkool' },
    { key: 'witte-asperges',   name: 'Witte asperges' },
    { key: 'prei',             name: 'Prei' },
    { key: 'champignon',       name: 'Champignon' },
    { key: 'oesterzwam',       name: 'Oesterzwam' },
    { key: 'witloof',          name: 'Witloof' },
    { key: 'rode-biet',        name: 'Rode biet' },
    { key: 'wortel',           name: 'Wortel' },
    { key: 'aubergine',        name: 'Aubergine' },
    { key: 'rabarber',         name: 'Rabarber' },
    { key: 'tomaat',           name: 'Tomaat',   riskFoodKey: 'kerstomaten' },
    { key: 'venkel',           name: 'Venkel' },
  ],

  knol: [
    { key: 'pastinaak',        name: 'Pastinaak' },
    { key: 'zoete-aardappel',  name: 'Zoete aardappel' },
    { key: 'aardappel',        name: 'Aardappel' },
    { key: 'knolselder',       name: 'Knolselder', allergens: ['selderij'] },
    { key: 'pompoen',          name: 'Pompoen' },
    { key: 'quinoa',           name: 'Quinoa' },
    { key: 'rijst',            name: 'Rijst' },
    { key: 'aardpeer',         name: 'Aardpeer' },
    { key: 'raapjes',          name: 'Raapjes' },
  ],

  vlees_vis: [
    { key: 'kipfilet',     name: 'Kipfilet',     dietary: ['omnivoor'] },
    { key: 'kalkoenfilet', name: 'Kalkoenfilet', dietary: ['omnivoor'] },
    { key: 'kippenlever',  name: 'Kippenlever',  dietary: ['omnivoor'], tag: 'orgaan' },
    { key: 'orgaanvlees',  name: 'Orgaanvlees',  dietary: ['omnivoor'], tag: 'orgaan' },
    { key: 'sardientjes',  name: 'Sardientjes',  dietary: ['omnivoor', 'pesco'], allergens: ['vis'] },
    { key: 'zalm',         name: 'Zalm',         dietary: ['omnivoor', 'pesco'], allergens: ['vis'] },
    { key: 'forel',        name: 'Forel',        dietary: ['omnivoor', 'pesco'], allergens: ['vis'] },
    { key: 'makreel',      name: 'Makreel',      dietary: ['omnivoor', 'pesco'], allergens: ['vis'] },
    { key: 'kabeljauw',    name: 'Kabeljauw',    dietary: ['omnivoor', 'pesco'], allergens: ['vis'] },
    { key: 'rivierkreeft', name: 'Rivierkreeft', dietary: ['omnivoor', 'pesco'], allergens: ['schaaldieren'] },
  ],

  vegetarisch: [
    { key: 'kikkererwten', name: 'Kikkererwten' },
    { key: 'linzen-rood',  name: 'Linzen (rood)' },
    { key: 'linzen-geel',  name: 'Linzen (geel)' },
    { key: 'linzen-bruin', name: 'Linzen (bruin)' },
    { key: 'linzen-groen', name: 'Linzen (groen)' },
    { key: 'kippenei',     name: 'Kippenei (½)', dietary: ['omnivoor', 'pesco', 'vegetarisch'], allergens: ['ei'] },
    { key: 'bonen-bruin',  name: 'Bruine bonen' },
    { key: 'bonen-wit',    name: 'Witte bonen' },
    { key: 'bonen-rood',   name: 'Rode bonen' },
  ],

  vet: [
    { key: 'olijfolie',    name: 'Olijfolie' },
    { key: 'kokosolie',    name: 'Kokosolie' },
    { key: 'ghee',         name: 'Ghee', dietary: ['omnivoor', 'pesco', 'vegetarisch'], allergens: ['koemelk'] },
    { key: 'avocado-olie', name: 'Avocado-olie' },
    { key: 'walnootolie',  name: 'Walnootolie',  allergens: ['noten'], note: 'Koud toevoegen na bereiding.' },
    { key: 'lijnzaadolie', name: 'Lijnzaadolie', note: 'Koud toevoegen na bereiding.' },
  ],
};

/**
 * Voedingsstijlen — gebruikt door de generator om bepaalde categorieën
 * uit te schakelen of in te perken.
 */
export const DIETARY_STYLES = {
  omnivoor: {
    key: 'omnivoor',
    label: 'Omnivoor',
    icon: '🥩',
    description: 'Alles mag — vlees, vis, ei, plantaardig.',
  },
  pesco: {
    key: 'pesco',
    label: 'Pescotarisch',
    icon: '🐟',
    description: 'Vis ja, vlees nee.',
  },
  vegetarisch: {
    key: 'vegetarisch',
    label: 'Vegetarisch',
    icon: '🥦',
    description: 'Geen vlees of vis. Ei en zuivel mogen.',
  },
  vegan: {
    key: 'vegan',
    label: 'Veganistisch',
    icon: '🌱',
    description: 'Volledig plantaardig — geen vlees, vis, ei.',
  },
};

/**
 * Helper: alle categorie-keys in vaste volgorde.
 */
export const CATEGORY_ORDER = ['groen', 'kleurrijk', 'knol', 'vlees_vis', 'vegetarisch', 'vet'];


/* ============================================
   FRUIT-MAALTIJD (Fase 3, vanaf ~8-9 maanden)
   3 categorieën uit de gids:
   - 1 stuk fruit (~150g)         → ratio 1.0
   - 50g+ groenten                → ratio 0.4 (kleinere portie)
   - 5g vetstof                   → snufje
   Verhoudingen — geen grammen tonen.
============================================ */

export const FRUIT_CATEGORIES = {
  fruit: {
    key: 'fruit',
    label: 'Fruit',
    icon: '🍓',
    ratio: 1.0,
    portionLabel: '1 stuk',
  },
  fruit_groen: {
    key: 'fruit_groen',
    label: 'Groente',
    icon: '🥬',
    ratio: 0.4,
    portionLabel: '⅓ portie',
  },
  fruit_vet: {
    key: 'fruit_vet',
    label: 'Vetstof',
    icon: '🫒',
    ratio: 0.05,
    portionLabel: '1 lepel',
  },
};

/**
 * Per ingrediënt:
 * - key, name (zoals warme maaltijd)
 * - allergens (optioneel) — citrus-vruchten, noten via notenmeel
 * - riskFoodKey (optioneel) — druif/blauwe bes voor verstikkingsgevaar
 */
export const FRUIT_INGREDIENTS = {
  fruit: [
    { key: 'aardbei',      name: 'Aardbei' },
    { key: 'abrikoos',     name: 'Abrikoos' },
    { key: 'appel',        name: 'Appel' },
    { key: 'ananas',       name: 'Ananas' },
    { key: 'banaan',       name: 'Banaan' },
    { key: 'blauwe-bes',   name: 'Blauwe bes',  riskFoodKey: 'kleine-bessen' },
    { key: 'bosbes',       name: 'Bosbes',      riskFoodKey: 'kleine-bessen' },
    { key: 'braam',        name: 'Braam' },
    { key: 'cactusvijg',   name: 'Cactusvijg' },
    { key: 'citroen',      name: 'Citroen',     allergens: ['citrus'] },
    { key: 'clementine',   name: 'Clementine',  allergens: ['citrus'] },
    { key: 'dadel',        name: 'Dadel' },
    { key: 'druif',        name: 'Druif',       riskFoodKey: 'druiven' },
    { key: 'framboos',     name: 'Framboos' },
    { key: 'granaatappel', name: 'Granaatappel' },
    { key: 'grapefruit',   name: 'Grapefruit',  allergens: ['citrus'] },
    { key: 'guave',        name: 'Guave' },
    { key: 'kaki',         name: 'Kaki' },
    { key: 'kers',         name: 'Kers',        riskFoodKey: 'kleine-bessen' },
    { key: 'kiwi',         name: 'Kiwi' },
    { key: 'kiwibes',      name: 'Kiwibes' },
    { key: 'limoen',       name: 'Limoen',      allergens: ['citrus'] },
    { key: 'lychee',       name: 'Lychee' },
    { key: 'mandarijn',    name: 'Mandarijn',   allergens: ['citrus'] },
    { key: 'mango',        name: 'Mango' },
    { key: 'meloen',       name: 'Meloen' },
    { key: 'nectarine',    name: 'Nectarine' },
    { key: 'papaja',       name: 'Papaja' },
    { key: 'passievrucht', name: 'Passievrucht' },
    { key: 'peer',         name: 'Peer' },
    { key: 'perzik',       name: 'Perzik' },
    { key: 'pomelo',       name: 'Pomelo',      allergens: ['citrus'] },
    { key: 'pompelmoes',   name: 'Pompelmoes',  allergens: ['citrus'] },
    { key: 'pruim',        name: 'Pruim' },
    { key: 'sinaasappel',  name: 'Sinaasappel', allergens: ['citrus'] },
    { key: 'vijg',         name: 'Vijg' },
    { key: 'watermeloen',  name: 'Watermeloen' },
    { key: 'zwarte-bes',   name: 'Zwarte bes',  riskFoodKey: 'kleine-bessen' },
  ],

  fruit_groen: [
    { key: 'bloemkool',       name: 'Bloemkool' },
    { key: 'rode-biet',       name: 'Rode biet' },
    { key: 'wortel',          name: 'Wortel' },
    { key: 'rabarber',        name: 'Rabarber' },
    { key: 'broccoli',        name: 'Broccoli' },
    { key: 'spinazie',        name: 'Spinazie' },
    { key: 'courgette',       name: 'Courgette' },
    { key: 'zoete-aardappel', name: 'Zoete aardappel' },
    { key: 'pompoen',         name: 'Pompoen' },
    { key: 'erwtjes',         name: 'Erwtjes' },
    { key: 'avocado',         name: 'Avocado' },
  ],

  fruit_vet: [
    { key: 'kokosolie',    name: 'Kokosolie' },
    { key: 'avocado-olie', name: 'Avocado-olie' },
    { key: 'walnootolie',  name: 'Walnootolie',  allergens: ['noten'], note: 'Koud toevoegen.' },
    { key: 'lijnzaadolie', name: 'Lijnzaadolie', note: 'Koud toevoegen.' },
    { key: 'notenmeel',    name: 'Notenmeel',    allergens: ['noten'], note: 'Eetlepel.' },
  ],
};

export const FRUIT_CATEGORY_ORDER = ['fruit', 'fruit_groen', 'fruit_vet'];
