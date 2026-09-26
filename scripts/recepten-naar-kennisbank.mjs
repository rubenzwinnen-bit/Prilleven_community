#!/usr/bin/env node
/**
 * recepten-naar-kennisbank.mjs — zet recepten uit de weekschema-tabel `recipes`
 * als fragmenten in de kennisbank (`documents`), zodat HapjesHeld ze kent.
 *
 * Neemt enkel recepten op die nog nergens in de kennisbank staan (naam komt in
 * geen titel of tekst voor). Fragmenten krijgen id `wks-<recipe id>`, dus opnieuw
 * draaien werkt ze bij in plaats van dubbel toe te voegen.
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
// Staan al in de kennisbank onder een andere naam (Eten met handjes / Brooddoos).
const AL_GEDEKT = new Set(['Berenhap (gehaktballetjes)', 'Fisch&chips', 'Blondies met bonen']);

const SOORT = {
  'recept-warm': 'warme maaltijd',
  'recept-ontbijt': 'ontbijt',
  'snack': 'snack',
  'recept-fruit': 'fruit',
};

const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

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
  supabase.from('documents').select('id, title, content'),
]);
if (rErr || dErr) throw new Error((rErr || dErr).message);

const anderen = docs.filter(d => !d.id.startsWith(ID_PREFIX)).map(d => norm(`${d.title} ${d.content}`));
const ontbrekend = recepten.filter(r => !AL_GEDEKT.has(r.name) && !anderen.some(t => t.includes(norm(r.name))));
const fragmenten = ontbrekend.map(naarFragment);

for (const f of fragmenten) {
  console.log(`\n── ${f.id} · ${f.category} · ${f.age_min_months}–${f.age_max_months} mnd\n${f.title}\n${f.content}`);
}
console.log(`\n${fragmenten.length} van ${recepten.length} recepten ontbreken in de kennisbank.`);

if (!SCHRIJF) {
  console.log('Niets geschreven. Voeg --schrijf toe om te embedden en naar productie te schrijven.');
  process.exit(0);
}

const embeddings = await embed(fragmenten.map(f => `${f.title}\n\n${f.content}`));
const rijen = fragmenten.map((f, i) => ({ ...f, embedding: embeddings[i] }));
const { error: uErr } = await supabase.from('documents').upsert(rijen, { onConflict: 'id' });
if (uErr) throw new Error(`Upsert: ${uErr.message}`);
console.log(`✓ ${rijen.length} fragmenten weggeschreven naar documents.`);
