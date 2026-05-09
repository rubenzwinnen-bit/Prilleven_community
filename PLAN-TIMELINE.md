# Timeline / Community Feed — Implementatieplan

Branch: `chat-interface`

## 1. Beslissingen (uit gesprek)

- **Layout**: Tegels boven (ongewijzigd), timeline breed eronder, gecentreerd ~720px. Pinned mededelingen in sticky zijkolom rechts (≥ 1024px). Op mobiel volledig onder elkaar.
- **Identiteit**: Verplichte **nickname** bij eerste post. Email is **nooit** zichtbaar voor andere users. Avatar = initialen-bubbel met gegenereerde kleur op basis van user_id (uit het bestaande palet).
- **Scope v1** (alle features samen):
  - Posts (CRUD voor eigen post binnen 15 min, daarna read-only met "(bewerkt)" tag indien gewijzigd)
  - Replies (1 niveau diep — geen threading)
  - Likes (teller, geen lijst van wie)
  - Pinned posts (alleen admin, max 5)
  - Categorieën: `vraag`, `tip`, `mijlpaal`, `voeding`, `slapen`, `algemeen` — filterbalk
  - Foto's (1 per post, max 5MB, EXIF-strip client-side)
  - Edit/delete eigen + rapporteer-knop
  - **Polls** (optioneel bij post: 2-4 opties, 1 stem per user, sluit na 7 dagen)
  - **Notificaties** (in-app badge bovenaan): nieuwe reply op je post, nieuwe like (gebundeld), reactie op poll waar je aan meedeed
- **Geen v1**: realtime sockets (polling 60s), email-notificaties, mentions, search.

## 2. Moderatie

Twee lagen:

**Laag 1 — Reactief**: rapporteer-knop op elke post/reply → admin-queue (`/api/community/admin/reports`).

**Laag 2 — Woord-blacklist (server-side)**: bij `POST /api/community/posts` en `POST /api/community/replies` controleert de server de body tegen een lijst geblokkeerde woorden. Match → response 422 `{ error: 'Bevat ongepaste taal.' }`, post wordt nooit aangemaakt. Lijst in `api/_lib/moderation.mjs`, te beheren via één bestand. Start met ondubbelzinnige termen (scheldwoorden, spam-triggers); breid uit op basis van rapporten.

Geen pre-moderatie (te zwaar voor de schaal).

## 3. EXIF-strip (privacy foto's)

EXIF kan GPS-locatie, telefoon-serie, naam bevatten → AVG-gevoelig.

**Aanpak**: client-side via Canvas re-encode. Code in `js/utils.js` (nieuwe helper `stripExif(file)`):

```js
export async function stripExif(file) {
  if (!file.type.startsWith('image/')) return file;
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
  return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
}
```

Geen server-side dependencies, werkt in alle moderne browsers. Resoluties >2048px schalen we ook meteen omlaag in dezelfde stap.

## 4. Kleurpalet (uit `styles.css`)

Hergebruik bestaande variabelen — geen nieuwe kleuren. Mapping voor de timeline:

