---
name: "source-command-update-docs"
description: "Synchroniseer AGENTS.md's met wijzigingen uit deze sessie"
---

# source-command-update-docs

Use this skill when the user asks to run the migrated source command `update-docs`.

## Command Template

Bekijk wat er in deze sessie is gewijzigd en update de relevante AGENTS.md bestanden waar nodig.

## Werkwijze

1. **Inventariseer** wat er deze sessie is veranderd:
   - Welke bestanden zijn aangepast?
   - Zijn er nieuwe endpoints, tabellen, conventies, env-vars, of patronen?
   - Zijn er valkuilen of gotcha's ontdekt die niet in AGENTS.md stonden?
   - Zijn bestaande conventies of regels gewijzigd?

2. **Beslis** of het de moeite waard is om in AGENTS.md te zetten:
   - **WEL** opnemen: nieuwe tabel/endpoint, gewijzigd gedrag, nieuwe valkuil, gewijzigde conventie, nieuwe env-var, niet-vanzelfsprekend patroon.
   - **NIET** opnemen: kleine bugfix in bestaand patroon, cosmetische CSS-tweak, copy-tekst-aanpassing.

3. **Update de juiste AGENTS.md**:
   - Wijziging in `/api` of `_lib` → `api/AGENTS.md`
   - Wijziging in `/js` of frontend-conventie → `js/AGENTS.md`
   - Nieuwe tabel/RPC/policy → `supabase-migrations/AGENTS.md`
   - Project-breed (taal, kleur, deploy, fundamentele regel) → root `AGENTS.md`
   - Update **alleen de meest specifieke** — niet meerdere AGENTS.md's voor één wijziging.

4. **Houd het beknopt**:
   - Eén regel of bullet per wijziging.
   - Geen lange uitleg, geen voorbeelden tenzij echt nodig.
   - Volg de bestaande structuur en stijl van het bestand.

5. **Rapporteer** aan het einde wat je hebt aangepast (of waarom je niets hebt aangepast als alles al correct gedocumenteerd was).

## Wat NIET doen
- Geen nieuwe secties aanmaken zonder reden — sluit aan bij bestaande structuur.
- Geen herschrijving van wat al goed staat.
- Geen "binnenkort" of "TODO" toevoegen — alleen wat NU waar is.
