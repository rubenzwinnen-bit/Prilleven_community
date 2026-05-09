/* ============================================
   EERSTE HAPJES — RISICOVOEDINGEN (brok H.1)
   Centrale config voor voedingsmiddelen die op een bepaalde leeftijd
   nog niet (of niet in die vorm) veilig zijn voor baby's en peuters.

   Bronnen voor defaults: Kind & Gezin (BE), NL Voedingscentrum.
   Body's zijn skeleton-content — Anneleen vult later aan.

   Gebruik:
   - "Vandaag"-reminders: getRelevantRiskFoods(ageMnd)
   - Volledige lijst-modal: getAllRiskFoods()
   - Recept-scan: scanRecipeForRisks(recipeText, ageMnd)

   Geen medisch advies — disclaimer staat per kaart.
============================================ */

/**
 * Categorie-tags. Eén item kan meerdere tags dragen.
 */
export const RISK_TAGS = {
  verstikking: 'Verstikking',
  microbieel: 'Microbieel',
  botulisme: 'Botulisme',
  kwik: 'Kwik',
  nutrient: 'Voedingsstoffen',
};

/**
 * Drempel waarboven een item als "veilig" wordt beschouwd.
 * Per item een leeftijd in maanden — onder die drempel waarschuwen.
 *
 * Velden:
 * - key: stabiele ID (snake_case)
 * - label: kort, mens-leesbaar
 * - icon: emoji voor kaart/lijst
 * - maxAgeMonths: drempel — onder = waarschuwen, gelijk/boven = OK
 * - tags: zie RISK_TAGS
 * - intro: één-regel uitleg (toont in card + lijst)
 * - body: HTML-skeleton (Anneleen vult)
 * - ingredientMatchers: regex-lijst voor recept-scan. Lege array
 *   = niet automatisch scannen (alleen in lijst-modal).
 */
