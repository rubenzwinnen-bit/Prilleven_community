// Publieke affiliatepagina "Aanraders" — /aanraders
//
// Server-rendered HTML (geen SPA, geen login) zodat Google de pagina kan
// indexeren en elke categorie/product een echte URL heeft. De rest van de
// site is een hash-router achter login; die kan dat niet.
//
// Catch-all via rewrite in vercel.json:
//   /aanraders          → /api/aanraders
//   /aanraders/:path*   → /api/aanraders
//
// Routes (zie matchRoute):
//   GET /aanraders              → overzichtspagina
//   GET /aanraders/c/:slug      → categoriepagina        (stap 6)
//   GET /aanraders/p/:slug      → productdetailpagina    (stap 6)
//
// Admin-CRUD komt later in dit bestand (stap 7), achter requireAdmin().
// Publieke routes doen GEEN auth-check — dat is het hele punt.

import { supabase } from './_lib/clients.mjs';

/* Pad waarop de pagina leeft. Wil je later /favorieten of /producten,
   dan pas je dit aan + de twee rewrites in vercel.json. Doe dat vóór je
   de link publiek deelt — daarna kost het je SEO. */
const BASE = '/aanraders';

/* Cache-buster voor aanraders.css — bump bij CSS-wijziging. */
const CSS_VERSION = '3.1.3';

/* Vier eigen producten. Bewust hardcoded: ze wijzigen zelden en horen
   niet tussen de affiliateproducten in de database te staan. */
const PRIL_LEVEN_ITEMS = [
  { titel: 'Community',              tekst: 'Vragen stellen, meelezen en ervaringen delen met andere ouders.', href: '/' },
  { titel: 'Roadmap Eerste Hapjes',  tekst: 'Stap voor stap van eerste hapje tot mee-eten aan tafel.',        href: '/' },
  { titel: 'Kookboek',               tekst: 'Recepten voor het hele gezin, ook voor de allerkleinsten.',      href: '/' },
  { titel: 'Masterclass',            tekst: 'Verdiepend en praktisch, in je eigen tempo te volgen.',          href: '/' },
];

/* Transparantielabels. relatie_type is verplicht in de DB met een CHECK,
   dus onbekende waarden kunnen niet voorkomen — de fallback is defensief. */
const RELATIE_LABELS = {
  affiliate_korting: 'Affiliatelink + kortingscode',
  affiliate:         'Affiliatelink',
  enkel_korting:     'Enkel kortingscode — geen commissie',
  geen_samenwerking: 'Persoonlijke aanbeveling — geen samenwerking',
};

const LABEL_TEKST = {
  favoriet:           'Favoriet',
  bestseller:         'Bestseller',
  'community-favoriet': 'Community favoriet',
  budgetvriendelijk:  'Budgetvriendelijk',
  nieuw:              'Nieuw',
};

const INTRO_TEKST =
  'Op deze pagina vind je alle producten die ik zelf gebruik, testte of met overtuiging ' +
  'aanbeveel. Sommige links zijn affiliatelinks of bevatten een kortingscode. Wanneer je ' +
  'via deze links aankoopt, ontvangt Pril Leven mogelijk een kleine commissie, ' +
  '<strong>zonder extra kost voor jou</strong>. Zo help je mee om gratis content te blijven maken.';

const FOOTER_TEKST =
  'Pril Leven werkt samen met een beperkt aantal merken. Bij elk product staat duidelijk ' +
  'vermeld of het om een affiliatelink, een kortingscode of een persoonlijke aanbeveling ' +
  'zonder financiële samenwerking gaat. Producten worden enkel opgenomen na eigen gebruik of test.';

/* ---------------------------------------------------------------
   HELPERS
--------------------------------------------------------------- */

/** Escape voor HTML-tekstinhoud en attribuutwaarden. */
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Alleen http(s) doorlaten als link-href. Voorkomt dat een verkeerd
 * ingevulde affiliate_link (javascript:, data:) in de HTML terechtkomt.
 */
