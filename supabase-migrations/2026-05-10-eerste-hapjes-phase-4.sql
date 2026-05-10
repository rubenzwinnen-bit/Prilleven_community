-- ============================================================
-- Eerste Hapjes — Fase 4 toevoegen (ontbijt vanaf ~12 mnd)
-- ============================================================
-- Fase 4: alles van fase 3 (2 warme + fruit) + ontbijt-recept.
-- Update CHECK-constraint van current_phase 0-3 → 0-4.
-- ============================================================

alter table public.eerste_hapjes_state
  drop constraint if exists eerste_hapjes_state_current_phase_check;

alter table public.eerste_hapjes_state
  add constraint eerste_hapjes_state_current_phase_check
  check (current_phase between 0 and 4);
