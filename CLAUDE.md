# CLAUDE.md — Pril Leven

Dit bestand geeft Claude Code (en andere AI-assistenten) de context om effectief in dit project te werken. Lees dit ALTIJD eerst voordat je code wijzigt.

---

## 1. Project in 1 alinea

**Pril Leven** is een betaalde web-app voor (jonge) ouders met een **weekschema/receptenboek**, een **community/timeline**, en een **AI-chatbot (RAG)** die vragen beantwoordt op basis van de Pril Leven content. Doelgroep is Nederlandstalig (Vlaanderen). Gebruikers loggen in met email; toegang is afhankelijk van een actieve betaling (gecheckt via Plug&Pay webhook).

---

## 2. Tech stack

- **Frontend:** Vanilla HTML/CSS/JS (ES modules). **Géén framework, géén build step, géén TypeScript.**
- **Backend:** Vercel Functions (Node.js, `.mjs` files in `/api`).
- **DB + Auth + Storage:** Supabase (Postgres + RLS).
- **AI:** Anthropic SDK (`@anthropic-ai/sdk`) voor chat, Voyage AI voor embeddings (RAG).
- **Hosting:** Vercel (zie `vercel.json`).
- **Betalingen:** Plug&Pay (webhook → `allowed_users` / `subscriptions` tabel).
- **Plan-niveau:** Vercel **Pro** + Supabase **Pro**. Geen Hobby-limieten op functions, executions, DB-grootte etc. — niet zelf gaan optimaliseren voor die limieten.

Node ≥ 20.

---

## 3. Mappenstructuur

```
/                          → static site root (geserveerd door Vercel)
  index.html               → app shell (SPA-routing via rewrite naar index.html)
  chat.html                → chat-interface
  admin-chat.html          → admin chat-overzicht
  privacy.html, delete-account.html
  script.js                → app entry (login flow, init)
  styles.css               → ALLE styling staat hier (groot bestand, salie-groen thema)

/js                        → frontend modules (ES modules)
  store.js                 → localStorage + state
  supabase.js              → Supabase fetch helpers
  router.js                → SPA-router
  utils.js
  chat.js, admin-chat.js
  communityApi.js
  headerAvatarStandalone.js
  /components              → UI componenten (header, nav, recipeCard, weekSchedule, timeline, ...)
  /content                 → statische content-modules (bv. eerste-hapjes microlearning)

/api                       → Vercel Functions (.mjs)
  chat.mjs                 → AI chat endpoint (RAG)
  community.mjs            → community/timeline (catch-all via rewrite)
  conversations.mjs, conversations/[id].mjs
  me.mjs, profile.mjs, memory.mjs
  admin.mjs
  subscription-status.mjs
  /webhooks/plugpay.mjs    → betalingswebhook
  /_lib                    → gedeelde helpers (auth, clients, model-router, retrieve, rate-limit, ...)

/supabase-migrations       → SQL-bestanden, naamgeving: YYYY-MM-DD-<beschrijving>.sql
/scripts                   → utility scripts (geen prod code)
/tools, /fotos, /recepten boeken
/mockups                   → design-iteraties (HTML mockups), gitignored, lokaal werkbestand
```

---

## 4. Conventies (BELANGRIJK)

### Algemeen
- **Taal:** alles in het **Nederlands** (UI, foutmeldingen, commit messages, comments waar nodig).
- **Stijl:** salie-groen (`#...` — zie `styles.css`), zachte UI, ronding, subtiele schaduwen. Pas geen kleuren aan zonder bevestiging.
- **Geen frameworks toevoegen.** Geen React, Vue, Tailwind, Next.js, build tools, TypeScript. Vanilla JS blijft vanilla JS.
- **Geen overengineering.** Kleine, gerichte wijzigingen. Geen refactors "voor de zekerheid".

### Frontend
- ES modules met `<script type="module">`.
- State via `js/store.js` (localStorage wrapper) — gebruik `Store.getCurrentUser()` etc.
- Supabase calls via `supabaseFetch()` helper in `js/supabase.js`.
- Cache-buster in HTML: alle `<script>` en `<link>` tags hebben `?v=X.Y.Z`. **Bij elke deploy met JS/CSS wijziging: bump deze versie** in alle HTML-bestanden (`index.html`, `chat.html`, `admin-chat.html`, etc.).