function safeUrl(v) {
  if (!v) return null;
  try {
    const u = new URL(String(v).trim());
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
  } catch {
    return null;
  }
}

/** Leeftijdslabel: 0 → "vanaf de geboorte", <24 mnd → maanden, daarna jaren. */
function leeftijdLabel(maanden) {
  if (maanden === null || maanden === undefined) return 'Alle leeftijden';
  if (maanden === 0) return 'Vanaf de geboorte';
  if (maanden < 24) return `Vanaf ${maanden} mnd`;
  const jaren = Math.floor(maanden / 12);
  return `Vanaf ${jaren} jaar`;
}

function getSegments(req) {
  const raw = req.query?.path;
  if (Array.isArray(raw) && raw.length > 0) return raw;
  if (typeof raw === 'string' && raw.length > 0) return raw.split('/').filter(Boolean);
  if (req.url) {
    const pathname = new URL(req.url, 'http://x').pathname;
    const stripped = pathname.replace(/^\/aanraders\/?/, '');
    return stripped.split('/').filter(Boolean);
  }
  return [];
}

function matchRoute(req) {
  const segments = getSegments(req);

  if (segments.length === 0) return { route: 'overzicht' };
  if (segments.length === 2 && segments[0] === 'c') return { route: 'categorie', params: { slug: segments[1] } };
  if (segments.length === 2 && segments[0] === 'p') return { route: 'product',   params: { slug: segments[1] } };

  return { route: 'notfound' };
}

/* ---------------------------------------------------------------
   DATA
--------------------------------------------------------------- */

async function fetchPaginaData() {
  const [cats, prods, downloads] = await Promise.all([
    supabase.from('affiliate_categories')
      .select('id, slug, titel, emoji, omschrijving, volgorde, binnenkort')
      .eq('zichtbaar', true)
      .order('volgorde', { ascending: true }),

    supabase.from('affiliate_products')
      .select('*')
      .eq('zichtbaar', true)
      .order('volgorde', { ascending: true }),

    supabase.from('affiliate_downloads')
      .select('slug, titel, omschrijving, bestand_url, emoji, volgorde')
      .eq('zichtbaar', true)
      .order('volgorde', { ascending: true }),
  ]);

  if (cats.error)      throw cats.error;
  if (prods.error)     throw prods.error;
  if (downloads.error) throw downloads.error;

  return {
    categorieen: cats.data || [],
    producten:   prods.data || [],
    downloads:   downloads.data || [],
  };
}

/* ---------------------------------------------------------------
   RENDER — bouwstenen
--------------------------------------------------------------- */

const ICON_COPY =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" ' +
  'stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/>' +
  '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

const ICON_EXTERN =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" ' +
  'stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>';

function renderLabels(p) {
  const uit = [];
  if (p.favoriet_anneleen) uit.push('<span class="label label--fav">Favoriet</span>');
  for (const l of (p.labels || [])) {
    if (l === 'favoriet' && p.favoriet_anneleen) continue;   // niet dubbel
    const tekst = LABEL_TEKST[l] || l;
    const cls = l === 'nieuw' ? 'label label--new' : 'label';
    uit.push(`<span class="${cls}">${esc(tekst)}</span>`);
  }
  if (p.korting_tekst) uit.push(`<span class="label">${esc(p.korting_tekst)}</span>`);
  return uit.length ? `<div class="card-labels">${uit.join('')}</div>` : '';
}

