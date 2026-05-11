-- ============================================================
-- Eerste Hapjes — fase-restructure
-- ============================================================
-- Nieuwe structuur (4 fases ipv 5):
--   Fase 0: Voorbereiden (readiness-checklist)        — < 7 mnd
--   Fase 1: 1 warme maaltijd                          — vanaf 6 mnd
--   Fase 2: 1 warme maaltijd + fruit                  — vanaf 8 mnd
--   Fase 3: 1 warme maaltijd + fruit + ontbijt        — vanaf 10 mnd
--
-- Fase 2 (oud "2 warme maaltijden") valt weg. We blijven bij 1 warme/dag.
-- Remap oude waardes naar nieuwe schaal:
--   oud 0 → nieuw 0
--   oud 1 → nieuw 1 (1 warm)
--   oud 2 → nieuw 1 (was 2 warm → naar 1 warm)
--   oud 3 → nieuw 2 (was 2 warm + fruit → naar 1 warm + fruit)
--   oud 4 → nieuw 3 (was 2 warm + fruit + ontbijt → naar 1 warm + fruit + ontbijt)
-- ============================================================

-- 1. Drop oude check (0-4) zodat update kan
alter table public.eerste_hapjes_state
  drop constraint if exists eerste_hapjes_state_current_phase_check;

-- 2. Remap bestaande data
update public.eerste_hapjes_state set current_phase = 1 where current_phase = 2;
update public.eerste_hapjes_state set current_phase = 2 where current_phase = 3;
update public.eerste_hapjes_state set current_phase = 3 where current_phase = 4;

-- 3. Nieuwe check (0-3)
alter table public.eerste_hapjes_state
  add constraint eerste_hapjes_state_current_phase_check
  check (current_phase between 0 and 3);

-- 4. meals_per_day is altijd 1 in de nieuwe structuur — reset eventuele 2-waardes
update public.eerste_hapjes_state set meals_per_day = 1 where meals_per_day = 2;
