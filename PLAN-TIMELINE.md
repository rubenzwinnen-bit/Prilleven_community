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

## 2026-05-15 — Chatruimtes polish + landing volledige breedte (branch `uitbouw-chat-ruimtes` → main)

**Context**: Restant-werk op de chatruimtes-feature (caching, freeze-bug, admin-edit) en de hardnekkige width-clamp op de landing-page eindelijk opgelost. Branch `uitbouw-chat-ruimtes` gemerged in `main` (commit `fd66b8d`) — productie-deploy actief.

### Vandaag afgerond
- ✅ **Per-room topic-cache** (`pril_chatroom_v1_<slug>`, TTL 2 min) — rooms openen instant, daarna background-refresh. Lost trage laadtijd op voor "Melk voeding", "Eerste hapjes", "Allergieën", "Feedback".
- ✅ **Freeze-bug** op eerste click op een chatruimte gefixt: `state.activeSlug` wordt nu meteen gezet, voor de cache-check en API-call. Voorkomt race waarbij `state.activeSlug !== slug` true was na fetch.
- ✅ **Admin kan room-intro bewerken**: nieuwe `PATCH /api/chat-rooms/:slug` (admin-only, `findBlockedWord` validatie). Inline edit-form in de room-header met Annuleer/Opslaan. Cache wordt mee bijgewerkt.
- ✅ **Header-alignment in chatroom-view**: `chatroom-header` herstructureerd naar column-layout met back+title+edit op één rij en description ingesprongen onder de titel.
- ✅ **Landing volle browserbreedte** (eindelijk!). Root-cause was `#app-content { max-width: var(--max-width) /* 1140px */ }` — die clampte heel de app, ook al stond op `.home-hub--tri` zelf `max-width: 2200px`. Gefixt via:
  - `#app-content:has(.home-hub--tri) { max-width: none }` voor de hoofdcontent
  - `body.is-hub .header-inner { max-width: none }` voor de header
- ✅ **Layout-tuning landing**: grid `240px / 1fr / 170px` (functies wijder, chatrooms smaller). Functies-tegels nu titels-only + compact. Bij 1600px viewport krijgt de midden-kolom 1131px (was ~777px = +45%).
- ✅ **Cache-buster** bumped 2.4.6 → 2.4.13 over de hele branch.
- ✅ **Supabase RLS** geverifieerd via MCP: alle UPDATE-policies op `chat_topics`, `chat_replies`, `community_posts`, `community_replies` zijn nu zonder 15-min check — migratie `2026-05-14-remove-edit-window.sql` is correct toegepast.
- ✅ **Branch gemerged** in `main`. 14 commits, 39 bestanden, 2243 inserts. Vercel deploy automatisch.

