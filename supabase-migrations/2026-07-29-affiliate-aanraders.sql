-- =====================================================================
-- AFFILIATEPAGINA ("AANRADERS")
-- Run in: Supabase Dashboard → SQL Editor (veilig om meermaals te draaien)
-- =====================================================================
--
-- Drie tabellen voor de publieke affiliatepagina /aanraders:
--
--   affiliate_categories  De 9 categorieën. `binnenkort = true` toont een
--                         "binnenkort"-blok i.p.v. producten.
--
--   affiliate_products    De producten zelf. Alle inhoud van de productkaart
--                         én de detailpagina zit hier. `relatie_type` is
--                         verplicht en bepaalt het transparantielabel.
--
--   affiliate_downloads   De gratis downloads (aparte sectie op de pagina).
--
-- PUBLIEK LEESBAAR: anon mag lezen waar zichtbaar = true. Dat is bewust —
-- dit is de enige publieke, niet-ingelogde pagina van de site.
-- Schrijven kan enkel via de service-role (api/aanraders.mjs).
--
-- LET OP: nieuwe producten krijgen zichtbaar = false. Ze verschijnen dus
-- pas online nadat ze in het admin-scherm expliciet zichtbaar gezet worden.
-- =====================================================================


-- ---------------------------------------------------------------------
-- CATEGORIEËN
-- ---------------------------------------------------------------------
create table if not exists public.affiliate_categories (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  titel         text not null,
  emoji         text,
  omschrijving  text,
  volgorde      int  not null default 0,
  zichtbaar     boolean not null default true,
  binnenkort    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists affiliate_categories_volgorde_idx
  on public.affiliate_categories (volgorde);

alter table public.affiliate_categories enable row level security;

drop policy if exists "publiek leesbaar" on public.affiliate_categories;
create policy "publiek leesbaar" on public.affiliate_categories
  for select
  using (zichtbaar = true);


-- ---------------------------------------------------------------------
-- PRODUCTEN
-- ---------------------------------------------------------------------
create table if not exists public.affiliate_products (
  id                     uuid primary key default gen_random_uuid(),
  slug                   text not null unique,
  titel                  text not null,
  categorie_id           uuid references public.affiliate_categories(id) on delete set null,
  subcategorie           text,
  merk                   text,

  -- beeld
  afbeelding_url         text,
  afbeeldingen           jsonb not null default '[]'::jsonb,

  -- teksten
  korte_beschrijving     text,
  lange_beschrijving     text,
  waarom_aanbevolen      text,
  voordelen              jsonb not null default '[]'::jsonb,
  nadelen                jsonb not null default '[]'::jsonb,
  faq                    jsonb not null default '[]'::jsonb,  -- [{vraag, antwoord}]
  opmerking              text,                                -- bv. Nammm-waarschuwing

  -- commercieel
  affiliate_link         text,
  kortingscode           text,
  korting_tekst          text,
  prijs                  numeric(10,2),
  prijs_indicatie        text check (prijs_indicatie in ('€','€€','€€€') or prijs_indicatie is null),

  -- filters
  labels                 text[] not null default '{}',
  leeftijd_vanaf_maanden int,
  materiaal              text,

  -- transparantie
  relatie_type           text not null default 'geen_samenwerking'
                           check (relatie_type in ('affiliate_korting','affiliate','enkel_korting','geen_samenwerking')),
  commissie              boolean not null default false,
  persoonlijk_getest     boolean not null default false,
  zelf_in_gebruik        boolean not null default false,
  community_favoriet     boolean not null default false,
  laatst_gecontroleerd   date,

  -- weergave
  favoriet_anneleen      boolean not null default false,
  favoriet_volgorde      int,
  zichtbaar              boolean not null default false,
  volgorde               int not null default 0,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists affiliate_products_categorie_idx
  on public.affiliate_products (categorie_id);
create index if not exists affiliate_products_zichtbaar_idx
  on public.affiliate_products (zichtbaar, volgorde);
create index if not exists affiliate_products_favoriet_idx
  on public.affiliate_products (favoriet_anneleen, favoriet_volgorde)
  where favoriet_anneleen = true;

alter table public.affiliate_products enable row level security;

drop policy if exists "publiek leesbaar" on public.affiliate_products;
create policy "publiek leesbaar" on public.affiliate_products
  for select
  using (zichtbaar = true);


-- ---------------------------------------------------------------------
-- GRATIS DOWNLOADS
-- ---------------------------------------------------------------------
create table if not exists public.affiliate_downloads (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  titel          text not null,
  omschrijving   text,
  bestand_url    text,
  afbeelding_url text,
  emoji          text,
  volgorde       int not null default 0,
  zichtbaar      boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.affiliate_downloads enable row level security;

drop policy if exists "publiek leesbaar" on public.affiliate_downloads;
create policy "publiek leesbaar" on public.affiliate_downloads
  for select
  using (zichtbaar = true);


-- ---------------------------------------------------------------------
-- updated_at automatisch bijwerken
-- Hergebruikt de bestaande projecthelper public.touch_updated_at()
-- (gedefinieerd in 2026-04-18-rag-schema.sql) — geen eigen functie.
-- ---------------------------------------------------------------------
drop trigger if exists touch_affiliate_categories_updated_at on public.affiliate_categories;
create trigger touch_affiliate_categories_updated_at
  before update on public.affiliate_categories
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_affiliate_products_updated_at on public.affiliate_products;
create trigger touch_affiliate_products_updated_at
  before update on public.affiliate_products
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_affiliate_downloads_updated_at on public.affiliate_downloads;
create trigger touch_affiliate_downloads_updated_at
  before update on public.affiliate_downloads
  for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------
-- SEED: de 9 categorieën
-- ---------------------------------------------------------------------
insert into public.affiliate_categories (slug, titel, emoji, volgorde, binnenkort) values
  ('start-vaste-voeding',      'Start vaste voeding',      '🍽️',  1, false),
  ('eten-en-drinken',          'Eten & drinken',           '🥣',  2, false),
  ('lunchbox-en-onderweg',     'Lunchbox & onderweg',      '🥪',  3, true),
  ('keuken-en-mealprep',       'Keuken & mealprep',        '🍳',  4, true),
  ('voedzame-extras',          'Voedzame extra''s',        '🥩',  5, false),
  ('boodschappen',             'Boodschappen',             '🛒',  6, false),
  ('rust-en-slaap',            'Rust & slaap',             '😴',  7, false),
  ('verzorging-en-huishouden', 'Verzorging & huishouden',  '🌿',  8, false),
  ('kookboeken',               'Kookboeken',               '📚',  9, true)
on conflict (slug) do nothing;


-- ---------------------------------------------------------------------
-- SEED: de 8 startpartners
--
-- Alles op zichtbaar = false. Foto's, "waarom ik dit aanbeveel" en de
-- lange beschrijvingen ontbreken nog — die vult Anneleen aan via het
-- admin-scherm (stap 7). Pas daarna zichtbaar = true zetten.
--
-- Crisp staat op relatie_type = 'geen_samenwerking' tot de affiliate-link
-- binnen is; dan wordt dat 'affiliate' of 'affiliate_korting'.
-- ---------------------------------------------------------------------
insert into public.affiliate_products
  (slug, titel, categorie_id, merk, korte_beschrijving, opmerking,
   affiliate_link, kortingscode, korting_tekst, prijs_indicatie, labels,
   leeftijd_vanaf_maanden, relatie_type, commissie,
   favoriet_anneleen, favoriet_volgorde, zichtbaar, volgorde)
values
  ('eten-met-handjes', 'Eten met Handjes — kookboek',
   (select id from affiliate_categories where slug='start-vaste-voeding'), 'Eten met Handjes',
   'Recepten en inspiratie voor de start van vaste voeding, vanaf 6 maanden.', null,
   'https://etenmethandjes.nl/?utm_campaign=aa3faa&utm_source=shareable_link',
   null, null, null, '{}', 6, 'affiliate', true, false, null, false, 1),

  ('patotter', 'Patotter — vriesverse kindervoeding',
   (select id from affiliate_categories where slug='eten-en-drinken'), 'Patotter',
   'Kant-en-klare maaltijden op basis van verse ingrediënten, ingevroren op het moment zelf.', null,
   null, 'PrillevenxPatotter', null, null, '{}', 6, 'enkel_korting', false, false, null, false, 2),

  ('nammm', 'Nammm — plantaardige melk',
   (select id from affiliate_categories where slug='eten-en-drinken'), 'Nammm',
   'Plantaardige drink, geschikt vanaf 12 maanden.',
   'Dit is geen vervanging van borst- of flesvoeding vóór 12 maanden.',
   null, 'PRILLEVEN10', null, null, '{}', 12, 'enkel_korting', false, false, null, false, 3),

  ('hant', 'Hant — bottenbouillon & beenmerg',
   (select id from affiliate_categories where slug='voedzame-extras'), 'Hant',
   'Langzaam getrokken bottenbouillon en beenmerg, om maaltijden voedzamer te maken.', null,
   null, 'PRILLEVEN15', null, null, '{}', 6, 'enkel_korting', false, false, null, false, 4),

  ('crisp', 'Crisp — online supermarkt',
   (select id from affiliate_categories where slug='boodschappen'), 'Crisp',
   'Verse boodschappen van producenten, thuisbezorgd.', 'Affiliate-link volgt nog.',
   null, null, null, null, '{}', null, 'geen_samenwerking', false, false, null, false, 5),

  ('koro', 'KoRo — gezonde ingrediënten in bulk',
   (select id from affiliate_categories where slug='boodschappen'), 'KoRo',
   'Notenpasta, tahin, chiazaad, hennepzaad, lijnzaad, pompoenpitten, dadels, gevriesdroogd fruit, kokosrasp, cacaopoeder en olijfolie.',
   null, 'https://l.ink.je/Xx6ViQxb', 'ANNELEEN', null, '€€', '{budgetvriendelijk}', null,
   'affiliate_korting', true, true, 2, false, 6),

  ('moonbird', 'Moonbird ademhalingscoach',
   (select id from affiliate_categories where slug='rust-en-slaap'), 'Moonbird',
   'Een handzaam toestel dat je ademhaling vertraagt. Voor kinderen en volwassenen.', null,
   'https://moonbird.life/discount/PRILLEVEN?ref=jpxchicw&utm_medium=affiliate&utm_source=goaffpro',
   'PRILLEVEN', '15% korting', '€€€', '{favoriet}', 48,
   'affiliate_korting', true, true, 1, false, 7),

  ('hem-nature', 'Hem-Nature — natuurlijke verzorging',
   (select id from affiliate_categories where slug='verzorging-en-huishouden'), 'Hem-Nature',
   'Minerale zonnecrème, wasmiddel, huidverzorging en babyverzorging.', null,
   'https://hemnature.com?sca_ref=10997416.r4gmQxg5n7&utm_source=campaign_source&utm_medium=campaign_medium&utm_campaign=campaign_name',
   'PRILLEVEN10', '10% korting', '€€', '{favoriet}', 0,
   'affiliate_korting', true, true, 3, false, 8)
on conflict (slug) do nothing;
