# CLAUDE.md — `/api` (Backend / Vercel Functions)

Vercel Functions voor Pril Leven. Lees eerst de root `CLAUDE.md`; dit bestand voegt enkel backend-specifieke regels en endpoint-details toe.

---

## 1. Bestandsformaat

- Alle endpoints zijn `.mjs` (ES modules).
- Default export = handler: `export default async function handler(req, res) { ... }`.
- Geen TypeScript, geen build step.
- `maxDuration: 30` is project-breed gezet (zie `vercel.json`).
- Dynamische subroutes via `[param].mjs` (zie `conversations/[id].mjs`).
- Catch-all routes via een rewrite in `vercel.json` (zie `community.mjs`).

---

## 2. Endpoint-overzicht

### `chat.mjs` — POST `/api/chat`
De **AI-chat** (HapjesHeld). Hot path, kostbaar. **Niet aanpassen zonder bevestiging.**
- Body: `{ question, conversation_id?, image_b64?, image_mime? }`
- Vereist `Authorization: Bearer <supabase-jwt>`.
- Flow: auth → subscription gate → rate-limit + cost cap (uur/dag/maand + image cap) → load profile → load/create conversation → cache check → retrieval (Voyage embed → `match_documents` RPC + `match_user_memory` RPC + age-fallback) → out-of-scope fallback → `pickModel()` (Haiku of Sonnet) → Anthropic call met conversation history → store messages → cache antwoord (alleen tekst, géén foto-vragen) → log usage → memory-extract (Haiku → `chat_user_memory`).
- Foto-flow (vision): Haiku extraheert eerst ingrediënten als zoekstring, dan Sonnet genereert het antwoord. Foto-bytes worden NOOIT in DB opgeslagen (`had_image=true` flag enkel).
- System-prompt staat hardcoded in dit bestand — toon = warm, geruststellend, NL, geen markdown, alleen info uit retrieval-context.

### `community.mjs` — `/api/community/*` (catch-all)
Alle community endpoints lopen via één function (Vercel Hobby function-limit). Rewrite: `/api/community/(.*) → /api/community`.
Interne routes (in `matchRoute()`):
- `GET/PUT /profile` — community-profiel (nickname, avatar)
- `POST /profile/avatar-url` — signed avatar upload-URL
- `GET/POST /posts` — feed lijst + create
- `PATCH/DELETE /posts/:id` — bewerken (15 min) / verwijderen
- `GET/POST /posts/:id/replies`
- `PATCH/DELETE /replies/:id`
- `POST /posts/:id/like` + `POST /replies/:id/like`
- `POST /posts/:id/poll/vote` — body: `{ option_idx, action: 'set'|'toggle'|'unvote' }`
- `POST /upload-url` — signed image upload-URL voor posts
- `POST /report` — body: `{ target_type, target_id, reason }`
- `GET /notifications` + `POST /notifications/read`
- `GET /app-badges?since=` — server-side tijdlijn-badge-teller (posts+replies+gevolgde topics, admin/gevolgd-telregel + 6-weken-vervaltermijn). Zie `countTimelineBadge` in `_lib/badges.mjs`.
- **App-icoon-push (v3.2.0):** `POST/DELETE /push/register` (Expo-push-token opslaan/wissen in `push_tokens`) + `PUT /badge-state` (spiegelt `timeline_seen_at`/`chatrooms_seen_at`/`topic_reads` naar `user_badge_state` zodat de server bij een push het absolute app-icoon-getal per ontvanger kan berekenen). Bij een nieuwe post/reply triggert `posts.create`/`replies.create` de push via `notifyNewActivity()` uit `_lib/push.mjs`.
- **Admin (vereist `requireAdmin`):**
  - `POST /posts/:id/pin` (max 5 gepinned)
  - `GET /admin/reports`
  - `POST /admin/reports/:id/resolve` (body: `{ delete_target?: bool }`)
- Pad-detectie: gebruikt `req.query.path` (Vercel auto-parse), valt terug op `req.url` parsing.
- Alle endpoints: `requireAuth` upfront, `findBlockedWord()` op alle user-content, image-paden moeten beginnen met `<userId>/`.

