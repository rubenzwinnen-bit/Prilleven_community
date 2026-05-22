-- Profiel-opschoning: dieet verplaatsen naar algemeen profiel + kind-data migreren
-- + overbodige kopie-kolommen droppen op chat_user_profiles.
--
-- Wijzigingen:
--  1. ADD COLUMN community_profiles.family_diet text[]
--  2. Data-migratie: voor users met kinderen in chat_user_profiles.children (JSONB)
--     maar zonder rijen in public.children → kopieer naar children-tabel.
--  3. Data-migratie: voor users met diet in chat_user_profiles EN een bestaand
--     community_profile → zet community_profiles.family_diet.
--  4. DROP COLUMN op chat_user_profiles: display_name, children, diet, allergies,
--     notes. Tabel houdt enkel nog memory_enabled (+ user_id, timestamps).
--
-- NIET in deze migratie (bewust):
--  - texture_preference en has_eczema op children blijven staan (data behouden,
--    enkel uit UI verwijderd).

BEGIN;

-- 1) family_diet kolom op community_profiles ------------------------------
ALTER TABLE public.community_profiles
  ADD COLUMN IF NOT EXISTS family_diet text[] NOT NULL DEFAULT '{}';

-- Constraint: alleen toegestane diet-keys (zelfde set als oude ALLOWED_DIET).
ALTER TABLE public.community_profiles
  DROP CONSTRAINT IF EXISTS community_profiles_family_diet_check;

ALTER TABLE public.community_profiles
  ADD CONSTRAINT community_profiles_family_diet_check CHECK (
    family_diet <@ ARRAY[
      'vegetarisch','veganistisch','glutenvrij','lactosevrij',
      'pescotarisch','halal','kosher','geen-varken','geen-rund'
    ]::text[]
  );

-- 2) Kind-data migreren ---------------------------------------------------
-- Voor elke chat_user_profiles.children JSON-entry van een user die NOG GEEN
-- niet-gearchiveerde kinderen in public.children heeft: insert.
-- We migreren alleen als de user géén bestaande rijen heeft (om dubbels te
-- voorkomen); is er één enkel record dan negeren we de JSON-kopie volledig.
INSERT INTO public.children (user_id, name, birthdate, known_allergies, notes)
SELECT
  cup.user_id,
  COALESCE(NULLIF(TRIM(elem->>'name'), ''), 'Mijn kindje') AS name,
  CASE
    WHEN elem->>'birthdate' ~ '^\d{4}-\d{2}-\d{2}$'
      THEN (elem->>'birthdate')::date
    ELSE NULL
  END AS birthdate,
  CASE
    WHEN jsonb_typeof(elem->'allergies') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(elem->'allergies'))
    ELSE ARRAY[]::text[]
  END AS known_allergies,
  NULLIF(TRIM(elem->>'notes'), '') AS notes
FROM public.chat_user_profiles cup
CROSS JOIN LATERAL jsonb_array_elements(cup.children) elem
WHERE jsonb_typeof(cup.children) = 'array'
  AND jsonb_array_length(cup.children) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.children c
     WHERE c.user_id = cup.user_id
       AND c.archived_at IS NULL
  )
  -- birthdate is verplicht in /profiel UI; skip JSON-rijen zonder geldige datum
  AND elem->>'birthdate' ~ '^\d{4}-\d{2}-\d{2}$'
  -- children_birthdate_check eist: tussen vandaag en 10 jaar terug.
  -- JSON-data bevat soms typfouten (bv. 2925-03-21) → skippen ipv migratie laten falen.
  AND (elem->>'birthdate')::date <= CURRENT_DATE
  AND (elem->>'birthdate')::date >= (CURRENT_DATE - INTERVAL '10 years');

-- 3) Dieet migreren -------------------------------------------------------
-- Alleen waar al een community_profile bestaat (nickname NOT NULL).
-- 5 users zonder community_profile verliezen hun diet-voorkeur door de drop
-- in stap 4. De UI toonde die data al niet meer (RAG-modal is weg, /profiel
-- leest van community_profiles), dus functioneel verlies = 0. Ze kunnen
-- opnieuw kiezen zodra ze een nickname instellen.
UPDATE public.community_profiles cp
   SET family_diet = (
         SELECT COALESCE(
           ARRAY(
             SELECT unnest(cup.diet)
             INTERSECT
             SELECT unnest(ARRAY[
               'vegetarisch','veganistisch','glutenvrij','lactosevrij',
               'pescotarisch','halal','kosher','geen-varken','geen-rund'
             ]::text[])
           ),
           '{}'::text[]
         )
       ),
       updated_at = NOW()
  FROM public.chat_user_profiles cup
 WHERE cup.user_id = cp.user_id
   AND cup.diet IS NOT NULL
   AND array_length(cup.diet, 1) > 0;

-- 4) Overbodige kolommen droppen op chat_user_profiles --------------------
-- Na de migratie zit alle relevante data in public.children en
-- community_profiles.family_diet. De RAG-bot leest enkel nog memory_enabled
-- uit deze tabel.
ALTER TABLE public.chat_user_profiles
  DROP COLUMN IF EXISTS display_name,
  DROP COLUMN IF EXISTS children,
  DROP COLUMN IF EXISTS diet,
  DROP COLUMN IF EXISTS allergies,
  DROP COLUMN IF EXISTS notes;

COMMIT;
