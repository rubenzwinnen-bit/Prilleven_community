-- ============================================================
-- Eerste Hapjes — allergen intro logs (brok H.2)
-- ============================================================
-- Eén rij per intro-poging van een allergeen bij een kindje.
-- Gebruikt voor:
--   * 1/3 - 2/3 - 3/3 progressie per allergeen
--   * Tijdlijn-view per allergeen
--   * Reminder "tijd voor herhaling" na N dagen
--
-- Naast bestaande child_allergens-tabel (die houdt vermijdingsstatus
-- + planlijst bij). De afgeleide UI-status combineert beide.
-- ============================================================

create table if not exists public.allergen_intro_logs (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  child_id           uuid not null references public.children(id) on delete cascade,
  allergen_key       text not null,
  intro_date         date not null default current_date,
  reaction           text not null default 'geen'
                     check (reaction in ('geen','mild','matig','heftig','onbekend')),
  notes              text check (notes is null or char_length(notes) <= 500),
  meal_log_id        uuid references public.meal_logs(id) on delete set null,
  linked_symptom_id  uuid references public.child_symptoms(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Snel ophalen per kindje + allergeen, gesorteerd op datum desc.
create index if not exists allergen_intro_logs_child_idx
  on public.allergen_intro_logs (child_id, allergen_key, intro_date desc);

-- Snel reminder-check (laatste intro per kindje).
create index if not exists allergen_intro_logs_user_idx
  on public.allergen_intro_logs (user_id, intro_date desc);

alter table public.allergen_intro_logs enable row level security;

drop policy if exists "owner select intro logs" on public.allergen_intro_logs;
create policy "owner select intro logs" on public.allergen_intro_logs
  for select using (auth.uid() = user_id);

drop policy if exists "owner insert intro logs" on public.allergen_intro_logs;
create policy "owner insert intro logs" on public.allergen_intro_logs
  for insert with check (auth.uid() = user_id);

drop policy if exists "owner update intro logs" on public.allergen_intro_logs;
create policy "owner update intro logs" on public.allergen_intro_logs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "owner delete intro logs" on public.allergen_intro_logs;
create policy "owner delete intro logs" on public.allergen_intro_logs
  for delete using (auth.uid() = user_id);

-- updated_at trigger (project-conventie: touch_updated_at).
drop trigger if exists touch_allergen_intro_logs_updated_at on public.allergen_intro_logs;
create trigger touch_allergen_intro_logs_updated_at
  before update on public.allergen_intro_logs
  for each row execute procedure public.touch_updated_at();
