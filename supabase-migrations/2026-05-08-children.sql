-- ============================================================
-- 2026-05-08 — Children table (Eerste Hapjes Traject brok A.2)
-- Run in: Supabase Dashboard → SQL Editor → New query
-- Safe to run twice: uses IF NOT EXISTS / DROP POLICY IF EXISTS.
-- ============================================================
-- Wordt de single source of truth voor kindjes-data.
-- Vervangt op termijn chat_user_profiles.children (jsonb).
-- HapjesHeld leest later uit deze tabel via api/_lib/profile.mjs.
-- Eerste Hapjes-onboarding is de plek waar kindjes worden aangemaakt.
-- ============================================================

-- 1. Children-tabel
create table if not exists public.children (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  name                text not null check (char_length(trim(name)) between 1 and 50),
  birthdate           date not null check (
    birthdate <= current_date
    and birthdate >= current_date - interval '10 years'
  ),
  texture_preference  text check (
    texture_preference in ('puree','stukjes','combi')
  ),
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- 2. Index voor snelle "mijn kindjes"-query
create index if not exists children_user_idx
  on public.children (user_id, archived_at, birthdate);

-- 3. RLS aan
alter table public.children enable row level security;

-- 4. Owner-only policies (eigen rijen lezen, schrijven, updaten, verwijderen)
drop policy if exists "own children read"   on public.children;
drop policy if exists "own children write"  on public.children;
drop policy if exists "own children update" on public.children;
drop policy if exists "own children delete" on public.children;

create policy "own children read"
  on public.children for select
  using (auth.uid() = user_id);

create policy "own children write"
  on public.children for insert
  with check (auth.uid() = user_id);

create policy "own children update"
  on public.children for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own children delete"
  on public.children for delete
  using (auth.uid() = user_id);

-- 5. updated_at trigger (gebruikt bestaande public.touch_updated_at())
drop trigger if exists touch_children_updated_at on public.children;
create trigger touch_children_updated_at
  before update on public.children
  for each row execute function public.touch_updated_at();
