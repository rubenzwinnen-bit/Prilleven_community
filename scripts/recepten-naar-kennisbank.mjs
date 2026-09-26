#!/usr/bin/env node
/**
 * recepten-naar-kennisbank.mjs — zet recepten uit de weekschema-tabel `recipes`
 * als fragmenten in de kennisbank (`documents`), zodat HapjesHeld ze kent.
 *
 * Een recept staat al in de kennisbank als een boekfragment exact dat recept is
 * (titel = receptnaam, of KOPPEL_HANDMATIG). Dat fragment krijgt metadata.recipe_id,
 * zodat HapjesHeld naar het recept in het weekschema kan linken. Alle andere
 * recepten krijgen een eigen fragment `wks-<recipe id>` (met hetzelfde recipe_id);
 * opnieuw draaien werkt die bij in plaats van dubbel toe te voegen.
 * Een naam die enkel ergens in een tekst voorkomt, telt niet: Eiermuffin en Tahini
 * koekjes staan in de gids/brooddoos als een ander recept met dezelfde naam.
 *
 * Gebruik (vanuit de projectroot):
 *   node --env-file=.env.local scripts/recepten-naar-kennisbank.mjs            (toon enkel, schrijft niets)
 *   node --env-file=.env.local scripts/recepten-naar-kennisbank.mjs --schrijf  (embed + upsert naar productie)
 */

import { supabase, VOYAGE_API_KEY } from '../api/_lib/clients.mjs';
import { getRecipeMinAge, getAllergenLabel } from '../js/utils.js';

const SCHRIJF = process.argv.includes('--schrijf');
const BRON = 'Weekschema Pril Leven';
const ID_PREFIX = 'wks-';
// Zelfde bovengrens als de andere receptfragmenten in de kennisbank.
const AGE_MAX = 36;
// Staan in de kennisbank onder een andere titel (Eten met handjes / Brooddoos).
const KOPPEL_HANDMATIG = {
  'Berenhap (gehaktballetjes)': 'emh-012-berenhap',
  'Fisch&chips': 'emh-026-fish-chips',
  'Blondies met bonen': 'bd-005-recept-bonen-blondies',
};

const SOORT = {
  'recept-warm': 'warme maaltijd',
  'recept-ontbijt': 'ontbijt',
  'snack': 'snack',
  'recept-fruit': 'fruit',
};

const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
// "Recept ontbijt: Avocado met 'soldaatjes'" → "Avocado met 'soldaatjes'"
const kaleTitel = t => t.replace(/^(recept|dag \d+)[^:]*:\s*/i, '').replace(/\(.*?\)/g, '');

function categorie(momenten) {
  if (momenten.includes('middag') || momenten.includes('avond')) return 'recept-warm';
  if (momenten.includes('ochtend')) return 'recept-ontbijt';
  if (momenten.includes('snack')) return 'snack';
  return 'recept-fruit';
}

function ingredient(i) {
  const eenheid = i.unit && i.unit !== 'stuk' ? ` ${i.unit}` : '';
  return `${i.amount ?? ''}${eenheid} ${i.name}`.trim();
}

function naarFragment(r) {
  const momenten = r.meal_moments || [];
  const cat = categorie(momenten);
  const vanaf = getRecipeMinAge({ minAgeMonths: r.min_age_months, mealMoments: momenten }) ?? 6;
  const allergenen = (r.allergens || []).map(a => getAllergenLabel(a).toLowerCase());
  const stappen = (r.preparation || []).map((s, n) => `${n + 1}. ${s.replace(/\s*\n\s*/g, ' ').trim()}`);

  const content = [
    `Recept uit het weekschema van Pril Leven. Voor ${r.portions} ${r.portions == 1 ? 'portie' : 'porties'}, ${r.cooking_time} minuten.`,
    // Leeftijd bewust niet in de tekst: ze komt uit het eetmoment, niet van Anneleen.
    // Ze dient enkel als leeftijdsfilter (age_min_months).
    `Eetmoment: ${momenten.join(', ')}.`,
    `Allergenen: ${allergenen.length ? allergenen.join(', ') : 'geen'}.`,
    `Ingrediënten: ${(r.ingredients || []).map(ingredient).join(', ')}.`,
    `Bereiding: ${stappen.join(' ')}`,
  ].join(' ');

  return {
    id: `${ID_PREFIX}${r.id}`,
    source: BRON,
    source_url: null,
    title: `Recept ${SOORT[cat]}: ${r.name}`,
    content,
    category: cat,
    age_min_months: vanaf,
    age_max_months: AGE_MAX,
    page_refs: null,
    metadata: { recipe_id: r.id },
  };
}

async function embed(teksten) {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${VOYAGE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: teksten, model: 'voyage-3-large', input_type: 'document' }),
  });
  if (!res.ok) throw new Error(`Voyage ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return [...data.data].sort((a, b) => a.index - b.index).map(d => d.embedding);
}

const [{ data: recepten, error: rErr }, { data: docs, error: dErr }] = await Promise.all([
  supabase.from('recipes').select('id, name, meal_moments, cooking_time, portions, min_age_months, allergens, ingredients, preparation').order('name'),
  supabase.from('documents').select('id, title, content, category, metadata'),
]);
if (rErr || dErr) throw new Error((rErr || dErr).message);

const receptDocs = docs.filter(d => !d.id.startsWith(ID_PREFIX) && /^(recept|snack)/.test(d.category || ''));
const boekDoc = r => (KOPPEL_HANDMATIG[r.name]
  ? docs.find(d => d.id === KOPPEL_HANDMATIG[r.name])
  : receptDocs.find(d => norm(kaleTitel(d.title)) === norm(r.name)));
const ontbrekend = recepten.filter(r => !boekDoc(r));
const fragmenten = ontbrekend.map(naarFragment);

for (const f of fragmenten) {
  console.log(`\n── ${f.id} · ${f.category} · ${f.age_min_months}–${f.age_max_months} mnd\n${f.title}\n${f.content}`);
}
console.log(`\n${fragmenten.length} van ${recepten.length} recepten ontbreken in de kennisbank.`);

const koppelingen = [];
for (const r of recepten) {
  const doc = boekDoc(r);
  if (doc && doc.metadata?.recipe_id !== r.id) koppelingen.push({ doc, recipe: r });
}
for (const { doc, recipe } of koppelingen) console.log(`↔ ${recipe.name}  →  ${doc.id} (${doc.title})`);
console.log(`${koppelingen.length} boekfragmenten te koppelen aan een weekschema-recept.`);

if (!SCHRIJF) {
  console.log('Niets geschreven. Voeg --schrijf toe om te embedden en naar productie te schrijven.');
  process.exit(0);
}

const embeddings = await embed(fragmenten.map(f => `${f.title}\n\n${f.content}`));
const rijen = fragmenten.map((f, i) => ({ ...f, embedding: embeddings[i] }));
const { error: uErr } = await supabase.from('documents').upsert(rijen, { onConflict: 'id' });
if (uErr) throw new Error(`Upsert: ${uErr.message}`);
console.log(`✓ ${rijen.length} fragmenten weggeschreven naar documents.`);

for (const { doc, recipe } of koppelingen) {
  const { error } = await supabase.from('documents')
    .update({ metadata: { ...(doc.metadata || {}), recipe_id: recipe.id } })
    .eq('id', doc.id);
  if (error) throw new Error(`Koppelen ${doc.id}: ${error.message}`);
}
console.log(`✓ ${koppelingen.length} boekfragmenten gekoppeld.`);