export const RISK_FOODS = [
  {
    key: 'honing',
    label: 'Honing',
    icon: '🍯',
    maxAgeMonths: 12,
    tags: ['botulisme'],
    intro: 'Niet geven onder 12 maanden — risico op zuigelingenbotulisme.',
    body: `
      <p><em>(Skeleton — Anneleen vult later aan.)</em></p>
      <h4>Waarom een risico</h4>
      <p>Honing kan sporen van Clostridium botulinum bevatten. Babydarmen kunnen die nog niet onschadelijk maken, met risico op botulisme.</p>
      <h4>Vanaf wanneer wel</h4>
      <p>Vanaf 12 maanden is de darmflora rijp genoeg.</p>
      <h4>Let op</h4>
      <p>Ook in koek, ontbijtgranen of yoghurt waar honing in verwerkt is.</p>
    `,
    ingredientMatchers: [/\bhoning\b/i],
  },
  {
    key: 'koemelk_drank',
    label: 'Koemelk als drank',
    icon: '🥛',
    maxAgeMonths: 12,
    tags: ['nutrient'],
    intro: 'Geen volle koemelk als hoofd-drank onder 12 maanden.',
    body: `
      <p><em>(Skeleton — Anneleen vult later aan.)</em></p>
      <h4>Waarom een risico</h4>
      <p>Koemelk als hoofdvoeding belast nog onrijpe nieren en mist ijzer dat een baby in deze fase nodig heeft.</p>
      <h4>Vanaf wanneer wel</h4>
      <p>Verwerkt in yoghurt of pap mag vanaf 6 maanden in beperkte hoeveelheid. Als drank pas vanaf 12 maanden.</p>
    `,
    // Geen scan — koemelk komt te vaak voor in recepten (false positives).
    ingredientMatchers: [],
  },
  {
    key: 'hele_noten',
    label: 'Hele noten',
    icon: '🥜',
    maxAgeMonths: 48,
    tags: ['verstikking'],
    intro: 'Verstikkingsgevaar tot 4 jaar — alleen fijngemalen of als pasta.',
    body: `
      <p><em>(Skeleton — Anneleen vult later aan.)</em></p>
      <h4>Waarom een risico</h4>
      <p>Hele noten kunnen in de luchtweg terechtkomen en zijn moeilijk te verwijderen.</p>
      <h4>Hoe wel veilig geven</h4>
      <p>Fijngemalen, als notenpasta dun gesmeerd, of in gebak verwerkt.</p>
    `,
    ingredientMatchers: [
      /\b(hele|gehakte|stukjes?)\s+noten\b/i,
      // NL-meervoud: walnoot/walnoten (oo→o). Suffix `noo?t(?:en)?`
      // matcht enkelvoud (oo+t) én meervoud (o+ten).
      /\b(?:hazel|wal|para|pecan(?:ne)?|cashew|macadamia)noo?t(?:en)?\b/i,
      /\bpistaches?\b/i,
      /\bamandel(?:en)?\b/i,
    ],
  },
  {
    key: 'druiven',
    label: 'Druiven (heel)',
    icon: '🍇',
    maxAgeMonths: 48,
    tags: ['verstikking'],
    intro: 'Halveer of kwarteer — heel zijn ze het juiste formaat om luchtwegen te blokkeren.',
    body: `
      <p><em>(Skeleton — Anneleen vult later aan.)</em></p>
      <h4>Waarom een risico</h4>
      <p>De vorm en stevigheid maken druiven een bekende oorzaak van verstikking bij jonge kinderen.</p>
      <h4>Hoe wel veilig geven</h4>
      <p>In de lengte halveren of kwarteren tot minstens 4 jaar.</p>
    `,
    ingredientMatchers: [/\bdruiv/i],
  },
  {
    key: 'kerstomaten',
    label: 'Kerstomaten (heel)',
    icon: '🍅',
    maxAgeMonths: 48,
    tags: ['verstikking'],
    intro: 'Halveer of kwarteer — zelfde reden als hele druiven.',
    body: `
      <p><em>(Skeleton — Anneleen vult later aan.)</em></p>
      <h4>Waarom een risico</h4>
      <p>Ronde, gladde, stevige vorm — perfecte luchtwegblokker.</p>
      <h4>Hoe wel veilig geven</h4>
      <p>In de lengte halveren of in vier delen tot minstens 4 jaar.</p>
    `,
    // Singulair + meervoud: tomaat/tomaten.
    ingredientMatchers: [/\b(kers|cherry)\s*tomaa?t(en)?\b/i],
  },
  {
    key: 'rauwe_eieren',
    label: 'Rauwe of half-rauwe eieren',
    icon: '🥚',
    maxAgeMonths: 60,
    tags: ['microbieel'],
    intro: 'Salmonella-risico — eieren goed doorbakken tot 5 jaar.',
    body: `
      <p><em>(Skeleton — Anneleen vult later aan.)</em></p>
      <h4>Waarom een risico</h4>
      <p>Rauwe eieren kunnen salmonella bevatten. Bij jonge kinderen verloopt zo'n infectie ernstiger.</p>
      <h4>Let op</h4>
      <p>Tiramisu, zelfgemaakte mayonaise, mousse, zachtgekookte eieren met lopende dooier — vermijden tot 5 jaar.</p>
    `,
    ingredientMatchers: [
      /\brauw(e)?\s+ei(eren)?\b/i,
      /\btiramisu\b/i,
      /\bmousse\b/i,
      /\bzachtgekookt(e)?\s+ei/i,
    ],
  },
  {
    key: 'rauw_vlees',
    label: 'Rauw of half-gaar vlees',
    icon: '🥩',
    maxAgeMonths: 60,
    tags: ['microbieel'],
    intro: 'Carpaccio, tartaar, filet americain — niet onder 5 jaar.',
    body: `
      <p><em>(Skeleton — Anneleen vult later aan.)</em></p>
      <h4>Waarom een risico</h4>
      <p>Rauw of half-gaar vlees kan E. coli, salmonella of listeria bevatten.</p>
      <h4>Let op</h4>
      <p>Vlees altijd goed doorbakken — geen rosé bij gehakt of gevogelte.</p>
    `,
    ingredientMatchers: [
      /\b(carpaccio|tartaar|filet\s+americain|biefstuk\s+rosé)\b/i,
      /\brauw(e?)\s+(vlees|gehakt|kip)/i,
    ],
  },
  {
    key: 'rauwe_vis',
    label: 'Rauwe vis',
    icon: '🍣',
    maxAgeMonths: 60,
    tags: ['microbieel'],
    intro: 'Sushi, sashimi, gerookte vis — vermijden tot 5 jaar.',
    body: `
      <p><em>(Skeleton — Anneleen vult later aan.)</em></p>
      <h4>Waarom een risico</h4>
      <p>Rauwe en gerookte vis kunnen listeria of parasieten bevatten.</p>
      <h4>Let op</h4>
      <p>Sushi, sashimi, gerookte zalm, gravad lax — pas vanaf 5 jaar in beperkte mate.</p>
    `,
    ingredientMatchers: [
      /\b(sushi|sashimi|gravad\s*lax)\b/i,
      /\bgerookte?\s+(zalm|forel|haring|paling|vis)/i,
      /\brauwe?\s+vis/i,
    ],
  },
  {
    key: 'kwik_vis',
    label: 'Vis met veel kwik',
    icon: '🐟',
    maxAgeMonths: 192,
    tags: ['kwik'],
    intro: 'Roofvissen (zwaardvis, haai, marlijn) — niet voor jonge kinderen.',
    body: `
      <p><em>(Skeleton — Anneleen vult later aan.)</em></p>
      <h4>Waarom een risico</h4>
      <p>Roofvissen stapelen kwik op via kleinere vis. Hoge kwik-inname schaadt de ontwikkeling van het zenuwstelsel.</p>
      <h4>Wat dan wel</h4>
      <p>Zalm, kabeljauw, koolvis, schol, forel — beperkt tot 1-2 keer per week.</p>
    `,
    ingredientMatchers: [/\b(zwaardvis|haai|marlijn|koningsmakreel|tilefish)\b/i],
  },
  {
    key: 'rauwe_melkproducten',
    label: 'Rauwe melkproducten',
    icon: '🧀',
    maxAgeMonths: 60,
    tags: ['microbieel'],
    intro: 'Rauwmelkse kazen — listeria-risico tot 5 jaar.',
    body: `
      <p><em>(Skeleton — Anneleen vult later aan.)</em></p>
      <h4>Waarom een risico</h4>
      <p>Niet-gepasteuriseerde melk en kazen kunnen listeria bevatten — gevaarlijk voor jonge kinderen.</p>
      <h4>Let op het etiket</h4>
      <p>"Au lait cru" of "rauwmelks" = vermijden. Gepasteuriseerde alternatieven zijn veilig.</p>
    `,
    ingredientMatchers: [
      /\brauwmelks(e)?\b/i,
      /\bau\s+lait\s+cru\b/i,
    ],
  },
  {
    key: 'toegevoegd_zout',
    label: 'Toegevoegd zout',
    icon: '🧂',
    maxAgeMonths: 12,
    tags: ['nutrient'],
    intro: 'Onder 12 maanden geen zout toevoegen — onrijpe nieren.',
    body: `
      <p><em>(Skeleton — Anneleen vult later aan.)</em></p>
      <h4>Waarom een risico</h4>
      <p>Babynieren kunnen overtollig zout nog niet goed uitscheiden.</p>
      <h4>Let op</h4>
      <p>Bouillonblokjes, kant-en-klaar saus, brood en kaas bevatten al zout — geen extra toevoegen.</p>
    `,
    // Te veel false positives in recepten — alleen tonen in lijst-modal.
    ingredientMatchers: [],
  },
  {
    key: 'toegevoegde_suiker',
    label: 'Toegevoegde suiker',
    icon: '🍬',
    maxAgeMonths: 24,
    tags: ['nutrient'],
    intro: 'Onder 2 jaar liefst geen toegevoegde suikers.',
    body: `
      <p><em>(Skeleton — Anneleen vult later aan.)</em></p>
      <h4>Waarom een risico</h4>
      <p>Vroeg gewenning aan zoete smaak en tand-erosie.</p>
      <h4>Wat dan wel</h4>
      <p>Natuurlijke zoetheid uit fruit en zuivel.</p>
    `,
    ingredientMatchers: [],
  },
  {
    key: 'rauwe_peulvruchten',
    label: 'Rauwe of slecht gegaarde peulvruchten',
    icon: '🫘',
    maxAgeMonths: 12,
    tags: ['microbieel', 'nutrient'],
    intro: 'Goed weken en doorkoken — anders moeilijk verteerbaar.',
    body: `
      <p><em>(Skeleton — Anneleen vult later aan.)</em></p>
      <h4>Waarom een risico</h4>
      <p>Onvoldoende gekookte peulvruchten bevatten lectines die buikpijn en braken kunnen geven.</p>
      <h4>Hoe wel veilig</h4>
      <p>Minstens 8 uur weken, daarna 30+ minuten doorkoken. Conservenversies zijn al gaar.</p>
    `,
    ingredientMatchers: [],
  },
];

