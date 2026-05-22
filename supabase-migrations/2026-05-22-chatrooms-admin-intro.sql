-- ============================================================
-- Admin-intro-bericht per chat-room
--   1 bericht per room, alleen admins kunnen het zetten/wijzigen.
--   Wordt in de UI bovenaan de room getoond als een chat-bericht
--   met avatar + nickname + Admin-badge van de auteur.
-- ============================================================

ALTER TABLE chat_rooms
  ADD COLUMN IF NOT EXISTS admin_intro_message    text,
  ADD COLUMN IF NOT EXISTS admin_intro_user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS admin_intro_updated_at timestamptz;

-- Lengte-check: leeg (NULL) of 1..4000 tekens.
ALTER TABLE chat_rooms DROP CONSTRAINT IF EXISTS chat_rooms_admin_intro_len;
ALTER TABLE chat_rooms ADD CONSTRAINT chat_rooms_admin_intro_len
  CHECK (admin_intro_message IS NULL
         OR (char_length(admin_intro_message) BETWEEN 1 AND 4000));

-- ------------------------------------------------------------
-- Seed: kopieer 'Een woordje van de bouwer' uit chat_topics
-- naar admin_intro op de feedback-room, en verwijder dat topic.
-- Idempotent: doet niets als het topic er al niet meer is.
-- ------------------------------------------------------------
DO $$
DECLARE
  src_topic_id     uuid;
  src_body         text;
  src_user_id      uuid;
  src_created_at   timestamptz;
  feedback_room_id uuid;
BEGIN
  SELECT id INTO feedback_room_id
  FROM chat_rooms
  WHERE slug = 'feedback';

  IF feedback_room_id IS NULL THEN
    RETURN;
  END IF;

  SELECT id, body, user_id, created_at
    INTO src_topic_id, src_body, src_user_id, src_created_at
  FROM chat_topics
  WHERE room_id = feedback_room_id
    AND title = 'Een woordje van de bouwer'
  ORDER BY created_at ASC
  LIMIT 1;

  IF src_topic_id IS NOT NULL THEN
    UPDATE chat_rooms
       SET admin_intro_message    = src_body,
           admin_intro_user_id    = src_user_id,
           admin_intro_updated_at = src_created_at
     WHERE id = feedback_room_id;

    -- Verwijder het oorspronkelijke topic (replies cascaden mee via FK).
    DELETE FROM chat_topics WHERE id = src_topic_id;
  END IF;
END $$;
