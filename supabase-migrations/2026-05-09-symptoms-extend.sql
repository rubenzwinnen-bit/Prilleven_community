-- ============================================================
-- Eerste Hapjes — symptoom-enum uitbreiden (brok G.2)
-- Voegt 6 nieuwe symptoom-keys toe aan child_symptoms.symptom_type:
--   gewicht, hoesten, verstopping, geen_eetlust, prikkelbaar, lethargie
-- Bestaande logs blijven geldig (additieve uitbreiding van CHECK).
-- ============================================================

alter table public.child_symptoms
  drop constraint if exists child_symptoms_symptom_type_check;

alter table public.child_symptoms
  add constraint child_symptoms_symptom_type_check
  check (symptom_type in (
    'huid','buik','diarree','braken','slaap',
    'koorts','jeuk','zwelling','ademhaling','anders',
    'gewicht','hoesten','verstopping','geen_eetlust','prikkelbaar','lethargie'
  ));
