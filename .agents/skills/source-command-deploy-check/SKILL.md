---
name: "source-command-deploy-check"
description: "Pre-deploy sanity check — vangt typische deploy-fouten af vóór je naar main pusht"
---

# source-command-deploy-check

Use this skill when the user asks to run the migrated source command `deploy-check`.

## Command Template

Doe een complete sanity-check vóór ik naar productie deploy. Loop alle stappen door en rapporteer per item een status (✓ ok / ✗ probleem / ⚠ aandacht).

## 1. Branch & git-status
- Toon huidige branch (`git branch --show-current`).
- Toon hoeveel commits voor/achter op `main` (`git rev-list --left-right --count main...HEAD`).
- Toon of er uncommitted changes zijn (`git status --short`).
- Als ik op `main` zit: ✓. Als op een andere branch: ⚠ — vermeld dat een merge naar main nog moet gebeuren.

## 2. Cache-buster check (KRITISCH)
Als JS of CSS bestanden gewijzigd zijn t.o.v. de laatst gepushte versie, MOET de cache-buster gebumpt zijn.

- Vind de huidige cache-buster versie (grep `v=X.Y.Z` in `index.html`).
- Vergelijk met de versie in de laatst gepushte commit (`git show origin/main:index.html | grep "v="`).
- Lijst de gewijzigde `.js` en `.css` bestanden t.o.v. `origin/main` (`git diff --name-only origin/main -- '*.js' '*.css'`).
- Als er JS/CSS-wijzigingen zijn EN de cache-buster nog dezelfde is: ✗ "Bump cache-buster vóór deploy."
- Verifieer dat de cache-buster CONSISTENT is over alle bestanden: alle `v=X.Y.Z` voorkomens moeten dezelfde waarde hebben. Gebruik `grep -rho "v=[0-9.]*" --include="*.js" --include="*.html" --include="*.css" | sort -u`.
- Als er meerdere versies tegelijk in de code staan: ✗ "Cache-buster inconsistent — sync alle bestanden naar dezelfde versie."

## 3. Nieuwe SQL-migraties
- Lijst nieuwe `.sql` files in `supabase-migrations/` t.o.v. `origin/main` (`git diff --name-only origin/main -- 'supabase-migrations/*.sql'`).
- Als er nieuwe zijn: ⚠ "Vergeet niet deze migraties handmatig in Supabase SQL Editor te draaien:" + lijst de bestanden.
- Geen pipeline = altijd handmatig.

## 4. Env-vars
- Grep naar `process.env.X` references in `/api` (alleen `.mjs` files).
- Vergelijk met `.env.example`.
- Als er env-vars in code staan die niet in `.env.example` staan: ⚠ "Voeg toe aan `.env.example` + zet ze in Vercel project settings:" + lijst de ontbrekende.
- Negeer standaard Node-vars (NODE_ENV, etc.).

## 5. Gevoelige bestanden geraakt
Check of de diff t.o.v. `origin/main` deze bestanden raakt:
- `api/webhooks/plugpay.mjs` → ⚠ "Webhook gewijzigd — dubbelcheck dat ik dit bewust heb goedgekeurd."
- `api/_lib/auth.mjs` → ⚠ "Auth gewijzigd — bevestig met mij vóór deploy."
- `api/_lib/subscription.mjs` of `api/subscription-status.mjs` → ⚠ "Subscription/billing gewijzigd — bevestig vóór deploy."
- `api/_lib/rate-limit.mjs` → ⚠ "Rate-limit constanten gewijzigd — kan iedereen tegelijk raken."
- `api/chat.mjs` (specifiek de SYSTEM_PROMPT) → ⚠ "Chat system-prompt gewijzigd — toon-impact op alle gebruikers."
- `vercel.json` → ⚠ "Vercel config gewijzigd — controleer rewrites/headers/functions."

## 6. AGENTS.md sync
- Zijn de wijzigingen significant genoeg om in een AGENTS.md te documenteren?
- Zo ja en het is nog niet gebeurd: ⚠ "Overweeg `/update-docs` te draaien vóór deploy zodat de docs kloppen."

## 7. Eindrapport
Sluit af met een duidelijke eindstatus:

**Als alles ✓:**
```
✅ KLAAR OM TE PUSHEN
Branch: <branch>, X commits ahead of main.
Geen blockers gevonden.
```

**Als er ✗ items zijn:**
```
🛑 NIET PUSHEN — los deze blockers eerst op:
- <blocker 1>
- <blocker 2>
```

**Als er ⚠ items zijn maar geen ✗:**
```
⚠️  PUSHEN KAN, MAAR LET OP:
- <waarschuwing 1>
- <waarschuwing 2>

Bevestig dat ik dit gezien heb voor je doorgaat.
```

## Wat NIET doen
- Geen wijzigingen maken — dit is alleen een check, geen fix.
- Niet zelf de cache-buster bumpen of bestanden aanpassen — alleen rapporteren.
- Niet zelf `git push` uitvoeren — dat doe ik altijd zelf.
- Niet de migraties zelf draaien — die zet ik handmatig in Supabase.