function renderKaart(p) {
  const link = safeUrl(p.affiliate_link);
  const media = p.afbeelding_url
    ? `<img src="${esc(p.afbeelding_url)}" alt="${esc(p.titel)}" loading="lazy">`
    : '<span class="ph">🛍️</span>';

  const meta = [
    `<span class="chip">${esc(leeftijdLabel(p.leeftijd_vanaf_maanden))}</span>`,
    p.prijs_indicatie ? `<span class="chip">${esc(p.prijs_indicatie)}</span>` : '',
    p.materiaal ? `<span class="chip">${esc(p.materiaal)}</span>` : '',
  ].filter(Boolean).join('');

  /* Kortingscode: <button> zodat kopiëren met toetsenbord werkt.
     data-code wordt door het inline script uitgelezen. */
  const code = p.kortingscode ? `
        <button type="button" class="code" data-code="${esc(p.kortingscode)}">
          <span class="code-val">${esc(p.kortingscode)}</span>
          <span class="code-copy">${ICON_COPY}kopieer</span>
        </button>` : '';

  /* Geen affiliatelink = geen valse knop. Bij enkel een kortingscode
     krijgt de gebruiker een lichtere knop; zonder beide een dode knop
     met uitleg (bv. Crisp, link volgt nog). */
  let knop;
  if (link) {
    const ghost = p.relatie_type === 'enkel_korting' ? ' btn--ghost' : '';
    knop = `<a class="btn${ghost}" href="${esc(link)}" target="_blank" rel="sponsored nofollow noopener">` +
           `Bekijk bij ${esc(p.merk || p.titel)}${ICON_EXTERN}</a>`;
  } else if (p.kortingscode) {
    knop = `<span class="btn btn--disabled">Gebruik de code in de webshop</span>`;
  } else {
    knop = `<span class="btn btn--disabled">Link volgt</span>`;
  }

  const relCls = (p.relatie_type === 'enkel_korting' || p.relatie_type === 'geen_samenwerking')
    ? 'rel rel--none' : 'rel';

  return `
      <article class="card">
        <div class="card-media">${media}${renderLabels(p)}</div>
        <div class="card-body">
          ${p.merk ? `<div class="card-brand">${esc(p.merk)}</div>` : ''}
          <h3 class="card-title">${esc(p.titel)}</h3>
          ${p.korte_beschrijving ? `<p class="card-desc">${esc(p.korte_beschrijving)}</p>` : ''}
          ${p.waarom_aanbevolen ? `<div class="card-why"><b>Waarom ik dit aanbeveel</b>${esc(p.waarom_aanbevolen)}</div>` : ''}
          ${meta ? `<div class="card-meta">${meta}</div>` : ''}
          ${p.opmerking ? `<div class="card-note"><strong>Belangrijk:</strong> ${esc(p.opmerking)}</div>` : ''}
        </div>
        <div class="card-foot">
          ${code}
          ${knop}
          <div class="${relCls}"><i></i>${esc(RELATIE_LABELS[p.relatie_type] || '')}</div>
        </div>
      </article>`;
}

function renderCategorie(cat, producten) {
  const eigen = producten.filter(p => p.categorie_id === cat.id);
  const titel = `${cat.emoji ? esc(cat.emoji) + ' ' : ''}${esc(cat.titel)}`;

  /* binnenkort-vlag OF gewoon nog geen producten → hetzelfde blok.
     Zo staat er nooit een lege categorie op de pagina. */
  if (cat.binnenkort || eigen.length === 0) {
    return `
    <div class="cat">
      <div class="cat-head"><h3>${titel}</h3></div>
      <div class="soon"><b>Binnenkort</b>Deze categorie is nog in opbouw — enkel producten die ik zelf getest heb komen erin.</div>
    </div>`;
  }

  return `
    <div class="cat">
      <div class="cat-head"><h3>${titel}</h3></div>
      ${cat.omschrijving ? `<p class="section-head-p">${esc(cat.omschrijving)}</p>` : ''}
      <div class="grid">${eigen.map(renderKaart).join('')}</div>
    </div>`;
}

function renderDownloads(downloads) {
  if (!downloads.length) return '';
  const items = downloads.map(d => {
    const href = safeUrl(d.bestand_url);
    const inner = `
        <div class="dl-ico">${esc(d.emoji || '📄')}</div>
        <div class="dl-txt">
          <h4>${esc(d.titel)}</h4>
          ${d.omschrijving ? `<p>${esc(d.omschrijving)}</p>` : ''}
        </div>
        <svg class="dl-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>`;
    return href
      ? `<a class="dl" href="${esc(href)}" download>${inner}</a>`
      : `<div class="dl">${inner}</div>`;
  }).join('');

  return `
  <section>
    <div class="section-head">
      <h2>📥 Gratis downloads</h2>
      <p>Direct te gebruiken, zonder account of aankoop.</p>
    </div>
    <div class="dl-grid">${items}</div>
  </section>`;
}

