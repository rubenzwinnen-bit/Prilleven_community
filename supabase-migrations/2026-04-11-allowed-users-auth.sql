-- ============================================
-- RLS POLICY VOOR ALLOWED_USERS - UPDATE
-- Staat toe dat de anon key de has_registered
-- kolom kan updaten van false naar true.
-- Dit gebeurt wanneer een betaalde gebruiker
-- voor het eerst een account aanmaakt.
--
-- Voer dit uit in de Supabase SQL Editor:
-- https://supabase.com/dashboard/project/ynrdoxukevhzupjvcjuw/sql/new
-- ============================================

-- Update policy: alleen has_registered mag op true gezet worden
CREATE POLICY "allow_anon_update_has_registered"
  ON allowed_users
  FOR UPDATE
  USING (true)
  WITH CHECK (has_registered = true);
