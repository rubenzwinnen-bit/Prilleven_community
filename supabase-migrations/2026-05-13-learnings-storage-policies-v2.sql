-- Storage INSERT policies voor learnings-buckets (v2)
-- De eerdere policies met "TO authenticated" werden niet correct herkend
-- (waarschijnlijk door publishable-key / role-detectie). We schakelen over
-- naar het patroon dat al wél werkt voor community-images:
--   TO public  +  auth.role() = 'authenticated' in WITH CHECK

-- Eerst de oude (niet-werkende) policies droppen
DROP POLICY IF EXISTS "learnings-thumb insert authenticated" ON storage.objects;
DROP POLICY IF EXISTS "learnings-pdf insert authenticated"   ON storage.objects;
DROP POLICY IF EXISTS "learnings-video insert authenticated" ON storage.objects;

-- Nieuwe INSERT policies (zelfde patroon als community-images)
CREATE POLICY "learnings-thumb insert"
ON storage.objects FOR INSERT
TO public
WITH CHECK (
  bucket_id = 'learnings-thumb'
  AND auth.role() = 'authenticated'
);

CREATE POLICY "learnings-pdf insert"
ON storage.objects FOR INSERT
TO public
WITH CHECK (
  bucket_id = 'learnings-pdf'
  AND auth.role() = 'authenticated'
);

CREATE POLICY "learnings-video insert"
ON storage.objects FOR INSERT
TO public
WITH CHECK (
  bucket_id = 'learnings-video'
  AND auth.role() = 'authenticated'
);