function renderPrilLeven() {
  const items = PRIL_LEVEN_ITEMS.map(i => `
        <a href="${esc(i.href)}" class="pl-item">
          <h4>${esc(i.titel)}</h4>
          <p>${esc(i.tekst)}</p>
          <span>Ontdek →</span>
        </a>`).join('');

  return `
  <section>
    <div class="pl">
      <div class="pl-head">
        <h2>Van Pril Leven zelf</h2>
        <p>Geen affiliate, geen commissie — dit is het werk waar Pril Leven zelf achter staat.</p>
      </div>
      <div class="pl-grid">${items}</div>
    </div>
  </section>`;
}

/* Kopieer-gedrag. Klein en inline: één extern JS-bestand voor dit beetje
   is niet de moeite, en het moet werken zonder de app-bundel.
   Drie niveaus, want een kortingscode die je niet kan kopiëren is een
   kapotte pagina:
     1. navigator.clipboard  — moderne browsers, secure context
     2. execCommand('copy')  — oudere Safari / niet-secure context
     3. tekst selecteren     — dan kan de bezoeker zelf Cmd/Ctrl+C doen */
const INLINE_SCRIPT = `
document.addEventListener('click', function (e) {
  var btn = e.target.closest('.code');
  if (!btn) return;
  var code = btn.getAttribute('data-code') || '';
  var label = btn.querySelector('.code-copy');
  var oud = label ? label.innerHTML : '';

  function melden(tekst) {
    if (!label) return;
    label.textContent = tekst;
    btn.classList.add('is-copied');
    setTimeout(function () {
      label.innerHTML = oud;
      btn.classList.remove('is-copied');
    }, 1800);
  }

  function selecteer() {
    var val = btn.querySelector('.code-val');
    if (!val || !window.getSelection) return false;
    try {
      var r = document.createRange();
      r.selectNodeContents(val);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      return true;
    } catch (err) { return false; }
  }

  function viaExecCommand() {
    if (!selecteer()) return false;
    try { return document.execCommand('copy'); } catch (err) { return false; }
  }

  function terugvallen() {
    if (viaExecCommand()) { melden('gekopieerd'); return; }
    if (selecteer()) { melden('selecteer + kopieer'); return; }
    melden(code);
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(function () {
      melden('gekopieerd');
    }).catch(terugvallen);
  } else {
    terugvallen();
  }
});`;

/* ---------------------------------------------------------------
   RENDER — volledige pagina
--------------------------------------------------------------- */

function layout({ titel, beschrijving, canonical, body }) {
  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(titel)}</title>
<meta name="description" content="${esc(beschrijving)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(titel)}">
<meta property="og:description" content="${esc(beschrijving)}">
<meta property="og:url" content="${esc(canonical)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/aanraders.css?v=${CSS_VERSION}">
</head>
<body>

<header class="site-header">
  <div class="site-header-inner">
    <a href="${BASE}" class="brand">Pril<span>Leven</span></a>
    <a href="/" class="header-cta">Naar de community</a>
  </div>
</header>

${body}

<footer class="site-footer">
  <div class="wrap">
    <p>${FOOTER_TEKST}</p>
    <nav>
      <a href="/privacy.html">Privacy</a>
      <a href="/voorwaarden.html">Voorwaarden</a>
      <a href="/">Community</a>
    </nav>
  </div>
</footer>

<script>${INLINE_SCRIPT}</script>
</body>
</html>`;
}

function renderOverzicht(data, origin) {
  const { categorieen, producten, downloads } = data;

  const favorieten = producten
    .filter(p => p.favoriet_anneleen)
    .sort((a, b) => (a.favoriet_volgorde ?? 999) - (b.favoriet_volgorde ?? 999))
    .slice(0, 10);

  const favSectie = favorieten.length ? `
  <section>
    <div class="section-head">
      <h2>⭐ Anneleen's favorieten</h2>
      <p>De producten die ik het vaakst aanraad — omdat ze het verschil maken in ons eigen gezin.</p>
    </div>
    <div class="grid">${favorieten.map(renderKaart).join('')}</div>
  </section>` : '';

  /* Nog geen enkel product zichtbaar: geen halfleeg skelet tonen. */
  const geenProducten = producten.length === 0;

  const body = `
