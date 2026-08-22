---
name: eind-sessie
description: "Sluit een Pril Leven-werksessie af en maak een overdraagbare status. Gebruik bij /eind-sessie, $eind-sessie, 'eind sessie' of wanneer de gebruiker documentatie, PLAN-TIMELINE en een handover voor een volgende chat wil synchroniseren."
---

# Eind sessie

Leg alleen vast wat in de huidige sessie daadwerkelijk is besloten, gewijzigd of geverifieerd.

## 1. Inventariseer

- Controleer branch, recente commits en `git status --short --branch`.
- Bekijk de relevante diff en onderscheid afgerond werk van open of ongecommitteerd werk.
- Noteer uitgevoerde controles, resterende blockers en beslissingen die niet vanzelf uit de code blijken.

## 2. Synchroniseer assistentdocumentatie

- Voeg duurzame nieuwe endpoints, tabellen, conventies, env-vars of valkuilen beknopt toe aan het meest specifieke bestaande `AGENTS.md`- of `CLAUDE.md`-bestand.
- Houd bestaande AGENTS/CLAUDE-spiegels inhoudelijk gelijk wanneer dezelfde projectregel in beide staat.
- Leg cosmetische tweaks, gewone bugfixes en tijdelijke implementatiedetails niet als algemene regel vast.

## 3. Werk `PLAN-TIMELINE.md` bij

- Werk de meest recente relevante datum- of featuresectie bij, of voeg een nieuwe datumsectie toe als die nog niet bestaat.
- Leg vast: afgerond werk, verificatie, beslissingen, open vragen en maximaal drie concrete vervolgstappen.
- Voorkom dubbele geschiedenis en verzin geen open issues.

## 4. Geef een kopieerbare handover

Sluit het antwoord af met dit ingevulde formaat:

```text
---HANDOVER VOOR NIEUWE CHAT---

Project: Pril Leven (lees AGENTS.md voor de projectregels)

Waar we mee bezig zijn:
<1-2 zinnen>

Vandaag gedaan:
- <feitelijke bullet>

Status:
<branch, commit/pushstatus, wat werkt en wat nog openstaat>

Volgende stap:
<één concrete actie>

Belangrijke beslissingen / context:
<alleen niet-vanzelfsprekende context>

Begin met:
<eerste concrete lees- of uitvoeractie>
---/HANDOVER---
```

Vermeld vóór het handoverblok kort welke documentatie is aangepast en of er ongecommitteerde wijzigingen overblijven.

## Grenzen

- Schrijf tijdens deze afsluiting geen nieuwe featurecode.
- Commit of push niet, tenzij de gebruiker dat expliciet vraagt.
- Verberg geen falende checks of onafgewerkt werk achter de formulering “afgerond”.
