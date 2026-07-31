// Publieke affiliatepagina "Aanraders" — /aanraders
//
// Server-rendered HTML (geen SPA, geen login) zodat Google de pagina kan
// indexeren en elke categorie/product een echte URL heeft. De rest van de
// site is een hash-router achter login; die kan dat niet.
//
// Catch-all via rewrites in vercel.json:
//   /aanraders           → /api/aanraders
//   /aanraders/:path*    → /api/aanraders
//   /api/aanraders/:path* → /api/aanraders   (admin + fragment)
//
// Drie soorten output uit één bestand:
//
//   1. Publieke HTML — GET /aanraders, /aanraders/c/:slug, /aanraders/p/:slug
//      Geen auth. Dat is het hele punt: indexeerbaar en deelbaar.
//
//   2. Fragment voor de app — GET /api/aanraders?fragment=1[&c=|&p=]
//      Exact dezelfde HTML, maar zonder <html>/header/footer en met
//      hash-links, zodat de SPA het kan injecteren. Bewust hetzelfde
//      render-pad als (1): één renderer, dus de in-app weergave kan niet
//      uiteenlopen met de publieke pagina.
//
//   3. Admin-JSON — /api/aanraders/admin/*, achter requireAdmin().

import { supabase } from './_lib/clients.mjs';
import { requireAdmin, AuthError } from './_lib/auth.mjs';

/* Pad waarop de pagina leeft. Wil je later /favorieten of /producten,
   dan pas je dit aan + de twee rewrites in vercel.json. Doe dat vóór je
   de link publiek deelt — daarna kost het je SEO. */
const BASE = '/aanraders';

/* Cache-buster voor aanraders.css — bump bij CSS-wijziging. */
const CSS_VERSION = '3.2.7';

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

/* Eén intro-blok. Verving eerder twee losse teksten (een lead-zin en een
   apart disclosure-kader) — de transparantie zit nu in dezelfde alinea,
   wat eerlijker leest dan een kleine grijze voetnoot eronder. */
const INTRO_TEKST =
  'Als ouders worden we overspoeld met producten en adviezen. Daarom verzamel ik hier ' +
  'enkel de producten waar ik écht achter sta. Alles op deze pagina gebruik ik zelf, ' +
  'testte ik uitgebreid of raad ik met vertrouwen aan. Sommige links zijn affiliatelinks ' +
  'of bevatten een kortingscode. Daarmee steun je Pril Leven, zonder dat het jou iets ' +
  'extra kost.';

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

const MAANDEN = ['januari','februari','maart','april','mei','juni',
  'juli','augustus','september','oktober','november','december'];

/** date-kolom (YYYY-MM-DD) → "29 juli 2026". */
function formatDatum(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d));
  if (!m) return String(d);
  return `${Number(m[3])} ${MAANDEN[Number(m[2]) - 1]} ${m[1]}`;
}

function parseBody(req) {
  try {
    return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return null;
  }
}

/**
 * Pad-segmenten ná /aanraders/ (publiek) of /api/aanraders/ (admin).
 * Beide lopen via een rewrite naar deze ene function.
 */
function getSegments(req) {
  const raw = req.query?.path;
  if (Array.isArray(raw) && raw.length > 0) return raw;
  if (typeof raw === 'string' && raw.length > 0) return raw.split('/').filter(Boolean);
  if (req.url) {
    const pathname = new URL(req.url, 'http://x').pathname;
    const stripped = pathname
      .replace(/^\/api\/aanraders\/?/, '')
      .replace(/^\/aanraders\/?/, '');
    return stripped.split('/').filter(Boolean);
  }
  return [];
}

/** Kwam de request binnen op /api/aanraders...? Dan is het geen publieke pagina. */
function isApiPad(req) {
  if (!req.url) return false;
  return new URL(req.url, 'http://x').pathname.startsWith('/api/aanraders');
}

const ADMIN_COLLECTIES = {
  products:   'affiliate_products',
  categories: 'affiliate_categories',
  downloads:  'affiliate_downloads',
};

