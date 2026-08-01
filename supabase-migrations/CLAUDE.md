# CLAUDE.md — `/supabase-migrations`

SQL-migraties voor het Supabase Postgres-project. Lees eerst de root `CLAUDE.md`.

---

## 1. Naamgeving

```
YYYY-MM-DD-<korte-beschrijving>.sql
```
Voorbeelden uit deze map:
- `2026-04-12-schedule-persons.sql`
- `2026-04-19-subscriptions.sql`
- `2026-05-03-community-poll-multi.sql`

Kleine letters, streepjes als scheiding. Géén spaties, géén onderstrepen.

---

## 2. Verplichte regels

### 2.1 Idempotent
Elke migratie moet **veilig her-uitvoerbaar** zijn:
```sql
CREATE TABLE IF NOT EXISTS my_table (...);
CREATE INDEX IF NOT EXISTS idx_x ON my_table(x);
ALTER TABLE my_table ADD COLUMN IF NOT EXISTS col text;
```
Voor policies / triggers: `DROP ... IF EXISTS` vóór `CREATE`. Dit project gebruikt dat patroon consequent — volg het.

### 2.2 RLS verplicht
Elke nieuwe tabel:
```sql
ALTER TABLE <tabel> ENABLE ROW LEVEL SECURITY;
```
En minstens één policy. Geen tabel zonder beleid.

### 2.3 Comment-blok bovenaan
Elk bestand begint met:
```sql
-- ============================================================
-- <YYYY-MM-DD> — <doel in 1 zin>
-- Run in: Supabase Dashboard → SQL Editor → New query
-- Safe to run twice: uses IF NOT EXISTS / DROP POLICY IF EXISTS.
-- ============================================================
```

### 2.4 Eén migratie = één doel
Niet meerdere onsamenhangende wijzigingen in één file. Splits indien nodig in aparte files met dezelfde datum-prefix.

---

## 3. Workflow (geen automatische pipeline!)

1. Maak het SQL-bestand in deze map.
2. **Plaats de SQL in de Claude Code chat** — zoals afgesproken in de root CLAUDE.md, zodat het meteen kopieerbaar is.
3. Anneleen draait het handmatig in Supabase SQL Editor:
   `https://supabase.com/dashboard/project/ynrdoxukevhzupjvcjuw/sql/new`
4. Commit het bestand zoals elke andere wijziging.

Er is **geen** `supabase db push`, **geen** Supabase CLI in dit project, **geen** automatische migratie via CI.

---

## 4. Snippets (recht uit bestaande migraties)

### Anon read-only policy
```sql
CREATE POLICY "anon_read_<tabel>" ON <tabel>
  FOR SELECT TO anon USING (true);
```

### Authenticated user — eigen rijen
```sql
DROP POLICY IF EXISTS "own row" ON <tabel>;
CREATE POLICY "own row"
  ON <tabel> FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

### Auth-only read (alle ingelogde users)
```sql
DROP POLICY IF EXISTS "read all" ON <tabel>;
CREATE POLICY "read all"
  ON <tabel> FOR SELECT
  USING (auth.role() = 'authenticated');
```

### Updated_at trigger
Het project heeft al `public.touch_updated_at()` (gedefinieerd in `2026-04-18-rag-schema.sql`):
```sql
DROP TRIGGER IF EXISTS touch_<tabel>_updated_at ON <tabel>;
CREATE TRIGGER touch_<tabel>_updated_at
  BEFORE UPDATE ON <tabel>
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
```

### View met RLS-respect
```sql
CREATE OR REPLACE VIEW public.my_view AS
  SELECT ... FROM ... ;
ALTER VIEW public.my_view SET (security_invoker = true);
```
**Altijd** `security_invoker = true` zetten — anders draait de view met owner-rechten en kan de view RLS van de uitvoerende user omzeilen.

### Embedding-kolom (RAG / memory)
```sql
embedding vector(1024)   -- Voyage voyage-3-large
```
HNSW-index voor cosine similarity:
```sql
CREATE INDEX IF NOT EXISTS <tabel>_embedding_hnsw
  ON public.<tabel>
  USING hnsw (embedding vector_cosine_ops);