/**
 * Vast aantal toedieningen per allergeen om als "veilig" te gelden.
 * Niet specifiek voor risk-foods, maar samen met allergenen-progressie
 * in brok H.3 gebruikt. Hier centraal voor één bron.
 */
export const ALLERGEN_INTROS_TARGET = 3;

/* ============================================
   Helpers
============================================ */

export function getRiskFood(key) {
  return RISK_FOODS.find((r) => r.key === key) || null;
}

export function getAllRiskFoods() {
  return RISK_FOODS.slice();
}

/**
 * Items die nog relevant zijn voor een kindje van deze leeftijd.
 * Een item is relevant als ageMonths < maxAgeMonths.
 */
export function getRelevantRiskFoods(ageMonths) {
  if (typeof ageMonths !== 'number' || Number.isNaN(ageMonths)) return [];
  return RISK_FOODS.filter((r) => ageMonths < r.maxAgeMonths);
}

/**
 * Recept-scan: geef array terug van risk-items die in de tekst voorkomen
 * en waarvoor het kindje nog te jong is. `recipe` mag een string zijn
 * (gecombineerde tekst) of een recipe-object met name + ingredients.
 *
 * Conservatief: bij twijfel waarschuwen, niet blokkeren.
 */
export function scanRecipeForRisks(recipe, ageMonths) {
  const text = typeof recipe === 'string' ? recipe : recipeToScanText(recipe);
  if (!text) return [];
  const relevant = getRelevantRiskFoods(ageMonths);
  return relevant.filter((r) =>
    Array.isArray(r.ingredientMatchers) &&
    r.ingredientMatchers.some((re) => re.test(text))
  );
}

