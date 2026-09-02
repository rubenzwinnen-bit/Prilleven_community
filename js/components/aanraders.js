/* ============================================
   AANRADERS — in-app weergave
   Toont dezelfde affiliatepagina als /aanraders,
   maar binnen de community: header, navigatie en
   sessie blijven staan.

   Er is bewust GEEN tweede renderer. De server
   levert exact dezelfde HTML als de publieke
   pagina (api/aanraders.mjs, fragment-modus),
   alleen zonder <html>/header/footer en met
   hash-links. Zo kan de in-app weergave niet
   uiteenlopen met de publieke pagina.

   Wat hier wél opnieuw moet: het inline script
   van de publieke pagina draait niet wanneer we
   HTML via innerHTML injecteren.
============================================ */

import * as Store from '../store.js?v=4.0.29';
import { initAanradersFilters } from '../../aanraders-filters.js?v=4.0.29';

const FRAGMENT_URL = '/api/aanraders?fragment=1';

/* Beheermodule wordt lazy geladen: gewone leden halen die code nooit op. */
let Admin = null;

/* Huidige route onthouden, zodat we na een wijziging kunnen herladen. */
let huidig = { soort: 'overzicht', slug: null };

/* ----------------------------------------
   RENDER — skelet, inhoud komt asynchroon
---------------------------------------- */
export function render() {
  /* Balk en inhoud staan bewust in aparte containers: de balk mag niet mee
     vervangen worden bij het herladen van de inhoud, anders springt de
     pagina omhoog na elke bewerking. */
  return `<div class="aanraders" id="aanraders-view">
    <div id="aanraders-beheer"></div>
    <div id="aanraders-inhoud">
      <div class="aanraders-laden">Aanraders laden…</div>
    </div>
  </div>`;
}

/* ----------------------------------------
   INIT
---------------------------------------- */
export async function init(soort = 'overzicht', slug = null) {
  huidig = { soort, slug };
  const view = document.getElementById('aanraders-view');
  if (!view) return;

  if (!view.dataset.wired) {
    wireInteracties(view);
    view.dataset.wired = '1';
  }

  /* Beheerbalk eerst: die is er dan al voor de inhoud binnenkomt en
     hoeft daarna niet meer opnieuw opgebouwd te worden. */
  if (Store.isAdmin()) await bouwBeheerbalk(view);

  await laadInhoud(view, { scroll: true });
}

async function laadInhoud(view, { scroll = false } = {}) {
  const doel = view.querySelector('#aanraders-inhoud');
  if (!doel) return;

  let url = FRAGMENT_URL;
  if (huidig.soort === 'product')   url += '&p=' + encodeURIComponent(huidig.slug);
  if (huidig.soort === 'categorie') url += '&c=' + encodeURIComponent(huidig.slug);

  try {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      doel.innerHTML = `
        <div class="wrap">
          <div class="empty">
            <h1>Niet gevonden</h1>
            <p>${escapeTekst(data.error || 'Deze pagina bestaat niet.')}</p>
            <a class="btn" href="#/aanraders" style="max-width:260px;margin:0 auto">Terug naar alle aanraders</a>
          </div>
        </div>`;
      return;
    }

    doel.innerHTML = data.html;
    view.classList.toggle('heeft-balk', Boolean(data.heeftBalk));
    if (scroll) window.scrollTo(0, 0);

    /* Zoeken + filteren draait op hetzelfde bestand als de publieke pagina.
       Die start zichzelf op body.aanraders-page; hier moet het na elke
       injectie opnieuw, want de toolbar is dan een vers element. */
    initAanradersFilters(doel);

    if (Store.isAdmin() && Admin) markeerBewerkbaar(view);
  } catch {
    doel.innerHTML = `
      <div class="wrap">
        <div class="empty">
          <h1>Er ging iets mis</h1>
          <p>De aanraders konden niet geladen worden. Probeer het straks opnieuw.</p>
        </div>
      </div>`;
  }
}

