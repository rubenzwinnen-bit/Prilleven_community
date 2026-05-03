-- ============================================================
-- Community profielfoto's
-- ============================================================

-- 1. Voeg avatar_path kolom toe aan community_profiles
alter table public.community_profiles
  add column if not exists avatar_path text;

-- 2. Herbouw view met avatar_path uit community_profiles
create or replace view public.community_posts_view as
  select
    p.id,
    p.user_id,
    p.body,
    p.category,
    p.image_path,
    p.is_pinned,
    p.edited_at,
    p.created_at,
    cp.nickname,
    cp.avatar_path,
    coalesce(l.likes,   0) as likes_count,
    coalesce(r.replies, 0) as replies_count,
    (po.post_id is not null) as has_poll
  from public.community_posts p
  left join public.community_profiles cp on cp.user_id = p.user_id
  left join (
    select post_id, count(*)::int as likes
    from public.community_likes
    group by post_id
  ) l on l.post_id = p.id
  left join (
    select post_id, count(*)::int as replies
    from public.community_replies
    group by post_id
  ) r on r.post_id = p.id
  left join public.community_polls po on po.post_id = p.id;

-- View moet RLS van uitvoerende user respecteren
alter view public.community_posts_view set (security_invoker = true);
