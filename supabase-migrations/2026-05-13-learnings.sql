-- ============================================================
-- 2026-05-13 — Learnings (kennisbank: PDF / blog / video)
-- Run in: Supabase Dashboard → SQL Editor → New query
-- Safe to run twice: uses IF NOT EXISTS / DROP POLICY IF EXISTS.
--
-- Onderdelen:
--   1. learnings                   — admin uploadt items (pdf/blog/video)
--   2. user_learning_favorites     — ster van gebruiker per item
--   3. user_learning_bookmarks     — last_position per item (resume "lindje")
--   4. user_learning_notes         — meerdere notities per user per item
--   5. user_learning_note_clips    — losse selecties/tijdcodes binnen een notitie
--
-- Storage (manueel in Dashboard, zie onderaan).
-- ============================================================

-- ------------------------------------------------------------
-- 0. touch_updated_at() — self-healing
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 1. learnings
--    kind=pdf   → storage_path verwijst naar learnings-pdf bucket
--    kind=video → storage_path verwijst naar learnings-video bucket
--    kind=blog  → body_html bevat de inhoud (storage_path = null)
-- ------------------------------------------------------------
create table if not exists public.learnings (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('pdf','blog','video')),
  title         text not null check (char_length(title) between 1 and 200),
  description   text check (char_length(description) <= 1000),
  thumbnail_url text,
  storage_path  text,            -- voor pdf/video
  body_html     text,            -- voor blog
  duration_sec  integer,         -- voor video (optioneel)
  tags          text[] not null default '{}',
  is_published  boolean not null default true,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint learnings_payload_check check (
    (kind = 'blog'  and body_html    is not null and storage_path is null) or
    (kind = 'pdf'   and storage_path is not null and body_html    is null) or
    (kind = 'video' and storage_path is not null and body_html    is null)
  )
);

create index if not exists learnings_kind_idx on public.learnings(kind);
create index if not exists learnings_created_idx on public.learnings(is_published, created_at desc);

alter table public.learnings enable row level security;

-- Iedereen die ingelogd is mag gepubliceerde items zien.
drop policy if exists "read published learnings" on public.learnings;
create policy "read published learnings"
  on public.learnings for select
  using (auth.role() = 'authenticated' and is_published = true);

-- Schrijven gebeurt via API met service-role (admin-check daar).
-- Geen INSERT/UPDATE/DELETE-policy nodig voor authenticated users.

drop trigger if exists touch_learnings_updated_at on public.learnings;
create trigger touch_learnings_updated_at
  before update on public.learnings
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- 2. user_learning_favorites  (PK = user/item)
-- ------------------------------------------------------------
create table if not exists public.user_learning_favorites (
  user_id     uuid not null references auth.users(id) on delete cascade,
  learning_id uuid not null references public.learnings(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, learning_id)
);

alter table public.user_learning_favorites enable row level security;

drop policy if exists "own favorites" on public.user_learning_favorites;
create policy "own favorites"
  on public.user_learning_favorites for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 3. user_learning_bookmarks  ("lindje" — last seen position)
--    position-types:
--      blog  → scroll_px (integer)
--      pdf   → page_nr   (integer, 1-based)
--      video → seconds   (numeric)
--    We bewaren alles als jsonb om typevrij te zijn.
-- ------------------------------------------------------------
create table if not exists public.user_learning_bookmarks (
  user_id     uuid not null references auth.users(id) on delete cascade,
  learning_id uuid not null references public.learnings(id) on delete cascade,
  position    jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (user_id, learning_id)
);

alter table public.user_learning_bookmarks enable row level security;

drop policy if exists "own bookmarks" on public.user_learning_bookmarks;
create policy "own bookmarks"
  on public.user_learning_bookmarks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists touch_user_learning_bookmarks_updated_at on public.user_learning_bookmarks;
create trigger touch_user_learning_bookmarks_updated_at
  before update on public.user_learning_bookmarks
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- 4. user_learning_notes
--    Per-learning notitieboekje. Gebruiker maakt 1..N notities
--    per item. Eigen tekst staat in body; geknipte selecties als
--    losse rijen in user_learning_note_clips (volgorde via position).
-- ------------------------------------------------------------
create table if not exists public.user_learning_notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  learning_id uuid not null references public.learnings(id) on delete cascade,
  title       text not null default 'Notitie' check (char_length(title) between 1 and 120),
  body        text not null default '' check (char_length(body) <= 20000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists user_learning_notes_user_idx
  on public.user_learning_notes (user_id, learning_id, updated_at desc);

alter table public.user_learning_notes enable row level security;

drop policy if exists "own notes" on public.user_learning_notes;
create policy "own notes"
  on public.user_learning_notes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists touch_user_learning_notes_updated_at on public.user_learning_notes;
create trigger touch_user_learning_notes_updated_at
  before update on public.user_learning_notes
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- 5. user_learning_note_clips  (selecties / tijdcodes)
--    clip_type:
--      'text'      → tekst-selectie (body bevat de geknipte tekst)
--      'timecode'  → video-tijdcode (seconds gevuld, body optioneel)
--    Cascadeert mee met de notitie.
-- ------------------------------------------------------------
create table if not exists public.user_learning_note_clips (
  id          uuid primary key default gen_random_uuid(),
  note_id     uuid not null references public.user_learning_notes(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  clip_type   text not null check (clip_type in ('text','timecode')),
  body        text check (char_length(body) <= 4000),
  seconds     numeric,                    -- voor timecode
  page_nr     integer,                    -- optioneel: pdf-pagina
  position    integer not null default 0, -- volgorde binnen de notitie
  created_at  timestamptz not null default now()
);

create index if not exists user_learning_note_clips_note_idx
  on public.user_learning_note_clips (note_id, position);

alter table public.user_learning_note_clips enable row level security;

drop policy if exists "own clips" on public.user_learning_note_clips;
create policy "own clips"
  on public.user_learning_note_clips for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- KLAAR — DB-schema.
--
-- Post-migration in Dashboard (manueel):
--
-- A) Storage → New bucket → "learnings-pdf"    (public: false)
-- B) Storage → New bucket → "learnings-video"  (public: false)
-- C) Storage → New bucket → "learnings-thumb"  (public: true)  -- thumbnails mogen wel publiek
--
-- Policies (Storage → Policies, voor learnings-pdf én learnings-video):
--   - SELECT: authenticated   (alleen via signed URL vanuit API gebruiken)
--   - INSERT/UPDATE/DELETE: service_role only  (uploaden gebeurt server-side)
--
-- Voor learnings-thumb:
--   - SELECT: public
--   - INSERT/UPDATE/DELETE: service_role only
-- ============================================================
