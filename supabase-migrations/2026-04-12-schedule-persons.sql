-- Voeg personen en actief-status toe aan weekschema's
-- persons: aantal personen waarvoor ingrediënten worden berekend
-- is_active: slechts 1 schema per gebruiker kan actief zijn

ALTER TABLE schedules ADD COLUMN IF NOT EXISTS persons integer DEFAULT 4;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT false;
