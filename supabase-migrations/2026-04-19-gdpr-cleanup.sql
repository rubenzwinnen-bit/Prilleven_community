-- ============================================================
-- Pril Leven — GDPR cleanup-functie (Fase D10)
-- Verwijdert chat-data van users die al > 2 jaar niet meer actief zijn.
-- Bewaart allowed_users rij zelf (voor re-activatie later).
-- Run manueel of via cron (wekelijks/maandelijks).
-- ============================================================

create or replace function public.gdpr_cleanup_inactive_users(retention_interval interval default '2 years')
returns table (
  deleted_profiles  int,
  deleted_conversations int,
  deleted_memories int
)
language plpgsql
as $$
declare
  profile_count int := 0;
  conversation_count int := 0;
  memory_count int := 0;
  target_user_ids uuid[];
begin
  -- Verzamel auth.users ids van users wiens subscription:
  --  - niet actief is (subscription_active = false OR NULL)
  --  - niet binnen de retentie-periode is afgelopen
  --  - EN de user is bekend in auth.users (via email join)
  select array_agg(au.id) into target_user_ids
  from auth.users au
  inner join public.allowed_users a
    on lower(au.email) = lower(a.email)
  where
    a.is_admin = false
    and a.subscription_active = false
    and (
      a.subscription_end_date is not null
      and a.subscription_end_date < now() - retention_interval
    );

  if target_user_ids is null or array_length(target_user_ids, 1) is null then
    return query select 0, 0, 0;
    return;
  end if;

  -- Delete in dependency order.
  -- chat_user_memory cascadet niet naar conversaties dus eerst expliciet.
  with d as (
    delete from public.chat_user_memory
    where user_id = any(target_user_ids)
    returning 1
  )
  select count(*) into memory_count from d;

  -- conversations cascade → messages automatisch mee
  with d as (
    delete from public.conversations
    where user_id = any(target_user_ids)
    returning 1
  )
  select count(*) into conversation_count from d;

  -- profile
  with d as (
    delete from public.chat_user_profiles
    where user_id = any(target_user_ids)
    returning 1
  )
  select count(*) into profile_count from d;

  -- Opmerking: we verwijderen GEEN auth.users rij en GEEN allowed_users rij.
  -- Bij re-activatie kan de user opnieuw toegang krijgen.
  -- subscription_events blijft staan (alleen email, geen persoonlijke data).

  return query select profile_count, conversation_count, memory_count;
end;
$$;

-- ============================================================
-- Gebruik:
--   select * from public.gdpr_cleanup_inactive_users();              -- 2 jaar default
--   select * from public.gdpr_cleanup_inactive_users('1 year');      -- custom
--
-- Ideaal via maandelijkse cron (pg_cron of Vercel cron).
-- Resultaat: aantal verwijderde profielen, gesprekken (incl. messages), memories.
-- ============================================================
