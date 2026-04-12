-- ============================================
-- STORAGE POLICIES VOOR ingredient-icons BUCKET
--
-- Lost het probleem op:
--   "new row violates row-level security policy"
-- bij het uploaden van iconen.
--
-- De sb_publishable_ key werkt mogelijk niet met
-- TO anon, daarom gebruiken we TO public (alle rollen).
-- ============================================

-- Verwijder eventueel oude/niet-werkende policies
DROP POLICY IF EXISTS "ingredient-icons-insert" ON storage.objects;
DROP POLICY IF EXISTS "ingredient-icons-update" ON storage.objects;
DROP POLICY IF EXISTS "ingredient-icons-select" ON storage.objects;
DROP POLICY IF EXISTS "ingredient-icons-delete" ON storage.objects;
DROP POLICY IF EXISTS "Allow public insert ingredient-icons" ON storage.objects;
DROP POLICY IF EXISTS "Allow public update ingredient-icons" ON storage.objects;
DROP POLICY IF EXISTS "Allow public select ingredient-icons" ON storage.objects;
DROP POLICY IF EXISTS "Allow public delete ingredient-icons" ON storage.objects;

-- SELECT: iedereen mag iconen lezen (publieke bucket)
CREATE POLICY "Allow public select ingredient-icons"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'ingredient-icons');

-- INSERT: iedereen mag iconen uploaden
CREATE POLICY "Allow public insert ingredient-icons"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'ingredient-icons');

-- UPDATE: nodig voor x-upsert (bestaande bestanden overschrijven)
CREATE POLICY "Allow public update ingredient-icons"
ON storage.objects FOR UPDATE
TO public
USING (bucket_id = 'ingredient-icons');

-- DELETE: iconen verwijderen
CREATE POLICY "Allow public delete ingredient-icons"
ON storage.objects FOR DELETE
TO public
USING (bucket_id = 'ingredient-icons');