### Backend (`/api/*.mjs`)
- ESM (`.mjs`), default export = handler.
- Auth via helpers in `api/_lib/auth.mjs`.
- Supabase service-role key alleen server-side (nooit naar client).
- `maxDuration: 30` (zie `vercel.json`).
- Rate-limit endpoints die LLM/embeddings aanroepen (`api/_lib/rate-limit.mjs`).

### Database / Supabase
- Migraties als losse SQL-files in `supabase-migrations/` met datum-prefix.
- **RLS staat overal aan.** Bij nieuwe tabellen: altijd policies toevoegen.
- Anon key mag alleen lezen wat publiek hoort. Schrijfacties via service-role in een Vercel Function.
- Views voor admin-data (zie `community-admin-view-email.sql`).

### Git / commits
- Commit messages in **Nederlands**, kort en concreet (zie recente commits).
- Voorbeeld: `Polls: multi-vote + unvote, en notificaties klikbaar`
- Geen "chore:" / conventional commits — gewoon natuurlijke taal.
- Branch `main` = productie. Voor grotere features: feature branch (zie huidige `chat-interface`).

---

## 5. Werkwijze met Claude

### Wat Claude WEL mag doen zonder vragen
- Bestaande bugs fixen die duidelijk zijn.
- Bestanden lezen om context op te bouwen.
- Kleine UI-tweaks die ik expliciet vraag.
- SQL migratie schrijven volgens bestaand patroon.
- geef deze sql altijd in de Claude code chat zodat ik deze meteen kan kopiëren.
- Cache-buster bumpen na JS/CSS wijziging.
- **CLAUDE.md's automatisch bijwerken** wanneer er iets wijzigt dat toekomstige sessies moet kennen: nieuwe tabel/endpoint/conventie, nieuwe env-var, nieuwe valkuil, of gedrag dat afwijkt van wat er nu in CLAUDE.md staat. Update de meest specifieke (submap-)CLAUDE.md, niet de root, tenzij het écht project-breed is. Wees beknopt — voeg één regel of bullet toe, geen lange uitleg.
- **Waarschuwen wanneer het tijd is voor `/eind-sessie`.** Triggers waarop ik proactief moet melden "tijd voor `/eind-sessie`":
  - De sessie is lang en heeft veel file-edits / tool-calls gehad (sessie voelt "vol").
  - Een feature of taak is volledig afgerond en er ligt een logisch afsluitpunt.
  - Er zijn meerdere CLAUDE.md-waardige learnings opgestapeld die nog niet zijn gesynct.
  - Ik merk dat antwoorden trager worden of context verloren raakt.
  - De gebruiker zegt iets als "morgen verder", "even pauze", "voor vandaag genoeg".
  Bij een trigger: één korte zin, bv. *"Tip: dit is een goed moment voor `/eind-sessie` — feature X is afgerond en er staan een paar learnings klaar voor de docs."* Niet pushen — gewoon één keer melden en dan doorwerken als de gebruiker het negeert.

### Wat Claude EERST moet vragen
- Nieuwe dependency toevoegen aan `package.json`.
- Database schema wijzigingen die bestaande data raken.
- Wijzigingen aan auth/login flow.
- Wijzigingen aan de webhook (`api/webhooks/plugpay.mjs`).
- Refactors die meer dan 2-3 bestanden raken.
- Nieuwe API endpoints toevoegen.
- Kleuren of design-systeem aanpassen.

### Wat Claude NOOIT doet
- Een framework introduceren of een build step toevoegen.
- TypeScript introduceren.
- `node_modules` of lockfile met de hand wijzigen.
- Pushen naar `main` zonder bevestiging.
- Secrets of `.env.local` lezen/wijzigen/committen.
- "Voor de zekerheid" code refactoren die ik niet vroeg.
- Tests, docstrings of comments toevoegen aan code die ik niet wijzig.

