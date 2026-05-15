-- ============================================================
-- Chatrooms: avatar_path uit community_profiles meenemen in view
-- Run in: Supabase Dashboard → SQL Editor → New query
-- Safe to run twice: drop + recreate view.
-- ============================================================

drop view if exists public.chat_topics_view;

create view public.chat_topics_view as
  select
    t.id,
    t.room_id,
    t.user_id,
    t.title,
    t.body,
    t.is_pinned,
    t.edited_at,
    t.created_at,
    cp.nickname,
    cp.avatar_path,
    coalesce(r.replies_count, 0) as replies_count,
    r.last_reply_at
  from public.chat_topics t
  left join public.community_profiles cp on cp.user_id = t.user_id
  left join (
    select topic_id,
           count(*)::int     as replies_count,
           max(created_at)   as last_reply_at
    from public.chat_replies
    group by topic_id
  ) r on r.topic_id = t.id;

alter view public.chat_topics_view set (security_invoker = true);

-- ============================================================
-- KLAAR.
-- ============================================================
