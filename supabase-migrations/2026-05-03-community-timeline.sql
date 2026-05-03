-- ============================================================
-- Pril Leven Community Timeline
-- Run in: Supabase Dashboard → SQL Editor → New query
-- Safe to run twice: uses IF NOT EXISTS / DROP POLICY IF EXISTS.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Zorg dat touch_updated_at() bestaat (was er normaal al via
--    een eerdere migratie, maar self-healing voor het geval dat).
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
-- 1. community_profiles  (publieke nickname, los van chat_user_profiles)
-- ------------------------------------------------------------
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

drop policy if exists "read all nicknames" on public.community_profiles;
create policy "read all nicknames"
  on public.community_profiles for select
  using (auth.role() = 'authenticated');

drop policy if exists "own nickname write" on public.community_profiles;
create policy "own nickname write"
  on public.community_profiles for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists touch_community_profile_updated_at on public.community_profiles;
create trigger touch_community_profile_updated_at
  before update on public.community_profiles
  for each row execute function public.touch_updated_at();

-- Gereserveerde nicknames die niemand mag claimen (los van auth.users).
create table if not exists public.community_reserved_nicknames (
  nickname text primary key
);
insert into public.community_reserved_nicknames (nickname)
  values ('admin'),('pril'),('prilleven'),('support'),('moderator')
  on conflict (nickname) do nothing;
alter table public.community_reserved_nicknames enable row level security;
drop policy if exists "read reserved" on public.community_reserved_nicknames;
create policy "read reserved"
  on public.community_reserved_nicknames for select
  using (auth.role() = 'authenticated');
-- Server-side check in API: nickname mag niet voorkomen in deze tabel.

-- ------------------------------------------------------------
-- 2. community_posts
-- ------------------------------------------------------------
create table if not exists public.community_posts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 4000),
  category    text not null default 'algemeen'
    check (category in ('vraag','tip','mijlpaal','voeding','slapen','algemeen')),
  image_path  text,
  is_pinned   boolean not null default false,
  edited_at   timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists community_posts_created_idx
  on public.community_posts (is_pinned desc, created_at desc);
create index if not exists community_posts_category_idx
  on public.community_posts (category);

alter table public.community_posts enable row level security;

drop policy if exists "read posts" on public.community_posts;
create policy "read posts"
  on public.community_posts for select
  using (auth.role() = 'authenticated');

drop policy if exists "insert own post" on public.community_posts;
create policy "insert own post"
  on public.community_posts for insert
  with check (auth.uid() = user_id and is_pinned = false);

drop policy if exists "update own post 15min" on public.community_posts;
create policy "update own post 15min"
  on public.community_posts for update
  using (auth.uid() = user_id and now() - created_at < interval '15 minutes')
  with check (auth.uid() = user_id);

