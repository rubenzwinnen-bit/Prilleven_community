-- ============================================================
-- Verwijder de 15-minuten edit-window in RLS-policies.
-- Eigen posts/replies/topics/chat-replies zijn voortaan
-- altijd bewerkbaar door de eigenaar.
-- Run in: Supabase Dashboard → SQL Editor → New query.
-- ============================================================

-- community_posts
drop policy if exists "update own post 15min" on public.community_posts;
create policy "update own post"
  on public.community_posts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- community_replies
drop policy if exists "update own reply 15min" on public.community_replies;
create policy "update own reply"
  on public.community_replies for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- chat_topics (behoud is_pinned = false in with check, zodat
-- gebruikers via eigen update geen pin kunnen toggelen)
drop policy if exists "update own topic 15min" on public.chat_topics;
create policy "update own topic"
  on public.chat_topics for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and is_pinned = false);

-- chat_replies
drop policy if exists "update own chat reply 15min" on public.chat_replies;
create policy "update own chat reply"
  on public.chat_replies for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- KLAAR.
-- ============================================================
