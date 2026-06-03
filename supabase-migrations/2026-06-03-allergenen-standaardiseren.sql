-- ============================================================
-- Allergenen standaardiseren naar de 9 canonieke flow-keys
-- (kippen-ei, pinda, noten, sesam, vis, schaaldieren, soja, tarwe, koemelk)
--
-- Mapping van oude -> nieuwe waarden:
--   gluten            -> tarwe
--   lactose/melk/zuivel -> koemelk
--   ei                -> kippen-ei
--
-- "lactose" is geen allergeen (suiker, niet eiwit); de allergeen-
-- referentie is "koemelk". Daarom verdwijnt lactose volledig.
--
-- Idempotent: kan veilig opnieuw gedraaid worden. Rijen zonder
-- oude waarden blijven ongemoeid. Dubbele waarden (bv. lactose+melk
-- -> 2x koemelk) worden ontdubbeld via DISTINCT.
--
-- LET OP: handmatig draaien in de Supabase SQL-editor (geen
-- automatische migrate-pipeline).
-- ============================================================

BEGIN;

-- 1) recepten.allergens (jsonb array) ------------------------
UPDATE recipes
SET allergens = (
  SELECT to_jsonb(array_agg(DISTINCT mapped.v))
  FROM (
    SELECT CASE elem
      WHEN 'gluten'  THEN 'tarwe'
      WHEN 'lactose' THEN 'koemelk'
      WHEN 'melk'    THEN 'koemelk'
      WHEN 'zuivel'  THEN 'koemelk'
      WHEN 'ei'      THEN 'kippen-ei'
      ELSE elem
    END AS v
    FROM jsonb_array_elements_text(allergens) AS elem
  ) AS mapped
)
WHERE allergens IS NOT NULL
  AND jsonb_array_length(allergens) > 0
  AND allergens ?| array['gluten','lactose','melk','zuivel','ei'];

-- 2) bewaarde filters: schedules.excluded_allergens (jsonb array)
UPDATE schedules
SET excluded_allergens = (
  SELECT to_jsonb(array_agg(DISTINCT mapped.v))
  FROM (
    SELECT CASE elem
      WHEN 'gluten'  THEN 'tarwe'
      WHEN 'lactose' THEN 'koemelk'
      WHEN 'melk'    THEN 'koemelk'
      WHEN 'zuivel'  THEN 'koemelk'
      WHEN 'ei'      THEN 'kippen-ei'
      ELSE elem
    END AS v
    FROM jsonb_array_elements_text(excluded_allergens) AS elem
  ) AS mapped
)
WHERE excluded_allergens IS NOT NULL
  AND jsonb_array_length(excluded_allergens) > 0
  AND excluded_allergens ?| array['gluten','lactose','melk','zuivel','ei'];

-- 3) kinderen.known_allergies (text[]) -----------------------
--    lactose -> koemelk (per beslissing), incl. dedup.
UPDATE children
SET known_allergies = (
  SELECT array_agg(DISTINCT
    CASE val
      WHEN 'gluten'  THEN 'tarwe'
      WHEN 'lactose' THEN 'koemelk'
      WHEN 'melk'    THEN 'koemelk'
      WHEN 'zuivel'  THEN 'koemelk'
      WHEN 'ei'      THEN 'kippen-ei'
      ELSE val
    END
  )
  FROM unnest(known_allergies) AS val
)
WHERE known_allergies IS NOT NULL
  AND array_length(known_allergies, 1) > 0
  AND known_allergies && ARRAY['gluten','lactose','melk','zuivel','ei'];

COMMIT;

-- ============================================================
-- Controle-queries (los draaien na de migratie):
--   SELECT val, COUNT(*) FROM recipes, jsonb_array_elements_text(allergens) val GROUP BY val ORDER BY 2 DESC;
--   SELECT val, COUNT(*) FROM schedules, jsonb_array_elements_text(excluded_allergens) val GROUP BY val ORDER BY 2 DESC;
--   SELECT val, COUNT(*) FROM children, unnest(known_allergies) val WHERE archived_at IS NULL GROUP BY val ORDER BY 2 DESC;
-- Verwacht: enkel nog tarwe/koemelk/kippen-ei + de overige canonieke keys.
-- ============================================================