function matchRoute(req) {
  const segments = getSegments(req);
  const method = req.method;

  /* ---- admin ---- */
  if (segments[0] === 'admin') {
    // GET /admin/data — alles, inclusief onzichtbare items
    if (segments.length === 2 && segments[1] === 'data' && method === 'GET') {
      return { route: 'admin.data' };
    }
    // POST /admin/upload-url — signed URL voor een foto-upload
    if (segments.length === 2 && segments[1] === 'upload-url' && method === 'POST') {
      return { route: 'admin.uploadUrl' };
    }
    // POST /admin/<collectie>
    if (segments.length === 2 && ADMIN_COLLECTIES[segments[1]] && method === 'POST') {
      return { route: 'admin.create', params: { tabel: ADMIN_COLLECTIES[segments[1]] } };
    }
    // PUT|DELETE /admin/<collectie>/<id>
    if (segments.length === 3 && ADMIN_COLLECTIES[segments[1]]) {
      const params = { tabel: ADMIN_COLLECTIES[segments[1]], id: segments[2] };
      if (method === 'PUT')    return { route: 'admin.update', params };
      if (method === 'DELETE') return { route: 'admin.delete', params };
    }
    return { route: 'admin.notfound' };
  }

  /* ---- publiek ---- */
  if (method !== 'GET' && method !== 'HEAD') return { route: 'methodNotAllowed' };
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
      .order('volgorde', { ascending: true }).order('titel', { ascending: true }),

    supabase.from('affiliate_products')
      .select('*')
      .eq('zichtbaar', true)
      .order('volgorde', { ascending: true }).order('titel', { ascending: true }),

    supabase.from('affiliate_downloads')
      .select('slug, titel, omschrijving, bestand_url, emoji, volgorde')
      .eq('zichtbaar', true)
      .order('volgorde', { ascending: true }).order('titel', { ascending: true }),
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

/** Categorie + haar zichtbare producten. null als de slug niet bestaat. */
async function fetchCategorie(slug) {
  const { data: cat, error } = await supabase
    .from('affiliate_categories')
    .select('id, slug, titel, emoji, omschrijving, binnenkort')
    .eq('slug', slug)
    .eq('zichtbaar', true)
    .maybeSingle();

  if (error) throw error;
  if (!cat) return null;

  const { data: producten, error: pErr } = await supabase
    .from('affiliate_products')
    .select('*')
    .eq('categorie_id', cat.id)
    .eq('zichtbaar', true)
    .order('volgorde', { ascending: true }).order('titel', { ascending: true });

  if (pErr) throw pErr;
  return { cat, producten: producten || [] };
}

/**
 * Product + categorie + gerelateerde producten.
 * Gerelateerd = zelfde categorie; is dat te weinig, dan aanvullen met
 * andere zichtbare producten zodat de sectie nooit halfleeg staat.
 */
async function fetchProduct(slug) {
  const { data: p, error } = await supabase
    .from('affiliate_products')
    .select('*')
    .eq('slug', slug)
    .eq('zichtbaar', true)
    .maybeSingle();

  if (error) throw error;
  if (!p) return null;

  let cat = null;
  if (p.categorie_id) {
    const { data } = await supabase
      .from('affiliate_categories')
      .select('slug, titel, emoji')
      .eq('id', p.categorie_id)
      .maybeSingle();
    cat = data || null;
  }

  const { data: zelfde } = await supabase
    .from('affiliate_products')
    .select('*')
    .eq('zichtbaar', true)
    .eq('categorie_id', p.categorie_id)
    .neq('id', p.id)
    .order('volgorde', { ascending: true }).order('titel', { ascending: true })
    .limit(3);

  let gerelateerd = zelfde || [];
  if (gerelateerd.length < 3) {
    const uitsluiten = [p.id, ...gerelateerd.map(g => g.id)];
    const { data: rest } = await supabase
      .from('affiliate_products')
      .select('*')
      .eq('zichtbaar', true)
      .not('id', 'in', `(${uitsluiten.join(',')})`)
      .order('volgorde', { ascending: true }).order('titel', { ascending: true })
      .limit(3 - gerelateerd.length);
    gerelateerd = gerelateerd.concat(rest || []);
  }

  return { p, cat, gerelateerd };
}

/* ---------------------------------------------------------------
   ADMIN
--------------------------------------------------------------- */

const BUCKET = 'affiliate-images';

/* Whitelist per tabel. Alles wat hier niet in staat wordt genegeerd —
   zo kan een client nooit id, created_at of een onbekende kolom zetten. */
const SCHRIJFBARE_VELDEN = {
  affiliate_products: [
    'slug', 'titel', 'categorie_id', 'subcategorie', 'merk',
    'afbeelding_url', 'afbeeldingen',
    'korte_beschrijving', 'lange_beschrijving', 'waarom_aanbevolen',
    'voordelen', 'nadelen', 'faq', 'opmerking',
    'affiliate_link', 'kortingscode', 'korting_tekst', 'prijs',
    'labels', 'leeftijd_vanaf_maanden', 'materiaal',
    'relatie_type', 'commissie', 'persoonlijk_getest', 'zelf_in_gebruik',
    'community_favoriet', 'laatst_gecontroleerd',
    'favoriet_anneleen', 'favoriet_volgorde', 'zichtbaar', 'volgorde',
  ],
  affiliate_categories: [
    'slug', 'titel', 'emoji', 'omschrijving', 'volgorde', 'zichtbaar', 'binnenkort',
  ],
  affiliate_downloads: [
    'slug', 'titel', 'omschrijving', 'bestand_url', 'afbeelding_url',
    'emoji', 'volgorde', 'zichtbaar',
  ],
};

const RELATIE_WAARDEN = Object.keys(RELATIE_LABELS);

class ValidatieError extends Error {}

/** Lege string → null. Scheelt "" in de database waar null hoort. */
function leegNaarNull(v) {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  return t === '' ? null : t;
}

/**
 * Filter op de whitelist en valideer.
 * Gooit ValidatieError met een Nederlandse melding die de admin te zien krijgt.
 */
function schoonPayload(tabel, body, { nieuw }) {
  const toegestaan = SCHRIJFBARE_VELDEN[tabel];
  const uit = {};

  for (const veld of toegestaan) {
    if (!Object.prototype.hasOwnProperty.call(body, veld)) continue;
    uit[veld] = leegNaarNull(body[veld]);
  }

  if (nieuw && !uit.titel) throw new ValidatieError('Titel is verplicht.');

  /* Slug: onderdeel van de publieke URL, dus streng. Bij een nieuw item
     afleiden uit de titel als hij niet is meegegeven. */
  if (nieuw && !uit.slug && uit.titel) uit.slug = slugify(uit.titel);
  if (uit.slug !== undefined && uit.slug !== null) {
    uit.slug = slugify(uit.slug);
    if (!uit.slug) throw new ValidatieError('Slug mag niet leeg zijn.');
  }
  if (nieuw && !uit.slug) throw new ValidatieError('Slug is verplicht.');

  if (tabel === 'affiliate_products') {
    if (uit.relatie_type !== undefined && uit.relatie_type !== null
        && !RELATIE_WAARDEN.includes(uit.relatie_type)) {
      throw new ValidatieError('Onbekend relatietype.');
    }
    /* Een affiliate-link die geen http(s) is, komt straks als dode of
       gevaarlijke href op een publieke pagina. Nu tegenhouden. */
    if (uit.affiliate_link && !safeUrl(uit.affiliate_link)) {
      throw new ValidatieError('Affiliate-link moet met http:// of https:// beginnen.');
    }
    for (const veld of ['afbeeldingen', 'voordelen', 'nadelen', 'faq']) {
      if (uit[veld] !== undefined && uit[veld] !== null && !Array.isArray(uit[veld])) {
        throw new ValidatieError(`Veld ${veld} moet een lijst zijn.`);
      }
    }
    if (uit.labels !== undefined && uit.labels !== null && !Array.isArray(uit.labels)) {
      throw new ValidatieError('Labels moet een lijst zijn.');
    }
    for (const veld of ['leeftijd_vanaf_maanden', 'favoriet_volgorde', 'volgorde']) {
      if (uit[veld] !== undefined && uit[veld] !== null && uit[veld] !== '') {
        const n = Number(uit[veld]);
        if (!Number.isFinite(n)) throw new ValidatieError(`Veld ${veld} moet een getal zijn.`);
        uit[veld] = Math.round(n);
      }
    }
    if (uit.prijs !== undefined && uit.prijs !== null && uit.prijs !== '') {
      const n = Number(uit.prijs);
      if (!Number.isFinite(n)) throw new ValidatieError('Prijs moet een getal zijn.');
      uit.prijs = n;
    }
  }

  if (tabel === 'affiliate_downloads' && uit.bestand_url && !safeUrl(uit.bestand_url)) {
    throw new ValidatieError('Bestand-URL moet met http:// of https:// beginnen.');
  }

  return uit;
}

/** Titel → URL-veilige slug. */
function slugify(v) {
  return String(v)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // accenten weg
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Alles ophalen, inclusief onzichtbare items — dit is de beheerweergave. */
async function fetchAdminData() {
  const [cats, prods, downloads] = await Promise.all([
    supabase.from('affiliate_categories').select('*').order('volgorde', { ascending: true }).order('titel', { ascending: true }),
    supabase.from('affiliate_products').select('*').order('volgorde', { ascending: true }).order('titel', { ascending: true }),
    supabase.from('affiliate_downloads').select('*').order('volgorde', { ascending: true }).order('titel', { ascending: true }),
  ]);
  if (cats.error) throw cats.error;
  if (prods.error) throw prods.error;
  if (downloads.error) throw downloads.error;

  return {
    categorieen: cats.data || [],
    producten: prods.data || [],
    downloads: downloads.data || [],
    relatie_labels: RELATIE_LABELS,
  };
}

function newRandomId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Signed upload-URL + de publieke URL die na de upload geldig is. */
async function createUploadUrl() {
  const path = `${newRandomId()}.jpg`;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) throw new Error('Upload URL: ' + error.message);
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { path, uploadUrl: data.signedUrl, token: data.token, publicUrl: pub.publicUrl };
}

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

async function handleAdmin(req, res, route, params) {
  await requireAdmin(req);

  if (route === 'admin.data') {
    return json(res, 200, await fetchAdminData());
  }

  if (route === 'admin.uploadUrl') {
    return json(res, 200, await createUploadUrl());
  }

  if (route === 'admin.create') {
    const body = parseBody(req);
    if (body === null) return json(res, 400, { error: 'Ongeldige JSON.' });
    const payload = schoonPayload(params.tabel, body, { nieuw: true });
    const { data, error } = await supabase.from(params.tabel).insert(payload).select().single();
    if (error) return json(res, 400, { error: dbFoutmelding(error) });
    return json(res, 201, data);
  }

  if (route === 'admin.update') {
    if (!UUID_RE.test(params.id)) return json(res, 400, { error: 'Ongeldig id.' });
    const body = parseBody(req);
    if (body === null) return json(res, 400, { error: 'Ongeldige JSON.' });
    const payload = schoonPayload(params.tabel, body, { nieuw: false });
    if (Object.keys(payload).length === 0) {
      return json(res, 400, { error: 'Niets om op te slaan.' });
    }
    const { data, error } = await supabase.from(params.tabel)
      .update(payload).eq('id', params.id).select().single();
    if (error) return json(res, 400, { error: dbFoutmelding(error) });
    if (!data) return json(res, 404, { error: 'Niet gevonden.' });
    return json(res, 200, data);
  }

  if (route === 'admin.delete') {
    if (!UUID_RE.test(params.id)) return json(res, 400, { error: 'Ongeldig id.' });
    const { error } = await supabase.from(params.tabel).delete().eq('id', params.id);
    if (error) return json(res, 400, { error: dbFoutmelding(error) });
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'Onbekende admin-route.' });
}

