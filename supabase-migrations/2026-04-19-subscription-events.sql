-- ============================================================
-- Subscription audit-log (Fase D - bis)
-- Bewaart elke webhook-event van Plug&Pay zodat je achteraf
-- kan nagaan wat er gebeurd is.
-- Safe to run twice.
-- ============================================================

create table if not exists public.subscription_events (
  id          bigserial primary key,
  email       text not null,
  event_type  text not null,        -- raw type (zoals doorgegeven)
  category    text not null,        -- 'activated' | 'cancelled' | 'expired' | 'unknown'
  cycle       text,                 -- 'monthly' | 'yearly' | null
  payload     jsonb not null,       -- volledige webhook body voor debugging
  applied     boolean not null,     -- is de DB-update geslaagd?
  error       text,                 -- fout-bericht als applied=false
  received_at timestamptz not null default now()
);

create index if not exists subscription_events_email_idx
  on public.subscription_events (email, received_at desc);

create index if not exists subscription_events_time_idx
  on public.subscription_events (received_at desc);

-- RLS: alleen service role kan lezen/schrijven (geen publieke policy)
alter table public.subscription_events enable row level security;

-- ============================================================
-- Klaar. De webhook /api/webhooks/plugpay logt hierin.
-- Admin dashboard (Fase D8) toont de tijdlijn per user.
-- ============================================================
