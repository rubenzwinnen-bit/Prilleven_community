-- Opzegverzoeken voor het abonnement.
--
-- Waarom deze tabel: klanten kunnen niet zelf opzeggen in het Plug&Pay
-- klantenportaal — dat zit enkel in het Ultimate-pakket en wij draaien op
-- Premium. Het verzoek loopt dus via ons. Een mail alleen is te fragiel: als
-- die in een spamfilter of een volle inbox verdwijnt, blijft iemand betalen
-- die had opgezegd. Daarom staat elk verzoek ook hier, met een status die
-- afgevinkt kan worden.
--
-- De rij is het bewijsstuk: wie, wanneer, en of het afgehandeld is.
-- Het daadwerkelijk stopzetten gebeurt met de hand in Plug&Pay.

create table if not exists public.cancellation_requests (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  email        text not null,
  -- 'open' → nog niets mee gedaan
  -- 'verwerkt' → in Plug&Pay opgezegd
  -- 'geannuleerd' → klant wilde toch blijven
  status       text not null default 'open'
               check (status in ('open', 'verwerkt', 'geannuleerd')),
  -- Vrij tekstveld van de klant; mag leeg blijven.
  reden        text,
  -- Einddatum op het moment van het verzoek, zodat later terug te zien is
  -- tot wanneer iemand toegang had toen hij opzegde.
  einddatum_bij_verzoek timestamptz,
  mail_verstuurd boolean not null default false,
  created_at   timestamptz not null default now(),
  verwerkt_op  timestamptz,
  verwerkt_door text
);

-- Eén open verzoek per gebruiker: tweemaal klikken mag geen tweede mail
-- en geen tweede rij opleveren.
create unique index if not exists cancellation_requests_een_open_per_user
  on public.cancellation_requests (user_id)
  where status = 'open';

create index if not exists cancellation_requests_status_idx
  on public.cancellation_requests (status, created_at desc);

alter table public.cancellation_requests enable row level security;

-- Lezen: enkel je eigen verzoeken. Schrijven gebeurt uitsluitend server-side
-- met de service-role (die RLS omzeilt), zodat status en e-mailadres nooit
-- door de client gezet kunnen worden.
drop policy if exists "eigen opzegverzoeken lezen" on public.cancellation_requests;
create policy "eigen opzegverzoeken lezen"
  on public.cancellation_requests
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.cancellation_requests is
  'Opzegverzoeken voor het abonnement. Aangemaakt door /api/opzegverzoek; wordt met de hand afgehandeld in Plug&Pay.';