/** Postgres-fouten omzetten naar iets dat een mens begrijpt. */
function dbFoutmelding(error) {
  if (error.code === '23505') return 'Die slug bestaat al. Kies een andere.';
  if (error.code === '23503') return 'De gekozen categorie bestaat niet (meer).';
  if (error.code === '23514') return 'Een waarde is niet toegestaan (check de leeftijd, prijs of het relatietype).';
  return error.message || 'Opslaan mislukt.';
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

/**
 * Links verschillen per context:
 *   publieke pagina → /aanraders/p/slug   (echte URL, indexeerbaar)
 *   in de app       → #/aanraders/p/slug  (hash-route, blijft in de SPA)
 * Daarom krijgt elke render-functie een ctx mee.
 */
const CTX_PUBLIEK = { inApp: false };
const CTX_APP = { inApp: true };

function productHref(p, ctx) {
  return ctx.inApp
    ? `#/aanraders/p/${encodeURIComponent(p.slug)}`
    : `${BASE}/p/${encodeURIComponent(p.slug)}`;
}

function categorieHref(slug, ctx) {
  return ctx.inApp
    ? `#/aanraders/c/${encodeURIComponent(slug)}`
    : `${BASE}/c/${encodeURIComponent(slug)}`;
}

function overzichtHref(ctx) {
  return ctx.inApp ? '#/aanraders' : BASE;
}

function renderKaart(p, ctx = CTX_PUBLIEK) {
  const link = safeUrl(p.affiliate_link);
  const detail = productHref(p, ctx);
  const media = p.afbeelding_url
    ? `<img src="${esc(p.afbeelding_url)}" alt="${esc(p.titel)}" loading="lazy">`
    : '<span class="ph">🛍️</span>';

  /* Kleine labels staan naast de merknaam, niet onderaan de kaart: daar
     onderbraken ze de leesvolgorde tussen "waarom ik dit aanbeveel" en de
     knop. Prijsindicatie is er bewust uit — die zei te weinig. */
  const meta = [
    `<span class="chip">${esc(leeftijdLabel(p.leeftijd_vanaf_maanden))}</span>`,
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

  /* data-slug laat de app een kaart terugkoppelen aan een product, zodat
     een admin hem ter plekke kan bewerken. Een slug is publieke info —
     hij staat al in de URL — en schrijven blijft achter requireAdmin. */
  return `
      <article class="card" data-slug="${esc(p.slug)}">
        <a class="card-media-link" href="${esc(detail)}"><div class="card-media">${media}${renderLabels(p)}</div></a>
        <div class="card-body">
          <div class="card-kop">
            ${p.merk ? `<div class="card-brand">${esc(p.merk)}</div>` : '<span></span>'}
            ${meta ? `<div class="card-meta">${meta}</div>` : ''}
          </div>
          <h3 class="card-title"><a href="${esc(detail)}">${esc(p.titel)}</a></h3>
          ${p.korte_beschrijving ? `<p class="card-desc">${esc(p.korte_beschrijving)}</p>` : ''}
          ${p.waarom_aanbevolen ? `<div class="card-why"><b>Waarom ik dit aanbeveel</b>${esc(p.waarom_aanbevolen)}</div>` : ''}
          ${p.opmerking ? `<div class="card-note"><strong>Belangrijk:</strong> ${esc(p.opmerking)}</div>` : ''}
        </div>
        <div class="card-foot">
          ${code}
          ${knop}
          <div class="${relCls}"><i></i>${esc(RELATIE_LABELS[p.relatie_type] || '')}</div>
        </div>
      </article>`;
}

function renderCategorie(cat, producten, ctx = CTX_PUBLIEK) {
  const eigen = producten.filter(p => p.categorie_id === cat.id);
  /* Geen emoji voor de categorienaam: rustiger beeld, past bij het
     minimalistische uitgangspunt. De emoji blijft wel in de database
     staan, mocht je hem ooit terug willen. */
  const titel = esc(cat.titel);

  /* binnenkort-vlag OF gewoon nog geen producten → hetzelfde blok.
     Zo staat er nooit een lege categorie op de pagina. */
  if (cat.binnenkort || eigen.length === 0) {
    return `
    <div class="cat">
      <div class="cat-head"><h3>${titel}</h3></div>
      <div class="soon"><b>Binnenkort</b>Deze categorie is nog in opbouw — enkel producten die ik zelf getest heb komen erin.</div>
    </div>`;
  }

  const href = categorieHref(cat.slug, ctx);

  return `
    <div class="cat">
      <div class="cat-head">
        <h3><a href="${esc(href)}">${titel}</a></h3>
        <a class="cat-meer" href="${esc(href)}">Alles bekijken →</a>
      </div>
      ${cat.omschrijving ? `<p class="section-head-p">${esc(cat.omschrijving)}</p>` : ''}
      <div class="grid">${eigen.map(p => renderKaart(p, ctx)).join('')}</div>
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
});

/* Galerij op de productdetailpagina: thumbnail wisselt de hoofdfoto.
   Werkt zonder JS ook prima — dan zie je enkel de hoofdfoto. */
document.addEventListener('click', function (e) {
  var t = e.target.closest('.thumb');
  if (!t) return;
  var hoofd = document.getElementById('galerij-hoofd');
  var src = t.getAttribute('data-src');
  if (!hoofd || !src) return;
  hoofd.src = src;
  var alle = document.querySelectorAll('.thumb');
  for (var i = 0; i < alle.length; i++) alle[i].classList.remove('active');
  t.classList.add('active');
});`;

/* ---------------------------------------------------------------
   RENDER — volledige pagina
--------------------------------------------------------------- */

function layout({ titel, beschrijving, canonical, body, bodyClass = '', afbeelding = null }) {
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
${afbeelding ? `<meta property="og:image" content="${esc(afbeelding)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/aanraders.css?v=${CSS_VERSION}">
</head>
<body class="aanraders aanraders-page${bodyClass ? ' ' + esc(bodyClass) : ''}">

<header class="site-header">
  <div class="site-header-inner">
    <a href="${BASE}" class="brand">
      <img src="/pril-leven-logo.png" alt="Pril Leven" class="brand-logo">
    </a>
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

function bodyOverzicht(data, ctx) {
  const { categorieen, producten, downloads } = data;

  /* Geen aparte favorieten-sectie meer: élke categorie is een selectie van
     Anneleen, dus een uitgelichte kop erboven suggereerde ten onrechte dat
     de rest dat niet is. De producten stonden er bovendien dubbel op —
     één keer bovenaan, één keer in hun eigen categorie.
     Het veld favoriet_anneleen blijft wel bestaan: het zet het label
     "Favoriet" op de kaart. */

  /* Nog geen enkel product zichtbaar: geen halfleeg skelet tonen. */
  const geenProducten = producten.length === 0;

  return `
<div class="wrap">

  <section class="hero">
    <h1>Alles wat ik zelf gebruik en met overtuiging aanbeveel</h1>
    <p class="intro">${INTRO_TEKST}</p>
  </section>

  ${geenProducten ? `
  <section>
    <div class="soon"><b>Binnenkort</b>De eerste aanraders worden op dit moment samengesteld.</div>
  </section>` : `
  <section>
    ${categorieen.map(c => renderCategorie(c, producten, ctx)).join('')}
  </section>`}

  ${renderDownloads(downloads)}

</div>`;
}

const OVERZICHT_TITEL = 'Aanraders — producten die ik zelf gebruik | Pril Leven';
const OVERZICHT_BESCHRIJVING =
  'Alle producten, materialen en tools die Anneleen van Pril Leven zelf gebruikt en ' +
  'aanbeveelt. Met kortingscodes en eerlijke uitleg per product.';

function renderOverzicht(data, origin) {
  return layout({
    titel: OVERZICHT_TITEL,
    beschrijving: OVERZICHT_BESCHRIJVING,
    canonical: `${origin}${BASE}`,
    body: bodyOverzicht(data, CTX_PUBLIEK),
  });
}

function bodyCategorie({ cat, producten }, ctx) {
  const titelTekst = cat.titel;
  const terug = overzichtHref(ctx);

  const inhoud = producten.length
    ? `<div class="grid">${producten.map(p => renderKaart(p, ctx)).join('')}</div>`
    : `<div class="soon"><b>Binnenkort</b>Deze categorie is nog in opbouw — enkel producten die ik zelf getest heb komen erin.</div>`;

  return `
<div class="wrap">
  <nav class="crumbs">
    <a href="${esc(terug)}">Aanraders</a><em>/</em>${esc(cat.titel)}
  </nav>

  <div class="cat-hero">
    <h1>${esc(titelTekst)}</h1>
    ${cat.omschrijving ? `<p>${esc(cat.omschrijving)}</p>` : ''}
  </div>

  <section>${inhoud}</section>

  <p style="margin-bottom:56px"><a class="terug" href="${esc(terug)}">← Alle categorieën</a></p>
</div>`;
}

function categorieMeta(cat) {
  return {
    titel: `${cat.titel} — Aanraders | Pril Leven`,
    beschrijving: cat.omschrijving
      || `Producten voor ${cat.titel.toLowerCase()} die Anneleen van Pril Leven zelf gebruikt en aanbeveelt.`,
  };
}

function renderCategoriePagina(data, origin) {
  const meta = categorieMeta(data.cat);
  return layout({
    ...meta,
    canonical: `${origin}${BASE}/c/${data.cat.slug}`,
    body: bodyCategorie(data, CTX_PUBLIEK),
  });
}

function bodyProduct({ p, cat, gerelateerd }, ctx) {
  const link = safeUrl(p.affiliate_link);

  /* Galerij: hoofdfoto voorop, daarna de extra's uit afbeeldingen[].
     Zonder foto's blijft er één placeholder staan, geen lege thumbnails. */
  const extra = Array.isArray(p.afbeeldingen) ? p.afbeeldingen.filter(Boolean) : [];
  const alle = [p.afbeelding_url, ...extra].filter(Boolean);

  const hoofd = alle.length
    ? `<img src="${esc(alle[0])}" alt="${esc(p.titel)}" id="galerij-hoofd">`
    : '<span class="ph">🛍️</span>';

  const thumbs = alle.length > 1 ? `
      <div class="thumbs">${alle.map((src, i) => `
        <button type="button" class="thumb${i === 0 ? ' active' : ''}" data-src="${esc(src)}">
          <img src="${esc(src)}" alt="" loading="lazy">
        </button>`).join('')}
      </div>` : '';

  const facts = [
    `<span class="chip"><b>Leeftijd</b> ${esc(leeftijdLabel(p.leeftijd_vanaf_maanden))}</span>`,
    cat ? `<span class="chip"><b>Categorie</b> ${esc(cat.titel)}</span>` : '',
    p.materiaal ? `<span class="chip"><b>Materiaal</b> ${esc(p.materiaal)}</span>` : '',
    p.subcategorie ? `<span class="chip">${esc(p.subcategorie)}</span>` : '',
  ].filter(Boolean).join('');

  const code = p.kortingscode ? `
      <button type="button" class="code" data-code="${esc(p.kortingscode)}">
        <span class="code-left">
          <span class="code-lbl">Kortingscode${p.korting_tekst ? ' — ' + esc(p.korting_tekst) : ''}</span>
          <span class="code-val">${esc(p.kortingscode)}</span>
        </span>
        <span class="code-copy">${ICON_COPY}kopieer</span>
      </button>` : '';

  let knop;
  if (link) {
    knop = `<a class="btn" href="${esc(link)}" target="_blank" rel="sponsored nofollow noopener">` +
           `Bekijk bij ${esc(p.merk || p.titel)}${ICON_EXTERN}</a>`;
  } else if (p.kortingscode) {
    knop = `<span class="btn btn--disabled">Gebruik de code in de webshop</span>`;
  } else {
    knop = `<span class="btn btn--disabled">Link volgt</span>`;
  }

  const relTekst = RELATIE_LABELS[p.relatie_type] || '';
  const relUitleg = p.commissie
    ? `${relTekst} — Pril Leven ontvangt een kleine commissie wanneer je via deze link aankoopt, zonder extra kost voor jou.`
    : relTekst;

  const vinkjes = [
    p.persoonlijk_getest ? 'Persoonlijk getest' : '',
    p.zelf_in_gebruik ? 'Zelf in gebruik' : '',
    p.community_favoriet ? 'Community favoriet' : '',
    p.favoriet_anneleen ? "Favoriet van Anneleen" : '',
  ].filter(Boolean);

  const ICON_CHECK = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="2.2" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>';

  const trust = vinkjes.length
    ? `<div class="trust">${vinkjes.map(v => `<div>${ICON_CHECK} ${esc(v)}</div>`).join('')}</div>`
    : '';

  const gecontroleerd = p.laatst_gecontroleerd
    ? `<p class="checked">Laatst gecontroleerd op ${esc(formatDatum(p.laatst_gecontroleerd))}</p>`
    : '';

  /* Lange beschrijving: dubbele witregel = nieuwe alinea. */
  const langeTekst = p.lange_beschrijving
    ? `
  <section class="sec">
    <h2>Over dit product</h2>
    <div class="prose">${String(p.lange_beschrijving).split(/\n\s*\n/)
      .map(a => `<p>${esc(a.trim())}</p>`).join('')}</div>
  </section>` : '';

  const voordelen = Array.isArray(p.voordelen) ? p.voordelen.filter(Boolean) : [];
  const nadelen = Array.isArray(p.nadelen) ? p.nadelen.filter(Boolean) : [];

  const prosCons = (voordelen.length || nadelen.length) ? `
  <section class="sec">
    <h2>Voordelen en nadelen</h2>
    <div class="pros-cons">
      ${voordelen.length ? `
      <div class="pc pc--pro">
        <h3>Wat ik er goed aan vind</h3>
        <ul>${voordelen.map(v => `<li>${esc(v)}</li>`).join('')}</ul>
      </div>` : ''}
      ${nadelen.length ? `
      <div class="pc pc--con">
        <h3>Waar je rekening mee moet houden</h3>
        <ul>${nadelen.map(v => `<li>${esc(v)}</li>`).join('')}</ul>
      </div>` : ''}
    </div>
  </section>` : '';

  const faqItems = Array.isArray(p.faq)
    ? p.faq.filter(f => f && f.vraag && f.antwoord)
    : [];

  const faq = faqItems.length ? `
  <section class="sec">
    <h2>Veelgestelde vragen</h2>
    <div class="faq">${faqItems.map((f, i) => `
      <details${i === 0 ? ' open' : ''}>
        <summary>${esc(f.vraag)}</summary>
        <p>${esc(f.antwoord)}</p>
      </details>`).join('')}
    </div>
  </section>` : '';

  const gerelateerdSectie = gerelateerd.length ? `
  <section class="sec">
    <h2>Bekijk ook</h2>
    <div class="grid">${gerelateerd.map(g => renderKaart(g, ctx)).join('')}</div>
  </section>` : '';

  /* Mobiele actiebalk: alleen zinvol als er iets te doen valt. */
  const mobileBar = (p.kortingscode || link) ? `
<div class="mobile-bar">
  ${p.kortingscode ? `<button type="button" class="code" data-code="${esc(p.kortingscode)}"><span class="code-val">${esc(p.kortingscode)}</span></button>` : ''}
  ${link ? `<a class="btn" href="${esc(link)}" target="_blank" rel="sponsored nofollow noopener">Naar ${esc(p.merk || 'de webshop')}</a>` : ''}
</div>` : '';

  return `
<div class="wrap">
  <nav class="crumbs">
    <a href="${esc(overzichtHref(ctx))}">Aanraders</a><em>/</em>
    ${cat ? `<a href="${esc(categorieHref(cat.slug, ctx))}">${esc(cat.titel)}</a><em>/</em>` : ''}
    ${esc(p.titel)}
  </nav>

  <div class="product">
    <div>
      <div class="gallery-main">${hoofd}${renderLabels(p)}</div>
      ${thumbs}
    </div>

    <div class="buy">
      ${p.merk ? `<div class="buy-brand">${esc(p.merk)}</div>` : ''}
      <h1>${esc(p.titel)}</h1>
      ${p.korte_beschrijving ? `<p class="buy-lead">${esc(p.korte_beschrijving)}</p>` : ''}
      ${facts ? `<div class="facts">${facts}</div>` : ''}
      ${p.waarom_aanbevolen ? `
      <div class="why">
        <h3>Waarom ik dit aanbeveel</h3>
        <p>${esc(p.waarom_aanbevolen)}</p>
      </div>` : ''}
      ${code}
      ${knop}
      ${relUitleg ? `<div class="rel"><i></i>${esc(relUitleg)}</div>` : ''}
      ${p.opmerking ? `<div class="note-groot"><strong>Belangrijk:</strong> ${esc(p.opmerking)}</div>` : ''}
      ${trust}
      ${gecontroleerd}
    </div>
  </div>

  ${langeTekst}
  ${prosCons}
  ${faq}
  ${gerelateerdSectie}
</div>${mobileBar}`;
}

/** Heeft dit product een mobiele actiebalk? Bepaalt de body-class. */
function heeftMobieleBalk(p) {
  return Boolean(p.kortingscode || safeUrl(p.affiliate_link));
}

function renderProductPagina(data, origin) {
  const { p } = data;
  const extra = Array.isArray(p.afbeeldingen) ? p.afbeeldingen.filter(Boolean) : [];
  const eersteFoto = [p.afbeelding_url, ...extra].filter(Boolean)[0] || null;

  return layout({
    titel: `${p.titel} — Aanraders | Pril Leven`,
    beschrijving: p.korte_beschrijving || `${p.titel} — aanbevolen door Anneleen van Pril Leven.`,
    canonical: `${origin}${BASE}/p/${p.slug}`,
    body: bodyProduct(data, CTX_PUBLIEK),
    bodyClass: heeftMobieleBalk(p) ? 'has-bar' : '',
    afbeelding: eersteFoto,
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

/**
 * Fragment-modus voor de SPA:
 *   GET /api/aanraders?fragment=1            → overzicht
 *   GET /api/aanraders?fragment=1&c=<slug>   → categorie
 *   GET /api/aanraders?fragment=1&p=<slug>   → product
 *
 * Geeft JSON terug met de HTML én de titel, zodat de app de paginatitel
 * kan zetten. Publieke data, dus geen auth — net als de gewone pagina.
 */
async function handleFragment(req, res, url) {
  const pSlug = url.searchParams.get('p');
  const cSlug = url.searchParams.get('c');

  if (pSlug) {
    const data = await fetchProduct(pSlug);
    if (!data) return json(res, 404, { error: 'Dit product bestaat niet (meer).' });
    return json(res, 200, {
      html: bodyProduct(data, CTX_APP),
      titel: data.p.titel,
      heeftBalk: heeftMobieleBalk(data.p),
    });
  }

  if (cSlug) {
    const data = await fetchCategorie(cSlug);
    if (!data) return json(res, 404, { error: 'Deze categorie bestaat niet (meer).' });
    return json(res, 200, {
      html: bodyCategorie(data, CTX_APP),
      titel: data.cat.titel,
    });
  }

  const data = await fetchPaginaData();
  return json(res, 200, {
    html: bodyOverzicht(data, CTX_APP),
    titel: 'Aanraders',
  });
}

function getOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'community-web.prilleven.be';
  return `${proto}://${host}`;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  const origin = getOrigin(req);
  const { route, params } = matchRoute(req);

  /* ---- admin: JSON, achter requireAdmin ---- */
  if (route.startsWith('admin.')) {
    try {
      return await handleAdmin(req, res, route, params);
    } catch (err) {
      if (err instanceof AuthError) return json(res, err.status, { error: err.message });
      if (err instanceof ValidatieError) return json(res, 400, { error: err.message });
      console.error('[aanraders admin]', err);
      return json(res, 500, { error: 'Er ging iets mis bij het opslaan.' });
    }
  }

  if (route === 'methodNotAllowed') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    return res.end('Method not allowed');
  }

  /* ---- fragment voor de app ----
     De SPA toont dezelfde aanraders zonder de community te verlaten. In
     plaats van een tweede renderer te bouwen (die na verloop van tijd
     uiteenloopt met deze) geeft de server hier exact dezelfde HTML terug,
     maar zonder <html>/header/footer en met hash-links. */
  if (isApiPad(req)) {
    const url = new URL(req.url, 'http://x');
    if (url.searchParams.get('fragment') === '1') {
      try {
        return await handleFragment(req, res, url);
      } catch (err) {
        console.error('[aanraders fragment]', err);
        return json(res, 500, { error: 'Kon de aanraders niet laden.' });
      }
    }
    /* De publieke pagina hoort op /aanraders te staan, niet op /api/aanraders.
       Anders zou dezelfde HTML op twee URL's leven (duplicate content). */
    return json(res, 404, { error: 'Niet gevonden.' });
  }

  try {
    if (route === 'overzicht') {
      const data = await fetchPaginaData();
      return sendHtml(res, 200, renderOverzicht(data, origin));
    }

    if (route === 'categorie') {
      const data = await fetchCategorie(params.slug);
      if (!data) return sendHtml(res, 404, renderNotFound(origin), { cache: false });
      return sendHtml(res, 200, renderCategoriePagina(data, origin));
    }

    if (route === 'product') {
      const data = await fetchProduct(params.slug);
      if (!data) return sendHtml(res, 404, renderNotFound(origin), { cache: false });
      return sendHtml(res, 200, renderProductPagina(data, origin));
    }

    /* Onbekend pad: echte 404, geen lege pagina — beter voor Google én
       voor de bezoeker die een oude link opent. */
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
