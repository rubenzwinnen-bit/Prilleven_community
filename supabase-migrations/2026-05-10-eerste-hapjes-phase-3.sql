-- ============================================================
-- Eerste Hapjes — Fase 3 toevoegen (fruit-maaltijd vanaf ~8-9 mnd)
-- ============================================================
-- Fase 3: warme maaltijd(en) + dagelijkse fruit-maaltijd.
-- Update CHECK-constraint van current_phase 0-2 → 0-3.
-- ============================================================

alter table public.eerste_hapjes_state
  drop constraint if exists eerste_hapjes_state_current_phase_check;

alter table public.eerste_hapjes_state
  add constraint eerste_hapjes_state_current_phase_check
  check (current_phase between 0 and 3);
