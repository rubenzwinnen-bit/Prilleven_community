-- ============================================
-- MIGRATION: Voeg "portions" kolom toe aan recipes
-- Datum: 2026-04-08
--
-- Deze migratie voegt een aantal-porties veld toe
-- aan de recepten zodat we kunnen tonen "voor X
-- personen" of "12 koekjes" enz.
--
-- Voer dit ÉÉN keer uit in de Supabase SQL Editor:
--   https://supabase.com/dashboard/project/ynrdoxukevhzupjvcjuw/sql/new
-- ============================================

-- 1. Voeg de kolom toe (default 1 zodat oude recepten een waarde hebben)
ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS portions integer NOT NULL DEFAULT 1;

-- 2. Optioneel: backfill bestaande recepten naar 1 portie
--    (de DEFAULT zorgt hier al voor, maar voor de zekerheid)
UPDATE recipes
SET portions = 1
WHERE portions IS NULL;

-- 3. Voeg een check constraint toe: porties moet positief zijn
ALTER TABLE recipes
  DROP CONSTRAINT IF EXISTS recipes_portions_positive;

ALTER TABLE recipes
  ADD CONSTRAINT recipes_portions_positive CHECK (portions > 0);

-- ============================================
-- KLAAR
-- Test met:
--   SELECT id, name, portions FROM recipes LIMIT 5;
-- ============================================
