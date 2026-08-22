---
name: start-sessie
description: "Start of hervat een Pril Leven-werksessie. Gebruik bij /start-sessie, $start-sessie, 'start sessie' of wanneer de gebruiker na een chatwissel snel de actuele branch, voortgang en eerstvolgende stap wil kennen."
---

# Start sessie

Breng de gebruiker snel en feitelijk terug in de actuele projectcontext.

## Status verzamelen

- Lees `AGENTS.md` en de laatste relevante secties van `PLAN-TIMELINE.md`.
- Controleer de huidige branch, `git status --short --branch`, de laatste tien commits en het verschil in commits met `origin/main`.
- Lees alleen aanvullende submapdocumentatie als de genoemde vervolgstap die map raakt.
- Behandel niet-gecommitteerde wijzigingen als werk van de gebruiker; wijzig of verwijder ze niet.

## Terugkoppeling

Geef een compacte status met:

- **Branch:** naam en aantal commits voor/achter op `origin/main`.
- **Laatst afgerond:** de recentste aantoonbaar voltooide taak.
- **Huidige staat:** relevante ongecommitteerde wijzigingen, blockers of een schone branch.
- **Volgende stap:** één concrete actie uit het plan.

Als de gebruiker alleen de skill heeft gestart, eindig met één gerichte vraag of voorstel. Als dezelfde boodschap al een concrete nieuwe taak bevat, vat de status kort samen en voer die taak daarna uit; vraag alleen om verduidelijking als een ontbrekende keuze het resultaat wezenlijk verandert.

## Grenzen

- Start geen ongevraagde review, refactor of nieuwe feature.
- Verzin geen voortgang die niet uit Git of `PLAN-TIMELINE.md` blijkt.
- Maak geen commits, pushes of externe wijzigingen alleen omdat deze skill gestart is.
