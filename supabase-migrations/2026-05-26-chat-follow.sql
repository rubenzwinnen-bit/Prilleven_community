-- ============================================================
-- Chat-rooms volgsysteem: rooms + topics opvolgen in tijdlijn
-- ============================================================

-- 1. Chatruimte volgen
create table if not exists public.chat_room_followers (
  user_id      uuid not null references auth.users(id) on delete cascade,
  room_id      uuid not null references public.chat_rooms(id) on delete cascade,
  followed_at  timestamptz not null default now(),
  last_read_at timestamptz,
  primary key (user_id, room_id)
);
alter table public.chat_room_followers enable row level security;

create policy if not exists "own room follows"
  on public.chat_room_followers
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists chat_room_followers_room_idx
  on public.chat_room_followers(room_id);

-- 2. Topic volgen
create table if not exists public.chat_topic_followers (
  user_id      uuid not null references auth.users(id) on delete cascade,
  topic_id     uuid not null references public.chat_topics(id) on delete cascade,
  followed_at  timestamptz not null default now(),
  last_read_at timestamptz,
  primary key (user_id, topic_id)
);
alter table public.chat_topic_followers enable row level security;

create policy if not exists "own topic follows"
  on public.chat_topic_followers
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists chat_topic_followers_topic_idx
  on public.chat_topic_followers(topic_id);
