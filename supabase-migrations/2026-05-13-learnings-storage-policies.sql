-- Storage INSERT policies voor learnings-buckets
-- Hierdoor kunnen ingelogde (authenticated) gebruikers bestanden rechtstreeks
-- uploaden naar de Supabase Storage REST API (POST /storage/v1/object/...)
-- zonder tussenliggende signed-upload-URL.
-- Zowel learnings-thumb (publieke bucket), learnings-pdf als learnings-video
-- krijgen een INSERT-policy voor de 'authenticated' rol.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'learnings-thumb insert authenticated'
  ) THEN
    CREATE POLICY "learnings-thumb insert authenticated"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'learnings-thumb');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'learnings-pdf insert authenticated'
  ) THEN
    CREATE POLICY "learnings-pdf insert authenticated"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'learnings-pdf');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'learnings-video insert authenticated'
  ) THEN
    CREATE POLICY "learnings-video insert authenticated"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'learnings-video');
  END IF;
END$$;
