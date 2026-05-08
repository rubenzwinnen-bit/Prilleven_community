-- ============================================================
-- 2026-05-08 — Child phases (Eerste Hapjes brok F)
-- Run in: Supabase Dashboard → SQL Editor → New query
-- Safe to run twice: uses IF NOT EXISTS / DROP POLICY IF EXISTS.
-- ============================================================
-- Twee tabellen die alleen STATE bewaren — fase-definities + checklist
-- staan statisch in js/content/eersteHapjes-phases.js (frontend) en
-- worden gevalideerd in api/_lib/eersteHapjes-phases.mjs.
--
-- 1. child_phases       → per (kindje, fase): unlocked + completed timestamps
-- 2. child_phase_checks → per afgevinkt checklist-item
-- ============================================================

-- ----------- child_phases ----------------------------------------------
create table if not exists public.child_phases (
  child_id     uuid not null references public.children(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  phase_number smallint not null check (phase_number between 0 and 5),
  unlocked_at  timestamptz not null default now(),
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (child_id, phase_number)
);

create index if not exists child_phases_child_idx
  on public.child_phases (child_id);

alter table public.child_phases enable row level security;

drop policy if exists "own child_phases read"   on public.child_phases;
drop policy if exists "own child_phases write"  on public.child_phases;
drop policy if exists "own child_phases update" on public.child_phases;
drop policy if exists "own child_phases delete" on public.child_phases;

create policy "own child_phases read"
  on public.child_phases for select
  using (auth.uid() = user_id);

create policy "own child_phases write"
  on public.child_phases for insert
  with check (auth.uid() = user_id);

create policy "own child_phases update"
  on public.child_phases for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own child_phases delete"
  on public.child_phases for delete
  using (auth.uid() = user_id);

drop trigger if exists touch_child_phases_updated_at on public.child_phases;
create trigger touch_child_phases_updated_at
  before update on public.child_phases
  for each row execute function public.touch_updated_at();

-- ----------- child_phase_checks ----------------------------------------
create table if not exists public.child_phase_checks (
  child_id     uuid not null references public.children(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  phase_number smallint not null check (phase_number between 0 and 5),
  check_key    text not null check (
    check_key = lower(check_key)
    and char_length(check_key) between 1 and 60
  ),
  checked_at   timestamptz not null default now(),
  primary key (child_id, phase_number, check_key)
);

create index if not exists child_phase_checks_child_idx
  on public.child_phase_checks (child_id, phase_number);

alter table public.child_phase_checks enable row level security;

drop policy if exists "own child_phase_checks read"   on public.child_phase_checks;
drop policy if exists "own child_phase_checks write"  on public.child_phase_checks;
drop policy if exists "own child_phase_checks delete" on public.child_phase_checks;

create policy "own child_phase_checks read"
  on public.child_phase_checks for select
  using (auth.uid() = user_id);

create policy "own child_phase_checks write"
  on public.child_phase_checks for insert
  with check (auth.uid() = user_id);

create policy "own child_phase_checks delete"
  on public.child_phase_checks for delete
  using (auth.uid() = user_id);
