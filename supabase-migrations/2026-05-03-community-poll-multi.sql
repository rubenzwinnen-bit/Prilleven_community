-- ============================================================
-- Community polls: multi-vote ondersteuning
--   - Nieuwe kolom community_polls.allow_multi (boolean)
--   - Primary key op community_poll_votes uitgebreid met option_idx
--     zodat 1 user meerdere opties kan kiezen
-- ============================================================

alter table public.community_polls
  add column if not exists allow_multi boolean not null default false;

-- PK aanpassen: nu (post_id, user_id, option_idx) i.p.v. (post_id, user_id)
-- Zo kan een user meerdere opties stemmen wanneer allow_multi = true.
-- Voor single-vote polls handhaaft de API dat er maar 1 stem mag.
alter table public.community_poll_votes
  drop constraint if exists community_poll_votes_pkey;

alter table public.community_poll_votes
  add constraint community_poll_votes_pkey
  primary key (post_id, user_id, option_idx);