/* ----------------------------------------
   BEHEER — alleen voor admins
   Een laag bovenop dezelfde HTML: een balk bovenaan
   en een bewerkknop op elke tegel. Geen tweede
   weergave, dus niets kan uiteenlopen.
---------------------------------------- */
async function bouwBeheerbalk(view) {
  if (!Admin) {
    Admin = await import('../aanradersAdmin.js?v=4.0.29');
  }
  try {
    await Admin.laadBeheerdata();
  } catch {
    return;   // geen admin-rechten op de server: stil laten, pagina blijft gewoon werken
  }
  vulBeheerbalk(view);
}

/** Alleen de balk hertekenen — raakt de pagina-inhoud niet aan. */
function vulBeheerbalk(view) {
  const mount = view.querySelector('#aanraders-beheer');
  if (!mount || !Admin) return;

  const beheer = Admin.getBeheerdata();
  const verborgen = beheer.producten.filter(p => !p.zichtbaar).length;

  /* Op een productdetailpagina is het product zelf geen tegel. Zonder deze
     knop zou je daar niets kunnen bewerken. */
  const ditProduct = huidig.soort === 'product'
    ? `<button type="button" class="aa-btn aa-btn--primair" data-beheer="bewerk" data-slug="${escapeTekst(huidig.slug)}">Dit product bewerken</button>`
    : '';

  mount.innerHTML = `
    <div class="aa-beheerbalk">
      <div class="aa-beheerbalk-inner">
        <div class="aa-beheer-links">
          <span class="aa-beheer-titel">Beheer</span>
          <span class="aa-beheer-info">
            ${beheer.producten.length} producten${verborgen ? ` &middot; ${verborgen} verborgen` : ''}
          </span>
        </div>
        <div class="aa-beheer-acties">
          ${ditProduct}
          <button type="button" class="aa-btn" data-beheer="categorieen">Categorieën &amp; downloads</button>
          <button type="button" class="aa-btn aa-btn--primair" data-beheer="nieuw">+ Nieuw product</button>
        </div>
      </div>
    </div>`;
}

/**
 * Zet een bewerkknop op elke tegel, en toon verborgen producten die
 * anders niet in de fragment-HTML zitten.
 */
function markeerBewerkbaar(view) {
  const beheer = Admin.getBeheerdata();

  /* Op een productdetail zit de bewerkknop in de beheerbalk ("Dit product
     bewerken"). Geen tweede knop op het koopblok: die stond in de weg. */

  view.querySelectorAll('.card[data-slug]').forEach(kaart => {
    if (kaart.querySelector('.aa-kaart-knoppen')) return;
    const slug = kaart.dataset.slug;
    const p = beheer.producten.find(x => x.slug === slug);
    if (!p) return;

    const knoppen = document.createElement('div');
    knoppen.className = 'aa-kaart-knoppen';
    knoppen.innerHTML = `
      <button type="button" class="aa-kaart-knop" data-beheer="bewerk" data-slug="${slug}">Bewerken</button>
      <button type="button" class="aa-kaart-knop" data-beheer="zichtbaar" data-slug="${slug}">
        ${p.zichtbaar ? 'Verbergen' : 'Tonen'}
      </button>`;
    kaart.appendChild(knoppen);
    kaart.classList.add('aa-bewerkbaar');
  });

  /* Verborgen producten staan niet in de publieke HTML. Zonder deze lijst
     zou een admin ze op de pagina zelf nooit terugvinden. */
  const verborgen = beheer.producten.filter(p => !p.zichtbaar);
  if (!verborgen.length || view.querySelector('.aa-verborgen')) return;

  const blok = document.createElement('section');
  blok.className = 'aa-verborgen wrap';
  blok.innerHTML = `
    <div class="section-head"><h2>Nog niet zichtbaar (${verborgen.length})</h2>
      <p>Deze producten staan alleen hier, voor jou. Klik op "Tonen" om ze op de pagina te zetten.</p></div>
    <div class="aa-verborgen-lijst">
      ${verborgen.map(p => `
        <div class="aa-verborgen-item">
          <div>
            <strong>${escapeTekst(p.titel)}</strong>
            <div class="muted" style="font-size:.8rem">${escapeTekst(p.merk || '')}</div>
          </div>
          <button type="button" class="aa-kaart-knop" data-beheer="bewerk" data-slug="${escapeTekst(p.slug)}">Bewerken</button>
          <button type="button" class="aa-kaart-knop" data-beheer="zichtbaar" data-slug="${escapeTekst(p.slug)}">Tonen</button>
        </div>`).join('')}
    </div>`;
  /* Bovenaan de inhoud, niet onderaan: eerder stond dit blok ná de
     downloads en de Pril Leven-sectie, waardoor een pas toegevoegd
     product in de praktijk onvindbaar was. */
  const doel = view.querySelector('#aanraders-inhoud');
  doel?.insertBefore(blok, doel.firstChild);
}