```

---

## 5. Bestaande tabellen (snelreferentie)

### Auth + billing
- **`allowed_users`** — wie mag inloggen (gevuld door Plug&Pay webhook).
  Velden: `email`, `has_registered`, `is_admin`, `subscription_active`, `subscription_end_date`, `cancelled_at`, `plugpay_customer_id`.
  Anon mag SELECT (publieke check vanuit frontend) en UPDATE alleen `has_registered = true`.
  RPC `get_user_access(target_email)` voor efficiënte access-check.
- **`subscriptions`** — historisch (mogelijk niet actief gebruikt; check vóór wijzigen).
- **`subscription_events`** — audit-log van Plug&Pay webhooks. RLS = service-role only. Alle webhook-bodies bewaard in `payload jsonb`.

### Receptenboek + weekschema (legacy)
Deze tabellen worden direct met de **anon key** gelezen/geschreven via PostgREST, gekeyd op `user_name` (= email-string).
- **`recipes`** — `id, name, image, meal_moments, cooking_time, portions, ingredients, allergens, preparation, created_at, updated_at`. Constraint `portions > 0`.
- **`ratings`** — `recipe_id, user_name, rating (1-5)`. UPSERT via merge-duplicates.
- **`comments`** — `id, recipe_id, user_name, text, created_at`.
- **`favorites`** — `recipe_id, user_name, created_at`. Race-safe toggle via DELETE-then-INSERT pattern.
- **`schedules`** — `id, user_name, name, days (jsonb), excluded_allergens, persons (default 4), is_active, created_at`. Eén actief schema per user.
- **`ingredient_icons`** — `name (unique), icon_url`. RLS open (admin-check is client-side).

### RAG / chat (Fase A-D)
Deze tabellen werken met `auth.users` UUID's en JWT-auth. RLS strikt.
- **`documents`** — kennisbank-chunks. `id (text), source, title, content, category, age_min_months, age_max_months, page_refs, metadata jsonb, embedding vector(1024)`. Public read; writes alleen via service-role. RPC `match_documents(query_embedding, match_count, filter_age, filter_sources)`.
- **`conversations`** — `id, user_id (auth.users), title, created_at, updated_at`. Owner-only RLS.
- **`messages`** — `id, conversation_id, role ('user'|'assistant'|'system'), content, had_image, retrieved_ids text[], tokens_in, tokens_out, model, created_at`. Géén images bewaard (GDPR). Owner-only via parent conversation.
- **`usage_log`** — `id, user_id, ip_hash, event ('query'|'cache_hit'|'blocked_rate_limit'|'query_with_image'), tokens_in, tokens_out, cost_cents, created_at`. RLS dichtgezet — alleen service-role.
- **`answer_cache`** — `id, question_hash (unique), question, answer, retrieved_ids, hits, created_at, last_hit_at`. RLS dichtgezet.
- **`chat_user_profiles`** — `user_id (PK, FK auth.users), display_name, children (jsonb array), diet text[], allergies text[], notes, memory_enabled, created_at, updated_at`. Owner-only.
- **`chat_user_memory`** — `id, user_id, content, embedding vector(1024), source_message_id, importance (1-5), created_at, last_used_at`. Owner-only. RPC `match_user_memory(query_embedding, target_user_id, match_count)`. Functie `prune_user_memory()` voor cleanup.

### Community (Fase D)
Alle tabellen `auth.role() = 'authenticated'` voor read; mutations enkel eigen rijen via `auth.uid() = user_id`.
- **`community_profiles`** — `user_id (PK), nickname (unique, regex `^[A-Za-z0-9_\- ]{2,30}$`), avatar_path`. updated_at trigger.
- **`community_reserved_nicknames`** — gereserveerde namen (`admin`, `pril`, `prilleven`, `support`, `moderator`).
- **`community_posts`** — `id, user_id, body (1-4000 chars), category ∈ ('vraag','tip','mijlpaal','voeding','slapen','algemeen'), image_path, is_pinned, edited_at, created_at`. Edit/delete-window 15 minuten via RLS.
- **`community_replies`** — `id, post_id, user_id, body (1-2000 chars), edited_at, created_at`. Cascade.
- **`community_likes`** — PK `(post_id, user_id)`.
- **`community_reply_likes`** — PK `(reply_id, user_id)`.
- **`community_reports`** — `id, target_type ∈ ('post','reply'), target_id, reporter_id, reason, resolved_at, created_at`. Insert door reporter; lezen/oplossen alleen via service-role in API.
- **`community_polls`** — `post_id (PK), question (1-200), options (jsonb 2-4 strings), closes_at (default +7 dagen), allow_multi`.
- **`community_poll_votes`** — PK `(post_id, user_id, option_idx)` (multi-vote support).
- **`community_notifications`** — `id, user_id (ontvanger), type ∈ ('reply','like','poll_result','poll_reply'), post_id, reply_id, actor_id (veroorzaker), read_at, created_at`. Inserts alleen via service-role (anti-spoof).

### Push / app-icoon-badge (v3.2.0 — `2026-07-08-push-notifications.sql`)
Voedt de app-icoon-push (APNs/FCM via Expo Push) en de server-side badge-berekening.
- **`push_tokens`** — `token (PK, Expo-push-token), user_id (FK auth.users), platform ('ios'|'android'), updated_at`. Index op `user_id`. RLS owner-only ("own tokens" op `auth.uid() = user_id`). Upsert bij (her)login vanuit de app; delete bij uitloggen. Server leest deze om pushes te sturen wanneer de app dicht is.
- **`user_badge_state`** — `user_id (PK, FK auth.users), timeline_seen_at timestamptz, chatrooms_seen_at timestamptz, topic_reads jsonb (default '{}')`. RLS owner-only ("own badge state"). Server-spiegel van de "laatst gezien"-tijdstippen die de app pusht via `PUT /api/community/badge-state`; hergebruikt door `_lib/badges.mjs::computeTotalBadge` om het absolute app-icoon-getal per ontvanger te berekenen bij een push.

### Aanraders / affiliatepagina (V3.2 — `2026-07-29-affiliate-aanraders.sql`)
Voedt de **publieke** pagina `/aanraders` (zie `api/CLAUDE.md`). Anon mag lezen waar `zichtbaar = true`; schrijven uitsluitend via service-role in `api/aanraders.mjs`.
- **`affiliate_categories`** — `id, slug (unique), titel, emoji, omschrijving, volgorde, zichtbaar (default true), binnenkort`. `binnenkort = true` toont een placeholder **in plaats van** de producten — ook als er zichtbare producten in zitten. Policy: `"publiek leesbaar"` op `zichtbaar = true`.
- **`affiliate_products`** — alle inhoud van kaart én detailpagina. Belangrijk: `relatie_type` (NOT NULL, CHECK op `affiliate_korting | affiliate | enkel_korting | geen_samenwerking`) bepaalt het transparantielabel; `zichtbaar` **default false** zodat een nieuw product nooit per ongeluk live staat; `favoriet_anneleen` zet enkel het label "Favoriet" (de aparte favorieten-sectie is verwijderd). `prijs_indicatie` bestaat nog maar wordt nergens meer gezet of getoond.
- **`affiliate_downloads`** — `slug, titel, omschrijving, bestand_url, afbeelding_url, emoji, volgorde, zichtbaar`.
- **Sorteren:** altijd `order by volgorde, titel`. Zonder die tweede sleutel is de volgorde bij gelijke `volgorde` willekeurig en kan hij per query verschillen.
- Triggers gebruiken de bestaande `public.touch_updated_at()` — géén eigen functie.

### Storage buckets — aanvulling
- **`affiliate-images`** — productfoto's, publiek leesbaar (zoals `recipe-images`). Alleen een SELECT-policy; schrijven gaat server-side met de service-role via een signed upload-URL.

### Views
- **`community_posts_view`** — post + nickname + avatar_path + likes_count + replies_count + has_poll. `security_invoker = true`.
- **`community_admin_user_ids`** — resolveert admin user_ids via email-join `auth.users ↔ allowed_users.is_admin`. `security_invoker = true`. Bevat ook email + nickname (na `2026-05-03-community-admin-view-email.sql`).

### Storage buckets
- **`recipe-images`** — recepten foto's (publiek leesbaar).
- **`ingredient-icons`** — ingrediënt-iconen (publiek leesbaar).
- **`community-images`** — community-foto's (privé, signed URLs). Pad: `<userId>/<random>.jpg` voor posts, `<userId>/avatars/<random>.jpg` voor avatars. Policies: SELECT/INSERT/DELETE via owner.

---

## 6. Functions / RPCs

| Functie | Doel | Aangeroepen vanuit |
|---|---|---|
| `match_documents(query_embedding, match_count, filter_age, filter_sources)` | RAG-retrieval | `api/_lib/retrieve.mjs` |
| `match_user_memory(query_embedding, target_user_id, match_count)` | Persoonlijke memory-retrieval | `api/_lib/retrieve.mjs` + `user-memory.mjs` |
| `get_user_access(target_email)` | Toegang + admin-check | `api/_lib/subscription.mjs` |
| `touch_updated_at()` | Trigger-helper | meerdere triggers |
| `prune_user_memory()` | Cleanup memory (importance ≤ 2 + > 180 dagen + cap 500/user) | manueel of cron |
| `gdpr_cleanup_inactive_users(retention_interval)` | Verwijder chat-data van users > 2 jaar inactief | manueel of cron |

---

## 7. Niet doen

- **Geen** `DROP TABLE`/`DROP COLUMN` zonder expliciete bevestiging — data weg = data weg.
- **Geen** migratie die bestaande RLS-policies stilzwijgend verwijdert. Drop alleen wat je zelf hernieuwt.
- **Geen** wijzigingen aan `allowed_users` of `subscription_events` zonder bevestiging — dat raakt billing/auth.
- **Geen** wijzigingen aan `documents` schema/embedding-dim (1024) zonder ingestion-script aan te passen.
- **Geen** hardcoded user-IDs of email-adressen in SQL — gebruik views/policies/RPCs.
- **Geen** views zonder `security_invoker = true` — anders kan een view RLS omzeilen.
- **Geen** secrets in SQL comments of `INSERT`-statements.
- **Niet** rechtstreeks data inserten in productie via een migratie tenzij echt nodig (en dan altijd `ON CONFLICT DO NOTHING`).
- **Geen** wijziging van het embedding-dim (1024 = Voyage `voyage-3-large`) zonder nieuwe ingestion.

## Data-fixes (geen schema)

- `2026-07-31-abonnementen-einddatum-uit-plugpay-export.sql` — eenmalige UPDATE van `allowed_users.subscription_end_date` voor 160 e-mails uit een Plug&Pay-export. Aanleiding: de webhook zette geen verlengingen door, waardoor 31 betalende leden op een verlopen datum stonden. **Al uitgevoerd op productie op 2026-07-31.** De kolom bevat bewust de kale incassodatum; de weekendmarge zit in `effectiveExpiry()` in `api/_lib/subscription.mjs`.
