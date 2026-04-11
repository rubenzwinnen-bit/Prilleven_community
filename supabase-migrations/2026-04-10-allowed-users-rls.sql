-- ============================================
-- RLS POLICY VOOR ALLOWED_USERS TABEL
-- Zorgt ervoor dat de anon key de tabel kan
-- lezen zodat de frontend kan controleren of
-- een e-mailadres betaald heeft.
--
-- Voer dit uit in de Supabase SQL Editor:
-- https://supabase.com/dashboard/project/ynrdoxukevhzupjvcjuw/sql/new
-- ============================================

-- Stap 1: Zorg dat RLS aan staat
ALTER TABLE allowed_users ENABLE ROW LEVEL SECURITY;

-- Stap 2: Maak een read-only policy voor anon gebruikers
-- Alleen SELECT is toegestaan, geen INSERT/UPDATE/DELETE
CREATE POLICY "allow_anon_select"
  ON allowed_users
  FOR SELECT
  USING (true);