<div class="wrap">

  <section class="hero">
    <h1>Alles wat ik zelf gebruik en met overtuiging aanbeveel</h1>
    <p class="lead">Geen webshop, geen willekeurige lijst. Een zorgvuldig samengestelde bibliotheek van producten, materialen en tools die passen binnen de visie van Pril Leven.</p>
    <div class="disclosure">${INTRO_TEKST}</div>
  </section>

  ${geenProducten ? `
  <section>
    <div class="soon"><b>Binnenkort</b>De eerste aanraders worden op dit moment samengesteld.</div>
  </section>` : `
  ${favSectie}

  <section>
    <div class="section-head">
      <h2>Alle categorieën</h2>
      <p>Per thema gebundeld, zodat je vindt wat je zoekt zonder door alles te scrollen.</p>
    </div>
    ${categorieen.map(c => renderCategorie(c, producten)).join('')}
  </section>`}

  ${renderDownloads(downloads)}

  ${renderPrilLeven()}

</div>`;

  return layout({
    titel: 'Aanraders — producten die ik zelf gebruik | Pril Leven',
    beschrijving: 'Alle producten, materialen en tools die Anneleen van Pril Leven zelf gebruikt en aanbeveelt. Met kortingscodes en eerlijke uitleg per product.',
    canonical: `${origin}${BASE}`,
    body,
  });
}

function renderNotFound(origin) {
  return layout({
    titel: 'Niet gevonden — Aanraders | Pril Leven',
    beschrijving: 'Deze pagina bestaat niet.',
    canonical: `${origin}${BASE}`,
    body: `
<div class="wrap">
  <div class="empty">
    <h1>Deze pagina bestaat niet</h1>
    <p>Misschien is de link verouderd of verkeerd getypt.</p>
    <a class="btn" href="${BASE}" style="max-width:260px;margin:0 auto">Terug naar alle aanraders</a>
  </div>
</div>`,
  });
}

/* ---------------------------------------------------------------
   HANDLER
--------------------------------------------------------------- */

function sendHtml(res, status, html, { cache = true } = {}) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  /* Publieke pagina: kort in de browser, langer op de Vercel-edge met
     stale-while-revalidate. Een productwijziging is binnen ~5 min zichtbaar
     zonder dat elke bezoeker de function warm moet maken. */
  res.setHeader('Cache-Control', cache
    ? 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400'
    : 'no-store');
  res.statusCode = status;
  res.end(html);
}

function getOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'community-web.prilleven.be';
  return `${proto}://${host}`;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    return res.end('Method not allowed');
  }

  const origin = getOrigin(req);
  const { route } = matchRoute(req);

  try {
    if (route === 'overzicht') {
      const data = await fetchPaginaData();
      return sendHtml(res, 200, renderOverzicht(data, origin));
    }

    /* Categorie- en productpagina's komen in stap 6. Tot dan een echte
       404 in plaats van een lege pagina — beter voor Google én voor de
       bezoeker die een oude link opent. */
    return sendHtml(res, 404, renderNotFound(origin), { cache: false });

  } catch (err) {
    console.error('[aanraders]', err);
    return sendHtml(res, 500, layout({
      titel: 'Er ging iets mis — Pril Leven',
      beschrijving: 'Er ging iets mis bij het laden van deze pagina.',
      canonical: `${origin}${BASE}`,
      body: `
<div class="wrap">
  <div class="empty">
    <h1>Er ging iets mis</h1>
    <p>Deze pagina kon niet geladen worden. Probeer het straks opnieuw.</p>
  </div>
</div>`,
    }), { cache: false });
  }
}