### Beslissingen
- **`body.is-hub` + `:has()` als landing-only hook** voor breedte-overrides — niet de globale `--max-width` wijzigen (zou alle andere pagina's raken). Patroon toegevoegd aan root CLAUDE.md (sectie 8) zodat toekomstige sessies het kennen.
- **PATCH /api/chat-rooms/:slug** is admin-only via `requireAdmin` + `findBlockedWord`. Geen aparte audit-log (chat-rooms zijn weinig wijzigingen, low-risk).
- **Per-room cache TTL = 2 min** — kort genoeg voor verse data bij active gebruik, lang genoeg om instant render bij snelle terug-navigatie te bieden.

### Open / nog te doen
- ⬜ Visuele check op productie na deploy (1280px + 1600px viewport + mobile).
- ⬜ Hover-image effect op functies-tegels nu kleiner door compactere padding — eventueel hover-img-hoogte heroverwegen als gebruiker het minder duidelijk vindt.

### Niet vergeten
- CLAUDE.md-updates: root (width-clamp + chat-rooms catch-all), `api/` (chat-rooms.mjs endpoint), `js/` (chatRoomsApi + chatRooms.js + profileRender). Allemaal beknopt — één regel of bullet.

---

## 2026-05-19 — Allergenen-flow opschoning + chatruimtes landing-fix (branch `uitwerken-profiel`, 2.5.8)

**Context**: Vervolg op `d147956` (pencil-edit voor doses/symptomen). Vier kleine UX-issues weggewerkt + de allergen-flow definitief vereenvoudigd.

### Vandaag afgerond
- ✅ **Pencil-positie consistent rechts**: in `allergenen.js` HTML-volgorde aangepast (pencil vóór notes/details) + in `styles.css` expliciete `grid-row: 1; grid-column: -1 / -2` op `.allergenen-dose-edit` en `.allergenen-symptom-edit`. Lost de "pencil onderaan bij notes"-bug op.
- ✅ **Agenda-knop verwijderd** uit allergenen-header. `js/components/allergenenAgenda.js` gedropt, `mountAllergenenAgenda`-import + `open-agenda`-handler + `openAgendaModal()` weg.
- ✅ **Allergen-lijst opgeschoond** in `js/content/eersteHapjes-allergen-flow.js`:
  - `ei-geel` + `ei-wit` → één `kippen-ei`
  - `citrus`, `gluten-niet-tarwe`, `honing` geschrapt
  - `koemelk` nu `introBefore: 12` (altijd actief), geen `introFrom` meer
  - Nieuwe flow telt 9 items.
  - Bijbehorende `ALLERGEN_KEYS` Sets in `api/_lib/eersteHapjes-state.mjs` en `api/_lib/eersteHapjes-logs.mjs` mee bijgewerkt, plus `ALLERGEN_LABELS` in `js/components/symptomLogModal.js`.
- ✅ **Chatruimtes landing "Laden..."-freeze**: in `js/components/chatRooms.js` empty-state branch in `renderRoomsList()` + `renderedFromCache`-flag in `init()` zodat de placeholder ook bij lege fetch verdwijnt. CSS class `.rooms-empty` toegevoegd.
- ✅ **Cache-buster** bumped 2.5.7 → 2.5.8 in alle HTML/JS-bestanden.
- ✅ **Commit & push** als `44e7555` op `uitwerken-profiel`. Vercel preview-deploy actief.

### Beslissingen
- **Bulk-merge `ei-geel` + `ei-wit` → `kippen-ei`** via SQL-migratie: UNIQUE constraint `(child_id, allergen_key, dose_number)` tijdelijk droppen, oude allergens deleten, hernoemen, dedupen (oudste rij behouden per `(child_id, dose_number)`), constraint herstellen. Een `dose_number`-offset truc kan niet door CHECK `BETWEEN 1 AND 3`.
- `eerste_hapjes_state.allergen_state` (jsonb) niet automatisch opschonen — frontend leest defensief (`?.includes(...)`), oude keys zijn no-ops in de nieuwe flow.
- Constraint-detail toegevoegd aan root CLAUDE.md (valkuilen-sectie) zodat toekomstige bulk-key-merges niet opnieuw vastlopen.

### Open / nog te doen
- ⬜ **SQL-migratie nog uitvoeren** in Supabase Dashboard (`uitwerken-profiel`). Anders blijven `ei-geel`/`ei-wit`/`citrus`/`gluten-niet-tarwe`/`honing` rijen rondzwerven in `eerste_hapjes_allergen_doses` en matchen ze niet meer met de nieuwe flow-keys.
- ⬜ Visuele check op preview-URL (pencil-positie bij dose+notes, lege chatruimtes-pane, allergen-lijst-render).
- ⬜ Eventueel `eerste_hapjes_state.allergen_state` jsonb opschonen als legacy keys later toch gaan irriteren (apart UPDATE-script).
- ⬜ Branch `uitwerken-profiel` later mergen naar `main` als de hele profiel-uitbouw klaar is.

---

## 2026-05-26 — Profiel-refactor V2.7.0 + V2.8.0 (branches `ragbot-via-profiel` & `profiel-update` → main)

**Context**: Twee opeenvolgende productie-releases die het profiel als centrale plek positioneren. V2.7.0 unificeerde de headers en bracht nickname/avatar inline op `/profiel`. V2.8.0 verplaatste de laatste resten van de oude "Instellingen"-modal (memory-toggle + GDPR) naar `/profiel` en sloopte de modal in HapjesHeld 2.0 volledig.

### Vandaag afgerond — V2.7.0 (branch `ragbot-via-profiel`, merge `710c226`)
- ✅ **Nickname & avatar inline** op `/profiel` onder "Account" (popup weg). Live preview via blob-URL + `processImageForUpload` (EXIF-strip + resize) blijven behouden.
- ✅ **Headers van `chat.html` + `admin-chat.html`** gerefactord naar het SPA-header-patroon (`header-inner > header-title + header-user`). Inline `.chat-header*` / `.admin-header*` CSS-blokken + BETA/Admin-badges + user-email verwijderd. Hamburger blijft in `.header-left` (alleen mobiele-app gebruikt hem).
- ✅ **Avatar in chat/admin-header** navigeert naar `/#/profiel` (was: profile-modal openen). `openProfileModal`-import uit `headerAvatarStandalone.js` weg.
- ✅ **Reeds geïntroduceerde allergenen** op profiel-kindkaart (label was "Geïntroduceerd via HapjesHeld" — feitelijk fout). Data komt uit `eerste_hapjes_allergen_doses` (zelfde tabel als "Allergenen introduceren"-feature).
- ✅ **RAG-bot krijgt `introduced_allergens` mee**: `api/_lib/profile.mjs` doet 4e parallel-query op `eerste_hapjes_allergen_doses`, bouwt `introMap` per kind, en `formatProfileForPrompt()` zet `reeds geïntroduceerde allergenen: …` in de profile-summary.
- ✅ **Cache-buster** 2.6.3 → 2.7.0 over alle HTML/JS.

### Vandaag afgerond — V2.8.0 (branch `profiel-update`, merge `376cbae`)
- ✅ **"Voorkeuren & privacy"-sectie onderaan `/profiel`**: memory-toggle met 300ms-debounce autosave (`PUT /api/profile`) + Download data (`GET /api/me`) + Verwijder account (`DELETE /api/me` met dubbele bevestiging: `confirm()` + typ "VERWIJDER").
- ✅ **"Mijn profiel"-knop + `#profile-modal`** verwijderd uit `chat.html`. `#memory-modal` blijft. Inline `.memory-toggle` + `.pf-email-readonly` CSS in chat.html nu dood; niet aangeraakt (geen impact, opruimen kan later).
- ✅ **`js/chat.js` opgeschoond**: DOM-refs (`btnProfile`, `profileModal`, `pfEmail`, `pfMemory`, `pfSave`, `pfCancel`), `openProfileModal`/`closeProfileModal`/`saveProfile` functies, profile-modal event-handlers, en GDPR-handlers (`pfExport`, `pfDelete`) allemaal weg. `loadProfile()` blijft enkel voor de quota-bar (verbruikt `data.usage`).
- ✅ **`js/components/profiel.js`** uitgebreid: interne `fetchChatProfile()` haalt `chat_user_profiles.memory_enabled` via `/api/profile` GET, `bindInstellingenSection()` regelt autosave/export/delete. Alle 3 plekken die `renderPage()` aanroepen (init + na kind-save + na kind-delete) parallel uitgebreid met `fetchChatProfile()`.
- ✅ **Styling**: `.profiel-memory-toggle`, `.profiel-memory-label`, `.profiel-privacy-block`, `.profiel-privacy-title`, `.profiel-privacy-actions` toegevoegd aan `styles.css`.
- ✅ **Cache-buster** 2.7.0 → 2.7.1 → 2.8.0 (productie-bump op merge).

### Beslissingen
- **Memory-toggle = autosave (300ms debounce)** ipv "Opslaan"-knop. Past bij dieet-chips-patroon op dezelfde pagina.
- **GDPR-acties blijven `confirm()` + `prompt("VERWIJDER")`** in plaats van een custom modal — dubbele bevestiging via browser-native dialogen is bewust kort en hard om per-ongeluk-klikken te voorkomen, en consistent met de oude flow.
- **`loadProfile()` in chat.js NIET verwijderen** ondanks dat het modaal weg is. Het is dual-purpose: profile *en* `usage`-data voor de quota-bar. `currentProfile`-state is wel weg.
- **`fetchChatProfile()` lokaal in profiel.js** ipv toevoegen aan `communityApi.js` — `/api/profile` is geen community-endpoint, en de enige caller is profiel.js. Geen abstractie voor 1 call.

### Niet vergeten
- Inline CSS-resten `.memory-toggle` en `.pf-email-readonly` in `chat.html` zijn nu dode classes — eventueel weghalen bij een toekomstige opschoning van chat.html inline-styles.
- `js/CLAUDE.md` bijgewerkt: chat.js-rol (modal weg) + nieuwe `profiel.js`-rij in components-tabel.

### Open / nog te doen
- ⬜ Productie-rooktest na deploy van `376cbae`: memory-toggle autosave, download data, account-verwijdering (test-account), avatar-klik in chat/admin-header → /#/profiel.
- ⬜ Branch `uitwerken-profiel` (uit eerdere sessie) staat nog open met SQL-migratie-todo voor `kippen-ei` / dedup. Apart afhandelen.

---

## 2026-05-27 — Tijdlijn-optimalisaties V2.9.0 (branch `tijdlijn-optimalisatie` → main)

**Context**: Afrondingssprint voor de web-app vóór de overstap naar mobiele app-ontwikkeling. Vier gerichte verbeteringen aan de community-tijdlijn en admin-tools.

### Vandaag afgerond (merge `b31ac4b`)

- ✅ **SQL-fix chatruimtes volgen**: `CREATE POLICY IF NOT EXISTS` niet geldig in PG15 — `IF NOT EXISTS` verwijderd uit beide policies (`chat_room_followers`, `chat_topic_followers`). Migratie `2026-05-26-chat-follow.sql` nu correct.
- ✅ **Chatruimtes volgen** in tijdlijn: nieuwe tabellen `chat_room_followers` + `chat_topic_followers` (PK `user_id/room_id` resp. `user_id/topic_id`, `last_read_at` kolom). Tijdlijn toont updates van gevolgde rooms/topics.
- ✅ **Composer admin-only**: textarea + foto-knop + poll-knop + "Plaats"-knop verborgen voor gewone gebruikers. Alleen admins kunnen nog posten op de tijdlijn.
- ✅ **Notificatiebel verplaatst naar app-header**: SVG-belicoon in salie-groen (`--color-secondary-dark`) met rood badge (`#e53935`). Polling 60s + visibilitychange. Werkt op alle pagina's.
  - `header.js` bevat nu alle bell-logica (`initBell`, `startBellPolling`, `refreshBellCount`, `setBellBadge`, `refreshBellList`, `navigateToPost`, `renderNotifRow`).
  - `headerBellStandalone.js` — nieuwe module voor pagina's buiten de SPA (`chat.html`). Exporteert `mountHeaderBell(container)`.
  - `chat.html` krijgt `<span id="header-bell-mount">` + import van `mountHeaderBell`.
- ✅ **Reports queue** uit tijdlijn → nieuw **"Chat"-tabblad** in `admin-chat.html`:
  - Lazy-load bij eerste klik op tab.
  - "Niets doen" (sluit melding) + "Verwijder bericht" (verwijdert content + sluit melding) met `window.confirm()`.
  - Vernieuwen-knop.
  - `authedPost()` helper toegevoegd aan `js/admin-chat.js`.
- ✅ **Nav admin-dropdown**: "Admin dashboard" linkt nu direct naar `/admin-chat.html` (was: dode SPA-hash-route `#/admin-dashboard`). `adminDashboard.js` verwijderd.
- ✅ **Cache-buster** 2.8.0 → 2.9.0.

### Beslissingen
- **Composer verbergen** i.p.v. blokkeren via API: snelste UX, API heeft al auth-check voor admin-acties.
- **Bell in `header.js`** (SPA) + aparte `headerBellStandalone.js` (non-SPA): zelfde HTML/logica, maar standalone-versie navigeert bij notificatieklik naar `window.location.href = '/'` (volledige navigatie naar SPA) i.p.v. in-page hash-routing.
- **Lazy-load reports in admin-chat**: past bij het patroon van de andere tabs (data pas laden wanneer nodig), vermijdt onnodige API-call bij elke pageload voor zelden bezochte tab.

---

## 2026-05-27 — V3.0.0 Release — Webplatform voltooid, start mobiele app

**Context**: Officiële afsluiting van het web-platform als v3.0.0. Alle kernfunctionaliteit is live. Volgende fase = implementatie van alle features in de mobiele app (React Native / Expo of vergelijkbaar). De web-app blijft productie-waardig draaien en wordt parallel onderhouden.

### Volledig overzicht V1 → V2 → V3

#### V1.0.0 — Weekschema & Receptenboek (april 2026)
Kern van de app: het originele recepten- en weekschema-platform.
- Receptenbeheer: CRUD, bulk-import via CSV/JSON, ingrediënt-iconen.
- Weekschema-generator met AI (Anthropic Claude).
- Boodschappenlijst met porties.
- Favorieten en opgeslagen schema's.
- Admin-systeem + gebruikersauthenticatie (email/wachtwoord, Supabase Auth).
- Wachtwoord-reset via Resend.
- Betalingsintegratie: Plug&Pay webhook → `allowed_users` + `subscriptions`.

#### V2.0.0 — HapjesHeld 2.0 RAG-chat + Community platform (april 2026)
Twee grote uitbreidingen bovenop het receptenboek.

**HapjesHeld 2.0 (RAG-chatbot)**
- AI-chatbot met Retrieval-Augmented Generation (Anthropic Claude + Voyage AI embeddings).
- Kennisbank van Pril Leven-content als vectorbasis.
- Gespreksgeheugen per gebruiker (`memory_enabled`-toggle).
- Quota-tracking (tokens in/uit, kosten per gebruiker).
- Admin-dashboard (`/admin-chat.html`): globale stats, gebruikersoverzicht, recente vragen, fallback-antwoorden, abonnement-events.

**Community tijdlijn**
- Posts (tekst + 1 foto, EXIF-strip client-side, max 5MB).
- Categorieën: `vraag`, `tip`, `mijlpaal`, `voeding`, `slapen`, `algemeen` + filterbalk.
- Replies (1 niveau).
- Likes (teller, geen ledenlijst).
- Pinned posts (admin, max 5).
- Polls: 2–4 opties, 1 stem per user, sluit na 7 dagen. Multi-vote + unvote later toegevoegd.
- Moderatie: woord-blacklist (server-side, `api/_lib/moderation.mjs`) + rapporteer-knop → reports queue.
- In-app notificaties: badge + dropdown, polling 60s, "reply op je post" + "like".
- Nickname verplicht bij eerste actie; email nooit zichtbaar voor andere users.
- Admin kan posten pinnen via tijdlijn.

#### V2.5.x — Allergenen-introductieflow (mei 2026)
- Eerste hapjes: stap-voor-stap introductie van 9 allergenen (kippen-ei, pinda, noten, vis, schaaldieren, koemelk, tarwe, soja, sesam).
- Doses/introducties bijhouden (max 3 per allergeen).
- Symptomen loggen via stoplicht (mild / twijfel / ernstig).
- Pauze-flow bij twijfel/ernstige reactie + arts-toezicht modus.
- Foto's per introductie.
- Setup-tegels met foto-achtergrond; accordeon-UI met smooth fade.

#### V2.6.x — Chatruimtes (mei 2026)
- Categorische chat rooms: Melk & voeding, Eerste hapjes, Allergieën, Feedback.
- Topics per room met replies (1 niveau).
- Admin-intro per ruimte met avatar in het eerste bericht.
- Admin kan room-intro live bewerken (`PATCH /api/chat-rooms/:slug`).
- Per-room topic-cache (TTL 2 min) voor instant rendering bij terug-navigatie.
- Landing-page volledige browserbreedte via `:has()`-hook + `body.is-hub`.

#### V2.7.0 — Profiel geunificeerd (mei 2026)
- Nickname & avatar inline bewerken op `/profiel` (geen aparte popup meer).
- Headers van `chat.html` + `admin-chat.html` gerefactord naar SPA-header-patroon.
- Avatar navigeert naar `/#/profiel` op alle pagina's.
- RAG-bot krijgt geïntroduceerde allergenen mee in de profiel-context.

#### V2.8.0 — Privacy & geheugen naar /profiel (mei 2026)
- Memory-toggle (autosave 300ms debounce) op `/profiel`.
- Download persoonlijke data (`GET /api/me`).
- Account verwijderen (dubbele bevestiging: `confirm()` + typ "VERWIJDER").
- Profiel-modal in `chat.html` volledig verwijderd.

#### V2.9.0 — Tijdlijn-optimalisaties + admin-tools (mei 2026)
- Composer tijdlijn admin-only (gewone gebruikers kunnen niet meer posten).
- Notificatiebel naar app-header (SVG groen, rood badge, alle pagina's).
- Reports queue als "Chat"-tabblad in `/admin-chat.html` (lazy-load).
- Chatruimtes volgen: rooms + topics opvolgen in de tijdlijn.
- Nav admin-dropdown linkt direct naar `/admin-chat.html`.

### Huidige productie-staat (V3.0.0)
- **URL**: https://community-web.prilleven.be
- **Cache-buster**: `?v=2.9.0`
- **Supabase project**: `ynrdoxukevhzupjvcjuw`
- **Vercel project**: `pril_leven_community` (team: `prilleven-community`)
- **Actieve branches**: `main` = productie. Branch `uitwerken-profiel` heeft nog open SQL-todo (`kippen-ei` dedup).

### Volgende fase — V3.x Mobiele app
Alle bovenstaande features worden overgezet naar de mobiele app. De web-app blijft actief als referentie-implementatie en productie-platform.

**Prioriteitsvolgorde voor mobiel (te verfijnen):**
1. Auth (login/logout, session-handling in app)
2. Weekschema + recepten (kernfunctie)
3. HapjesHeld 2.0 chat
4. Community tijdlijn (lezen + reageren)
5. Allergenen-flow
6. Chatruimtes
7. Notificaties (push i.p.v. polling)

### Nog open op web vóór V3.1
- ⬜ SQL-migratie `kippen-ei`/dedup uitvoeren (branch `uitwerken-profiel`).
- ⬜ Inline CSS-resten `.memory-toggle` + `.pf-email-readonly` in `chat.html` opruimen.
- ⬜ Vercel Company Name corrigeren naar `Anneleen Plettinx`.
- ⬜ Vercel Observability Plus overwegen uit te zetten (ongebruikt, extra kosten).
