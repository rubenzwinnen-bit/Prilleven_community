-- =====================================================================
-- PUSH-NOTIFICATIES + APP-ICOON-BADGE
-- Run in: Supabase Dashboard → SQL Editor (veilig om meermaals te draaien)
-- =====================================================================
--
-- Twee tabellen:
--
--   push_tokens         De Expo-push-tokens per gebruiker (één rij per
--                       toestel/token). De server stuurt pushes naar deze
--                       tokens en zet daarbij het absolute app-icoon-getal.
--
--   user_badge_state    Server-side spiegel van de "laatst gezien"-tijdstippen
--                       die de app tot nu toe enkel lokaal (AsyncStorage)
--                       bijhield. Nodig zodat de server bij een nieuwe post/
--                       reply voor ELKE ontvanger het juiste totaal (tijdlijn
--                       + chatruimtes) kan berekenen en meesturen als badge.
--                       - timeline_seen_at   tijdlijn laatst gezien
--                       - chatrooms_seen_at  chatruimtes-baseline laatst gezien
--                       - topic_reads        { topic_id: ISO } per-topic gezien
--
-- Beide RLS owner-only: een gebruiker ziet/schrijft enkel zijn eigen rijen.
-- De server gebruikt de service-role key en omzeilt RLS voor het versturen.
-- =====================================================================

create table if not exists public.push_tokens (
  token      text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  platform   text,
  updated_at timestamptz not null default now()
);

create index if not exists push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

drop policy if exists "own tokens" on public.push_tokens;
create policy "own tokens" on public.push_tokens
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


create table if not exists public.user_badge_state (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  timeline_seen_at  timestamptz,
  chatrooms_seen_at timestamptz,
  topic_reads       jsonb not null default '{}'::jsonb,
  updated_at        timestamptz not null default now()
);

alter table public.user_badge_state enable row level security;

drop policy if exists "own badge state" on public.user_badge_state;
create policy "own badge state" on public.user_badge_state
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
