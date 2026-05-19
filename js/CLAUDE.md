# CLAUDE.md — `/js` (Frontend modules)

Vanilla ES modules voor de Pril Leven frontend. Lees eerst de root `CLAUDE.md`.

---

## 1. Algemeen

- **Vanilla JS, ES modules.** Geen frameworks, geen JSX, geen TypeScript, geen bundler.
- Bestanden worden direct door de browser geladen via `<script type="module">`.
- Browser-support: moderne browsers (laatste 2 versies). Geen polyfills.
- Indenteer met 2 spaties; gebruik `const`/`let`, nooit `var`.
- Imports gebruiken **altijd een cache-buster query string** (zie sectie 6).

---

## 2. Twee parallelle auth-systemen

Pril Leven heeft historisch **twee** parallel-lopende auth-systemen. Begrijp het verschil voor je iets aanpast:

### A. Legacy "user_name" — receptenboek + weekschema
- Stored in `localStorage['receptenboek_user']` (JSON-string van het email-adres).
- API: `Store.getCurrentUser()` / `Store.setCurrentUser(email)`.
- Tabellen: `recipes`, `ratings`, `comments`, `favorites`, `schedules` — keyed op de string `user_name` (= email).
- Geen JWT — schrijven gebeurt met de Supabase **anon key** rechtstreeks via PostgREST (zie `supabase.js`).
- Werkt zonder Supabase Auth — bestaat al sinds v1.

### B. Supabase Auth (JWT) — chat + community + profile
- Stored in `localStorage['pril_session']` (volledig auth-object met `access_token`, `refresh_token`, `expires_at`, `user_id`, `email`).
- API in `supabase.js`: `sessionGet()`, `sessionSet(authData)`, `sessionClear()`, `sessionRefreshIfNeeded({ force? })`.
- Used voor `/api/chat`, `/api/community/*`, `/api/profile`, `/api/memory`, `/api/conversations`, `/api/me`.
- Tabellen: `chat_user_profiles`, `chat_user_memory`, `conversations`, `messages`, `community_*` — keyed op `user_id` (UUID, FK naar `auth.users`).
- Tokens vernieuwen automatisch ~5 min vóór expiry. Parallelle calls delen één refresh-promise (anti-rotation race).

**Beide systemen werken naast elkaar.** Login flow in `script.js` zet beide: legacy `Store.setCurrentUser(email)` + `sessionSet(authData)`.

---

## 3. Bestanden en hun rol

| Bestand | Rol |
|---|---|
| `store.js` | Legacy data-laag (receptenboek, ratings, comments, favorites, schedules). Heeft eigen 30s in-memory cache. Bevat `getCurrentUser`, `setCurrentUser`, `isAdmin`, `refreshAdminStatus`. Roept Supabase rechtstreeks aan via `supabaseFetch()`. |
| `supabase.js` | Supabase REST + Storage + Auth helpers. Hardcoded `SUPABASE_URL` + `SUPABASE_ANON_KEY` (publiek = OK). Bevat: `supabaseFetch`, storage helpers (`supabaseStorageUpload`, `uploadIngredientIcon`, …), auth (`authSignUp`, `authSignIn`, `authResetPassword`, `authUpdatePassword`, `markUserRegistered`, `checkAllowedUser`, `checkCanSignUp`), sessie (`sessionGet/Set/Clear/RefreshIfNeeded`), subscription-status fetcher. |
| `router.js` | Hash-gebaseerde SPA-router. `on(path, handler)`, `navigate(path)`, `init()`, `getCurrentPath()`, `hasHistory()`. Bewaart scroll-positie in `sessionStorage` per pad. |
| `utils.js` | Helpers: `showToast`, `confirm`, `promptInput`, datum-formatters, sterren-render, `escapeHtml`, `nl2br`, `formatRelativeTime`, `colorFromSeed`, `initialsFromName`, `processImageForUpload` (EXIF strip + resize naar max 1920px JPEG q=0.85). Constanten: `ALLERGENS`, `MEAL_MOMENTS`, `SCHEDULE_SLOTS`, `WEEKDAYS`. |
| `chat.js` | Logic voor `chat.html` — chat-interface met sidebar (conversations), profile-modal, memory-modal. |
| `admin-chat.js` | Logic voor `admin-chat.html` — admin dashboard tabs (overview, users, queries, conversations, fallbacks). |
| `communityApi.js` | Wrapper rond `/api/community/*`. Doet `sessionRefreshIfNeeded()` vóór elke call, returnt `{ ok, status, data, error }`. Exporteert: `getMyProfile`, `setMyNickname`, `updateMyProfile`, `getAvatarUploadUrl`, `getPosts`, `createPost`, `votePoll`, `getUploadUrl`, `uploadToStorage`, replies, likes, edit/delete, `reportTarget`, admin (`togglePin`, `listReports`, `resolveReport`), notifications. |
| `chatRoomsApi.js` | Wrapper rond `/api/chat-rooms/*`. Zelfde patroon als `communityApi.js`. Exporteert: `listRooms`, `getRoom`, `editRoom` (admin), topics + replies CRUD, `pinTopic` (admin). |
| `profileRender.js` | Gedeelde helper om community-avatar + nickname-blok te renderen (gebruikt door timeline + chatrooms). |
| `headerAvatarStandalone.js` | Klein avatar-component voor losse pagina's (`chat.html`, `admin-chat.html`) zonder de volledige header. |
| `components/` | Pagina/feature-componenten. |