| Element | Kleur | Variabele |
|---|---|---|
| Achtergrond feed | crème-wit | `--color-bg` (#faf8f5) |
| Postkaart bg | wit | `--color-white` |
| Postkaart border | licht | `--color-light` (#f0ebe6) |
| Primaire actie (Plaats, Antwoord) | terracotta | `--color-primary` (#C98966) → hover `--color-primary-dark` |
| Like (actief) | terracotta | `--color-primary` |
| Like (inactief) | grijs | `--color-gray` |
| Pinned-rand + chip | salie | `--color-secondary` (#98C3A4) |
| Categorie-chip bg | licht | `--color-light` |
| Categorie-chip actief | salie | `--color-secondary-dark` |
| Tekst hoofd | donker | `--color-dark` |
| Meta (datum, nickname-suffix) | grijs | `--color-gray` |
| Rapporteer / delete | rood | `--color-danger` |
| Notificatie-badge | terracotta | `--color-primary` |
| Avatar-kleuren | rotatie van `--color-primary`, `--color-secondary`, `--color-info`, `--color-warning`, `--color-secondary-dark` op basis van hash(user_id) |

Geen nieuwe `:root`-variabelen toevoegen.

## 5. Database — nieuwe migratie

Bestand: `supabase-migrations/2026-05-03-community-timeline.sql`

```sql
-- ============================================================
-- Pril Leven Community Timeline
-- ============================================================

-- 1. Community profile (nickname)
create table if not exists public.community_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  nickname   text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nickname_format check (
    nickname ~ '^[A-Za-z0-9_\- ]{2,30}$'
  )
);
alter table public.community_profiles enable row level security;
create policy "read all nicknames" on public.community_profiles
  for select using (auth.role() = 'authenticated');
create policy "own nickname write" on public.community_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2. Posts
create table if not exists public.community_posts (
  id          uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 4000),
  category   text not null default 'algemeen'
    check (category in ('vraag','tip','mijlpaal','voeding','slapen','algemeen')),
  image_path text,
  is_pinned  boolean not null default false,
  edited_at  timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists community_posts_created_idx
  on public.community_posts (is_pinned desc, created_at desc);
create index if not exists community_posts_category_idx
  on public.community_posts (category);

alter table public.community_posts enable row level security;
create policy "read posts" on public.community_posts
  for select using (auth.role() = 'authenticated');
create policy "insert own post" on public.community_posts
  for insert with check (auth.uid() = user_id and is_pinned = false);
create policy "update own post 15min" on public.community_posts
  for update using (
    auth.uid() = user_id and now() - created_at < interval '15 minutes'
  );
create policy "delete own post" on public.community_posts
  for delete using (auth.uid() = user_id);

-- 3. Replies
create table if not exists public.community_replies (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.community_posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  edited_at  timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists community_replies_post_idx
  on public.community_replies (post_id, created_at);
alter table public.community_replies enable row level security;
create policy "read replies" on public.community_replies
  for select using (auth.role() = 'authenticated');
create policy "insert own reply" on public.community_replies
  for insert with check (auth.uid() = user_id);
create policy "update own reply 15min" on public.community_replies
  for update using (
    auth.uid() = user_id and now() - created_at < interval '15 minutes'
  );
create policy "delete own reply" on public.community_replies
  for delete using (auth.uid() = user_id);

-- 4. Likes
create table if not exists public.community_likes (
  post_id    uuid not null references public.community_posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.community_likes enable row level security;
create policy "read likes" on public.community_likes
  for select using (auth.role() = 'authenticated');
create policy "own like write" on public.community_likes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 5. Reports
create table if not exists public.community_reports (
  id          uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('post','reply')),
  target_id   uuid not null,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason      text,
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);
alter table public.community_reports enable row level security;
create policy "create report" on public.community_reports
  for insert with check (auth.uid() = reporter_id);

-- 6. Polls (1:1 met post — optioneel)
create table if not exists public.community_polls (
  post_id    uuid primary key references public.community_posts(id) on delete cascade,
  question   text not null check (char_length(question) between 1 and 200),
  options    jsonb not null,                -- ["optie A","optie B",...]  2-4 items
  closes_at  timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);
create table if not exists public.community_poll_votes (
  post_id    uuid not null references public.community_polls(post_id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  option_idx int  not null check (option_idx between 0 and 3),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.community_polls enable row level security;
alter table public.community_poll_votes enable row level security;
create policy "read polls" on public.community_polls
  for select using (auth.role() = 'authenticated');
create policy "read poll votes" on public.community_poll_votes
  for select using (auth.role() = 'authenticated');
create policy "vote own" on public.community_poll_votes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- Polls aanmaken gebeurt via API gekoppeld aan post-creatie (service-role).

-- 7. Notifications (in-app)
create table if not exists public.community_notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,  -- ontvanger
  type       text not null check (type in ('reply','like','poll_result','poll_reply')),
  post_id    uuid references public.community_posts(id) on delete cascade,
  reply_id   uuid references public.community_replies(id) on delete cascade,
  actor_id   uuid references auth.users(id) on delete set null,           -- veroorzaker
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists community_notifications_user_idx
  on public.community_notifications (user_id, read_at, created_at desc);
alter table public.community_notifications enable row level security;
create policy "read own notifications" on public.community_notifications
  for select using (auth.uid() = user_id);
create policy "update own read" on public.community_notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- Inserts: alleen via service-role in API (om spoofing te voorkomen).

-- 8. View
create or replace view public.community_posts_view as
  select
    p.*,
    cp.nickname,
    coalesce(l.likes, 0) as likes_count,
    coalesce(r.replies, 0) as replies_count,
    (po.post_id is not null) as has_poll
  from public.community_posts p
  left join public.community_profiles cp on cp.user_id = p.user_id
  left join (select post_id, count(*)::int as likes from public.community_likes group by post_id) l on l.post_id = p.id
  left join (select post_id, count(*)::int as replies from public.community_replies group by post_id) r on r.post_id = p.id
  left join public.community_polls po on po.post_id = p.id;
```

Storage bucket: `community-images` (private), policies analoog aan `2026-04-12-storage-policies.sql`.

## 6. API endpoints

| Methode | Pad | Functie |
|---|---|---|
| GET  | `/api/community/profile` | Eigen nickname |
| PUT  | `/api/community/profile` | Nickname opslaan (uniek) |
| GET  | `/api/community/posts?category=&before=&limit=20` | Feed (pinned eerst, dan chronologisch) |
| POST | `/api/community/posts` | Nieuwe post (+ optioneel poll-payload). Bevat woord-blacklist check. |
| PATCH| `/api/community/posts/[id]` | Edit (15 min) of pin/unpin (admin) |
| DELETE | `/api/community/posts/[id]` | Eigen of admin |
| GET  | `/api/community/posts/[id]/replies` | Replies |
| POST | `/api/community/posts/[id]/replies` | Reply (blacklist + notificatie) |
| PATCH| `/api/community/replies/[id]` | Edit reply (15 min) |
| DELETE | `/api/community/replies/[id]` | Reply verwijderen |
| POST | `/api/community/posts/[id]/like` | Toggle like (notificatie bij eerste like, gebundeld) |
| POST | `/api/community/posts/[id]/poll/vote` | Stem (1×) |
| POST | `/api/community/report` | Rapporteer post/reply |
| POST | `/api/community/upload` | Pre-signed upload-URL |
| GET  | `/api/community/notifications` | Eigen notificaties (ongelezen + recente) |
| POST | `/api/community/notifications/read` | Markeer alles/één als gelezen |
| GET  | `/api/community/admin/reports` | Admin: open meldingen |
| POST | `/api/community/admin/reports/[id]/resolve` | Admin: melding sluiten |

Patroon: `requireAuth` uit `_lib/auth.mjs`, JSON-helper zoals in `api/profile.mjs:12`.

Nieuw lib-bestand: `api/_lib/moderation.mjs` met `containsBlockedWord(text)` + woordenlijst.

## 7. Frontend bestanden

Nieuw:
- `js/components/timeline.js` — feed-render + polling + filterbalk
- `js/components/timelinePost.js` — postkaart (post, replies, like, edit, delete, rapport, poll)
- `js/components/nicknameModal.js` — verplicht bij eerste post
- `js/components/notificationsBell.js` — badge in header (🔔 met count) + dropdown

Wijzigen:
- `js/components/home.js` — extra section onder de tegels
- `js/components/header.js` — notificatie-bel rechts van user-info
- `js/utils.js` — helpers: `stripExif()`, `formatRelativeTime()`, `colorFromUserId()`
- `styles.css` — nieuwe sectie `/* TIMELINE */` met alle componenten via `--color-*` variabelen
- `privacy.html` — nieuwe sectie "Community feed"

## 8. UI-schets

```
┌────────────────────────────────────────────────────────────────┐
│  Welkom terug                                          🔔 [2]  │  ← bell in header
├────────────────────────────────────────────────────────────────┤
│  [ Receptenboek/Weekschema ]  [ HapjesHeld 2.0 ]  [ Admin ]    │  ← bestaande tegels
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌──────────────────────────────────┐  ┌──────────────────┐   │
│  │  Wat speelt er bij jou?     [📷] │  │ 📌 MEDEDELINGEN  │   │
│  │  [Categorie ▾] [+ Poll]  [Plaats]│  ├──────────────────┤   │
│  └──────────────────────────────────┘  │ Admin: nieuwe    │   │
│                                        │ recepten online  │   │
│  Filter: [Alle][Vraag][Tip][...]       │ ──────────────── │   │
│                                        │ Nieuwsbrief...   │   │
│  ┌──────────────────────────────────┐  └──────────────────┘   │
│  │ 🟣 SA  Sarah · 2 u · #vraag      │  (sticky)               │
│  │ Hoe pak je groente-weigering aan?│                         │
│  │ ❤ 5    💬 3    🚩               │                         │
│  └──────────────────────────────────┘                         │
│  ┌──────────────────────────────────┐                         │
│  │ 🟢 TO  Tom · 1 dag · #tip        │                         │
│  │ Welk speeltoestel werkt het best?│                         │
│  │ ▣ Trampoline           60%       │  ← poll                 │
│  │ ▢ Klimrek              40%       │                         │
│  │ 12 stemmen · sluit over 5 dagen  │                         │
│  └──────────────────────────────────┘                         │
└────────────────────────────────────────────────────────────────┘
```

Mobiel (< 768px): pinned-zijkolom → collapsible accordion bovenaan; bell blijft in header.

## 9. Werkvolgorde

1. Migratie SQL aanmaken (jij voert uit in Supabase Dashboard) + storage bucket aanmaken
2. `_lib/moderation.mjs` + `/api/community/profile` + nickname-modal
3. `/api/community/posts` GET+POST + feed render (zonder replies/likes/polls)
4. Replies + likes
5. Categorieën + filterbalk
6. Foto's (client-side EXIF-strip + upload via pre-signed URL)
7. Polls (post-creatie + stem)
8. Edit/delete + rapporteer
9. Admin: pin + reports queue
10. Notificaties + bell-component + polling 60s (alleen bij `document.visibilityState === 'visible'`)
11. Privacy.html bijwerken met sectie "Community feed"
12. Mobiele check + polish

## 10. Privacy.html — wat erbij komt

Nieuwe sectie na bestaande gegevens-sectie:

> **Community feed**
> Wanneer je posts of reacties plaatst in de community feed, worden de volgende gegevens zichtbaar voor andere ingelogde gebruikers: je nickname, je posts, reacties, likes, foto's en stemmen op polls. Je email-adres wordt **nooit** gedeeld. Foto's worden bij upload automatisch ontdaan van locatiegegevens en andere metadata. Posts en reacties zijn permanent zichtbaar voor andere users zolang ze niet door jou of een admin worden verwijderd. Je kan op elk moment je eigen posts verwijderen of je account verwijderen, waarna al je community-bijdragen meeverdwijnen.

## 11. Open punten / risico's

- **Nickname-squatting**: één user kan veel "officieel klinkende" nicks claimen. Reserveer in seed: `admin`, `pril`, `prilleven`, `support`, `moderator`.
- **Spam-rate-limiting**: max 5 posts/uur per user via simpele in-memory counter of Supabase function. Pakken we in stap 3 mee.
- **Poll-eerlijkheid**: één stem per user wordt afgedwongen door PK op `(post_id, user_id)`. Niet wijzigbaar in v1 (om "stemmen kopen" te vermijden).
- **Notificatie-storm**: bij viral post kan likes-tabel snel groeien. Notificatie alleen bij eerste like en daarna 1×/dag gebundeld ("Je post heeft 12 nieuwe likes").

---

## 2026-05-06 — Account & billing-setup (geen code)

**Context**: voorbereiden van professionele account-setup (eenmanszaak Anneleen Plettinx, BTW BE0639907218). Migratie naar `tech@prilleven.be` org overwogen, maar afgeblazen omdat Prilleven een eenmanszaak is en jullie team-account delen — geen juridische noodzaak.

### Vandaag afgerond
- ✅ Beslissing: **geen migratie** naar aparte org. Account blijft op Rubens login, maar billing op Anneleens eenmanszaak.
- ✅ Codebase gecheckt op `rubenzwinnen-bit` references → geen hits, team-URL-rename veilig.
- ✅ Supabase: project hernoemd, BTW-nummer + adres ingevuld, billing email = `anneleen.plettinx@gmail.com` met `ruben.zwinnen@hotmail.be` als CC.
- ✅ Vercel: Team Name = `Prilleven`, Team URL = `prilleven`, BTW + adres ingevuld, invoice email = `anneleen.plettinx@gmail.com`, taal = NL.
- ✅ Tweede Owner toegevoegd (al gedaan vóór sessie).

### Open / nog te doen
- ⬜ Vercel **Company Name** staat als `prilleven-community` — **moet** `Anneleen Plettinx` worden voor consistentie met BTW.
- ⬜ Vercel **Observability Plus** toggle staat AAN — overwegen uit te zetten (extra kosten, niet gebruikt).
- ⬜ Stad-inconsistentie: Supabase = "Deurne", Vercel = "Antwerpen". Beide kloppen, maar consistentie is netter.
- ⬜ Payment method op beide platformen verifiëren = Anneleens zakenkaart.
- ⬜ Beslissing Vercel + Supabase **Pro-upgrade** parkeren tot na overzetting (Supabase staat al op Pro).

### Beslissingen
- Eenmanszaak = juridisch dezelfde persoon als Anneleen → geen aparte tech@prilleven.be org nodig
- Account blijft gedeeld team-account; bus factor afgedekt via tweede Owner
- Facturen op naam `Anneleen Plettinx` / BE0639907218 / `anneleen.plettinx@gmail.com`

---

## 2026-05-07 — AI-werkflow & docs setup (geen feature-code)

**Context**: workflow met Claude Code professionaliseren. Doel: snellere onboarding bij nieuwe chats, minder context-verlies bij overdracht, betere foutpreventie bij deploys.

### Vandaag afgerond
- ✅ **Root `CLAUDE.md`** uitgebreid met regels voor: docs auto-updaten, waarschuwen voor `/eind-sessie`, en Tooling-sectie (MCP's + slash commands + Vercel-projectinfo).
- ✅ **Submap `CLAUDE.md`'s** geschreven na grondige codebase-analyse: `api/`, `js/`, `supabase-migrations/`. Volledig endpoint-overzicht, `_lib/` helper-tabel, exact DB-schema per cluster, twee parallelle auth-systemen (legacy `user_name` vs Supabase JWT) gedocumenteerd.
- ✅ **Slash commands** aangemaakt in `.claude/commands/`: `/start-sessie`, `/eind-sessie`, `/update-docs`, `/deploy-check`.
- ✅ **Supabase MCP** opgezet: project-scoped (`ynrdoxukevhzupjvcjuw`), read-only, via PAT in `.mcp.json`. Werkt.
- ✅ **Vercel MCP** opgezet: OAuth-based, alle Vercel-projecten. Werkt vanaf volgende sessie (tools laden bij sessie-start).
- ✅ `.gitignore` aangevuld: `.mcp.json` (bevat PAT). `.mcp.json.example` als gecommitteerde template.
- ✅ **PAT-rotatie** uitgevoerd nadat eerste token zichtbaar werd in chat-context — leerpunt: tokens nooit via system-reminder of chat-output laten lekken.

### Open / nog te doen
- ⬜ Vercel-project `pril-leven-web` — functie nog te bevestigen (placeholder/staging?). `pril_leven_community` is de productie-app.
- ⬜ Vercel CLI updaten: huidige `v51.7.0` → laatste (`v52+`). Niet urgent.
- ⬜ Eventueel: hook voor automatische cache-buster-bump (alleen als de regel in CLAUDE.md het in praktijk niet redt).

### Beslissingen
- **Geen `/migration` slash command** — overbodig voor solo-workflow waarin Claude altijd de migratie zelf opzet.
- **Geen GitHub MCP nu** — `gh` CLI via bash voldoet voor solo-werk.
- **Supabase MCP read-only** — schrijven blijft via SQL-in-chat → handmatig in Supabase Editor.
- **Cache-buster blijft handmatig** — regel in CLAUDE.md voorlopig genoeg, hook pas bij gebleken pijn.

---

# Eerste Hapjes Traject — Implementatieplan

Branch: `eerste-hapjes`

## A. Funderingen — afgerond ✅
- A.1 — tegel "Eerste Hapjes" op home + placeholder-pagina + SPA-route `#/eerste-hapjes`
- A.2 — `public.children`-tabel (single source of truth voor kindjes-data)
- A.3 — `privacy.html` sectie 2.8 toegevoegd

## B. Onboarding — afgerond ✅
- B.1 — children-API: `/api/eerste-hapjes/children.mjs` (GET/POST) + `/[id].mjs` (PATCH/DELETE) + `_lib/children.mjs` met sanitize + DB-helpers
- B.2 — `eersteHapjesApi.js` + `childOnboardingModal.js` (3-staps wizard) + Vandaag-skeleton met kindje-switcher in `eersteHapjes.js`

## C. Logging — afgerond ✅
- C.1 — migratie `meal_logs` + `child_symptoms` (additief, owner-only RLS, soft FK naar `recipes`).
- C.2 — `_lib/eersteHapjes-logs.mjs` + 4 endpoints (`meals.mjs`, `meals/[id].mjs`, `symptoms.mjs`, `symptoms/[id].mjs`).
- C.3 — frontend: api-helpers + `mealLogModal.js` (recept-typeahead via bestaande `getRecipes()`) + `symptomLogModal.js` (10-grid, severity-chips, optionele meal-koppeling) + Vandaag-cards met `+`/`×`-acties.

## D. Allergenen + recept-koppeling — afgerond ✅
- D.1 — migratie `child_allergens` (additief, unique `(child_id, allergen_key)`, owner-only RLS, soft FK naar `child_symptoms`).
- D.2 — `_lib/eersteHapjes-allergens.mjs` + 2 endpoints (`allergens.mjs` met upsert, `allergens/[id].mjs`).
- D.3 — frontend: `allergenManager.js` (accordion-modal met 13 allergenen, upsert per rij), Vandaag-card met groepen geprobeerd/gepland/vermijden + reactie-tags, recipe-warning in `mealLogModal` (waarschuwt bij overlap met `vermijden` of `geprobeerd+matig/heftig`).

## E. Microlearning + content — afgerond ✅ (skeleton-content)
- E.1 — content-module `js/content/eersteHapjes-content.js` met 7 skeleton-artikels (titels + leeftijdsranges + categorieën vast, body's als placeholder voor Anneleen om aan te vullen). HTML-string i.p.v. markdown — geen parser nodig, geen build step.
- E.2 — `js/eersteHapjesContent.js` helpers (`ageMonthsFromBirthdate`, `getNextStepArticle`, `getRelevantArticles`, `getArticlesByCategory`, `getArticleBySlug`, `formatAgeRange`).
- E.3 — `articleModal.js` (één component met detail + lijst-weergave, slug-navigatie tussen views).
- E.4 — `eersteHapjes.js`: "Volgende stap"-card vervangt placeholder met live artikel op basis van leeftijd, plus "Alle tips"-link onderaan Vandaag-pagina.

## G. Symptoom-detail-content + rode-vlag — afgerond ✅
- G.1 — content-config `js/content/eersteHapjes-symptoms.js` met 16 symptomen (10 brok C + 6 nieuw: gewicht, hoesten, verstopping, geen_eetlust, prikkelbaar, lethargie). Per symptoom: `key, label, icon, intro, body (HTML-skeleton placeholder), redFlags, redFlagSeverity`. Body's nog door Anneleen aan te vullen.
- G.2 — migratie `2026-05-09-symptoms-extend.sql`: DB-CHECK `child_symptoms.symptom_type` uitgebreid van 10 → 16 keys (additief, drop+add). Server-side `SYMPTOM_TYPES` Set in `_lib/eersteHapjes-logs.mjs` mee uitgebreid.
- G.3 — `detectRedFlag(type, severity)` helper in `_lib/eersteHapjes-logs.mjs` (mirror van frontend `redFlagSeverity`). `POST /api/eerste-hapjes/symptoms` returnt nu `{ symptom, red_flag }`.
- G.4 — frontend: nieuwe `symptomDetailModal.js` (lijst + detail) analoog aan `articleModal.js`. `symptomLogModal.js` aangepast: tegel-grid leest uit content-config + info-(i)-knop per tegel + "Wat betekenen deze?"-link. `eersteHapjes.js`: SYMPTOM_TYPE_LABEL/ICON vervangen door `getSymptomMeta()`, red-flag-pill in symptoom-rij + adaptieve top-banner na log met `red_flag: true`, "Symptomen-uitleg"-link onderaan Vandaag. Cache-buster `v2.7.0` → `v2.8.0` in 37 files.

## F. Fasen-systeem — afgerond ✅
- F.1 — statische config `js/content/eersteHapjes-phases.js`: 6 fases (0..5) met "ten vroegste vanaf"-leeftijd, intro-tekst, advance-label en checklist (5 mijlpalen per fase, fase 5 = eindstation zonder checks). Texten letterlijk uit het PDF-productoverzicht. `AUTO_FASE5_AGE_MONTHS = 14` (drempel waarboven kindjes meteen op fase 5 starten).
- F.2 — migratie `2026-05-08-child-phases.sql`: `child_phases` (PK `(child_id, phase_number)`) + `child_phase_checks` (PK `(child_id, phase_number, check_key)`). State-only — fase-definities blijven frontend. Owner-only RLS, updated_at trigger.
- F.3 — `_lib/eersteHapjes-phases.mjs` met `loadPhaseState` (auto-init bij eerste GET op basis van leeftijd), `togglePhaseCheck`, `advancePhase` (vereist alle checks gedaan + leeftijd ≥ minAge volgende). Endpoints: `GET /phases`, `POST /phases/check`, `POST /phases/advance`.
- F.4 — frontend: `phaseModal.js` met `renderPhaseBanner` (sticky banner bovenaan Vandaag) + `openPhaseDetailModal` (huidige fase met afvinkbare checklist + advance-knop, disabled met copy "Ten vroegste vanaf X mnd" als leeftijd te jong) + `openPhaseOverviewModal` (alle 6 fases als kaartjes, klik op actieve = naar detail). "Mijn fasen"-link onderaan Vandaag. Cache-buster `v2.6.0` → `v2.7.0`.

---

## 2026-05-08 — Brok A afgerond + branchstrategie opgezet

**Context**: opstart van het Eerste Hapjes Traject (zie PDF). Vandaag de funderingen gelegd zonder productie-functionaliteit te raken.

### Vandaag afgerond
- ✅ **Mockup-HTML** gemaakt in `/mockups/eerste-hapjes.html` (gitignored). 8 schermen side-by-side: tegel, onboarding, vandaag, maaltijd-loggen, allergenen, symptomen, recept-blokker, microlearning.
- ✅ **`/mockups/`** toegevoegd aan `.gitignore` + root `CLAUDE.md` mappenstructuur.
- ✅ **Docs-commit** (root + submap `CLAUDE.md`'s + `.mcp.json.example`) cherry-picked op `main` (commit `682398a`) — productie nu up-to-date.
- ✅ **`chat-interface`-branch verwijderd** (zowel lokaal als origin) — werk zat al via squash-merge in `main`.
- ✅ **Nieuwe branch `eerste-hapjes`** vanaf `main` aangemaakt.
- ✅ **Brok A.1** — `js/components/eersteHapjes.js` placeholder + tegel op home (nieuwe `home-tile--sage-deep` accent met salie-gradient + "Nieuw"-badge) + SPA-route geregistreerd in `script.js`. Cache-buster gebumped naar `v2.2.0` overal.
- ✅ **Brok A.2** — migratie `2026-05-08-children.sql` in productie-DB gedraaid. Tabel `public.children`: `id`, `user_id` (FK auth.users), `name` (1-50), `birthdate` (max 10 jaar terug, niet in toekomst), `texture_preference` (puree/stukjes/combi NULL), `archived_at`, timestamps. Owner-only RLS, index `(user_id, archived_at, birthdate)`, updated_at trigger. **Geverifieerd via Supabase MCP.**
- ✅ **Brok A.3** — `privacy.html` sectie 2.8 "Eerste Hapjes Traject" toegevoegd (kindje-data, maaltijd-logs, allergenen-historie, symptoom-notities, fase-voortgang). Benadrukt strikt persoonlijk, geen medisch advies, account-verwijdering wist alles.
- ✅ Drie commits gepusht naar `eerste-hapjes`: `51b9c0b` (tegel), `5066de0` (migratie), `0573034` (privacy).

### Open / nog te doen
- ⬜ **Brok B** starten — API endpoint + onboarding-modal.
- ⬜ Eerste-hapjes preview-URL op Vercel checken (na push naar `eerste-hapjes` automatisch).

### Beslissingen
- **Meerdere kindjes per account** — vanaf dag 1 in datamodel.
- **Recepten hebben al `allergens`-kolom** — brok D-blocker is weg, vocabulaire later afstemmen.
- **Toegang voor alle betalende users** — geen aparte gate/upsell.
- **Content-opslag = Markdown-files in repo** (Optie A) voor v1; eventueel later hybride met DB-tabel voor dagelijks-veranderende content.
- **Aparte SPA-route `/eerste-hapjes`** i.p.v. integratie in home-tegels — wordt grote sub-app.
- **Naam in UI = "Eerste Hapjes"**.
- **HapjesHeld leest later uit nieuwe `children`-tabel** (vervangt `chat_user_profiles.children` jsonb). Migratie van bestaande data en aanpassing van `loadUserProfile()` doen we **bewust pas op het einde** in één gecoördineerde release.
- **Strategie productie-veiligheid**: alleen additieve migraties tijdens deze branch (nieuwe tabellen, geen wijziging aan bestaande). Bestaand HapjesHeld-gedrag blijft ongewijzigd tot we expliciet switchen.
- **Branch-aanpak**: `main` = productie, `eerste-hapjes` = werk. Pushen naar feature branch geeft Vercel preview-URL zonder productie te raken.

---

## 2026-05-08 (avond) — Brok B afgerond + Pro-plan gedocumenteerd

**Context**: API + onboarding-flow gebouwd voor Eerste Hapjes. Cache-buster van `v2.2.0` → `v2.3.0`. Drie commits gepusht naar `eerste-hapjes` (Vercel preview = `https://prillevencommunity-git-eerste-hapjes-prilleven-community.vercel.app`).

### Vandaag afgerond
- ✅ **Brok B.1** — children-API. `_lib/children.mjs` met `sanitizeChildInput`, `sanitizeChildPatch`, `loadMyChildren`, `loadChildById`, `createChild`, `updateChild`, `deleteChild` + `HttpError`. Service-role bypass van RLS afgevangen via expliciete `eq('user_id', userId)` op alle queries. Endpoints: `GET/POST /api/eerste-hapjes/children` + `PATCH/DELETE /api/eerste-hapjes/children/[id]`. Birthdate-validatie max 10 jaar terug + niet in toekomst (matcht DB-constraint).
- ✅ **Brok B.2** — frontend. `js/eersteHapjesApi.js` (fetch-wrapper analoog aan `communityApi.js`). `childOnboardingModal.js` = 3-staps wizard (naam → geboortedatum → structuurvoorkeur, structuur skippable). `eersteHapjes.js` vervangt placeholder door echte logica: zonder kindje → onboarding-flow; met kindje(s) → switcher-chips (initialen-avatar in salie, actief gemarkeerd) + Vandaag-skeleton met `formatAge()` helper en 3 placeholder-cards ("Maaltijden vandaag" / "Allergenen" / "Volgende stap" met "Binnenkort"-pill). Nieuwe styles in `styles.css` onder sectie `EERSTE HAPJES — onboarding & Vandaag (brok B)`. Cache-buster naar `v2.3.0` overal.
- ✅ **Architectuur-keuze**: per-resource files in `api/eerste-hapjes/` ipv één catch-all (PLAN-TIMELINE volgde). Hobby function-limiet vervalt op Pro.
- ✅ **Root `CLAUDE.md`** uitgebreid met "Plan-niveau: Vercel Pro + Supabase Pro — niet zelf optimaliseren voor Hobby-limieten."
- ✅ **`api/CLAUDE.md`**: nieuwe endpoint-sectie voor `eerste-hapjes/children*`, `_lib/children.mjs` toegevoegd aan helpers-tabel, sectie 9 herschreven (geen Hobby-limiet meer, catch-all is bewuste organisatie-keuze).
- ✅ **`js/CLAUDE.md`**: `eersteHapjesApi.js` + `eersteHapjes.js` (uitgebreid) + `childOnboardingModal.js` toegevoegd. Cache-buster voorbeelden gebumped naar `v2.3.0`.
- ✅ Drie commits gepusht naar `eerste-hapjes`: `0f8231d` (B.1 backend), `8ebfd55` (Pro-plan in CLAUDE.md), `72a68cf` (B.2 frontend).
- ✅ **Verificatie via lokale static-server**: alle nieuwe assets HTTP-bereikbaar (200 OK), ES-module imports zonder errors, alle 11 nieuwe CSS-classes aanwezig in stylesheet, geen console errors.

### Open / nog te doen
- ⬜ Preview testen op Vercel-URL (login + `#/eerste-hapjes`): onboarding-flow, switcher, kindje toevoegen, archiveren.
- ⬜ **Brok C** starten — maaltijd-logging + symptomen-tracker. Vereist nieuwe migratie (`meal_logs`, evt. `child_symptoms`) + 2+ API endpoints + UI-integratie in Vandaag-skeleton (vervangt "Maaltijden vandaag" placeholder-card).

### Beslissingen
- **Per-resource API files** in `api/eerste-hapjes/` (niet catch-all). Reden: leesbaarheid, geen function-limiet relevant op Pro.
- **`archived` flag via PATCH** ipv aparte DELETE. `{ archived: true }` zet `archived_at = now()`, `{ archived: false }` zet `null`. Hard delete blijft beschikbaar via DELETE.
- **Onboarding op `#/eerste-hapjes`-route, niet bij eerste login** — bewust opt-in, niet alle users zullen Eerste Hapjes gebruiken.
- **Module-state voor actief kindje** in `eersteHapjes.js` (niet localStorage). Reset bij elke nieuwe SPA-bezoek; jongste actieve kindje wordt default. Bij meerdere kindjes is dat OK; bij één kindje doet 't er niet toe.

---

## 2026-05-08 (laat-avond) — Brokken C, D en E afgerond — Eerste Hapjes v1 compleet

**Context**: in één doorloop alle resterende functionaliteit voor de eerste versie van het Eerste Hapjes-traject gebouwd. Werken we nog optimalisaties achter na testen, maar de hele kern (logging, allergenen, microlearning) staat in productie-staat op de `eerste-hapjes` branch.

### Vandaag afgerond
- ✅ **Brok C — maaltijd- + symptomen-logging.** Migratie `meal_logs` + `child_symptoms` (additief, owner-only RLS, soft FK naar `recipes` voor recept-koppeling). `_lib/eersteHapjes-logs.mjs` met cross-table ownership-checks. 4 endpoints (`meals`, `meals/[id]`, `symptoms`, `symptoms/[id]`). Frontend: `mealLogModal.js` met **client-side recept-typeahead via bestaande `getRecipes()` cache** (geen extra endpoint nodig — kan later afgezonderd worden), `symptomLogModal.js` met 10-tegel grid + severity + optionele meal-koppeling. Vandaag-cards "Maaltijden vandaag" + "Symptomen 7 dagen" met `+` en `×`-acties.
- ✅ **Brok D — allergenen + recipe-warning.** Migratie `child_allergens` met unique `(child_id, allergen_key)`. 2 endpoints met upsert-pattern. Allergeen-vocabulaire (13 keys uit `js/utils.js ALLERGENS`) **client-side gevalideerd, geen DB-constraint** zodat lijst zonder migratie kan groeien. `allergenManager.js` accordion-modal: per allergeen status (`gepland/geprobeerd/vermijden`), reactie (`geen/mild/matig/heftig/onbekend`), datum + notes. Vandaag-card toont allergenen gegroepeerd op status met reactie-tags. **Recipe-warning in `mealLogModal`**: als ouder een recept kiest dat een te-vermijden allergeen bevat (status=vermijden of geprobeerd+matig/heftig) verschijnt waarschuwingsbalk — niet-blokkerend.
- ✅ **Brok E — microlearning + content.** Statisch `js/content/eersteHapjes-content.js` met 7 skeleton-artikels (titels, leeftijdsranges, categorieën vast — body's zijn placeholders die jij later vult). Helpers in `js/eersteHapjesContent.js` (`getNextStepArticle` kiest hoogste `ageMin` binnen leeftijdsrange, skipt categorie 'veiligheid'). `articleModal.js` met detail- én lijst-weergave in één component met slug-navigatie. Vandaag: "Volgende stap"-card live + "Alle tips & artikels"-link voor de volledige bibliotheek gegroepeerd per categorie.
- ✅ **9 commits** gepusht naar `eerste-hapjes`: 3× per brok (backend / frontend / docs). Cache-buster 3× gebumped: `v2.3.0` → `v2.4.0` → `v2.5.0` → `v2.6.0`.
- ✅ **Docs gesyncd** in `api/CLAUDE.md`, `js/CLAUDE.md`, `supabase-migrations/CLAUDE.md`, `CLAUDE.md` (root mappenstructuur), en deze PLAN-TIMELINE.

### Open / nog te doen
- ⬜ **Testen op Vercel preview** (`https://prillevencommunity-git-eerste-hapjes-prilleven-community.vercel.app`): volledige flow door — onboarding, meal log, recipe-typeahead, recipe-warning bij allergeen-overlap, symptoom-tracker, allergenen-manager, artikel-modals.
- ⬜ **Body's van de 7 microlearning-artikels schrijven** in `js/content/eersteHapjes-content.js` — structuur staat, alleen content invullen vanuit Anneleen's eigen content.
- ⬜ **Optimalisatie-ronde** (na testen): UX-tweaks, eventuele edge-cases, mogelijke uitbreidingen zoals recept-filter in receptenboek-UI (bewust uitgesteld, raakt legacy code).
- ⬜ **Merge `eerste-hapjes` → `main`** wanneer alles getest en goedgekeurd is. Pas dán komt het in productie. Bewust additief tot nu toe — bestaande HapjesHeld-flow ongewijzigd.
- ⬜ **Geplande HapjesHeld-migratie** (bewust uitgesteld): `loadUserProfile()` switchen van `chat_user_profiles.children` (jsonb) naar de nieuwe `children`-tabel. Doen we in één gecoördineerde release op het einde.

### Beslissingen genomen vandaag
- **Recept-typeahead client-side via `getRecipes()` cache** ipv server-endpoint. Recepten zijn publiek leesbaar via anon key, dus extra endpoint zou enkel een dunne wrapper zijn. Later afzonderen kan met minimale wijziging.
- **Allergeen-vocabulaire zonder DB-constraint** maar wel server-side gevalideerd in `_lib/eersteHapjes-allergens.mjs`. Reden: lijst kan in `js/utils.js ALLERGENS` groeien zonder migratie. Backend en frontend constants moeten wel in sync blijven (manueel — let op bij wijzigingen).
- **NL enum-waarden** voor user-facing data in DB-checks: `gepland/geprobeerd/vermijden`, `geen/mild/matig/heftig/onbekend`. Maakt SQL-queries in dashboard leesbaar.
- **Soft FK `meal_logs.recipe_id text → recipes(id) ON DELETE SET NULL`** — referentie-integriteit zonder dat een verwijderd recept een log breekt.
- **HTML-string body's voor content** ipv markdown. Geen parser of build-step nodig. Body's worden door Anneleen zelf geschreven, dus geen sanitize-risico.
- **Soft skeleton-content**: Brok E afgerond als infrastructuur + structuur staan, body-tekst aanvullen is geen blocker voor de volgende fase.

### Open vragen / blockers
- Geen blockers. Alleen handmatige test-cycle nodig op Vercel preview.

---

## 2026-05-08 (laat-laat-avond) — Brok F afgerond — fasen-systeem live

**Context**: na review van het PDF-productoverzicht bleek dat de fases helemaal nog niet gebouwd waren — wel in de mockup, niet in brok-A-tot-E. Brok F gaat enkel over het fasen-skelet (banner + checklist + advance), latere brokken (G/H/I/J/K) dekken symptoom-detail-content, allergeen-reminders, vandaag-suggesties, recipe-filter en microlearning-search.

### Vandaag afgerond
- ✅ **Brok F.1** — statische config `js/content/eersteHapjes-phases.js` met 6 fases (0=Opstart, 1=Eerste hapjes, 2=Tweede maaltijd, 3=Ontbijt, 4=Eerste snack, 5=Tweede snack/eindfase). Per fase: number, name, label, minAgeMonths (0/6/7/8/10/12), intro, advanceLabel, 5 checks (fase 5 heeft er 0). Alle texten **letterlijk uit het PDF-productoverzicht** ("Productoverzicht — Eerste Hapjes Traject" van Anneleen).
- ✅ **Brok F.2** — migratie `2026-05-08-child-phases.sql`. Twee tabellen: `child_phases` (PK `(child_id, phase_number)`, `unlocked_at`, `completed_at`) en `child_phase_checks` (PK `(child_id, phase_number, check_key)`, `checked_at`). Owner-only RLS (4 policies elk), updated_at trigger op phases. Alle constraints additief, geen wijziging aan bestaande tabellen.
- ✅ **Brok F.3** — `_lib/eersteHapjes-phases.mjs` + 3 endpoints. `loadPhaseState(userId, childId)` auto-initialiseert bij eerste call: `ageMonths >= 14` → fases 0..4 als `completed` + fase 5 actief; anders → enkel fase 0 actief. `togglePhaseCheck` insert/delete idempotent. `advancePhase` vereist alle 5 checks + `ageMonths >= minAge` van volgende fase, anders 409. Server-side mirror van fase-config: alleen `{number, minAgeMonths, checkCount}` voor validatie — labels/intros blijven exclusief frontend.
- ✅ **Brok F.4** — frontend in één component (`phaseModal.js`): `renderPhaseBanner(state)` voor sticky banner bovenaan Vandaag (klik opent detail), `openPhaseDetailModal({child, phaseState})` met afvinkbare checklist + voortgangsbalk + advance-knop (disabled met copy "Ten vroegste vanaf X mnd — geen haast" als leeftijd te jong), `openPhaseOverviewModal({child, phaseState})` met alle 6 fases als kaartjes (locked/active/completed). Detail- en overzichts-view delen modal-shell met interne `swap()`. Resolves `{changed: bool}` zodat caller kan herladen. `eersteHapjes.js` integreert: phaseState laden in `loadLogs`, banner inserten in `renderToday`, "Mijn fasen"-link onderaan, bind voor banner + link. Cache-buster gebumped: `v2.6.0` → `v2.7.0` in alle JS/CSS/HTML (37 files).
- ✅ **Privacy.html** sectie 2.8 explicieter over fase 0..5 en "geen automatisch doorzetten".
- ✅ **Docs gesyncd** in `api/CLAUDE.md` (endpoint-sectie + helpers-tabel), `js/CLAUDE.md` (eersteHapjesApi + content/eersteHapjes-phases + phaseModal + cache-buster voorbeelden), `supabase-migrations/CLAUDE.md` (schema-sectie).
- ✅ **5 commits** gepusht naar `eerste-hapjes`: F.1 → F.2 → F.3 → F.4 → docs.

### Open / nog te doen
- ⬜ **SQL handmatig draaien** in Supabase Dashboard — `supabase-migrations/2026-05-08-child-phases.sql` (al getoond in chat F.2).
- ⬜ **Testen op Vercel preview**: nieuwe kindjes (jong + oud), checklist afvinken, advance met te jonge leeftijd (moet blokken), advance met juiste leeftijd, overzichts-modal navigatie.
- ⬜ **Brokken G/H/I/J/K** (uit PDF-gap-analyse): symptoom-detail-content + rode-vlag, allergeen-reminders + risicovoedingen + max-1-nieuw-guard, vandaag-suggesties + adaptieve nudges, recipe-filter + alternatieven, microlearning-search.
- ⬜ **Body's van de 7 microlearning-artikels** schrijven (was al open van brok E).

### Beslissingen genomen vandaag
- **6 fases (0..5) i.p.v. 5** zoals mockup suggereerde — PDF is leidend.
- **Auto-init op basis van leeftijd**: kindjes ≥14 mnd starten direct op fase 5 (alle eerdere fases als 'completed' gemarkeerd zonder checks). Onder 14 mnd → fase 0 actief, ouder vinkt zelf door.
- **Geen automatisch doorzetten ooit**: ouder klikt expliciet "Klaar voor fase X+1". Leeftijd is alleen blokkerend, nooit triggerend.
- **State-only DB**: fase-definities (labels, intros, check-labels) blijven exclusief in `js/content/eersteHapjes-phases.js`. Texten aanpassen vereist geen migratie. Backend houdt enkel `{number, minAgeMonths, checkCount}` voor validatie — kleine duplicatie maar bewust gekozen.
- **Eén modal voor detail + overzicht**: zelfde patroon als `articleModal.js` — minder bestanden, makkelijker te navigeren.
- **PDF-texten letterlijk overgenomen** zonder paraphrase, zoals user expliciet vroeg.

### Open vragen / blockers
- Geen blockers. SQL moet nog manueel gedraaid worden voor de preview kan testen.

### Update einde sessie
- ✅ **SQL gedraaid** in productie-DB. Geverifieerd via Supabase MCP: `child_phases` (PK `(child_id, phase_number)`, 4 RLS-policies, updated_at trigger, FK cascade naar children + auth.users) + `child_phase_checks` (PK `(child_id, phase_number, check_key)`, 3 RLS-policies, FK cascade) staan beide leeg en correct opgezet. Geen nieuwe security-advisors voor deze tabellen.
- ✅ **Frontend-modules getest via static preview** (`preview_eval`): alle 4 nieuwe modules laden zonder errors, exports kloppen, `renderPhaseBanner` produceert correcte HTML met fase-pill + voortgangsbalk, alle 14 fasen-CSS-classes aanwezig in stylesheet.
- ⬜ **Live test op Vercel preview** is de enige resterende stap voor brok F vóór merge naar main.

---

## 2026-05-09 — Brok G afgerond — symptoom-detail + rode-vlag

**Context**: PDF-gap-analyse zei dat de symptoom-tracker in brok C alleen het loggen-deel had. Brok G voegt detail-content + adaptieve red-flag-banner toe en breidt de symptoom-lijst uit van 10 → 16. Skeleton-content (body's) wordt later door Anneleen aangevuld, zoals bij brok E.

### Vandaag afgerond
- ✅ **Brok G.1** — `js/content/eersteHapjes-symptoms.js` met 16 symptomen. Per item: `key, label, icon, intro, body (HTML-string skeleton), redFlags[], redFlagSeverity[]`. Helpers: `SYMPTOMS, SEVERITIES, getSymptom, getSymptomMeta, isRedFlag`. Severity-mapping per type: `ademhaling/lethargie` op alles → red_flag; `koorts/braken/zwelling/gewicht/hoesten` op matig+heftig; rest alleen op heftig; `mild` triggert nooit (behalve ademhaling/lethargie als safety net).
- ✅ **Brok G.2** — migratie `2026-05-09-symptoms-extend.sql`: drop+add CHECK constraint `child_symptoms_symptom_type_check` met 6 nieuwe keys (`gewicht, hoesten, verstopping, geen_eetlust, prikkelbaar, lethargie`). Bestaande logs blijven geldig. Server-side `SYMPTOM_TYPES` Set in `_lib/eersteHapjes-logs.mjs` mee uitgebreid.
- ✅ **Brok G.3** — `detectRedFlag(symptomType, severity)` helper in `_lib/eersteHapjes-logs.mjs` als server-side mirror van frontend `redFlagSeverity`. Endpoint `POST /api/eerste-hapjes/symptoms` returnt nu `{ symptom, red_flag }`.
- ✅ **Brok G.4** — frontend.
  - Nieuw `js/components/symptomDetailModal.js`: zelfde patroon als `articleModal.js` (lijst + detail in één modal-shell met `swap()`). Detail-view toont icon, intro, HTML-body, rode-vlag-blok (gele linker-rand), disclaimer-footer.
  - `symptomLogModal.js`: tegel-grid leest uit `SYMPTOMS` (geen hardcoded array meer); elke tegel heeft een info-(i)-knop rechtsboven die `openSymptomDetailModal({symptomKey})` opent (event-bubbling onderbroken zodat tegel niet selecteert). "Wat betekenen deze?"-link bovenaan veld → lijst-view. Modal resolved nu `{symptom, red_flag}` i.p.v. enkel `symptom`.
  - `eersteHapjes.js`: oude `SYMPTOM_TYPE_LABEL/ICON` constanten verwijderd → vervangen door `getSymptomMeta()`. Symptoom-rijen tonen een ⚠ "Aandachtssignaal"-pill (klikbaar → detail-modal) bij red-flag-combinaties; rij krijgt linker-rand in `--color-warning`. `showRedFlagBanner(symptomKey)`-helper toont fixed top-banner na log met `red_flag: true` (met sluit-knop, geen state-bewaring). "Symptomen-uitleg"-link onderaan Vandaag opent lijst-modal.
  - `styles.css`: nieuwe sectie `EERSTE HAPJES — symptom detail (brok G)` met info-icoontje, red-flag-pill, top-banner (incl. pop-animatie), detail-modal-shell, red-flag-blok, lijst-items, mobiele variant.
- ✅ **Brok G.5** — cache-buster `v2.7.0` → `v2.8.0` in 37 files (HTML + JS imports + JS CLAUDE.md voorbeelden).
- ✅ **Brok G.6** — docs gesyncd in `api/CLAUDE.md` (endpoint-uitbreiding + helpers-tabel met `detectRedFlag`), `js/CLAUDE.md` (nieuwe content-module + `symptomDetailModal` + aangepaste `symptomLogModal`-beschrijving), `supabase-migrations/CLAUDE.md` (uitgebreide CHECK-constraint).
- ✅ **Sanity-check via `node --check`**: alle 6 gewijzigde files (.js + .mjs) parsen zonder syntax-errors.

### Open / nog te doen
- ⬜ **SQL handmatig draaien** in Supabase Dashboard: `supabase-migrations/2026-05-09-symptoms-extend.sql` (additieve uitbreiding van CHECK — risico-laag).

```sql
alter table public.child_symptoms
  drop constraint if exists child_symptoms_symptom_type_check;

alter table public.child_symptoms
  add constraint child_symptoms_symptom_type_check
  check (symptom_type in (
    'huid','buik','diarree','braken','slaap',
    'koorts','jeuk','zwelling','ademhaling','anders',
    'gewicht','hoesten','verstopping','geen_eetlust','prikkelbaar','lethargie'
  ));
```

- ⬜ **Live test op Vercel preview** voor brok F + G samen vóór merge.
- ⬜ **Body's invullen** voor de 16 symptomen (skeleton staat) + 7 microlearning-artikels (nog open van brok E). Beide door Anneleen.
- ⬜ **Brokken H/I/J/K** (PDF-gap-analyse): allergeen-reminders + risicovoedingen + max-1-nieuw-guard, vandaag-suggesties + adaptieve nudges, recipe-filter + alternatieven, microlearning-search.

### Beslissingen genomen vandaag
- **Skeleton-content**: body's als HTML-string placeholder, geen markdown-parser (consistent met brok E). Anneleen vult body's later aan zonder code-wijziging.
- **6 nieuwe symptoom-keys**: gekozen op basis van wat ouders in de eerste-hapjes-fase reëel kunnen waarnemen en wat een arts-signaal kan zijn (gewicht, hoesten, verstopping, geen eetlust, prikkelbaar, lethargie).
- **Red-flag-trigger-strategie**: severity-niveau per type bepaalt of banner triggert. `mild` triggert alleen voor `ademhaling` en `lethargie` als safety net. Bewust client + server constants apart — frontend voor UI-rendering (rij-pill), server voor de adaptieve banner-trigger op POST-response.
- **Statische config voor symptomen** zonder DB-tabel — zelfde patroon als `eersteHapjes-phases.js` en `eersteHapjes-content.js`. Texten aanpassen vereist geen migratie. Backend houdt enkel `RED_FLAG_SEVERITIES` voor de detector — kleine duplicatie maar bewust gekozen.
- **Eén modal voor lijst + detail**: zelfde patroon als `articleModal.js` en `phaseModal.js` — minder bestanden, makkelijker te navigeren.
- **Banner sluit zichzelf niet automatisch**: gebruiker moet expliciet sluiten of "Lees meer" klikken — dit is een aandachtssignaal, niet een toast.

### Open vragen / blockers
- Geen blockers. Migratie-SQL hierboven moet manueel in Supabase Dashboard gedraaid worden voor de preview kan testen met de 6 nieuwe symptoom-keys (anders 422 op POST).

---

## 2026-05-09 (avond) — Brok H afgerond — risicovoedingen + allergeen-progressie + reminders

**Context**: substantiële uitbreiding van het Eerste Hapjes-traject na review van mockup. Brok H bevat: (1) defaultset risicovoedingen met leeftijdsdrempels, (2) afgeleide allergeen-progressie (1/3→2/3→3/3) op basis van intro-logs, (3) recept-warnings, (4) reminders-card, (5) max-1-nieuw-guard. Migratie-werk + 8 sub-stappen.

### Vandaag afgerond
- ✅ **Brok H.1** — `js/content/eersteHapjes-risk-foods.js` met 13 items (honing, koemelk-drank, hele noten, druiven, kerstomaten, rauwe eieren, rauw vlees, rauwe vis, kwik-vis, rauwe melkproducten, toegevoegd zout, toegevoegde suiker, rauwe peulvruchten). Per item: leeftijdsdrempel + tag + intro + body-skeleton + ingredient-matchers (regex). Items 1-10 worden tegen recepten gescand; 11-13 alleen in lijst-modal (zout/suiker zouden te veel false positives geven). `ALLERGEN_INTROS_TARGET = 3`. Helpers: `scanRecipeForRisks(recipe|text, ageMonths)`, `recipeToScanText(recipe)`, `getRelevantRiskFoods(months)`, `formatAgeLimit(months)`.
- ✅ **Brok H.2** — migratie `2026-05-09-allergen-intro-logs.sql` + lib + 2 endpoints. Nieuwe tabel `allergen_intro_logs` (additief naast bestaande `child_allergens`): één rij per intro-poging met datum + reactie + notes + optionele links naar `meal_log_id`/`linked_symptom_id`. Owner-only RLS, 2 indexen, `touch_updated_at`-trigger (project-conventie, niet `set_updated_at`). Endpoints: `GET/POST /api/eerste-hapjes/allergen-intros` + `DELETE /api/eerste-hapjes/allergen-intros/[id]`. Lib `_lib/eersteHapjes-allergen-intros.mjs` met `sanitizeIntroLogInput`, `loadIntroLogsForChild`, `createIntroLog`, `deleteIntroLog`. **SQL gedraaid in productie-DB en geverifieerd via Supabase MCP** (1 tabel, 4 policies, 3 indexen, 1 trigger, RLS enabled).
- ✅ **Brok H.3** — allergenenmodule herwerkt. Nieuwe `js/components/allergenIntroModal.js`: `deriveAllergenState(allergen, intros)` (state-derivation: 0 intros → 'later', 1-2 zonder reactie → 'probeer-opnieuw N/3', 3× geen → 'veilig', matig/heftig OF status='vermijden' → 'opvolgen'). `openAllergenTimelineModal(...)` (lijst van intros + voortgangsbalk + delete + "+ Intro registreren"). `openAllergenIntroModal(...)` (datum/reactie-chips/notes form). `js/eersteHapjesApi.js` uitgebreid met 3 helpers. `allergenManager.js` herwerkt: alle 13 allergenen behouden, per rij afgeleide status-pill + voortgangsbalk + 2 knoppen (timeline / + intro) + "Markeer als vermijden"-toggle + notitie. Reactie/datum verschoven naar intro-modal. Vandaag-card in `eersteHapjes.js`: rij per allergeen met klik → tijdlijn-modal. Nieuwe styles-sectie in `styles.css`. Verificatie via preview-eval: 5 derive-scenario's allemaal correct.
- ✅ **Brok H.4** — risicovoeding-warning op recept-detail + meal-log. `eersteHapjes.js` exporteert nu `getActiveChildSnapshot()` + `loadActiveChild()` voor cross-module access. `recipeDetail.js`: lazy `loadActiveChild()` → `scanRecipeForRisks()` → banner direct onder Terug-knop (alleen als kindje aanwezig + risico's gevonden). `mealLogModal.js`: extra params `childBirthdate` + `todayMeals`. Nieuwe `[data-risk-warning]`-slot bij setRecipe. **Bug gefixed**: regex `noo?ten?` was fout (matchte "te" minimum); nu `noo?t(?:en)?` voor zowel `walnoot` als `walnoten`. Ook `kerstomaat/kerstomaten` regex aangepast voor NL-meervoud. Verificatie: 9/9 testen pass.
- ✅ **Brok H.5** — `js/components/riskFoodsModal.js`. `openRiskFoodsListModal({ageMonths?})` toont alle 13 items gegroepeerd per tag (verstikking/microbieel/botulisme/kwik/nutrient), met klik → detail-view (zelfde shell, swap). `openRiskFoodDetailModal({riskKey, ageMonths?})` als zelfstandige detail-modal. Items waarvoor kindje te jong is krijgen "Geldt nu voor jouw kindje"-badge. Vandaag-pagina footer: "Risicovoedingen-lijst →"-link.
- ✅ **Brok H.6** — reminders-card op Vandaag-pagina (alleen als > 0 reminders). Bouwt 2 soorten: (a) actuele risicovoedingen voor leeftijd (klik → detail-modal), (b) allergeen-reminders (`later` = nog te proberen, `probeer-opnieuw` met laatste intro ≥ 2 dagen geleden = tijd voor herhaling). Card staat tussen fase-banner en cards-grid. Klik op item opent relevante modal.
- ✅ **Brok H.7** — max-1-nieuw-guard in `mealLogModal`. Bij recept-keuze: scan recept-allergenen tegen `gepland`-set + tegen "vandaag al geïntroduceerde" set (uit `state.meals` × recipes-cache). Als recept een NIEUW gepland-allergeen bevat én er vandaag al een ander gepland-allergeen werd gelogd → toon waarschuwing "Vandaag al X geïntroduceerd. Wacht 2-3 dagen voor Y." Niet blokkerend, alleen advies. Eigen styles-slot.
- ✅ **Brok H.8** — docs + cache-buster bump. `v=2.8.0 → v=2.12.0` in 40 files (HTML + JS imports + CLAUDE.md voorbeelden). Docs-updates in `js/CLAUDE.md` (3 nieuwe componenten + 1 content-module + uitgebreide eersteHapjes/mealLogModal/allergenManager beschrijvingen), `api/CLAUDE.md` (nieuwe endpoint-sectie + helpers-tabel), `supabase-migrations/CLAUDE.md` (nieuwe `allergen_intro_logs`-tabel + addendum bij `child_allergens` over brok H.3 use-pattern).

### Open / nog te doen
- ⬜ **Live test op Vercel preview**: hele brok H end-to-end. Onboarding kindje → allergenen-manager → intro registreren → progressie zien → recept openen met risk-food → warning → meal-log → max-1-nieuw-guard → reminders-card.
- ⬜ **Body's invullen** voor risk-foods (13 items skeleton). Anneleen vult later aan.
- ⬜ **Body's invullen** voor symptomen (16 items skeleton, brok G) en microlearning-artikels (7 items skeleton, brok E). Allemaal door Anneleen.
- ⬜ **Brokken I/J/K** uit PDF-gap-analyse: vandaag-suggesties + adaptieve nudges (I), recipe-filter + alternatieven (J), microlearning-search (K).
- ⬜ **Bewuste HapjesHeld-migratie** blijft uitgesteld tot eindronde.

### Beslissingen genomen vandaag
- **Statische defaultset risicovoedingen** + leeftijdsfilter + tag-categorisering — geen DB-tabel. Anneleen kan items toevoegen door 1 file te editen, geen migratie.
- **Client-side ingredient-scan** (regex per item) ipv DB-kolom op recipes. Reden: geen seed-werk over honderden recepten, false positives = OK want niet-blokkerend. Ouder beslist.
- **`allergen_intro_logs` apart van `child_allergens`** ipv migratie van bestaande tabel. Reden: schoon model (1:N), geen risico voor bestaande data.
- **Status-derivation centraal in 1 helper** (`deriveAllergenState`) — wordt gebruikt in allergenManager, intro-modal én Vandaag-card. Eén plek, één bron van waarheid.
- **Alle 13 allergenen blijven zichtbaar** in allergenManager — user expliciet: "alle allergenen zijn belangrijk". Mockup was ruwe schets, niet leidend.
- **Reminders-card alleen tonen als > 0 reminders** — geen lege card.
- **Max-1-nieuw alleen waarschuwen, niet blokkeren** — pediatrisch advies, ouder beslist.
- **`touch_updated_at`** als project-conventie ontdekt en gebruikt; `set_updated_at` bestond niet in productie-DB.
- **Regex-bug NL-meervoud** opgelost: `noo?ten?` → `noo?t(?:en)?` om zowel walnoot (oo+t) als walnoten (o+ten) te matchen.

### Open vragen / blockers
- Geen blockers. Live testen kan zodra preview-deploy is gebouwd na push naar `eerste-hapjes` branch.

---

## 2026-05-09 (laat) — Brok I afgerond — Vandaag-suggesties + adaptieve nudges

**Context**: na brok H reminders-card uitbreiden met "smart" suggesties op basis van patronen in meal-logs / symptomen / fase-voortgang. Statische rule-engine (geen DB-werk), 7 rules.

### Vandaag afgerond
- ✅ **Brok I.1** — `js/eersteHapjesSuggestions.js`. Pure rule-engine met 7 rules: (a) goede dag voor allergeen-intro (gepland + leeftijd ≥ 6 mnd + ≥ 2 dagen sinds laatste), (b) klaar voor volgende fase? (leeftijd ≥ minAge volgende fase), (c) recept-discovery (random uit cache, niet in laatste 7 dagen gelogd, deterministisch per dag via stable hash), (d) afwijzing-patroon (3+ × afwijzing op zelfde recept in 7 dagen), (e) 5+ dagen geen log, (f) dubbele meal-type vandaag (2+ × zelfde type), (g) symptoom-patroon (3+ × zelfde symptoom in 7 dagen). Exporteert `buildSuggestions(ctx)`. Verificatie via preview-eval: 3 scenario's getest, allemaal correct.
- ✅ **Brok I.2** — integratie in `eersteHapjes.js`. `loadLogs()` laadt nu ook 7d meal-history + recipes-cache. Nieuwe `buildAdvice(child)` combineert H.6-reminders + I-suggestions met dedupe (suggestion over allergeen wordt overgeslagen als reminder al bestaat voor zelfde key). Card-titel "Tips & herinneringen". Klik-handlers voor 5 action-kinds: `open-intro` (allergenIntroModal), `open-recipe` (Router.navigate), `open-meal-log` (triggert bestaande add-meal knop), `open-phase-detail` (triggert open-phases knop), `show-info` (toast met info per type).
- ✅ **Brok I.3** — styles + cache-buster + docs. Subtle differentiation in styles.css (`.eh-reminder-item-suggestion` met andere achtergrond). Cache-buster `v=2.9.0 → v=2.12.0` in alle files. Docs gesynced in `js/CLAUDE.md` (eersteHapjesSuggestions toegevoegd, eersteHapjes-beschrijving uitgebreid).

### Open / nog te doen
- ⬜ **Live test op preview**: ouder met meal-data zien hoe de "Tips & herinneringen"-card eruitziet met 0/1/multiple suggestions.
- ⬜ **Brokken J/K**: recipe-filter + alternatieven (J), microlearning-search (K).
- ⬜ **Layout-bijsturingsronde** (gepland): user gaf aan dat layout van Vandaag-pagina momenteel niet helemaal ok is — komt na alle features.

### Beslissingen genomen vandaag
- **Statische rules** ipv DB/server-side patroondetectie. Voorspelbaar, debugbaar, geen extra calls.
- **Dedupe via key-prefix** (`suggest-allergen-X` vs `allergen-X`): suggestion met action `open-intro` wordt overgeslagen als reminder al bestaat voor zelfde allergen-key.
- **Recipe-discovery deterministisch per dag**: stable hash op `(today + child_id)` zodat suggestion binnen één dag stabiel blijft maar elke dag verandert.
- **Geen acknowledged-state in v1**: suggesties verdwijnen vanzelf als voorwaarde wegvalt.
- **`show-info` action via toast** ipv aparte modal voor v1.
- **`recentMeals` als nieuw state-veld** (7 dagen) náást bestaande `meals` (vandaag) — geen breaking change op bestaande Vandaag-card.

---

## 2026-05-09 (laat) — Brok J afgerond — recept-filter + alternatieven

**Context**: na de Vandaag-pagina is het tijd voor receptenboek-integratie. Filter-toggle in receptenlijst + alternatieven-sectie op recept-detail wanneer een recept niet geschikt is.

### Vandaag afgerond
- ✅ **Brok J.1** — Filter-toggle in `recipeList.js`. Toggle "Geschikt voor [kindje]" verschijnt in toolbar, alleen als actief Eerste Hapjes-kindje aanwezig. Standaard uit (geen breaking change). Bij toggle aan: filter recepten weg waarvan (a) `scanRecipeForRisks(recipe, ageMonths)` een risk-food vindt, of (b) `recipe.allergens` overlapt met `child_allergens.status='vermijden'`. Lazy-load van actief kindje + allergens via `loadActiveChild()` + `getAllergensForChild()`.
- ✅ **Brok J.2** — Alternatieven-sectie in `recipeDetail.js`. Wanneer recept niet veilig is voor het actieve kindje, render onderaan (vóór Reacties) een "Alternatieven voor [kindje]"-sectie met tot 3 recepten die wel veilig zijn én meal-moment-overlap hebben. Klikbaar → directe navigatie naar alternatief recept-detail. Stable shuffle per recipe-id zodat de keuze niet bij elke render verandert.
- ✅ **Brok J — gedeelde helper** `js/eersteHapjesEligibility.js` met `isRecipeSafeForChild(recipe, ctx)` en `getRecipeAlternatives(current, all, ctx, limit)`. Gebruikt door beide componenten — single source of truth.
- ✅ **Brok J.3** — Styles in `styles.css` (filter-toggle pill + recipe-alt grid). Cache-buster `v=2.10.0 → v=2.12.0` in alle files. Docs gesynced in `js/CLAUDE.md`.

### Open / nog te doen
- ⬜ **Live test**: receptenlijst zonder en met toggle aan, recept-detail met honing-recept op jong kindje moet alternatieven tonen.
- ⬜ **Brok K** — microlearning-search (laatste van de PDF-gap-analyse).
- ⬜ **Layout-bijsturingsronde** (gepland).

### Beslissingen genomen vandaag
- **Filter standaard uit** — geen breaking change voor users zonder Eerste Hapjes-kindje.
- **Hard filter** (verbergen) ipv badge-on-card — eenvoudiger UX, gewoon filter-paradigma.
- **Gedeelde helper-file** ipv duplicate per component — `eersteHapjesEligibility.js`.
- **Alternatieven-sectie alleen bij niet-veilig recept** + alleen als kindje aanwezig — anders pure noise.
- **Stable shuffle per recipe-id**: alternatieven blijven consistent binnen dezelfde sessie maar variëren per recept.

---

## 2026-05-09 (laat) — Brok K afgerond — microlearning-search

**Context**: laatste brok van de PDF-gap-analyse. Bestaande artikel-lijst-modal uitbreiden met search + categorie-filter zodat ouders snel iets kunnen vinden.

### Vandaag afgerond
- ✅ **Brok K** — `articleModal.js` `openArticleListModal({ageMonths})` heeft nu een search-input bovenaan + categorie-chips (multi-select OFF). Search matcht in title + summary + body + categorie-label, en highlightt matches in de titel via `<mark>`. Chip-klik op actieve chip = reset, "Alle"-chip resets eveneens. Lege state heeft een vriendelijke "Geen artikels gevonden"-melding.
- **Architectuur**: `openModal`-shell kreeg een nieuwe `onBound`-callback die wordt aangeroepen na elke `bind()` (na initial render én na elke `swap`). Daarmee kan `openArticleListModal` zijn search/chip-events herbinden na elke re-render — focus op input wordt programmatisch hersteld.
- **Cache-buster** `v=2.11.0 → v=2.12.0` in alle files.
- **Docs** gesynced in `js/CLAUDE.md`.

### Open / nog te doen
- ⬜ **Live test**: zoekveld testen op preview, edge cases (lege string, alleen spaties, geen resultaten).
- ⬜ **Body's van 7 microlearning-artikels schrijven** door Anneleen.
- ⬜ **Layout-bijsturingsronde** (gepland) — alle features staan nu, kan beginnen.

### Beslissingen genomen vandaag
- **Multi-select OFF** voor chips — eenvoudiger UX. Eén categorie tegelijk; klik op zelfde chip reset.
- **Search matcht ook in body** (niet alleen titel/summary) — body is HTML-string, gestript voor matching.
- **Highlight in titel** alleen, niet in summary/body — om visuele rust.
- **`onBound`-callback** in modal-shell ipv aparte modal-shell voor lijst — minimal change, herbruikbaar.

---

## 2026-05-09 — Eerste Hapjes feature compleet (brokken A t/m K)

Alle PDF-gap-features staan nu live op `eerste-hapjes` branch. Volgende stap: **layout-bijsturingsronde** (door user aangevraagd) en aanvullen van skeleton-content (risk-foods bodies, symptoom-bodies, microlearning-artikel-bodies — allemaal door Anneleen).

Geen merge naar `main` tot bijsturing + content compleet zijn.