### `chat-rooms.mjs` — `/api/chat-rooms/*` (catch-all)
Chatruimtes (topics + replies + admin). Eén function, rewrite: `/api/chat-rooms/(.*) → /api/chat-rooms`. Routing in `matchRoute()`. Belangrijkste routes:
- `GET /` — alle rooms (lijst met counts)
- `GET /:slug` — room + recente topics
- `PATCH /:slug` — admin-only: room-intro (`title`, `description`) bewerken
- `GET/POST /:slug/topics` + `PATCH/DELETE /topics/:id`
- `GET/POST /topics/:id/replies` + `PATCH/DELETE /replies/:id`
- `POST /topics/:id/pin` (admin)
- Alle endpoints: `requireAuth`, `findBlockedWord` op user-content, admin via `requireAdmin`.
- **App-icoon-push (v3.2.0):** `topic.create` en `reply.create` triggeren `notifyNewActivity('chatroom_topic'|'chatroom_reply', ...)` uit `_lib/push.mjs` (defensief — breekt de create nooit).

### `webhooks/plugpay.mjs` — POST `/api/webhooks/plugpay`
**KRITISCH endpoint — NOOIT aanpassen zonder expliciete bevestiging.** Foutieve wijziging = users zonder toegang.
- Authenticatie: HMAC-SHA256 (`PLUGPAY_WEBHOOK_SECRET`) **OF** Bearer token (`PLUGPAY_WEBHOOK_BEARER`). Als beide leeg → trust-mode (dev only, met warning log).
- Type-bepaling 3-traps: URL `?type=` → body `event/event_type/type/action` → heuristiek.
- Categorieën: `activated` | `cancelled` | `expired` | `unknown`.
- Schrijft naar `allowed_users` (upsert bij activated, update anders) **én** `subscription_events` audit-log.
- Roept `invalidateSubscriptionCache(email)` aan na success.
- Ook GET = health-check (returnt JSON met hint).
- **De payload bevat géén abonnementsgegevens** (vastgesteld 2026-07-31 op de audit-tabel): het is een CRM-workflow-melding met enkel contactvelden — geen bedrag, cyclus, product of `next_billing_date`. `cycle` komt volledig uit de URL-parameter, die op één workflow staat en dus voor iedereen `monthly` is. Gevolg: `computeEndDate()` geeft élke klant +30 dagen, ook jaar- en kwartaalklanten. `detectCycle()` kent bovendien geen `quarterly`. Niet in code op te lossen — Plug&Pay moet de echte datum of de cyclus meesturen.

### `_lib/subscription.mjs` — `effectiveExpiry(endDate)`
Bepaalt wanneer toegang écht vervalt; enige plek waar dat wordt beoordeeld (`getAccessStatus` bedient web én mobiele app). Twee correcties op de ruwe `subscription_end_date`: toegang loopt tot het **einde** van die dag (Plug&Pay levert een datum zonder tijd), en een einddatum in het **weekend schuift naar de dinsdag erna** — SEPA-incasso's worden enkel op bankwerkdagen aangeboden. Daarom staat in `allowed_users.subscription_end_date` bewust de kale incassodatum, zonder marge.

### `me.mjs` — `/api/me`
GDPR-endpoints voor de huidige user.
- `GET` → JSON-export download (alle data: profiel, conversations, messages, memories, subscription, events).
- `DELETE` → right-to-be-forgotten: verwijdert chat-data + ratings/comments anonimiseren (worden 'Anoniem') + favorites/schedules verwijderen + `auth.users` deactiveren. `allowed_users` rij blijft (audit + re-activatie).

### `profile.mjs` — `/api/profile`
- `GET` → `{ profile, usage, imageUsage }` (chat user profile + maand-/dag-tellers).
- `PUT` → upsert via `sanitizeProfileInput()`. Whitelist: `display_name`, `children[]`, `diet[]` (uit ALLOWED_DIET set), `allergies[]`, `notes`, `memory_enabled`.

### `memory.mjs` — `/api/memory`
- `GET` → lijst eigen memories (sortering: importance desc, created desc).
- `DELETE` → alles van user.
- `DELETE ?id=<uuid>` → één specifieke (ownership-check via combined where).

### `conversations.mjs` — `/api/conversations`
- `GET` → lijst (sidebar).
- `POST` → maak nieuwe lege.

### `conversations/[id].mjs` — `/api/conversations/<id>`
- `GET` → conversatie + alle messages (chronologisch).
- `PATCH` → rename (body: `{ title }`, max 80 chars).
- `DELETE` → verwijder (cascade naar messages via FK).

### `subscription-status.mjs` — GET `/api/subscription-status?email=…`
**Publiek** endpoint (geen auth) — front-end pingt elke 2 minuten. Returnt enkel non-sensitive velden: `{ active, reason, end_date, is_admin }`.

