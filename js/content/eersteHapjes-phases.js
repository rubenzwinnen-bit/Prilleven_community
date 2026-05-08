/* ============================================
   EERSTE HAPJES — FASEN (brok F.1)
   6 fases (0..5) met "ten vroegste vanaf"-leeftijd en
   afvinkbare checklist om naar de volgende fase te gaan.

   Bron: Productoverzicht "Eerste Hapjes Traject" (PDF Anneleen).

   Regels:
   - Leeftijd is "ten vroegste vanaf", niet automatisch.
   - Ouder vinkt zelf de checklist af om door te schuiven.
   - Geen percentages — wel "X van 5 mijlpalen — geen haast".
   - Fase 5 = eindfase (geen checks om verder te gaan).
============================================ */

export const PHASES = [
  {
    number: 0,
    name: 'Opstart',
    label: 'Voorbereiding',
    minAgeMonths: 0,
    intro:
      'Voorbereiding zonder druk. Je leest, observeert je kindje en maakt het praktisch in orde. Pas wanneer je kindje signalen geeft van klaar-zijn, ga je over naar fase 1.',
    advanceLabel: 'Klaar voor fase 1 — Eerste hapjes',
    checks: [
      { key: 'rechtop_zitten', label: 'Mijn kindje kan stabiel rechtop zitten (met lichte ondersteuning).' },
      { key: 'interesse_eten', label: 'Mijn kindje toont interesse in eten van anderen.' },
      { key: 'tongreflex', label: 'De tongreflex (eten weer naar buiten duwen) is duidelijk verminderd.' },
      { key: 'praktisch_klaar', label: 'Ik ben praktisch klaar (kinderstoel, lepeltjes, slabbetjes).' },
      { key: 'geen_druk', label: 'Ik voel geen prestatiedruk — we starten op ons eigen tempo.' },
    ],
  },
  {
    number: 1,
    name: 'Eerste hapjes',
    label: 'Eén maaltijd',
    minAgeMonths: 6,
    intro:
      'De eerste smaakkennismakingen. Eén maaltijd per dag, kleine porties, rustig opbouwen. Je kindje hoeft niets "op te hebben" — proeven volstaat.',
    advanceLabel: 'Klaar voor fase 2 — Tweede maaltijd',
    checks: [
      { key: 'maaltijd_rustig', label: 'De eerste maaltijd verloopt rustiger dan in het begin.' },
      { key: 'enkele_hapjes', label: 'Mijn kindje neemt regelmatig enkele hapjes.' },
      { key: 'allergenen_intro', label: 'Ik heb de eerste allergenen bewust geïntroduceerd.' },
      { key: 'reacties_herkennen', label: 'Ik herken reacties beter en weet wat normaal is.' },
      { key: 'minder_stress', label: 'Er is minder stress en meer routine rond het eetmoment.' },
    ],
  },
  {
    number: 2,
    name: 'Tweede maaltijd',
    label: 'Smaak verbreden',
    minAgeMonths: 7,
    intro:
      'Naast de eerste maaltijd komt er een tweede eetmoment bij — meestal fruit. Je verbreedt smaken en texturen. Geen haast: dit mag een paar weken duren.',
    advanceLabel: 'Klaar voor fase 3 — Ontbijt',
    checks: [
      { key: 'twee_eetmomenten', label: 'Twee eetmomenten op een dag zijn haalbaar.' },
      { key: 'meerdere_momenten', label: 'Mijn kindje toont interesse in eten op meerdere momenten van de dag.' },
      { key: 'textuur_acceptatie', label: 'Mijn kindje accepteert iets meer textuur dan in het begin.' },
      { key: 'minder_stress_reacties', label: 'Ik voel minder stress rond stoelgang en mogelijke reacties.' },
      { key: 'langere_verzadiging', label: 'Mijn kindje voelt zich langer verzadigd na een maaltijd.' },
    ],
  },
  {
    number: 3,
    name: 'Ontbijt',
    label: 'Drie maaltijden',
    minAgeMonths: 8,
    intro:
      'De derde maaltijd komt erbij — meestal in de vorm van ontbijt. Je dagstructuur valt stilaan op zijn plaats. Melk blijft daarnaast belangrijk.',
    advanceLabel: 'Klaar voor fase 4 — Eerste snack',
    checks: [
      { key: 'drie_eetmomenten', label: 'Drie eetmomenten zijn stabiel ingebouwd in onze dag.' },
      { key: 'vraagt_extra', label: 'Mijn kindje vraagt op sommige momenten extra voeding.' },
      { key: 'meer_zelfstandig', label: 'Mijn kindje eet meer zelfstandig (handjes, eerste lepeltjes).' },
      { key: 'melk_loopt_goed', label: 'De melkvoeding blijft goed lopen naast de maaltijden.' },
      { key: 'dagstructuur_stabiel', label: 'Onze dagstructuur voelt stabieler aan.' },
    ],
  },
  {
    number: 4,
    name: 'Eerste snack',
    label: 'Tussendoor',
    minAgeMonths: 10,
    intro:
      'Een eerste tussendoortje vult de honger tussen maaltijden op. Je merkt dat je kindje langere actieve periodes heeft en grotere honger-pieken.',
    advanceLabel: 'Klaar voor fase 5 — Tweede snack',
    checks: [
      { key: 'snack_helpt', label: 'De snack helpt zichtbaar tegen honger-pieken.' },
      { key: 'langere_actief', label: 'Mijn kindje heeft langere actieve periodes tussen slaapmomenten.' },
      { key: 'maaltijden_stabiel', label: 'De maaltijden zelf zijn stabieler en voorspelbaarder.' },
      { key: 'textuur_beter', label: 'Mijn kindje accepteert nog wat meer textuur.' },
      { key: 'melk_neemt_af', label: 'De hoeveelheid melk neemt op natuurlijke wijze wat af.' },
    ],
  },
  {
    number: 5,
    name: 'Tweede snack',
    label: 'Volledig basisritme',
    minAgeMonths: 12,
    intro:
      'Drie maaltijden + twee tussendoortjes vormen het volledige basisritme. Je kindje eet mee in het gezinspatroon. Dit is de eindfase van het traject — vanaf hier is het verbreden en verfijnen.',
    advanceLabel: null, // eindfase, geen volgende
    checks: [
      // Geen checks: fase 5 is eindstation. Mijlpalen-balk toont 0/0.
    ],
  },
];

/** Auto-init drempel: kindjes ouder dan dit aantal maanden starten meteen op fase 5. */
export const AUTO_FASE5_AGE_MONTHS = 14;

/** Lookup-helper. Returnt undefined bij ongeldig nummer. */
export function getPhase(number) {
  return PHASES.find((p) => p.number === number);
}

/**
 * Welke fase past bij de leeftijd op moment van eerste init?
 * - ≥ AUTO_FASE5_AGE_MONTHS → 5
 * - anders → 0 (ouder vinkt zelf door).
 */
export function initialPhaseForAge(ageMonths) {
  if (typeof ageMonths === 'number' && ageMonths >= AUTO_FASE5_AGE_MONTHS) return 5;
  return 0;
}