/* ----------------------------------------
   INTERACTIES
   Kopieer-knop + fotogalerij. Zelfde gedrag als
   het inline script op de publieke pagina.
---------------------------------------- */
function wireInteracties(view) {
  view.addEventListener('click', async (e) => {
    /* Beheeracties eerst: die zitten binnen een kaart die zelf een link is. */
    const beheerBtn = e.target.closest('[data-beheer]');
    if (beheerBtn) {
      e.preventDefault();
      e.stopPropagation();
      return beheerActie(view, beheerBtn);
    }

    const codeBtn = e.target.closest('.code');
    if (codeBtn) return kopieerCode(codeBtn);

    const thumb = e.target.closest('.thumb');
    if (thumb) return wisselFoto(view, thumb);
  });

}

async function beheerActie(view, btn) {
  if (!Admin) return;
  const soort = btn.dataset.beheer;

  /* Na een wijziging: eerst de beheerdata verversen (aantallen, verborgen
     items), dan de balk en de pagina-inhoud. */
  const herlaad = async () => {
    await Admin.laadBeheerdata();
    vulBeheerbalk(view);
    await laadInhoud(view);
  };

  if (soort === 'nieuw') {
    return Admin.openProductEditor(null, { onKlaar: herlaad });
  }

  if (soort === 'categorieen') {
    return Admin.openBeheerEditor({ onKlaar: herlaad });
  }

  if (soort === 'bewerk') {
    const p = Admin.productBySlug(btn.dataset.slug);
    if (p) Admin.openProductEditor(p, { onKlaar: herlaad });
    return;
  }

  if (soort === 'zichtbaar') {
    const p = Admin.productBySlug(btn.dataset.slug);
    if (!p) return;
    btn.disabled = true;
    try {
      await Admin.zetZichtbaar(p.id, !p.zichtbaar);
      await herlaad();
    } catch {
      btn.disabled = false;
    }
  }
}

function kopieerCode(btn) {
  const code = btn.getAttribute('data-code') || '';
  const label = btn.querySelector('.code-copy');
  const oud = label ? label.innerHTML : '';

  const melden = (tekst) => {
    if (!label) return;
    label.textContent = tekst;
    btn.classList.add('is-copied');
    setTimeout(() => {
      label.innerHTML = oud;
      btn.classList.remove('is-copied');
    }, 1800);
  };

  const selecteer = () => {
    const val = btn.querySelector('.code-val');
    if (!val || !window.getSelection) return false;
    try {
      const r = document.createRange();
      r.selectNodeContents(val);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      return true;
    } catch {
      return false;
    }
  };

  /* Drie niveaus, net als op de publieke pagina: clipboard-API,
     execCommand, en anders de code selecteren zodat de bezoeker
     zelf kan kopiëren. */
  const terugvallen = () => {
    if (selecteer()) {
      let gelukt = false;
      try { gelukt = document.execCommand('copy'); } catch { gelukt = false; }
      melden(gelukt ? 'gekopieerd' : 'selecteer + kopieer');
      return;
    }
    melden(code);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(() => melden('gekopieerd')).catch(terugvallen);
  } else {
    terugvallen();
  }
}

function wisselFoto(view, thumb) {
  const hoofd = view.querySelector('#galerij-hoofd');
  const src = thumb.getAttribute('data-src');
  if (!hoofd || !src) return;
  hoofd.src = src;
  view.querySelectorAll('.thumb').forEach(t => t.classList.remove('active'));
  thumb.classList.add('active');
}

function escapeTekst(v) {
  const d = document.createElement('div');
  d.textContent = String(v ?? '');
  return d.innerHTML;
}
