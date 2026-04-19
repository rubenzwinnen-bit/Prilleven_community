-- ============================================================
-- Pril Leven — abonnement-status + admin rollen (Fase D)
-- Breidt bestaande allowed_users tabel uit.
-- Safe to run twice: gebruikt IF NOT EXISTS / DROP POLICY IF EXISTS.
-- ============================================================

-- 1. Voeg subscription-velden toe aan allowed_users
alter table public.allowed_users
  add column if not exists subscription_active   boolean not null default true;

alter table public.allowed_users
  add column if not exists subscription_end_date timestamptz;

alter table public.allowed_users
  add column if not exists cancelled_at          timestamptz;

alter table public.allowed_users
  add column if not exists plugpay_customer_id   text;

alter table public.allowed_users
  add column if not exists is_admin              boolean not null default false;

-- Indexen voor snelle lookups
create index if not exists allowed_users_plugpay_idx
  on public.allowed_users (plugpay_customer_id)
  where plugpay_customer_id is not null;

create index if not exists allowed_users_active_idx
  on public.allowed_users (subscription_active);

-- 2. Seed admins (wordt genegeerd als email niet bestaat)
update public.allowed_users
set is_admin = true
where lower(email) in (
  'ruben.zwinnen@hotmail.be',
  'anneleen.plettinx@gmail.com'
);

-- 3. RLS: publiek mag subscription_active + is_admin lezen (voor gate-check),
--    niet de rest (customer_id, end_date zijn gevoeliger).
--
-- Bestaande policy "Public SELECT allowed" op allowed_users blijft intact
-- (want frontend leest dit al tijdens login-flow). Voor extra veiligheid
-- kan je de SELECT-policy verfijnen tot alleen email + subscription_active + is_admin,
-- maar dat breekt bestaande checkAllowedUser flow.
-- Laat voor nu zoals het is; de gevoelige velden (plugpay_customer_id) worden
-- alleen server-side gelezen via service-role key.

-- 4. Helper RPC: check subscription + admin status voor één user (efficiënt)
create or replace function public.get_user_access (target_email text)
returns table (
  email text,
  has_registered boolean,
  subscription_active boolean,
  subscription_end_date timestamptz,
  cancelled_at timestamptz,
  is_admin boolean
)
language sql stable
as $$
  select
    au.email,
    au.has_registered,
    au.subscription_active,
    au.subscription_end_date,
    au.cancelled_at,
    au.is_admin
  from public.allowed_users au
  where lower(au.email) = lower(target_email)
  limit 1;
$$;

-- ============================================================
-- Klaar. Bestaande users behouden toegang (subscription_active default TRUE).
-- Plug&Pay webhook (D6) gaat deze velden updaten bij cancel/expire.
-- ============================================================
