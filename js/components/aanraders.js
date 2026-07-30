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

const FRAGMENT_URL = '/api/aanraders?fragment=1';

/* ----------------------------------------
   RENDER — skelet, inhoud komt asynchroon
---------------------------------------- */
export function render() {
  return `<div class="aanraders" id="aanraders-view">
    <div class="aanraders-laden">Aanraders laden…</div>
  </div>`;
}

/* ----------------------------------------
   INIT
   params: {} | { slug } afhankelijk van de route
---------------------------------------- */
export async function init(soort = 'overzicht', slug = null) {
  const view = document.getElementById('aanraders-view');
  if (!view) return;

  let url = FRAGMENT_URL;
  if (soort === 'product')   url += '&p=' + encodeURIComponent(slug);
  if (soort === 'categorie') url += '&c=' + encodeURIComponent(slug);

  try {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      view.innerHTML = `
        <div class="wrap">
          <div class="empty">
            <h1>Niet gevonden</h1>
            <p>${escapeTekst(data.error || 'Deze pagina bestaat niet.')}</p>
            <a class="btn" href="#/aanraders" style="max-width:260px;margin:0 auto">Terug naar alle aanraders</a>
          </div>
        </div>`;
      return;
    }

    view.innerHTML = data.html;
    view.classList.toggle('heeft-balk', Boolean(data.heeftBalk));
    wireInteracties(view);
    window.scrollTo(0, 0);
  } catch {
    view.innerHTML = `
      <div class="wrap">
        <div class="empty">
          <h1>Er ging iets mis</h1>
          <p>De aanraders konden niet geladen worden. Probeer het straks opnieuw.</p>
        </div>
      </div>`;
  }
}

/* ----------------------------------------
   INTERACTIES
   Kopieer-knop + fotogalerij. Zelfde gedrag als
   het inline script op de publieke pagina.
---------------------------------------- */
function wireInteracties(view) {
  view.addEventListener('click', (e) => {
    const codeBtn = e.target.closest('.code');
    if (codeBtn) return kopieerCode(codeBtn);

    const thumb = e.target.closest('.thumb');
    if (thumb) return wisselFoto(view, thumb);
  });
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