---

## 6. Veelgebruikte taken — recept

**Nieuwe Supabase migratie:**
1. Maak `supabase-migrations/YYYY-MM-DD-<beschrijving>.sql`.
2. Schrijf SQL idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE POLICY IF NOT EXISTS` etc.).
3. Voeg RLS-policies toe.
4. Vermeld in de chat dat ik de SQL nog handmatig in de Supabase dashboard moet draaien (er is geen automatische migrate-pipeline).

**Frontend feature toevoegen:**
1. Nieuwe component in `js/components/`.
2. Importeren waar nodig.
3. Stijlen toevoegen onderaan `styles.css` met duidelijke sectie-comment.
4. Cache-buster bumpen in alle HTML-bestanden.

**Nieuwe API endpoint:**
1. Bestand in `/api/<naam>.mjs` met default export handler.
2. Auth check via `api/_lib/auth.mjs`.
3. Rate-limit als het LLM/Voyage aanroept.
4. Indien dynamische subroutes nodig: gebruik `[param].mjs` patroon (zie `conversations/[id].mjs`).

**Deploy:**
- Push naar `main` → automatische productie-deploy via Vercel.
- Voor preview: push naar feature branch.

---

## 7. Belangrijke env-vars (in `.env.local`, nooit committen)

```
ANTHROPIC_API_KEY
VOYAGE_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Op Vercel zelf staan deze al ingesteld via project settings.

---

## 7b. Tooling — MCP's en slash commands

**MCP-servers** (geconfigureerd in `.mcp.json`, gitignored — zie `.mcp.json.example` als template):
- **Supabase MCP** — read-only, project-scoped op `ynrdoxukevhzupjvcjuw`. Voor schema-introspectie, RLS-checks, queries.
- **Vercel MCP** — OAuth, alle Vercel-projecten. Voor deployments, logs, env-vars.

**Vercel-context:** Team = `prilleven-community`. Projecten: `pril_leven_community` (productie, https://community-web.prilleven.be) en `pril-leven-web` (functie nog te bevestigen).

**Slash commands** (in `.claude/commands/`):
- `/start-sessie` — leest PLAN-TIMELINE + git, vat status samen, stelt voor wat te doen.
- `/eind-sessie` — sync docs, update PLAN-TIMELINE, genereer handover-prompt.
- `/update-docs` — sync CLAUDE.md's met sessie-wijzigingen.
- `/deploy-check` — pre-deploy sanity check (cache-buster, migraties, env-vars, gevoelige bestanden).

---

## 8. Bekende gevoeligheden / valkuilen

- **Cache-buster vergeten** = gebruikers zien oude JS/CSS. Altijd bumpen.
- **HTML cache headers staan op no-cache, JS/CSS op s-maxage 1 jaar** (zie `vercel.json`). Daarom is de cache-buster query string essentieel.
- **`allowed_users` vs `subscriptions`**: `allowed_users` is de huidige toegang, `subscriptions` houdt de geschiedenis bij. Webhook update beide.
- **RLS-fouten verschijnen als lege response** — niet als error. Bij "data komt niet binnen": eerst RLS-policy checken.
- **Community routes** lopen via 1 catch-all rewrite naar `/api/community` — die functie doet zelf de routing.
- **Admin-detectie** heeft een fallback (zie commit `845bd27`); breek deze niet.

---

## 9. Wat je NIET hoeft te doen

- Geen TypeScript types schrijven.
- Geen tests toevoegen tenzij ik er expliciet om vraag.
- Geen JSDoc op alles plakken.
- Geen README.md schrijven of bijwerken tenzij gevraagd.
- Geen "verbetervoorstellen" doen tenzij ik erom vraag — focus op de taak.

---

## 10. Communicatiestijl

- Antwoord in het **Nederlands**.
- Wees beknopt. Geen lange inleidingen.
- Bij twijfel: vraag, ga niet gokken.
- Bij meerdere mogelijke aanpakken: kort de opties geven, niet zelf kiezen.
- Geen tijdsschattingen ("dit duurt 5 min").
