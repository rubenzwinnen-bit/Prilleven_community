/* ============================================
   EERSTE HAPJES — CONTENT (brok E)
   Microlearning-artikels voor het Eerste Hapjes-traject.
   Geen DB-tabel: alle content staat hier statisch.

   Schrijfregels:
   - body = HTML-string (we schrijven 'm zelf, dus geen sanitize nodig).
   - Toegestane tags: <p>, <ul>, <ol>, <li>, <strong>, <em>, <h4>.
   - Geen externe links of <script>/<img> — bewust beperkt.
   - Iedere artikel heeft een uniek slug + leeftijdsrange in maanden.

   Categorieën:
   - 'intro'      — start van het traject
   - 'allergenen' — allergeen-introductie
   - 'textuur'    — textuur-overgang (puree → stukjes)
   - 'zelfvoeden' — zelfstandig eten + pincet-greep
   - 'mijlpaal'   — algemene mijlpalen / wat is normaal
   - 'veiligheid' — verstikking, slik-veiligheid

   Skeleton-status: titels + ageranges staan vast, body's zijn nog
   placeholders. Anneleen vult ze later aan vanuit haar eigen content.
============================================ */

export const ARTICLES = [
  {
    id: 'a1',
    slug: 'start-met-groente',
    title: 'Klaar om te starten met groente',
    summary: 'Hoe herken je dat je kindje klaar is voor de eerste hapjes en waarmee start je het beste.',
    ageMinMonths: 4,
    ageMaxMonths: 6,
    category: 'intro',
    body: `
      <p><em>Skeleton — vul aan vanuit eigen content.</em></p>
      <p>Korte intro over wanneer je kunt starten met vaste voeding, signalen van klaar-zijn (rechtop zitten, hoofd-controle, interesse in eten van anderen, geen tongstoot-reflex meer), en welke groenten je het best als eerste aanbiedt.</p>
      <h4>Wat staat er straks in dit artikel</h4>
      <ul>
        <li>Wanneer kan je starten? (richtlijnen NL/BE)</li>
        <li>5 signalen dat je kindje er klaar voor is</li>
        <li>Welke groenten als eerste — en waarom</li>
        <li>Hoeveelheid en frequentie in de eerste week</li>
      </ul>
    `,
  },
  {
    id: 'a2',
    slug: 'eerste-fruit',
    title: 'Eerste fruit aanbieden',
    summary: 'Na groente komt fruit. Welk fruit eerst, en waarom is volgorde belangrijk?',
    ageMinMonths: 5,
    ageMaxMonths: 7,
    category: 'intro',
    body: `
      <p><em>Skeleton — vul aan vanuit eigen content.</em></p>
      <p>Tips over het introduceren van fruit nadat groente al goed loopt. Volgorde, zoetheid, en het belang van afwisselen.</p>
      <h4>Wat staat er straks in dit artikel</h4>
      <ul>
        <li>Waarom groente vóór fruit?</li>
        <li>Goede starters: appel, peer, banaan</li>
        <li>Wanneer je nog moet kuisen/koken vs. rauw</li>
        <li>Combinaties met groente</li>
      </ul>
    `,
  },
  {
    id: 'a3',
    slug: 'allergenen-introduceren',
    title: 'Allergenen vroeg introduceren',
    summary: 'Recente richtlijnen raden aan om allergenen niet uit te stellen — wat, wanneer en hoe.',
    ageMinMonths: 6,
    ageMaxMonths: 9,
    category: 'allergenen',
    body: `
      <p><em>Skeleton — vul aan vanuit eigen content.</em></p>
      <p>De huidige Belgische/Nederlandse richtlijnen rond allergeen-introductie. Volgorde, frequentie, en wat als er een reactie is.</p>
      <h4>Wat staat er straks in dit artikel</h4>
      <ul>
        <li>Waarom vroege introductie wordt aangeraden</li>
        <li>Volgorde: ei, pinda, zuivel, vis, gluten, …</li>
        <li>Hoeveelheid om mee te starten</li>
        <li>Wat te doen bij een milde / ernstige reactie</li>
        <li>Wanneer arts contacteren</li>
      </ul>
      <p>Tip: gebruik de allergenen-tracker in deze app om bij te houden wat je al introduceerde en hoe je kindje reageerde.</p>
    `,
  },
  {
    id: 'a4',
    slug: 'puree-naar-stukjes',
    title: 'Van puree naar stukjes',
    summary: 'De textuur-overgang stap voor stap, en hoe je voorkomt dat je kindje "blijft hangen" in puree.',
    ageMinMonths: 7,
    ageMaxMonths: 10,
    category: 'textuur',
    body: `
      <p><em>Skeleton — vul aan vanuit eigen content.</em></p>
      <p>De stap van gladde puree naar grovere structuren is belangrijk voor de mondontwikkeling. Hoe pak je dat aan zonder weigering?</p>
      <h4>Wat staat er straks in dit artikel</h4>
      <ul>
        <li>Waarom textuur-variatie belangrijk is</li>
        <li>Tussenstappen: grof prakken, kleine zachte stukjes, vingerstukjes</li>
        <li>Wat als je kindje stukjes weigert?</li>
        <li>Verschil tussen kokhalzen en verslikken</li>
      </ul>
    `,
  },
  {
    id: 'a5',
    slug: 'zelf-eten-pincet',
    title: 'Zelf eten en de pincet-greep',
    summary: 'Vingerfood, lepel-experiment en de eerste stappen naar zelfstandig eten.',
    ageMinMonths: 8,
    ageMaxMonths: 12,
    category: 'zelfvoeden',
    body: `
      <p><em>Skeleton — vul aan vanuit eigen content.</em></p>
      <p>Rond 8-9 maanden ontwikkelt de pincet-greep en wil je kindje vaak zelf het eten naar de mond brengen. Een fase van knoeien, maar ook van ontwikkeling.</p>
      <h4>Wat staat er straks in dit artikel</h4>
      <ul>
        <li>Veilige vingerfood-ideeën per maand</li>
        <li>Hoe pincet-greep oefenen (kleine stukjes, niet-glibberig)</li>
        <li>Lepel zelf vasthouden: wanneer en hoe</li>
        <li>Knoeien = leren — tips om het werkbaar te houden</li>
      </ul>
    `,
  },
  {
    id: 'a6',
    slug: 'familiekost-meeproeven',
    title: 'Meeproeven met de familiekost',
    summary: 'Wanneer kan je kindje gewoon mee-eten, en wat moet je nog aanpassen?',
    ageMinMonths: 10,
    ageMaxMonths: 18,
    category: 'mijlpaal',
    body: `
      <p><em>Skeleton — vul aan vanuit eigen content.</em></p>
      <p>De fase waarin het kindje mee aan tafel zit en stilaan dezelfde maaltijden eet als de rest van het gezin. Wat moet je nog aanpassen?</p>
      <h4>Wat staat er straks in dit artikel</h4>
      <ul>
        <li>Wat zout, suiker en kruiden betreft</li>
        <li>Welke familievoeding aan te passen of te vermijden</li>
        <li>Portiegroottes en zelfregulatie</li>
        <li>Sociale waarde van samen eten</li>
      </ul>
    `,
  },
  {
    id: 'a7',
    slug: 'verstikking-veiligheid',
    title: 'Veilig eten: verstikkingsgevaar',
    summary: 'Hoe herken je het verschil tussen kokhalzen en verslikken, en welk eten is risico.',
    ageMinMonths: 4,
    ageMaxMonths: 36,
    category: 'veiligheid',
    body: `
      <p><em>Skeleton — vul aan vanuit eigen content.</em></p>
      <p>Een artikel dat altijd relevant is — zolang je kindje eet, blijft veiligheid een aandachtspunt. Wat te doen bij een incident en welke voeding is risicovol?</p>
      <h4>Wat staat er straks in dit artikel</h4>
      <ul>
        <li>Verschil kokhalzen ↔ verslikken (wel/geen geluid, kleur)</li>
        <li>Top-5 verstikkingsrisico's in de eerste 3 jaar</li>
        <li>Hoe snijd je risicovolle voeding wel veilig (druiven, worstjes, …)</li>
        <li>Eerste hulp bij verslikking — basisstappen</li>
      </ul>
      <p><strong>Belangrijk:</strong> dit vervangt geen erkende eerste-hulp-cursus. Volg een baby-EHBO-training voor echte vaardigheid.</p>
    `,
  },
];

export const CATEGORY_LABEL = {
  intro:      'Start',
  allergenen: 'Allergenen',
  textuur:    'Textuur',
  zelfvoeden: 'Zelf eten',
  mijlpaal:   'Mijlpaal',
  veiligheid: 'Veiligheid',
};
