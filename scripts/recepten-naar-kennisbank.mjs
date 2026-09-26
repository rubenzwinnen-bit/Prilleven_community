#!/usr/bin/env node
/**
 * recepten-naar-kennisbank.mjs — synchroniseert de weekschema-recepten met de
 * kennisbank van HapjesHeld (`documents`). De logica staat in
 * api/_lib/recipe-knowledge.mjs; dezelfde sync draait elke nacht via
 * api/cron/recepten-kennisbank.mjs. Dit script is voor met de hand (bv. na een
 * receptaanpassing die niet tot morgen kan wachten) en voor een droge run.
 *
 * Gebruik (vanuit de projectroot):
 *   node --env-file=.env.local scripts/recepten-naar-kennisbank.mjs            (toon enkel, schrijft niets)
 *   node --env-file=.env.local scripts/recepten-naar-kennisbank.mjs --schrijf  (embed + schrijf naar productie)
 */

import { syncRecipeKnowledge } from '../api/_lib/recipe-knowledge.mjs';

const SCHRIJF = process.argv.includes('--schrijf');
const r = await syncRecipeKnowledge({ schrijf: SCHRIJF });

for (const f of [...r.nieuw, ...r.gewijzigd]) {
  console.log(`\n── ${f.id} · ${f.category} · ${f.age_min_months}–${f.age_max_months} mnd\n${f.title}\n${f.content}`);
}
for (const k of r.gekoppeld) console.log(`↔ ${k.name}  →  ${k.docId} (${k.title})`);
for (const k of r.ontkoppeld) console.log(`✕ koppeling weg: ${k.docId} (${k.title})`);
for (const id of r.verwijderd) console.log(`✕ fragment weg: ${id}`);

console.log(`\n${r.recepten} recepten · ${r.nieuw.length} nieuw · ${r.gewijzigd.length} gewijzigd · ${r.verwijderd.length} verwijderd · ${r.gekoppeld.length} gekoppeld · ${r.ontkoppeld.length} ontkoppeld`);
console.log(SCHRIJF ? '✓ Weggeschreven naar productie.' : 'Niets geschreven. Voeg --schrijf toe om te embedden en naar productie te schrijven.');
