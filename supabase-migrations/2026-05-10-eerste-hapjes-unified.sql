-- ============================================================
-- Eerste Hapjes — UNIFIED (vervangt fragmentaire schema's)
-- ============================================================
-- Geen actieve productie-users. Alle eerste-hapjes-data zit in preview-state.
-- Daarom: clean slate voor één geünificeerde feature.
--
-- DROPT (preview-data, niet meer gebruikt):
--   - child_phases              (vervangen door eerste_hapjes_state.current_phase)
--   - child_phase_checks        (vervangen door eerste_hapjes_state.readiness_check JSONB)
--   - child_allergens           (vervangen door eerste_hapjes_state.allergen_state JSONB
--                                + eerste_hapjes_allergen_doses voor doses)
--   - allergen_intro_logs       (vervangen door eerste_hapjes_allergen_doses)
--
-- BLIJFT (structuur klopt al, leeg dus geen migratie):
--   - children, meal_logs, child_symptoms
--
-- CREATE:
--   1. eerste_hapjes_state              — 1 rij per kindje, alle state
--   2. eerste_hapjes_allergen_doses     — 1 rij per dose, bron-van-waarheid
-- ============================================================

-- ------------------------------------------------------------
-- 1. DROP oude tabellen
-- ------------------------------------------------------------
drop table if exists public.allergen_intro_logs cascade;
drop table if exists public.child_phase_checks  cascade;
drop table if exists public.child_phases        cascade;
drop table if exists public.child_allergens     cascade;


-- ------------------------------------------------------------
-- 2. eerste_hapjes_state  — 1 rij per kindje
-- ------------------------------------------------------------
create table if not exists public.eerste_hapjes_state (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  child_id           uuid not null unique references public.children(id) on delete cascade,

  -- Fase 0: klaarheids-checklist (5 booleans als JSONB)
  -- Voorbeeld: { "signals": ["zitten","interesse","tongreflex","praktisch","geen-druk"], "completed_at": "..." }
  readiness_check    jsonb not null default '{"signals": []}'::jsonb,

  -- Fase
  current_phase      smallint not null default 0
                     check (current_phase between 0 and 2),
  phase_started_at   timestamptz,

  -- Profiel
  dietary            text not null default 'omnivoor'
                     check (dietary in ('omnivoor','pesco','vegetarisch','vegan')),

  -- Allergeen-flow state (afgeleid uit doses, gecached voor speed)
  -- {
  --   paused: false,
  --   paused_reason: null,
  --   paused_allergen: null,
  --   known_allergies: [],     // ouder bevestigde allergieën
  --   excluded_keys: []        // door ouder uitgesloten ingrediënten (cross-cutting)
  -- }
  allergen_state     jsonb not null default '{
    "paused": false,
    "paused_reason": null,
    "paused_allergen": null,
    "known_allergies": [],
    "excluded_keys": []
  }'::jsonb,

  -- Generator-config
  current_week_seed  text,                                -- bv. "<child_id>:w22"
  meals_per_day      smallint not null default 1
                     check (meals_per_day between 1 and 2),
  variation_level    text not null default 'gevarieerd'
                     check (variation_level in ('gevarieerd','simpel')),

  -- Audit
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists eerste_hapjes_state_user_idx
  on public.eerste_hapjes_state (user_id);

alter table public.eerste_hapjes_state enable row level security;

drop policy if exists "owner select eh state" on public.eerste_hapjes_state;
create policy "owner select eh state" on public.eerste_hapjes_state
  for select using (auth.uid() = user_id);

drop policy if exists "owner insert eh state" on public.eerste_hapjes_state;
create policy "owner insert eh state" on public.eerste_hapjes_state
  for insert with check (auth.uid() = user_id);

drop policy if exists "owner update eh state" on public.eerste_hapjes_state;
create policy "owner update eh state" on public.eerste_hapjes_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "owner delete eh state" on public.eerste_hapjes_state;
create policy "owner delete eh state" on public.eerste_hapjes_state
  for delete using (auth.uid() = user_id);

drop trigger if exists touch_eerste_hapjes_state_updated_at on public.eerste_hapjes_state;
create trigger touch_eerste_hapjes_state_updated_at
  before update on public.eerste_hapjes_state
  for each row execute procedure public.touch_updated_at();


-- ------------------------------------------------------------
-- 3. eerste_hapjes_allergen_doses  — 1 rij per dose
-- ------------------------------------------------------------
-- Vaste flow van 13 allergenen × 3 doses elk. Bron-van-waarheid voor:
--   * doses-counter (1/3, 2/3, 3/3)
--   * reactie-historiek
--   * cooldown-berekening (laatste intro_date)
-- Allergen_state op eerste_hapjes_state is een gecachete afgeleide.
create table if not exists public.eerste_hapjes_allergen_doses (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  child_id           uuid not null references public.children(id) on delete cascade,
  allergen_key       text not null
                     check (allergen_key = lower(allergen_key) and char_length(allergen_key) between 1 and 40),
  dose_number        smallint not null check (dose_number between 1 and 3),
  intro_date         date not null default current_date,
  reaction           text not null default 'geen'
                     check (reaction in ('geen','mild','ernstig')),
  notes              text check (notes is null or char_length(notes) <= 500),
  -- Optionele koppelingen — voor traceability tussen modules
  meal_log_id        uuid references public.meal_logs(id) on delete set null,
  linked_symptom_id  uuid references public.child_symptoms(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Eén dose-nummer per allergeen per kindje is uniek (3 rijen max per allergeen)
  unique (child_id, allergen_key, dose_number)
);

create index if not exists eh_allergen_doses_child_idx
  on public.eerste_hapjes_allergen_doses (child_id, allergen_key, intro_date desc);

create index if not exists eh_allergen_doses_user_idx
  on public.eerste_hapjes_allergen_doses (user_id, intro_date desc);

alter table public.eerste_hapjes_allergen_doses enable row level security;

drop policy if exists "owner select eh doses" on public.eerste_hapjes_allergen_doses;
create policy "owner select eh doses" on public.eerste_hapjes_allergen_doses
  for select using (auth.uid() = user_id);

drop policy if exists "owner insert eh doses" on public.eerste_hapjes_allergen_doses;
create policy "owner insert eh doses" on public.eerste_hapjes_allergen_doses
  for insert with check (auth.uid() = user_id);

drop policy if exists "owner update eh doses" on public.eerste_hapjes_allergen_doses;
create policy "owner update eh doses" on public.eerste_hapjes_allergen_doses
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "owner delete eh doses" on public.eerste_hapjes_allergen_doses;
create policy "owner delete eh doses" on public.eerste_hapjes_allergen_doses
  for delete using (auth.uid() = user_id);

drop trigger if exists touch_eh_allergen_doses_updated_at on public.eerste_hapjes_allergen_doses;
create trigger touch_eh_allergen_doses_updated_at
  before update on public.eerste_hapjes_allergen_doses
  for each row execute procedure public.touch_updated_at();