### `admin.mjs` — GET `/api/admin?section=…`
Admin dashboard. Vereist `requireAdmin`. Sections: `global`, `users`, `queries`, `events`, `conversations` (per email), `chunks` (per ids), `fallbacks`.

### `aanraders.mjs` — `/aanraders*` (catch-all, **publiek, server-rendered HTML**)
De affiliatepagina. Wijkt bewust af van elk ander endpoint hier:
- **Geen auth.** Enige publieke, niet-ingelogde pagina van de site. Dat is het punt: SEO-indexeerbaar en deelbaar.
- **Geeft HTML terug, geen JSON.** Nodig omdat de rest van de site een hash-router achter login is en Google `#/`-URL's niet indexeert.
- **Rewrites in `vercel.json`** (`/aanraders` + `/aanraders/:path*`) staan **vóór** de SPA-catch-all — Vercel neemt de eerste match.
- Routes in `matchRoute()`: `overzicht`, `categorie` (`/c/:slug`), `product` (`/p/:slug`). Onbekend → echte 404-pagina, geen leeg skelet.
- Styling via `/aanraders.css` (eigen bestand, tokens uit `styles.css`) met eigen `CSS_VERSION`-constante als cache-buster — **niet** de app-versie in de HTML-bestanden.
- `esc()` op elke DB-waarde, `safeUrl()` laat enkel http(s) door als href.
- Affiliate-links: altijd `rel="sponsored nofollow noopener"` + `target="_blank"`.
- `Cache-Control: s-maxage=300, stale-while-revalidate=86400`. Vercel consumeert `s-maxage` op de edge en stuurt de browser `max-age=0` — dat is correct, geen bug.
- Het pad staat in de constante `BASE`; omdopen = `BASE` + de twee rewrites, en alleen doen vóór publieke lancering.
- **`CANONICAL_ORIGIN` = `https://community.prilleven.be`** — canonical, `og:url` en de sitemap gebruiken altijd die constante, nooit de request-host. Anders leeft dezelfde pagina op `community-web.prilleven.be` én elke preview-URL. Het nieuwe domein moet als extra domein aan het Vercel-project hangen; `community-web` blijft daarnaast werken.
- **SEO (stap 9)**: `/robots.txt` is een statisch bestand in de root (de SPA-catch-all slaat paden mét punt over, dus die wordt gewoon geserveerd). `/sitemap.xml` loopt via de rewrite `→ /api/aanraders?sitemap=1` — de query overleeft een rewrite betrouwbaarder dan het pad — en wordt afgehandeld vóór de fragment-check in de `isApiPad()`-tak. Categorieën op `binnenkort` staan bewust niet in de sitemap.
- **JSON-LD** via `layout({ jsonld })`: overzicht en categorie krijgen `CollectionPage` + `ItemList`, product krijgt `Product` + `BreadcrumbList`, overal met de gedeelde `ORGANISATIE`-node via `@id`. **`Product` heeft bewust geen `offers`** — er staan geen prijzen op de pagina en een verzonnen prijs is een structured-data-overtreding. `jsonLdScript()` escapet elke `<` naar `<`, anders breekt een titel met `</script>` erin de pagina open.
- **Zoeken + filters (stap 8)**: `renderToolbar()` zet een zoekveld en pill-groepen boven het overzicht. Een dimensie (leeftijd, categorie, materiaal, merk) verschijnt pas als de data hem rechtvaardigt — `pillGroep({minPerOptie})`: 1 voor leeftijd/categorie (echte indelingen), 2 voor merk/materiaal (anders één product per knop). Categorieën op `binnenkort` krijgen geen pil, want hun producten worden niet gerenderd. Het filteren zelf gebeurt client-side in `/aanraders-filters.js` (eigen `FILTER_JS_VERSION`), gedeeld met de in-app weergave.
- Contactadres = `CONTACT_MAIL` (footer). De Plug&Pay-checkout staat als `CHECKOUT_URL` hier én hardcoded in `index.html` (auth-modal) en `script.js` (verlopen-scherm) — bij wijziging alle drie aanpassen.

---

## 3. Helpers in `_lib/` — gebruik ze!

**Niet zelf opnieuw bouwen.** Importeer altijd:

