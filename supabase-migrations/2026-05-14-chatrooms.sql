-- ============================================================
-- Pril Leven Chatrooms (forum-style rooms met topics + replies)
-- Run in: Supabase Dashboard → SQL Editor → New query
-- Safe to run twice: uses IF NOT EXISTS / DROP POLICY IF EXISTS.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Zorg dat touch_updated_at() bestaat (self-healing).
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 1. chat_rooms (vaste kamers, beheerd door admin)
-- ------------------------------------------------------------
create table if not exists public.chat_rooms (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique
                check (slug ~ '^[a-z0-9-]{2,40}$'),
  title       text not null check (char_length(title) between 1 and 80),
  description text check (char_length(description) <= 300),
  sort_order  int  not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists chat_rooms_sort_idx
  on public.chat_rooms (is_active, sort_order, created_at);

alter table public.chat_rooms enable row level security;

drop policy if exists "read rooms" on public.chat_rooms;
create policy "read rooms"
  on public.chat_rooms for select
  using (auth.role() = 'authenticated');
-- Writes: alleen via service-role (admin) in /api/chat-rooms.

drop trigger if exists touch_chat_room_updated_at on public.chat_rooms;
create trigger touch_chat_room_updated_at
  before update on public.chat_rooms
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- 2. chat_topics (onderwerpen binnen een room)
-- ------------------------------------------------------------
create table if not exists public.chat_topics (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.chat_rooms(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 120),
  body        text not null check (char_length(body) between 1 and 4000),
  is_pinned   boolean not null default false,
  edited_at   timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists chat_topics_room_idx
  on public.chat_topics (room_id, is_pinned desc, created_at desc);

alter table public.chat_topics enable row level security;

drop policy if exists "read topics" on public.chat_topics;
create policy "read topics"
  on public.chat_topics for select
  using (auth.role() = 'authenticated');

drop policy if exists "insert own topic" on public.chat_topics;
create policy "insert own topic"
  on public.chat_topics for insert
  with check (auth.uid() = user_id and is_pinned = false);

drop policy if exists "update own topic 15min" on public.chat_topics;
create policy "update own topic 15min"
  on public.chat_topics for update
  using (auth.uid() = user_id and now() - created_at < interval '15 minutes')
  with check (auth.uid() = user_id and is_pinned = false);

drop policy if exists "delete own topic" on public.chat_topics;
create policy "delete own topic"
  on public.chat_topics for delete
  using (auth.uid() = user_id);
-- Pin / admin-delete / admin-edit: via service-role in /api/chat-rooms.

-- ------------------------------------------------------------
-- 3. chat_replies (antwoorden op topics)
-- ------------------------------------------------------------
create table if not exists public.chat_replies (
  id          uuid primary key default gen_random_uuid(),
  topic_id    uuid not null references public.chat_topics(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 2000),
  edited_at   timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists chat_replies_topic_idx
  on public.chat_replies (topic_id, created_at);

alter table public.chat_replies enable row level security;

drop policy if exists "read chat replies" on public.chat_replies;
create policy "read chat replies"
  on public.chat_replies for select
  using (auth.role() = 'authenticated');

drop policy if exists "insert own chat reply" on public.chat_replies;
create policy "insert own chat reply"
  on public.chat_replies for insert
  with check (auth.uid() = user_id);

drop policy if exists "update own chat reply 15min" on public.chat_replies;
create policy "update own chat reply 15min"
  on public.chat_replies for update
  using (auth.uid() = user_id and now() - created_at < interval '15 minutes')
  with check (auth.uid() = user_id);

drop policy if exists "delete own chat reply" on public.chat_replies;
create policy "delete own chat reply"
  on public.chat_replies for delete
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 4. View: topic + nickname + replies_count + last_reply_at
-- ------------------------------------------------------------
create or replace view public.chat_topics_view as
  select
    t.id,
    t.room_id,
    t.user_id,
    t.title,
    t.body,
    t.is_pinned,
    t.edited_at,
    t.created_at,
    cp.nickname,
    coalesce(r.replies_count, 0) as replies_count,
    r.last_reply_at
  from public.chat_topics t
  left join public.community_profiles cp on cp.user_id = t.user_id
  left join (
    select topic_id,
           count(*)::int     as replies_count,
           max(created_at)   as last_reply_at
    from public.chat_replies
    group by topic_id
  ) r on r.topic_id = t.id;

alter view public.chat_topics_view set (security_invoker = true);

-- ------------------------------------------------------------
-- 5. Seed: 4 vaste rooms
-- ------------------------------------------------------------
insert into public.chat_rooms (slug, title, description, sort_order)
  values
    ('melk-voeding',                'Melk voeding',                'Borst-, fles- en combinatievoeding — vragen en ervaringen.',                10),
    ('eerste-hapjes',               'Eerste hapjes',               'Starten met vast voedsel, BLW, pap, recepten en valkuilen.',                20),
    ('allergieen-overgevoeligheden','Allergieën en overgevoeligheden','Allergieën, intoleranties, introductie van risico-voedsel.',             30),
    ('feedback',                    'Feedback',                    'Suggesties, bugs en wensen voor de Pril Leven app.',                        40)
  on conflict (slug) do nothing;

-- ============================================================
-- KLAAR.
-- ============================================================
