-- Extra velden voor symptoom-tracking (niet-breaking, allemaal nullable).
-- - linked_allergen_key: link aan reeds geïntroduceerd allergeen (of 'onbekend')
-- - time_after_eating:   hoe snel na het eten? (enum)
-- - duration:            hoe lang duurde het? (enum)
-- - worsened:            werden symptomen erger? (enum)
-- - behavior:            hoe gedroeg kindje zich? (enum)

ALTER TABLE child_symptoms
  ADD COLUMN IF NOT EXISTS linked_allergen_key text,
  ADD COLUMN IF NOT EXISTS time_after_eating   text,
  ADD COLUMN IF NOT EXISTS duration            text,
  ADD COLUMN IF NOT EXISTS worsened            text,
  ADD COLUMN IF NOT EXISTS behavior            text;

-- Index op linked_allergen_key — handig voor latere rapportage per allergeen.
CREATE INDEX IF NOT EXISTS child_symptoms_linked_allergen_idx
  ON child_symptoms (child_id, linked_allergen_key)
  WHERE linked_allergen_key IS NOT NULL;
