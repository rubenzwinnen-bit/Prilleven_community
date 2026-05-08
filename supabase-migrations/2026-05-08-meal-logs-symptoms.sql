-- ============================================================
-- 2026-05-08 — Meal logs + child symptoms (Eerste Hapjes brok C)
-- Run in: Supabase Dashboard → SQL Editor → New query
-- Safe to run twice: uses IF NOT EXISTS / DROP POLICY IF EXISTS.
-- ============================================================
-- Twee additieve tabellen voor het Eerste Hapjes-traject:
--   1. meal_logs        — wat heeft het kindje gegeten + reactie
--   2. child_symptoms   — losse symptomen, optioneel gekoppeld aan een meal_log
-- Beide owner-only via RLS op user_id. Geen impact op bestaande tabellen.
-- ============================================================

-- ============================================================
-- 1. MEAL LOGS
-- ============================================================
create table if not exists public.meal_logs (
  id          uuid primary key default gen_random_uuid(),
  child_id    uuid not null references public.children(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  eaten_at    timestamptz not null default now(),
  meal_type   text not null check (
    meal_type in ('ontbijt','lunch','diner','snack')
  ),
  amount      text check (
    amount in ('klein','medium','groot')
  ),
  reaction    text check (
    reaction in ('positief','neutraal','afwijzing')
  ),
  food_text   text not null check (char_length(trim(food_text)) between 1 and 200),
  recipe_id   text references public.recipes(id) on delete set null,
  notes       text check (notes is null or char_length(notes) <= 500),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Snelle "logs van dit kindje, recent eerst"-query
create index if not exists meal_logs_child_eaten_idx
  on public.meal_logs (child_id, eaten_at desc);

-- RLS aan
alter table public.meal_logs enable row level security;

drop policy if exists "own meal_logs read"   on public.meal_logs;
drop policy if exists "own meal_logs write"  on public.meal_logs;
drop policy if exists "own meal_logs update" on public.meal_logs;
drop policy if exists "own meal_logs delete" on public.meal_logs;

create policy "own meal_logs read"
  on public.meal_logs for select
  using (auth.uid() = user_id);

create policy "own meal_logs write"
  on public.meal_logs for insert
  with check (auth.uid() = user_id);

create policy "own meal_logs update"
  on public.meal_logs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own meal_logs delete"
  on public.meal_logs for delete
  using (auth.uid() = user_id);

drop trigger if exists touch_meal_logs_updated_at on public.meal_logs;
create trigger touch_meal_logs_updated_at
  before update on public.meal_logs
  for each row execute function public.touch_updated_at();

-- ============================================================
-- 2. CHILD SYMPTOMS
-- ============================================================
create table if not exists public.child_symptoms (
  id            uuid primary key default gen_random_uuid(),
  child_id      uuid not null references public.children(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  occurred_at   timestamptz not null default now(),
  symptom_type  text not null check (
    symptom_type in (
      'huid','buik','diarree','braken','slaap',
      'koorts','jeuk','zwelling','ademhaling','anders'
    )
  ),
  severity      text not null check (
    severity in ('mild','matig','heftig')
  ),
  meal_log_id   uuid references public.meal_logs(id) on delete set null,
  notes         text check (notes is null or char_length(notes) <= 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists child_symptoms_child_occurred_idx
  on public.child_symptoms (child_id, occurred_at desc);

alter table public.child_symptoms enable row level security;

drop policy if exists "own child_symptoms read"   on public.child_symptoms;
drop policy if exists "own child_symptoms write"  on public.child_symptoms;
drop policy if exists "own child_symptoms update" on public.child_symptoms;
drop policy if exists "own child_symptoms delete" on public.child_symptoms;

create policy "own child_symptoms read"
  on public.child_symptoms for select
  using (auth.uid() = user_id);

create policy "own child_symptoms write"
  on public.child_symptoms for insert
  with check (auth.uid() = user_id);

create policy "own child_symptoms update"
  on public.child_symptoms for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own child_symptoms delete"
  on public.child_symptoms for delete
  using (auth.uid() = user_id);

drop trigger if exists touch_child_symptoms_updated_at on public.child_symptoms;
create trigger touch_child_symptoms_updated_at
  before update on public.child_symptoms
  for each row execute function public.touch_updated_at();
