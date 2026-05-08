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
- **Admin (vereist `requireAdmin`):**
  - `POST /posts/:id/pin` (max 5 gepinned)
  - `GET /admin/reports`
  - `POST /admin/reports/:id/resolve` (body: `{ delete_target?: bool }`)
- Pad-detectie: gebruikt `req.query.path` (Vercel auto-parse), valt terug op `req.url` parsing.
- Alle endpoints: `requireAuth` upfront, `findBlockedWord()` op alle user-content, image-paden moeten beginnen met `<userId>/`.

### `webhooks/plugpay.mjs` — POST `/api/webhooks/plugpay`
**KRITISCH endpoint — NOOIT aanpassen zonder expliciete bevestiging.** Foutieve wijziging = users zonder toegang.
- Authenticatie: HMAC-SHA256 (`PLUGPAY_WEBHOOK_SECRET`) **OF** Bearer token (`PLUGPAY_WEBHOOK_BEARER`). Als beide leeg → trust-mode (dev only, met warning log).
- Type-bepaling 3-traps: URL `?type=` → body `event/event_type/type/action` → heuristiek.
- Categorieën: `activated` | `cancelled` | `expired` | `unknown`.
- Schrijft naar `allowed_users` (upsert bij activated, update anders) **én** `subscription_events` audit-log.
- Roept `invalidateSubscriptionCache(email)` aan na success.
- Ook GET = health-check (returnt JSON met hint).

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
| `community.mjs` | Alle community helpers (groot bestand) — zie endpoint-overzicht hierboven. Bevat ook `loadAdminUserIds(userIds)` met fallback via `auth.admin.getUserById` als view onbeschikbaar is. |

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

## 9. Vercel Hobby functie-limiet

Je zit op de Hobby tier met max 12 functions per deployment. Daarom:
- `community.mjs` is een catch-all (had anders 15+ files moeten worden).
- `me.mjs` doet GET (export) + DELETE (forget) in één file.
- `memory.mjs` idem (GET + DELETE all + DELETE one).
- `admin.mjs` dispatched op `?section=...`.

**Voeg geen nieuwe `.mjs` toe als het bij een bestaand endpoint kan via een query-param of catch-all.**
