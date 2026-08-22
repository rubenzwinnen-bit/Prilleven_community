---
name: "source-command-start-sessie"
description: "Snel up-to-speed in een nieuwe chat — leest status en stelt voor wat te doen"
---

# source-command-start-sessie

Use this skill when the user asks to run the migrated source command `start-sessie`.

## Command Template

Help me snel verder na een chat-wissel. Voer in volgorde uit:

## 1. Lees de status
- Lees `PLAN-TIMELINE.md` (de laatste 2-3 secties zijn meestal genoeg).
- Check `git status` en `git log --oneline -10` voor recente activiteit.
- Check de huidige branch (`git branch --show-current`).

## 2. Vat samen
Geef een korte status in 4 bullets:
- **Branch:** welke branch ben ik op, en t.o.v. main: voor of achter?
- **Laatst afgerond:** wat is volgens PLAN-TIMELINE de laatste afgewerkte taak?
- **Volgende stap:** wat staat er als next-up in PLAN-TIMELINE?
- **Uncommitted changes?** zijn er werk-in-uitvoering bestanden?

## 3. Stel voor
Eindig met **één** concrete vraag of voorstel, bijvoorbeeld:
- "Wil je verder met [volgende stap uit PLAN]?"
- "Er staan ongecommitteerde wijzigingen in X — eerst afmaken of iets anders?"
- "Branch X loopt 3 commits achter op main — eerst rebasen?"

Of als ik in mijn eerste bericht al een nieuwe taak heb genoemd:
- Bevestig wat je gaat doen, vraag om verheldering als nodig, en begin pas met code-werk na mijn 'go'.

## Wat NIET doen
- Geen volledige code-review of refactor-voorstellen ongevraagd.
- Geen nieuwe features bedenken die niet in PLAN-TIMELINE staan.
- Geen lange uitleg over wat het project is — AGENTS.md is al geladen.
- Niet meteen code schrijven zonder bevestiging van mij.
