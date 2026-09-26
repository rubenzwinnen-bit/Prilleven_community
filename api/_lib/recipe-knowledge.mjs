// Weekschema-recepten ↔ kennisbank van HapjesHeld (`documents`).
// Gebruikt door de nachtelijke cron (api/cron/recepten-kennisbank.mjs) en door
// scripts/recepten-naar-kennisbank.mjs (met de hand, met een droge run).
//
// Een recept staat al in de kennisbank als een boekfragment exact dat recept is
// (titel = receptnaam, of KOPPEL_HANDMATIG). Dat fragment krijgt metadata.recipe_id,
// zodat HapjesHeld naar het recept in het weekschema kan linken. Alle andere
// recepten krijgen een eigen fragment `wks-<recipe id>` (met hetzelfde recipe_id).
// Een naam die enkel ergens in een tekst voorkomt, telt niet: Eiermuffin en Tahini
// koekjes staan in de gids/brooddoos als een ander recept met dezelfde naam.
//
// De sync is volledig: nieuwe en gewijzigde recepten worden (opnieuw) ge-embed,
// fragmenten van verwijderde recepten gaan weg, en een recipe_id op een boekfragment
// verdwijnt als het recept niet meer bij dat fragment hoort (verwijderd of hernoemd).
// Enkel wat echt verandert, wordt ge-embed.

import { supabase, VOYAGE_API_KEY } from './clients.mjs';
import { getRecipeMinAge, getAllergenLabel } from '../../js/utils.js';

const BRON = 'Weekschema Pril Leven';
export const ID_PREFIX = 'wks-';
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

const zelfdeFragment = (f, d) => d
  && d.title === f.title && d.content === f.content && d.category === f.category
  && d.age_min_months === f.age_min_months && d.age_max_months === f.age_max_months
  && d.metadata?.recipe_id === f.metadata.recipe_id;

/**
 * Bepaalt wat er moet veranderen en voert het uit als `schrijf` true is.
 * @returns {Promise<{ recepten: number, nieuw: object[], gewijzigd: object[], verwijderd: string[],
 *   gekoppeld: {docId, title, recipeId, name}[], ontkoppeld: {docId, title}[] }>}
 */
export async function syncRecipeKnowledge({ schrijf = false } = {}) {
  const [{ data: recepten, error: rErr }, { data: docs, error: dErr }] = await Promise.all([
    supabase.from('recipes').select('id, name, meal_moments, cooking_time, portions, min_age_months, allergens, ingredients, preparation').order('name'),
    supabase.from('documents').select('id, title, content, category, age_min_months, age_max_months, metadata'),
  ]);
  if (rErr || dErr) throw new Error((rErr || dErr).message);

  const docById = new Map(docs.map(d => [d.id, d]));
  const receptDocs = docs.filter(d => !d.id.startsWith(ID_PREFIX) && /^(recept|snack)/.test(d.category || ''));
  const boekDoc = r => (KOPPEL_HANDMATIG[r.name]
    ? docById.get(KOPPEL_HANDMATIG[r.name])
    : receptDocs.find(d => norm(kaleTitel(d.title)) === norm(r.name)));

  const nieuw = [];
  const gewijzigd = [];
  const gekoppeld = [];
  const hoortBij = new Map(); // boekfragment-id → recipe id
  const wksNodig = new Set();

  for (const r of recepten) {
    const doc = boekDoc(r);
    if (doc) {
      hoortBij.set(doc.id, r.id);
      if (doc.metadata?.recipe_id !== r.id) gekoppeld.push({ docId: doc.id, title: doc.title, recipeId: r.id, name: r.name });
      continue;
    }
    const f = naarFragment(r);
    wksNodig.add(f.id);
    const bestaand = docById.get(f.id);
    if (!bestaand) nieuw.push(f);
    else if (!zelfdeFragment(f, bestaand)) gewijzigd.push(f);
  }

  const verwijderd = docs.filter(d => d.id.startsWith(ID_PREFIX) && !wksNodig.has(d.id)).map(d => d.id);
  // Hoort een boekfragment bij een ander recept, dan overschrijft `gekoppeld` het al.
  const ontkoppeld = docs
    .filter(d => !d.id.startsWith(ID_PREFIX) && d.metadata?.recipe_id && !hoortBij.has(d.id))
    .map(d => ({ docId: d.id, title: d.title }));

  if (schrijf) {
    const teSchrijven = [...nieuw, ...gewijzigd];
    if (teSchrijven.length) {
      const embeddings = await embed(teSchrijven.map(f => `${f.title}\n\n${f.content}`));
      const rijen = teSchrijven.map((f, i) => ({ ...f, embedding: embeddings[i] }));
      const { error } = await supabase.from('documents').upsert(rijen, { onConflict: 'id' });
      if (error) throw new Error(`Upsert: ${error.message}`);
    }
    if (verwijderd.length) {
      const { error } = await supabase.from('documents').delete().in('id', verwijderd);
      if (error) throw new Error(`Verwijderen: ${error.message}`);
    }
    for (const k of gekoppeld) {
      const doc = docById.get(k.docId);
      const { error } = await supabase.from('documents')
        .update({ metadata: { ...(doc.metadata || {}), recipe_id: k.recipeId } })
        .eq('id', k.docId);
      if (error) throw new Error(`Koppelen ${k.docId}: ${error.message}`);
    }
    for (const k of ontkoppeld) {
      const { recipe_id: _weg, ...rest } = docById.get(k.docId).metadata || {};
      const { error } = await supabase.from('documents').update({ metadata: rest }).eq('id', k.docId);
      if (error) throw new Error(`Ontkoppelen ${k.docId}: ${error.message}`);
    }
  }

  return { recepten: recepten.length, nieuw, gewijzigd, verwijderd, gekoppeld, ontkoppeld };
}
