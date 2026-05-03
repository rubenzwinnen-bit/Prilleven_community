-- ============================================================
-- Community extras:
--   1. View die admin-userIds resolveert (voor "Admin" badge)
--   2. Reply-likes tabel (♡ op reacties)
-- ============================================================

-- 1. Admin user-id view
-- Resolve auth.users.id naar is_admin via email-join met allowed_users
create or replace view public.community_admin_user_ids as
  select au.id as user_id
  from auth.users au
  join public.allowed_users lu on lower(au.email) = lower(lu.email)
  where lu.is_admin = true;
alter view public.community_admin_user_ids set (security_invoker = true);

-- 2. Reply-likes
create table if not exists public.community_reply_likes (
  reply_id   uuid not null references public.community_replies(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (reply_id, user_id)
);

alter table public.community_reply_likes enable row level security;

drop policy if exists "read reply likes" on public.community_reply_likes;
create policy "read reply likes"
  on public.community_reply_likes for select
  using (auth.role() = 'authenticated');

drop policy if exists "own reply like write" on public.community_reply_likes;
create policy "own reply like write"
  on public.community_reply_likes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
