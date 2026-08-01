/* ============================================
   AANRADERS — zoeken + filteren (stap 8)

   Eén bestand voor twee weergaves, net als
   aanraders.css: de publieke pagina laadt het
   met een <script type="module">, de in-app
   weergave importeert initAanradersFilters()
   en roept die aan na het injecteren van het
   fragment. Twee kopieën van deze logica lopen
   na verloop van tijd uiteen.

   Alles gebeurt client-side op de al gerenderde
   kaarten: geen extra request, geen herlaadbeurt.
   Zonder JS blijft de volledige lijst staan —
   de toolbar is dan enkel niet bruikbaar.
============================================ */

/* Selecteert alle kaarten binnen één weergave. */
function kaarten(root) {
  return Array.prototype.slice.call(root.querySelectorAll('.card[data-zoek]'));
}

/** Normaliseer voor zoeken: kleine letters, diakritieken weg. */
function normaliseer(tekst) {
  return String(tekst || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Hangt zoek- en filtergedrag aan één weergave.
 *
 * root  – element dat zowel de .toolbar als de kaarten bevat.
 *
 * Veilig om meermaals aan te roepen: de vorige listeners worden
 * opgeruimd doordat we ze op de toolbar zelf zetten en die bij een
 * nieuwe fragment-injectie mee vervangen wordt.
 */
export function initAanradersFilters(root) {
  if (!root) return;
  const balk = root.querySelector('[data-filterbalk]');
  if (!balk) return; // categorie- en productpagina's hebben geen toolbar

  const zoekveld = balk.querySelector('[data-zoekveld]');
  const pillen = Array.prototype.slice.call(balk.querySelectorAll('.pill[data-dim]'));
  const leeg = root.querySelector('[data-geen-resultaten]');
  const items = kaarten(root);

  /* Actieve keuze per dimensie. Lege string = "Alles". */
  const keuze = Object.create(null);
  pillen.forEach((p) => { keuze[p.getAttribute('data-dim')] = ''; });

  function past(kaart) {
    const term = normaliseer(zoekveld ? zoekveld.value.trim() : '');
    if (term && normaliseer(kaart.getAttribute('data-zoek')).indexOf(term) === -1) return false;

    for (const dim in keuze) {
      const gekozen = keuze[dim];
      if (!gekozen) continue;

      /* Leeftijd is een ondergrens, geen exacte waarde: een kindje van
         12 maanden mag ook alles zien wat vanaf 6 maanden geschikt is.
         Producten zonder leeftijd zijn niet leeftijdsgebonden en blijven
         altijd staan. */
      if (dim === 'leeftijd') {
        const ruw = kaart.getAttribute('data-leeftijd');
        if (ruw === '' || ruw === null) continue;
        if (Number(ruw) > Number(gekozen)) return false;
        continue;
      }

      if (kaart.getAttribute('data-' + dim) !== gekozen) return false;
    }
    return true;
  }

  function toepassen() {
    let zichtbaar = 0;
    items.forEach((kaart) => {
      const ok = past(kaart);
      kaart.hidden = !ok;
      if (ok) zichtbaar++;
    });

    /* Een categorieblok zonder overgebleven kaarten verbergen, inclusief
       de kop — anders blijft er een titel met witruimte staan. Blokken
       zonder kaarten (de "binnenkort"-categorieën) blijven ongemoeid
       zolang er niet gefilterd wordt. */
    const filtertActief = zichtbaar !== items.length;
    Array.prototype.forEach.call(root.querySelectorAll('.cat'), (blok) => {
      const eigen = blok.querySelectorAll('.card[data-zoek]');
      if (!eigen.length) {
        blok.hidden = filtertActief; // "binnenkort"-blok enkel tonen zonder filter
        return;
      }
      blok.hidden = !Array.prototype.some.call(eigen, (k) => !k.hidden);
    });

    if (leeg) leeg.hidden = zichtbaar !== 0;
  }

  if (zoekveld) {
    zoekveld.addEventListener('input', toepassen);
    /* Escape wist het zoekveld — sneller dan terugbackspacen. */
    zoekveld.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && zoekveld.value) {
        zoekveld.value = '';
        toepassen();
      }
    });
  }

  pillen.forEach((pil) => {
    pil.addEventListener('click', () => {
      const dim = pil.getAttribute('data-dim');
      const val = pil.getAttribute('data-val') || '';

      /* Opnieuw klikken op een actieve pil zet de dimensie terug op Alles. */
      keuze[dim] = (keuze[dim] === val && val !== '') ? '' : val;

      pillen.forEach((p) => {
        if (p.getAttribute('data-dim') !== dim) return;
        const eigen = p.getAttribute('data-val') || '';
        p.classList.toggle('active', eigen === keuze[dim]);
        p.setAttribute('aria-pressed', eigen === keuze[dim] ? 'true' : 'false');
      });

      toepassen();
    });
  });

  toepassen();
}

/* Publieke pagina: daar staat de HTML al klaar bij het laden. In de app
   wordt het fragment later geïnjecteerd; die roept de functie zelf aan. */
if (typeof document !== 'undefined' && document.body && document.body.classList.contains('aanraders-page')) {
  initAanradersFilters(document.body);
}
