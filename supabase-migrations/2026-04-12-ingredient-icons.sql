-- ============================================
-- INGREDIENT ICONS
-- Tabel voor het opslaan van iconen per ingrediënt.
-- Elk ingrediënt krijgt een genormaliseerde naam
-- (lowercase, meervoud gestript) en een URL naar
-- de afbeelding in Supabase Storage.
-- ============================================

-- Tabel: ingredient_icons
CREATE TABLE IF NOT EXISTS ingredient_icons (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  icon_url text NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- RLS inschakelen
ALTER TABLE ingredient_icons ENABLE ROW LEVEL SECURITY;

-- Iedereen mag lezen (mobiele app gebruikt anon key)
CREATE POLICY "ingredient_icons_select" ON ingredient_icons
  FOR SELECT USING (true);

-- Iedereen mag invoegen (admin check is client-side)
CREATE POLICY "ingredient_icons_insert" ON ingredient_icons
  FOR INSERT WITH CHECK (true);

-- Iedereen mag bijwerken
CREATE POLICY "ingredient_icons_update" ON ingredient_icons
  FOR UPDATE USING (true);

-- Iedereen mag verwijderen
CREATE POLICY "ingredient_icons_delete" ON ingredient_icons
  FOR DELETE USING (true);
