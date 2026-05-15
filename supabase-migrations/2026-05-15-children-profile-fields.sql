-- Uitbreiding children-tabel voor profielpagina
-- Voegt velden toe voor eczeem, bekende allergieën, eerdere reacties en opmerkingen.
-- De kolommen 'name', 'birthdate' en 'texture_preference' bestaan al.

ALTER TABLE public.children
  ADD COLUMN IF NOT EXISTS has_eczema          boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS known_allergies     text[]   NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS previous_reactions  text
    CONSTRAINT children_previous_reactions_length CHECK (previous_reactions IS NULL OR char_length(previous_reactions) <= 1000),
  ADD COLUMN IF NOT EXISTS notes               text
    CONSTRAINT children_notes_length CHECK (notes IS NULL OR char_length(notes) <= 500);