### `components/` map
| Component | Doel |
|---|---|
| `header.js` | Header met logo + avatar-pill + uitlogknop. Cachet community-profiel in `localStorage['community.profile.cache.v1']` om email-flicker bij navigatie te vermijden. |
| `nav.js` | Hoofdnavigatie. |
| `home.js` | Landingspagina (hub). |
| `recipeCard.js`, `recipeList.js`, `recipeDetail.js`, `recipeForm.js` | Recepten. |
| `weekSchedule.js` | Weekschema (5 slots × 7 dagen). |
| `shoppingList.js` | Boodschappenlijst gegenereerd uit actief schema. |
| `favorites.js` | Favoriete recepten. |
| `importRecipes.js` | Bulk JSON import (admin). |
| `ingredientIcons.js` | Beheer van ingrediënt-iconen (admin). |
| `timeline.js`, `timelinePost.js` | Community-feed pagina + losse post-detail. |
| `chatRooms.js` | Chatruimtes-pane (rechts op landing) + room-view + topic-detail. Heeft per-room topic-cache (`pril_chatroom_v1_<slug>`, TTL 2 min) voor instant render. Set `state.activeSlug` **vóór** elke async fetch om freeze-bug bij race te vermijden. Admin kan room-intro inline bewerken via PATCH route. Rooms-lijst rendert altijd na eerste fetch (geen JSON.stringify-skip op lege array) + heeft `.rooms-empty` state. |
| `allergenen.js` | Allergenen-introductie-tracker (binnen Eerste Hapjes). Doses + symptoom-logs met pencil-edit (modal) ipv delete. Pencil expliciet `grid-row: 1; grid-column: -1 / -2` zodat hij rechts blijft bij multi-row content. Geen agenda-knop. Bron-flow in `content/eersteHapjes-allergen-flow.js` (9 items: kippen-ei, pinda, noten, sesam, vis, schaaldieren, soja, tarwe, koemelk — allemaal `introBefore: 12`). |
| `nicknameModal.js` | Modal om community-nickname in te stellen vóór posten. |
| `profileModal.js` | Modal voor community-profiel (nickname + avatar). |

---

## 4. Patronen

### 4.1 Supabase REST calls (legacy data)
**Altijd** via `supabaseFetch(path, options)` uit `supabase.js`. Niet zelf `fetch()` op `/rest/v1/...`.
```js
import { supabaseFetch } from './supabase.js?v=2.1.0';
const data = await supabaseFetch('/rest/v1/recipes?select=*&id=eq.' + encodeURIComponent(id));
```
Voor grote tabellen: voeg `Range`-header toe om PostgREST 1000-rij default te omzeilen:
```js
{ headers: { 'Range-Unit': 'items', 'Range': '0-9999' } }
```

### 4.2 API calls naar `/api/*` met JWT
Voor community: gebruik `communityApi.js` — die wrapt het al.
Voor andere endpoints (chat, profile, memory, conversations, me):
```js
import { sessionRefreshIfNeeded } from './supabase.js?v=2.1.0';
const session = await sessionRefreshIfNeeded();
if (!session) { /* redirect naar login */ return; }

const res = await fetch('/api/profile', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer ' + session.access_token,
    'Content-Type': 'application/json',
  },
});
```
**Altijd** `sessionRefreshIfNeeded()` aanroepen vóór een API call die auth vereist — voorkomt 401's door verlopen tokens. De helper deduppt parallelle refreshes.

### 4.3 Components
- Eén component per bestand in `components/`.
- Elke component exporteert een functie die ofwel HTML returnt (string) of een container vult. Volg het bestaande patroon van naburige componenten.
- DOM bouwen met `document.createElement` + `textContent`, of met template strings + `escapeHtml()` op alle dynamische data.
- **Geen** globale state — lees uit `Store` of krijg props door.

### 4.4 State (`store.js`)
- `Store.getCurrentUser()` → het email-adres (string) van de ingelogde user.
- `Store.setCurrentUser(email)` → zet legacy user. Invalidate user-specifieke cache automatisch.
- `Store.isAdmin()` → synchroon. Default `false` tot `refreshAdminStatus()` is gelopen; dan accuraat. Pre-load **altijd** in `script.js` initApp (na login + na sessie-restore). Hardcoded fallback: `['ruben.zwinnen@hotmail.be', 'anneleen.plettinx@gmail.com']`.
- `Store.refreshAdminStatus()` → fetch + cache. Roep aan na login.
- `Store.clearAdminCache()` → bij logout.
- `Store.clearCache()` → wis alle in-memory caches (bv. na een grote import).

