-- ============================================================
-- Pril Leven — Chat-rooms report queue (App Store Guideline 1.2)
-- Run in: Supabase Dashboard → SQL Editor → New query
-- Safe to run twice: uses IF NOT EXISTS / DROP POLICY IF EXISTS.
--
-- Spiegelt public.community_reports, maar voor chatruimte-content
-- (topics + replies). Aparte tabel omdat de admin-queue andere
-- bron-tabellen joint (chat_topics / chat_replies i.p.v. community_*).
-- ============================================================

create table if not exists public.chat_reports (
  id          uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('topic','reply')),
  target_id   uuid not null,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason      text,
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists chat_reports_open_idx
  on public.chat_reports (resolved_at, created_at desc);

alter table public.chat_reports enable row level security;

drop policy if exists "create chat report" on public.chat_reports;
create policy "create chat report"
  on public.chat_reports for insert
  with check (auth.uid() = reporter_id);
-- Lezen / oplossen: alleen via service-role in /api/chat-rooms/admin/*

-- ============================================================
-- KLAAR.
-- ============================================================
