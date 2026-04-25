#!/usr/bin/env node
/**
 * test-retrieval.js — Sanity check voor de RAG retrieval.
 *
 * Usage:
 *   node test-retrieval.js "wanneer mag mijn baby beginnen met vast voedsel"
 *   node test-retrieval.js "recept voor ontbijt met banaan"
 *   node test-retrieval.js "allergie pinda" --age 8
 *
 * Prints de top-K meest relevante chunks met similarity scores.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const VOYAGE_MODEL = 'voyage-3-large';
const TOP_K = 5;

// ---------- Args ----------
const args = process.argv.slice(2);
const ageIdx = args.indexOf('--age');
const filterAge = ageIdx >= 0 ? parseInt(args[ageIdx + 1], 10) : null;
const question = args
  .filter((_, i) => ageIdx < 0 || (i !== ageIdx && i !== ageIdx + 1))
  .join(' ')
  .trim();

if (!question) {
  console.error('Usage: node test-retrieval.js "<your question>" [--age <months>]');
  process.exit(1);
}

// ---------- Env ----------
function requireEnv(name) {
  const v = process.env[name];
  if (!v || v.startsWith('PASTE_') || v === '') {
    console.error(`❌ Missing env var: ${name}`);
    process.exit(1);
  }
  return v;
}
requireEnv('VOYAGE_API_KEY');
requireEnv('SUPABASE_URL');
requireEnv('SUPABASE_SERVICE_ROLE_KEY');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// ---------- Embed query ----------
async function embedQuery(text) {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: [text],
      model: VOYAGE_MODEL,
      input_type: 'query',   // <-- query mode (different from 'document' used in ingest)
    }),
  });
  if (!res.ok) throw new Error(`Voyage ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data[0].embedding;
}

// ---------- Main ----------
async function main() {
  console.log(`\n🔍 Query: "${question}"`);
  if (filterAge !== null) console.log(`   Age filter: ${filterAge} months`);
  console.log('');

  const embedding = await embedQuery(question);

  const { data, error } = await supabase.rpc('match_documents', {
    query_embedding: embedding,
    match_count: TOP_K,
    filter_age: filterAge,
    filter_sources: null,
  });

  if (error) {
    console.error(`❌ RPC error: ${error.message}`);
    process.exit(1);
  }

  if (!data || data.length === 0) {
    console.log('No results.');
    return;
  }

  console.log(`Top ${data.length} results:\n`);
  data.forEach((row, i) => {
    const pct = (row.similarity * 100).toFixed(1);
    console.log(`${i + 1}. [${pct}%] ${row.id}  (${row.source} / ${row.category || 'no-cat'})`);
    console.log(`   ${row.title}`);
    const preview = row.content.replace(/\s+/g, ' ').slice(0, 200);
    console.log(`   ${preview}${row.content.length > 200 ? '...' : ''}`);
    console.log('');
  });
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});