### 4.5 Sessie
- `sessionGet()` → het volledige sessie-object of `null`.
- `sessionSet(authData)` → wordt aangeroepen na `authSignIn()` / `authSignUp()`.
- `sessionClear()` → bij logout. **Combineer met** `Store.setCurrentUser('')` of equivalent + `Store.clearAdminCache()` + `invalidateSubscriptionCache(email)`.
- `sessionRefreshIfNeeded({ force })` → returnt huidige/nieuwe sessie, of `null` als refresh faalt.

### 4.6 Subscription-status
`fetchSubscriptionStatus(email)` uit `supabase.js`. 1 min in-memory cache. Returnt `{ active, reason, end_date, is_admin }`. **Fail-open** bij netwerkfout (we sluiten niemand uit als de server hikt).

`script.js` polleert dit elke 2 minuten via `startSubscriptionPoll()` om live-cancellation te detecteren zonder refresh.

---

## 5. XSS / veiligheid

- **Nooit** `innerHTML` met data uit Supabase of user-input zonder `escapeHtml()`.
- Voorkeur: `document.createElement` + `textContent`.
- Voor markdown-strip in chat: `stripMarkdown()` helper in `chat.js`.
- `escapeHtml(str)` zit in `utils.js` — gebruik die.
- Image upload: **altijd** door `processImageForUpload(file)` uit `utils.js` — strippet EXIF (locatie, telefoon-info) + resize naar 1920px max + JPEG q=0.85.

---

## 6. Cache-buster (KRITISCH)

Het project heeft **geen build step**, dus de browser cachet JS-files agressief (1 jaar `s-maxage` op CDN, zie `vercel.json`). De cache-buster is een query-string `?v=X.Y.Z` die op **elke** import staat.

### Waar staat hij?
- **Alle HTML-bestanden** (`index.html`, `chat.html`, `admin-chat.html`, `delete-account.html`, `privacy.html`):
  ```html
  <script type="module" src="script.js?v=2.1.0"></script>
  <link rel="stylesheet" href="styles.css?v=2.1.0">
  ```
- **`script.js`** (entry point) — 14× in import statements:
  ```js
  import * as Store from './js/store.js?v=2.1.0';
  ```
- **Elke module in `/js`** die andere modules importeert — `store.js`, `chat.js`, `admin-chat.js`, `headerAvatarStandalone.js`, `communityApi.js`, en **alle** componenten in `js/components/*`. Voorbeeld uit `header.js`:
  ```js
  import * as Store from '../store.js?v=2.1.0';
  import { sessionClear, sessionGet } from '../supabase.js?v=2.1.0';
  ```

### Wanneer bumpen?
Bij **élke** wijziging aan een `.js` of `.css` bestand. Anders zien gebruikers stale JS en breekt mogelijk de app.

### Hoe bumpen?
Vervang ALLE voorkomens van de huidige versie (bv. `?v=2.1.0`) met de nieuwe (bv. `?v=2.1.1`) in:
1. Alle HTML-bestanden in de root.
2. `script.js`.
3. Alle bestanden in `/js/*.js` en `/js/components/*.js` met imports.

Snelle check: `grep -rn "v=2.1.0" --include="*.js" --include="*.html"`.
Een vind-vervang over alle bestanden tegelijk werkt prima.

---

## 7. Stijl / styling

- **Géén** CSS in JS. Alle styling staat in `/styles.css`. Voeg classes toe, geen `element.style.X = ...` (uitzondering: dynamische waardes zoals progress-bar width).
- Class-naming volgt bestaand patroon (`recipe-card`, `header-user`, `btn-primary`, `auth-error`, `confirm-dialog`, …).
- Kleurthema: salie-groen via CSS-variabelen `--color-primary`, `--color-secondary`, `--color-info`, `--color-warning`, `--color-primary-dark`, `--color-secondary-dark`. Gebruik die ipv hardcoded hexes.

---

## 8. Wat NIET doen

- **Geen** npm packages importeren in frontend code (er is geen bundler).
- **Geen** JSX of template literals voor HTML met user data zonder `escapeHtml()`.
- **Geen** `eval` / `new Function`.
- **Geen** dependency op `window.X` globals tussen modules — exporteer/importeer expliciet.
- **Geen** import zonder cache-buster query string. Eén vergeten import = alle imports daarachter cachen verkeerd.
- **Geen** rechtstreeks `localStorage` voor sessie (`pril_session`) of legacy user (`receptenboek_user`) — gebruik altijd de `Store.*` of `session*` helpers.
- **Geen** fetch zonder error-handling.
- **Geen** wijziging aan de hardcoded `SUPABASE_URL` of `SUPABASE_ANON_KEY` in `supabase.js` zonder bevestiging.
- **Geen** wijziging aan `processImageForUpload()` zonder bevestiging — strip EXIF is privacy-kritisch.
