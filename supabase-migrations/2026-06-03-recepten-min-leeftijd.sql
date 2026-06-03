-- Minimumleeftijd per recept (family-layer fase 2)
-- Voegt een optionele kolom toe: vanaf hoeveel maanden een recept geschikt is.
-- Leeg/NULL = geen expliciete leeftijd; de frontend valt dan terug op de
-- minimumleeftijd afgeleid van de eetmomenten (zie utils.js MEAL_MOMENT_MIN_AGE).

ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS min_age_months integer
    CONSTRAINT recipes_min_age_months_range
      CHECK (min_age_months IS NULL OR (min_age_months >= 0 AND min_age_months <= 60));
