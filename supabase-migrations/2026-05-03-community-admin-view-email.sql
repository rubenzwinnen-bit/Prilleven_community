-- ============================================================
-- Community admin-view: voeg email + nickname toe aan view
-- voor leesbaarheid in de Supabase table editor.
-- De view-naam blijft community_admin_user_ids zodat de API niets
-- hoeft te wijzigen — die selecteert alleen user_id.
-- ============================================================

drop view if exists public.community_admin_user_ids;

create view public.community_admin_user_ids as
  select
    au.id    as user_id,
    au.email as email,
    cp.nickname as nickname
  from auth.users au
  join public.allowed_users lu on lower(au.email) = lower(lu.email)
  left join public.community_profiles cp on cp.user_id = au.id
  where lu.is_admin = true;

alter view public.community_admin_user_ids set (security_invoker = true);
