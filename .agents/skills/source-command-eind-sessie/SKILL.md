---
name: "source-command-eind-sessie"
description: "Sluit de sessie netjes af met handover-prompt voor de volgende chat"
---

# source-command-eind-sessie

Use this skill when the user asks to run the migrated source command `eind-sessie`.

## Command Template

Sluit deze sessie netjes af zodat ik soepel kan verdergaan in een nieuwe chat. Voer de stappen uit in volgorde.

## 1. Sync AGENTS.md's
Bekijk wat er deze sessie gewijzigd is en update de relevante AGENTS.md bestanden indien nodig (zelfde logica als `/update-docs`):
- Nieuwe endpoints/tabellen/conventies/valkuilen → de meest specifieke submap-AGENTS.md.
- Project-breed → root AGENTS.md.
- Beknopt: één regel of bullet per wijziging.

## 2. Update PLAN-TIMELINE.md
Open `PLAN-TIMELINE.md` en voeg toe / werk bij:
- Wat is vandaag afgerond? (concrete bullets)
- Wat is de volgende stap? (1-3 concrete acties)
- Zijn er beslissingen genomen die ergens vastgelegd moeten worden?
- Open vragen of blockers?

Houd de toon en structuur van het bestaande bestand aan. Voeg een nieuwe datum-sectie toe ipv inline edits in oude secties.

## 3. Genereer een handover-prompt

Print onderaan je antwoord een **kant-en-klaar blok** dat ik kan kopiëren in een nieuwe chat. Format:

```
---HANDOVER VOOR NIEUWE CHAT---

Project: Pril Leven (zie AGENTS.md voor context)

Waar we mee bezig zijn:
<1-2 zinnen wat de huidige feature/bug is>

Vandaag gedaan:
- <bullet>
- <bullet>

Status:
<wat werkt, wat niet, waar het stopt>

Volgende stap:
<1 concrete actie>

Belangrijke beslissingen / context:
<zaken die niet uit code af te leiden zijn>

Begin met: <eerste concrete actie zoals "lees X.js en stel Y voor">
---/HANDOVER---
```

## 4. Korte samenvatting voor mij
Sluit af met:
- Welke AGENTS.md's je hebt aangepast (of "geen wijzigingen nodig").
- Of PLAN-TIMELINE.md is bijgewerkt.
- Of de handover-prompt klaar staat om te kopiëren.

## Wat NIET doen
- Geen nieuwe code schrijven — dit is een afsluit-command.
- Geen commit maken (tenzij ik er expliciet om vraag).
- Geen verzonnen "open issues" — alleen wat we deze sessie hebben aangeraakt.