/**
 * Vlak een recipe-object naar één tekst-blok voor regex-scanning.
 * Pakt name + ingredient-namen + optionele method/description.
 */
export function recipeToScanText(recipe) {
  if (!recipe || typeof recipe !== 'object') return '';
  const parts = [recipe.name || recipe.title || ''];
  (recipe.ingredients || []).forEach((i) => {
    if (typeof i === 'string') parts.push(i);
    else if (i && typeof i === 'object') parts.push(i.name || i.ingredient || '');
  });
  if (recipe.description) parts.push(recipe.description);
  if (recipe.method) parts.push(recipe.method);
  if (Array.isArray(recipe.steps)) parts.push(recipe.steps.join(' '));
  return parts.join(' ');
}

/**
 * Korte mens-leesbare leeftijdsdrempel.
 * 12 → "tot 12 maanden", 48 → "tot 4 jaar", 60 → "tot 5 jaar".
 */
export function formatAgeLimit(maxAgeMonths) {
  if (typeof maxAgeMonths !== 'number') return '';
  if (maxAgeMonths < 24) return `tot ${maxAgeMonths} maanden`;
  const years = Math.floor(maxAgeMonths / 12);
  return `tot ${years} jaar`;
}

export function tagLabel(tag) {
  return RISK_TAGS[tag] || tag;
}
