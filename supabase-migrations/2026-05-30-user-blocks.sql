-- ============================================================
-- Pril Leven — Gebruikers blokkeren (App Store Guideline 1.2)
-- Run in: Supabase Dashboard → SQL Editor → New query
-- Safe to run twice: uses IF NOT EXISTS / DROP POLICY IF EXISTS.
--
-- Eenrichtings-block: blocker verbergt content van de geblokkeerde
-- gebruiker (tijdlijn + chatruimtes). De geblokkeerde gebruiker
-- merkt niets. Filtering gebeurt server-side in /api/community
-- en /api/chat-rooms.
-- ============================================================

create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint no_self_block check (blocker_id <> blocked_id)
);

create index if not exists user_blocks_blocker_idx
  on public.user_blocks (blocker_id);

alter table public.user_blocks enable row level security;

drop policy if exists "read own blocks" on public.user_blocks;
create policy "read own blocks"
  on public.user_blocks for select
  using (auth.uid() = blocker_id);

drop policy if exists "own block write" on public.user_blocks;
create policy "own block write"
  on public.user_blocks for all
  using (auth.uid() = blocker_id)
  with check (auth.uid() = blocker_id);

-- ============================================================
-- KLAAR.
-- ============================================================
