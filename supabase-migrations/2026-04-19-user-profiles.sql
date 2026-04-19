-- ============================================================
-- Pril Leven chat — user-profielen (Fase B)
-- Run in: Supabase Dashboard → SQL Editor → New query
-- Safe to run twice: uses IF NOT EXISTS / DROP POLICY IF EXISTS.
-- ============================================================

-- 1. Tabel: chat_user_profiles
create table if not exists public.chat_user_profiles (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  display_name    text,

  -- JSON array of child objects:
  -- [{ name: string, birthdate: 'YYYY-MM-DD', notes?: string }]
  -- Leeftijd wordt automatisch berekend uit birthdate (per query).
  children        jsonb not null default '[]'::jsonb,

  -- Dieet-restricties (vrije vinklijst):
  -- ['vegetarisch','veganistisch','glutenvrij','lactosevrij','halal','kosher', ...]
  diet            text[] not null default '{}',

  -- Allergieën (vrije tags):
  -- ['pinda','melk','ei','noten','gluten', ...]
  allergies       text[] not null default '{}',

  -- Vrije tekst van de ouder over gezinssituatie / voorkeur
  notes           text,

  -- Privacy-toggle: als false → bot slaat geen messages op, geen history,
  -- geen memory. Default aan (beste gebruikerservaring).
  memory_enabled  boolean not null default true,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 2. Row-Level Security
alter table public.chat_user_profiles enable row level security;

drop policy if exists "own profile" on public.chat_user_profiles;
create policy "own profile"
  on public.chat_user_profiles for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 3. updated_at trigger (hergebruikt de bestaande touch_updated_at-functie
-- uit de RAG-schema-migratie).
drop trigger if exists touch_user_profile_updated_at on public.chat_user_profiles;
create trigger touch_user_profile_updated_at
  before update on public.chat_user_profiles
  for each row execute function public.touch_updated_at();

-- ============================================================
-- Klaar. De /api/profile endpoints lezen en schrijven deze tabel.
-- Bot injecteert profiel-info in de system prompt bij elke vraag.
-- ============================================================