| Bestand | Inhoud |
|---|---|
| `auth.mjs` | `requireAuth(req)`, `requireAdmin(req)`, `AuthError`. Cachet JWT-validaties 5 min. |
| `clients.mjs` | Singleton `supabase` (service-role, `persistSession: false`), `anthropic`, `VOYAGE_API_KEY`. Crasht als env var ontbreekt — bewust. |
| `subscription.mjs` | `getAccessStatus(email)` via `get_user_access` RPC, 1 min in-memory cache. `accessDeniedMessage(status)`. `invalidateSubscriptionCache(email)`. |
| `rate-limit.mjs` | `checkRateLimit`, `checkCostCap` (dag), `checkMonthlyCostCap`, `checkImageRateLimit`, `getMonthlyUsage`, `getDailyImageUsage`, `logUsage`, `hashIp`, `extractIp`. Limieten in caps bovenaan het bestand. |
| `retrieve.mjs` | `embedQuery(text)` (Voyage `voyage-3-large`, 1024-dim), `retrieveCombined(question, {userId, filterAge, ...})` met age-filter fallback (drempel `RELEVANCE_THRESHOLD = 0.55`, `AGE_FALLBACK_THRESHOLD = 0.40`). |
| `model-router.mjs` | `pickModel({ hasImage, question, topScore })` → kiest Haiku 4.5 of Sonnet 4.6. Vision/medisch/lang/laag-score → Sonnet, anders Haiku. `MEDICAL_PATTERNS` regex-lijst. |
| `cache.mjs` | `getCached(question)`, `setCached(...)`, `questionHash(q)`. Hash = SHA-256 van genormaliseerde vraag. Tikt `hits` + `last_hit_at` aan op hit. |
| `moderation.mjs` | `findBlockedWord(text)`, `containsBlockedWord(text)`. Diakritieken-genormaliseerd, woord-grenzen. |
| `conversation.mjs` | `getOrCreateConversation`, `loadConversationMessages`, `storeMessage`, `generateConversationTitle` (Haiku, max 40 chars), `setConversationTitle`, `listConversations`, `deleteConversation`, `renameConversation`. Doet expliciet user-id ownership check. |
| `profile.mjs` | `loadUserProfile`, `sanitizeProfileInput` (whitelist), `upsertUserProfile`, `ageMonths(birthdate)`, `formatProfileForPrompt(profile)`, `primaryChildAgeMonths(profile)` (jongste kind). |
| `user-memory.mjs` | `retrieveUserMemory`, `extractAndStoreMemories(userId, q, a, msgId)` — Haiku extraheert max 5 feiten, dedupeert via embedding-sim ≥ 0.92, insert in `chat_user_memory`. |
| `community.mjs` | Alle community helpers (groot bestand) — zie endpoint-overzicht hierboven. Bevat ook `loadAdminUserIds(userIds)` met fallback via `auth.admin.getUserById` als view onbeschikbaar is, en `loadBlockedUserIds(userId)`. |
| `badges.mjs` (v3.2.0) | Single source of truth voor de badge-tellingen. `countTimelineBadge(userId, since)` (posts+replies+gevolgde topics, admin/gevolgd-telregel), `countChatroomBadge(userId, since, topicReads)` (per topic nieuw topic + replies, per-topic `effectiveSince`), `computeTotalBadge(userId)` (leest `user_badge_state` → tijdlijn+chatruimtes opgeteld = het absolute app-icoon-getal voor de push). `BADGE_MAX_AGE_MS` = 6 weken (`withExpiry` ondergrens). Hergebruikt door zowel `api/community.mjs` (route `app-badges`) als `_lib/push.mjs`. Importeert `loadAdminUserIds`/`loadBlockedUserIds` uit `_lib/community.mjs` + `loadFollowedChatroomTopics` (ook hier). |
| `push.mjs` (v3.2.0) | Expo-push versturen + tokens. `upsertPushToken`/`deletePushToken` (`push_tokens`), `notifyNewActivity(kind, ctx, notif)` = hoofdingang voor de triggers: bepaalt de ontvangers (`resolveRecipients`: timeline_post→iedereen met token; timeline_reply→admins tenzij auteur admin; chatroom_topic/reply→admins + room-/topic-volgers tenzij auteur admin; steeds minus auteur + minus wie de auteur blokkeerde), berekent per ontvanger `computeTotalBadge` (uit `badges.mjs`) en stuurt één Expo-push per token (`https://exp.host/--/api/v2/push/send`, chunks van 100). Volledig defensief — gooit nooit, een push-fout mag de post/reply-request nooit breken. |

---

## 4. Verplichte patronen

### Auth (elk endpoint dat user-data raakt)
```js
let auth;
try {
  auth = await requireAuth(req);
} catch (e) {
  if (e instanceof AuthError) return json(res, e.status, { error: e.message });
  throw e;
}
// gebruik auth.userId, auth.email, auth.jwt
```
Voor admin: `await requireAdmin(req)` (check via `allowed_users.is_admin`).

