-- ============================================================
-- 2026-05-08 — Child allergens (Eerste Hapjes brok D)
-- Run in: Supabase Dashboard → SQL Editor → New query
-- Safe to run twice: uses IF NOT EXISTS / DROP POLICY IF EXISTS.
-- ============================================================
-- Per kindje één rij per allergeen met intro-status + reactie.
-- Allergen-key wordt in API gevalideerd tegen de ALLERGENS-vocabulaire
-- (uit js/utils.js) zodat de lijst flexibel blijft zonder DB-migratie.
-- ============================================================

create table if not exists public.child_allergens (
  id                uuid primary key default gen_random_uuid(),
  child_id          uuid not null references public.children(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  allergen_key      text not null check (
    allergen_key = lower(allergen_key)
    and char_length(allergen_key) between 1 and 40
  ),
  status            text not null check (
    status in ('gepland','geprobeerd','vermijden')
  ),
  reaction          text check (
    reaction in ('geen','mild','matig','heftig','onbekend')
  ),
  intro_date        date,
  notes             text check (notes is null or char_length(notes) <= 500),
  linked_symptom_id uuid references public.child_symptoms(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint child_allergen_unique unique (child_id, allergen_key)
);

create index if not exists child_allergens_child_idx
  on public.child_allergens (child_id);

alter table public.child_allergens enable row level security;

drop policy if exists "own child_allergens read"   on public.child_allergens;
drop policy if exists "own child_allergens write"  on public.child_allergens;
drop policy if exists "own child_allergens update" on public.child_allergens;
drop policy if exists "own child_allergens delete" on public.child_allergens;

create policy "own child_allergens read"
  on public.child_allergens for select
  using (auth.uid() = user_id);

create policy "own child_allergens write"
  on public.child_allergens for insert
  with check (auth.uid() = user_id);

create policy "own child_allergens update"
  on public.child_allergens for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own child_allergens delete"
  on public.child_allergens for delete
  using (auth.uid() = user_id);

drop trigger if exists touch_child_allergens_updated_at on public.child_allergens;
create trigger touch_child_allergens_updated_at
  before update on public.child_allergens
  for each row execute function public.touch_updated_at();