drop policy if exists "delete own post" on public.community_posts;
create policy "delete own post"
  on public.community_posts for delete
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 3. community_replies
-- ------------------------------------------------------------
create table if not exists public.community_replies (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.community_posts(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 2000),
  edited_at   timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists community_replies_post_idx
  on public.community_replies (post_id, created_at);

alter table public.community_replies enable row level security;

drop policy if exists "read replies" on public.community_replies;
create policy "read replies"
  on public.community_replies for select
  using (auth.role() = 'authenticated');

drop policy if exists "insert own reply" on public.community_replies;
create policy "insert own reply"
  on public.community_replies for insert
  with check (auth.uid() = user_id);

drop policy if exists "update own reply 15min" on public.community_replies;
create policy "update own reply 15min"
  on public.community_replies for update
  using (auth.uid() = user_id and now() - created_at < interval '15 minutes')
  with check (auth.uid() = user_id);

drop policy if exists "delete own reply" on public.community_replies;
create policy "delete own reply"
  on public.community_replies for delete
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 4. community_likes  (PK = uniek per user/post)
-- ------------------------------------------------------------
create table if not exists public.community_likes (
  post_id    uuid not null references public.community_posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.community_likes enable row level security;

drop policy if exists "read likes" on public.community_likes;
create policy "read likes"
  on public.community_likes for select
  using (auth.role() = 'authenticated');

drop policy if exists "own like write" on public.community_likes;
create policy "own like write"
  on public.community_likes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 5. community_reports  (admin queue)
-- ------------------------------------------------------------
create table if not exists public.community_reports (
  id          uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('post','reply')),
  target_id   uuid not null,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason      text,
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists community_reports_open_idx
  on public.community_reports (resolved_at, created_at desc);

alter table public.community_reports enable row level security;

drop policy if exists "create report" on public.community_reports;
create policy "create report"
  on public.community_reports for insert
  with check (auth.uid() = reporter_id);
-- Lezen / oplossen: alleen via service-role in /api/community/admin/*

-- ------------------------------------------------------------
-- 6. community_polls + votes  (1:1 met post, optioneel)
-- ------------------------------------------------------------
create table if not exists public.community_polls (
  post_id    uuid primary key references public.community_posts(id) on delete cascade,
  question   text not null check (char_length(question) between 1 and 200),
  options    jsonb not null,                -- ["optie A","optie B",...] 2-4 strings
  closes_at  timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  constraint poll_options_valid check (
    jsonb_typeof(options) = 'array'
    and jsonb_array_length(options) between 2 and 4
  )
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

drop policy if exists "read polls" on public.community_polls;
create policy "read polls"
  on public.community_polls for select
  using (auth.role() = 'authenticated');

drop policy if exists "read poll votes" on public.community_poll_votes;
create policy "read poll votes"
  on public.community_poll_votes for select
  using (auth.role() = 'authenticated');

drop policy if exists "vote own" on public.community_poll_votes;
create policy "vote own"
  on public.community_poll_votes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
-- Polls zelf aanmaken: via API met service-role gekoppeld aan post-creatie.

-- ------------------------------------------------------------
-- 7. community_notifications
-- ------------------------------------------------------------
create table if not exists public.community_notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,  -- ontvanger
  type        text not null check (type in ('reply','like','poll_result','poll_reply')),
  post_id     uuid references public.community_posts(id) on delete cascade,
  reply_id    uuid references public.community_replies(id) on delete cascade,
  actor_id    uuid references auth.users(id) on delete set null,           -- veroorzaker
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists community_notifications_user_idx
  on public.community_notifications (user_id, read_at, created_at desc);

alter table public.community_notifications enable row level security;

drop policy if exists "read own notifications" on public.community_notifications;
create policy "read own notifications"
  on public.community_notifications for select
  using (auth.uid() = user_id);

drop policy if exists "update own read" on public.community_notifications;
create policy "update own read"
  on public.community_notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
-- Inserts: alleen via service-role om spoofing te voorkomen.

-- ------------------------------------------------------------
-- 8. View: post + nickname + counts + has_poll
-- ------------------------------------------------------------
create or replace view public.community_posts_view as
  select
    p.id,
    p.user_id,
    p.body,
    p.category,
    p.image_path,
    p.is_pinned,
    p.edited_at,
    p.created_at,
    cp.nickname,
    coalesce(l.likes,   0) as likes_count,
    coalesce(r.replies, 0) as replies_count,
    (po.post_id is not null) as has_poll
  from public.community_posts p
  left join public.community_profiles cp on cp.user_id = p.user_id
  left join (
    select post_id, count(*)::int as likes
    from public.community_likes
    group by post_id
  ) l on l.post_id = p.id
  left join (
    select post_id, count(*)::int as replies
    from public.community_replies
    group by post_id
  ) r on r.post_id = p.id
  left join public.community_polls po on po.post_id = p.id;

-- View moet RLS van de uitvoerende user respecteren, niet van de view-owner.
-- Voorkomt "UNRESTRICTED" waarschuwing in Supabase Dashboard.
alter view public.community_posts_view set (security_invoker = true);

-- ============================================================
-- KLAAR.
--
-- Post-migration in Dashboard:
--   Storage → New bucket → name: "community-images", public: false.
--   Policy (Storage → Policies → community-images):
--     - SELECT: authenticated
--     - INSERT: authenticated, owner = auth.uid()
--     - DELETE: owner = auth.uid()
-- ============================================================