### JSON helper
Elk bestand heeft een lokale `json(res, status, body)` helper bovenaan. Gebruik die ipv `res.json()` (Vercel's API verschilt subtiel). Foutmeldingen altijd in **Nederlands**.

### CORS preflight
Alle endpoints hebben:
```js
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Methods', '...');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
```

### Rate-limit (LLM/embedding endpoints)
Volg de drie-traps check uit `chat.mjs`: `checkRateLimit` → `checkCostCap` (dag) → `checkMonthlyCostCap`. Image-cap apart (`checkImageRateLimit`). Log altijd `event: 'blocked_rate_limit'` of `'query'`/`'cache_hit'`/`'query_with_image'`.

### Method check
```js
if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
```

### Body parsen
```js
const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
```
Vercel parseert JSON soms automatisch, soms niet — die ternary werkt in beide gevallen.

### Errors
- Returnt JSON `{ error: '<NL melding>' }`. Geen stack traces of interne details.
- Server-side `console.error('[<endpoint>]', err)` — verschijnt in Vercel function logs.
- Helpers gooien `Object.assign(new Error(...), { status: 422 })` zodat de handler `err.status` kan respecteren.

---

## 5. Service-role vs anon

- **Service-role** key wordt gebruikt in **alle** `/api/*` (`api/_lib/clients.mjs` → `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`). Slaat RLS over.
- User-isolatie gebeurt in **code** via expliciete `eq('user_id', userId)` checks of via ownership lookups vóór een mutation. RLS staat ook aan als backstop, maar service-role omzeilt het.
- **NOOIT** de service-role client of key naar de client lekken. Anon-key zit in `js/supabase.js` (publiek, niet geheim).

---

## 6. Env vars (verplicht aanwezig)

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY      # in alle /api functions (clients.mjs)
SUPABASE_ANON_KEY              # optioneel — auth.mjs valt anders terug op service-role
ANTHROPIC_API_KEY              # clients.mjs
VOYAGE_API_KEY                 # clients.mjs / retrieve.mjs
PLUGPAY_WEBHOOK_BEARER         # webhook (optie 1)
PLUGPAY_WEBHOOK_SECRET         # webhook (optie 2, HMAC)
```
Op Vercel ingesteld via project settings. Lokaal in `.env.local`. Crasht hard als ze in `clients.mjs` ontbreken.

---

## 7. Niet doen in `/api`

- **Geen** service-role client of key naar de client sturen.
- **Geen** zware npm dependencies toevoegen zonder afstemming (cold-start tijd).
- **Geen** `process.env` defaults hardcoderen — als env var mist: 500 met duidelijke melding.
- **Geen** lange CPU loops; offload naar cron/background als >5s.
- **Geen** sync `fs` calls op grote bestanden.
- **Geen** wijzigingen aan `chat.mjs` system-prompt zonder bevestiging (toon is afgesteld + verkeerd kost geld).
- **Geen** wijzigingen aan `webhooks/plugpay.mjs` zonder bevestiging.
- **Geen** wijzigingen aan rate-limit constanten zonder afstemming (raken alle users tegelijk).
- **Geen** Anthropic-modelnaam-changes zonder afstemming. Huidig: Sonnet `claude-sonnet-4-6` + Haiku `claude-haiku-4-5` / `claude-haiku-4-5-20251001`.

---

## 8. Lokaal testen

Er is **geen lokale dev-server** voor Vercel Functions in dit project (`.claude/static-server.mjs` serveert alleen statische files). Test via:
1. Push naar feature branch → Vercel preview URL.
2. Of cURL/Postman tegen preview met geldige Supabase JWT in `Authorization: Bearer ...`.
3. Voor `/api/community/*`: pad onthouden (rewrite!), JWT verplicht.

---

## 9. Functie-opzet (catch-alls)

**Sinds 2026-07-29: Vercel Pro.** De oude Hobby-limiet van 12 functions per deployment
geldt niet meer. Bestaande samenvoegingen blijven wel staan:
- `community.mjs` is een catch-all (had anders 15+ files moeten worden).
- `me.mjs` doet GET (export) + DELETE (forget) in één file.
- `memory.mjs` idem (GET + DELETE all + DELETE one).
- `admin.mjs` dispatched op `?section=...`.

Splits deze niet op zonder reden — ze zijn nu samengevoegd omdat de routes bij elkaar
horen, niet meer omwille van een limiet. Een nieuw `.mjs` toevoegen mag voortaan wel
wanneer het een echt losstaand endpoint is.
