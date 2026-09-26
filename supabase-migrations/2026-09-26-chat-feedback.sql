-- ============================================================
-- 2026-09-26 — Feedback (👍/👎) per antwoord van HapjesHeld.
-- Run in: Supabase Dashboard → SQL Editor → New query
-- Safe to run twice: uses IF NOT EXISTS / DROP POLICY IF EXISTS.
-- ============================================================

-- Vervangt de knop "Dit helpt mij", die enkel in localStorage stond en dus
-- nooit bij ons terechtkwam. Eén rij per antwoord per gebruiker: opnieuw
-- klikken overschrijft, ongedaan maken verwijdert de rij.

create table if not exists public.chat_feedback (
  id           bigint generated always as identity primary key,
  message_id   uuid not null references public.messages(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- 1 = 👍, -1 = 👎
  rating       smallint not null check (rating in (1, -1)),
  -- Optionele toelichting bij 👎.
  reden        text check (reden is null or length(reden) <= 500),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (message_id, user_id)
);

create index if not exists chat_feedback_created_idx
  on public.chat_feedback (created_at desc);

alter table public.chat_feedback enable row level security;

-- Lezen: enkel je eigen feedback. Schrijven gebeurt uitsluitend server-side
-- via /api/chat-feedback met de service-role, die controleert dat het
-- antwoord in een gesprek van de gebruiker zelf staat.
drop policy if exists "eigen chatfeedback lezen" on public.chat_feedback;
create policy "eigen chatfeedback lezen"
  on public.chat_feedback
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.chat_feedback is
  'Duim omhoog/omlaag per HapjesHeld-antwoord. Geschreven door /api/chat-feedback, getoond in admin-chat.';
