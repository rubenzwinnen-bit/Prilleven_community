/* ============================================
   EERSTE HAPJES — SYMPTOMEN (brok G.1)
   Centrale config voor de symptoom-tracker:
   - tegel-grid in symptomLogModal
   - detail-modal (symptomDetailModal) met uitleg + rode-vlag-criteria
   - server-side mirror in api/_lib/eersteHapjes-logs.mjs (alleen
     keys + redFlagSeverity worden daar gespiegeld voor adaptieve
     red-flag-detectie).

   Body's zijn skeleton-content — Anneleen vult later aan.
   Geen markdown-parser; HTML-strings rechtstreeks.
   Geen medisch advies — disclaimer staat per kaart.
============================================ */

/**
 * Severity-niveaus die de adaptieve red-flag-banner triggeren.
 * - 'heftig' op alles → red_flag (basis-veiligheidsnet).
 * - 'matig' op kritische types → ook red_flag.
 * - 'mild' nooit.
 */
export const SYMPTOMS = [
  // ---------- Bestaande 10 ----------
  {
    key: 'huid',
    label: 'Huid',
    icon: '🌡',
    intro: 'Roodheid, vlekjes of uitslag op de huid.',
    body: `
      <p><em>(Skeleton — Anneleen vult later aan.)</em></p>
      <h4>Wat zien we vaak</h4>
      <p>Korte uitleg over huidreacties bij baby's tijdens het hapjes-traject: contact-irritatie rond de mond, lokale uitslag na introductie van een nieuw voedsel, eczeem-flare-up.</p>
      <h4>Wat is meestal niet zorgwekkend</h4>
      <p>Lichte rode wangen of vlekjes rond de mond na pittige/zuurdere groenten of fruit, die vanzelf wegtrekken binnen het uur.</p>
      <h4>Wat kan helpen</h4>
      <p>Mond afdeppen na maaltijd, voedsel in een rustig moment introduceren.</p>
    `,
    redFlags: [
      'Snel verspreidende uitslag over het hele lichaam.',
      'Zwelling van lippen, tong of gezicht.',
      'Uitslag samen met benauwdheid of braken.',
    ],
    redFlagSeverity: ['heftig'],
  },
  {
    key: 'buik',
    label: 'Buikpijn',
    icon: '🤰',
    intro: 'Krampen, opgeblazen gevoel of duidelijk ongemak.',
    body: `
      <p><em>(Skeleton — Anneleen vult later aan.)</em></p>
      <h4>Wat zien we vaak</h4>
      <p>Buikkrampjes zijn frequent in de eerste maanden van vaste voeding, zeker bij overgang tussen texturen en hoeveelheden.</p>
      <h4>Wat is meestal niet zorgwekkend</h4>
      <p>Korte krampen na een maaltijd die vanzelf wegtrekken, zonder koorts of braken.</p>
      <h4>Wat kan helpen</h4>
      <p>Buikje masseren, fietsbeweging met de beentjes, kleinere porties verdelen over de dag.</p>
    `,
    redFlags: [
      'Aanhoudende, hevige pijn die niet wegtrekt.',
      'Bloed in de stoelgang.',
      'Buik die hard en gespannen aanvoelt + ontroostbaar huilen.',
    ],
    redFlagSeverity: ['heftig'],
  },
  {
    key: 'diarree',
    label: 'Diarree',
    icon: '💧',
    intro: 'Waterige of zeer frequente stoelgang.',
    body: `
      <p><em>(Skeleton — Anneleen vult later aan.)</em></p>
      <h4>Wat zien we vaak</h4>
      <p>De stoelgang verandert sterk bij introductie van nieuwe voeding. Frequentie, kleur en consistentie schuiven mee.</p>
      <h4>Wat is meestal niet zorgwekkend</h4>
      <p>Eén of twee zachtere ontlastingen na nieuw voedsel, zonder verdere klachten.</p>
      <h4>Wat kan helpen</h4>
      <p>Voldoende drinken aanbieden, terugschakelen naar vertrouwde voeding voor 1-2 dagen.</p>
    `,
    redFlags: [
      'Meer dan 5-6 waterige stoelgangen per dag.',
      'Tekenen van uitdroging (droge mond, weinig plassen, sufheid).',
      'Bloed of slijm in de stoelgang.',
      'Diarree + koorts + braken samen.',
    ],
    redFlagSeverity: ['heftig'],
  },
  {
    key: 'braken',
    label: 'Braken',
    icon: '🤢',
    intro: 'Echt overgeven (niet enkel spuugje na de fles).',
    body: `
      <p><em>(Skeleton — Anneleen vult later aan.)</em></p>
      <h4>Wat zien we vaak</h4>
      <p>Verschil tussen "spuugje na de fles" (normale reflux) en echt braken — de hoeveelheid en de manier zijn anders.</p>
      <h4>Wat is meestal niet zorgwekkend</h4>
      <p>Een eenmalige braak na een te grote hap of bekend triggervoedsel, zonder verdere klachten.</p>
      <h4>Wat kan helpen</h4>
      <p>Maaltijd uitstellen, kleine slokjes water/melk, rustig houden.</p>
    `,
    redFlags: [
      'Herhaaldelijk braken (>3× op een dag).',
      'Braken + diarree + koorts (uitdrogingsrisico).',
      'Groen-gallig of bloederig braaksel.',
    ],
    redFlagSeverity: ['matig', 'heftig'],
  },
  {
    key: 'slaap',
    label: 'Slaap',
    icon: '😴',
    intro: 'Onrust, vaak wakker worden, moeilijk inslapen.',
    body: `
      <p><em>(Skeleton — Anneleen vult later aan.)</em></p>
      <h4>Wat zien we vaak</h4>
      <p>Slaap kan verstoord raken bij grote veranderingen: nieuwe voeding, doorbrekende tandjes, ontwikkelingssprongen.</p>
      <h4>Wat is meestal niet zorgwekkend</h4>
      <p>Een paar onrustige nachten rond een nieuwe fase of mijlpaal.</p>
      <h4>Wat kan helpen</h4>
      <p>Voorspelbaar avondritueel, geen grote nieuwe voedingen vlak voor het slapen.</p>
    `,
    redFlags: [
      'Sufheid die niet wijkt na slaap (lethargie).',
      'Slaap die plots radicaal anders is + andere lichamelijke klachten.',
    ],
    redFlagSeverity: ['heftig'],
  },
  {
    key: 'koorts',
    label: 'Koorts',
    icon: '🤒',
    intro: 'Verhoogde lichaamstemperatuur (≥ 38°C rectaal).',
    body: `
      <p><em>(Skeleton — Anneleen vult later aan.)</em></p>
      <h4>Wat zien we vaak</h4>
      <p>Koorts hoort bijna nooit bij voeding zelf. Vaak hangt het samen met een andere infectie of doorbrekende tandjes (waar de discussie over woedt).</p>
      <h4>Wat is meestal niet zorgwekkend</h4>
      <p>Lichte koorts zonder andere alarmsignalen bij een verder vrolijk kindje.</p>
      <h4>Wat kan helpen</h4>
      <p>Voldoende drinken, rust, dunne kleding.</p>
    `,
    redFlags: [
      'Koorts < 3 maanden oud → altijd arts.',
      'Koorts > 39°C die niet zakt.',
      'Koorts + zwakke reactie / ontroostbaar / niet drinken.',
      'Koorts die langer dan 3 dagen aanhoudt.',
    ],
    redFlagSeverity: ['matig', 'heftig'],
  },
  {
    key: 'jeuk',
    label: 'Jeuk',
    icon: '✋',
    intro: 'Krabben, wrijven, onrustig op handjes/lijfje.',
    body: `
      <p><em>(Skeleton — Anneleen vult later aan.)</em></p>
      <h4>Wat zien we vaak</h4>
      <p>Lokale jeuk rond mond of wangen na nieuwe voeding kan komen door licht contact-irritatie.</p>
      <h4>Wat is meestal niet zorgwekkend</h4>
      <p>Korte jeuk-momenten zonder uitslag of zwelling.</p>
      <h4>Wat kan helpen</h4>
      <p>Mond afdeppen, nageltjes kort houden om krabben te beperken.</p>
    `,
    redFlags: [
      'Jeuk over het hele lichaam met uitslag.',
      'Jeuk samen met zwelling of benauwdheid.',
    ],
    redFlagSeverity: ['heftig'],
  },
  {
    key: 'zwelling',
    label: 'Zwelling',
    icon: '🫧',
    intro: 'Opzwellen van lippen, oogleden, gezicht of handjes.',
    body: `
      <p><em>(Skeleton — Anneleen vult later aan.)</em></p>
      <h4>Wat zien we vaak</h4>
      <p>Zwelling is altijd een aandachtssignaal — zeker bij introductie van nieuwe voeding.</p>
      <h4>Wat is meestal niet zorgwekkend</h4>
      <p>Heel lokale lichte zwelling rond een mug-prik of stootje.</p>
      <h4>Wat kan helpen</h4>
      <p>Bij twijfel rond voedsel-zwelling: arts contacteren — niet afwachten.</p>
    `,
    redFlags: [
      'Zwelling van lippen, tong of gezicht.',
      'Zwelling + ademhalingsproblemen → 112.',
      'Zwelling die snel groter wordt.',
    ],
    redFlagSeverity: ['matig', 'heftig'],
  },
  {
    key: 'ademhaling',
    label: 'Ademhaling',
    icon: '🫁',
    intro: 'Snel, piepend of moeilijk ademen.',
    body: `
      <p><em>(Skeleton — Anneleen vult later aan.)</em></p>
      <h4>Wat zien we vaak</h4>
      <p>Verandering in ademhaling is altijd een belangrijk signaal. Dit hoort niet bij gewone introductie van vaste voeding.</p>
      <h4>Wat is meestal niet zorgwekkend</h4>
      <p>Hijgen na actief spelen of korte snik na huilen.</p>
      <h4>Wat kan helpen</h4>
      <p>Bij twijfel: niet afwachten, arts contacteren.</p>
    `,
    redFlags: [
      'Piepende of fluitende ademhaling.',
      'Snelle, oppervlakkige ademhaling in rust.',
      'Blauwe verkleuring rond de lippen → 112.',
      'Intrekkingen tussen de ribben bij elke ademteug.',
    ],
    redFlagSeverity: ['mild', 'matig', 'heftig'],
  },
  {
    key: 'anders',
    label: 'Anders',
    icon: '❓',
    intro: 'Iets dat niet in de andere categorieën past.',
    body: `
      <p><em>(Skeleton — Anneleen vult later aan.)</em></p>
      <h4>Beschrijf zelf wat je ziet</h4>
      <p>Gebruik het notitie-veld om in eigen woorden te beschrijven wat je opvalt. Dat helpt bij latere navraag of bij arts/diëtist.</p>
      <h4>Algemene richtlijn</h4>
      <p>Bij twijfel over een verandering die je niet kunt plaatsen: noteer het, en bespreek bij volgende consultatie.</p>
    `,
    redFlags: [
      'Bij een acute, ernstige verandering → contacteer arts.',
    ],
    redFlagSeverity: ['heftig'],
  },

  // ---------- Nieuw in brok G ----------
  {
    key: 'gewicht',
    label: 'Gewicht',
    icon: '⚖️',
    intro: 'Afvallen, groeistilstand of duidelijk minder volle vorm.',
    body: `
      <p><em>(Skeleton — Anneleen vult later aan.)</em></p>
      <h4>Wat zien we vaak</h4>
      <p>Tijdelijke groei-plateaus zijn normaal. Echte gewichtsproblemen hoor je vooral te zien op de groeicurve, niet enkel op het oog.</p>
      <h4>Wat is meestal niet zorgwekkend</h4>
      <p>Een week wat minder eetlust waardoor het gewicht stabiel blijft.</p>
      <h4>Wat kan helpen</h4>
      <p>Volgende consultatie laten meten, intussen blijven aanbieden zonder druk.</p>
    `,
    redFlags: [
      'Duidelijk afvallen over meerdere weken.',
      'Onder de groeicurve zakken bij consultatie.',
      'Combinatie met sufheid of weinig plassen.',
    ],
    redFlagSeverity: ['matig', 'heftig'],
  },
  {
    key: 'hoesten',
    label: 'Hoesten',
    icon: '😷',
    intro: 'Aanhoudend hoesten, zeker tijdens of na het eten.',
    body: `
      <p><em>(Skeleton — Anneleen vult later aan.)</em></p>
      <h4>Wat zien we vaak</h4>
      <p>Verslikken bij nieuwe texturen kan korte hoest-momenten geven. Aanhoudend hoesten hoort niet bij gewone introductie.</p>
      <h4>Wat is meestal niet zorgwekkend</h4>
      <p>Eén keer kuchen na een hap die te snel ging.</p>
      <h4>Wat kan helpen</h4>
      <p>Texturen iets fijner aanbieden, in rustige houding eten, geen grote happen forceren.</p>
    `,
    redFlags: [
      'Hoesten met benauwdheid of piepen.',
      'Plotse hoesten + niet meer kunnen ademen → mogelijk verslikking → 112.',
      'Aanhoudend hoesten in combinatie met koorts.',
    ],
    redFlagSeverity: ['matig', 'heftig'],
  },
  {
    key: 'verstopping',
    label: 'Verstopping',
    icon: '🚧',
    intro: 'Harde, droge of zeldzame stoelgang.',
    body: `
      <p><em>(Skeleton — Anneleen vult later aan.)</em></p>
      <h4>Wat zien we vaak</h4>
      <p>Bij overgang naar vaste voeding wordt de stoelgang vaster en minder frequent. Dat is op zich niet meteen verstopping.</p>
      <h4>Wat is meestal niet zorgwekkend</h4>
      <p>1-2 dagen geen stoelgang bij een verder rustig kindje.</p>
      <h4>Wat kan helpen</h4>
      <p>Vezels (peer, pruim, volle granen), voldoende drinken, beweging op buikje.</p>
    `,
    redFlags: [
      'Bloed bij de stoelgang.',
      'Hevige buikpijn samen met verstopping.',
      'Verstopping die dagenlang aanhoudt ondanks aanpassingen.',
    ],
    redFlagSeverity: ['heftig'],
  },
  {
    key: 'geen_eetlust',
    label: 'Geen eetlust',
    icon: '🍽️',
    intro: 'Eet duidelijk minder dan gewoonlijk, of weigert plots.',
    body: `
      <p><em>(Skeleton — Anneleen vult later aan.)</em></p>
      <h4>Wat zien we vaak</h4>
      <p>Eetlust schommelt sterk. Tandjes, ontwikkelingssprongen, vermoeidheid en kleine virussen kunnen tijdelijk de eetlust drukken.</p>
      <h4>Wat is meestal niet zorgwekkend</h4>
      <p>Een paar dagen minder eten bij een verder vrolijk en actief kindje.</p>
      <h4>Wat kan helpen</h4>
      <p>Geen druk zetten, maaltijden niet rekken, melk blijft dan extra belangrijk.</p>
    `,
    redFlags: [
      'Volledig weigeren te drinken.',
      'Eetlust-daling samen met sufheid of koorts.',
      'Aanhoudende weigering > 1 week zonder verklaring.',
    ],
    redFlagSeverity: ['heftig'],
  },
  {
    key: 'prikkelbaar',
    label: 'Prikkelbaar',
    icon: '😣',
    intro: 'Onrustig, vaak huilen, moeilijk te troosten.',
    body: `
      <p><em>(Skeleton — Anneleen vult later aan.)</em></p>
      <h4>Wat zien we vaak</h4>
      <p>Periodes van extra prikkelbaarheid horen bij ontwikkelingssprongen en doorbrekende tandjes. Soms is het een eerste signaal van een infectie.</p>
      <h4>Wat is meestal niet zorgwekkend</h4>
      <p>Een paar dagen wat gevoeliger en sneller huilen, troostbaar in vertrouwde armen.</p>
      <h4>Wat kan helpen</h4>
      <p>Voorspelbaar dagritme, extra rust, prikkels verminderen.</p>
    `,
    redFlags: [
      'Ontroostbaar huilen dat uren aanhoudt.',
      'Prikkelbaarheid + koorts + niet drinken.',
    ],
    redFlagSeverity: ['heftig'],
  },
  {
    key: 'lethargie',
    label: 'Lethargie',
    icon: '😶',
    intro: 'Sufheid, weinig reactie, slap aanvoelen.',
    body: `
      <p><em>(Skeleton — Anneleen vult later aan.)</em></p>
      <h4>Wat zien we vaak</h4>
      <p>Lethargie is een belangrijk signaal — het is niet hetzelfde als "moe" of "uitgehuild".</p>
      <h4>Wat is meestal niet zorgwekkend</h4>
      <p>Diepe slaap na een drukke dag, waarbij het kindje gewekt wordt en weer normaal reageert.</p>
      <h4>Wat kan helpen</h4>
      <p>Bij echte lethargie: niet afwachten, contacteer arts.</p>
    `,
    redFlags: [
      'Niet of slecht wekbaar.',
      'Slap aanvoelen, geen oogcontact.',
      'Sufheid + koorts + weinig drinken → snelle medische evaluatie.',
    ],
    redFlagSeverity: ['mild', 'matig', 'heftig'],
  },
];

/** Severity-niveaus voor de form-chip (UI-volgorde + label). */
export const SEVERITIES = [
  { value: 'mild',   label: 'Mild' },
  { value: 'matig',  label: 'Matig' },
  { value: 'heftig', label: 'Heftig' },
];

/** Lookup-helper: symptoom-config per key. */
export function getSymptom(key) {
  return SYMPTOMS.find((s) => s.key === key);
}

/** Alleen de UI-bits (label + icon) voor een gegeven key. */
export function getSymptomMeta(key) {
  const s = getSymptom(key);
  return s ? { key: s.key, label: s.label, icon: s.icon } : null;
}

/**
 * Bepaal of een (type, severity)-combinatie een red-flag triggert.
 * Frontend gebruikt dit voor optimistic UI — server heeft een eigen mirror.
 */
export function isRedFlag(symptomKey, severity) {
  const s = getSymptom(symptomKey);
  if (!s) return false;
  return Array.isArray(s.redFlagSeverity) && s.redFlagSeverity.includes(severity);
}
