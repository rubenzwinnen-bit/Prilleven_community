#!/usr/bin/env node
/**
 * ingest.js — Read JSONL chunks, create Voyage embeddings, upsert to Supabase.
 *
 * Usage:
 *   node ingest.js                  # ingest all .jsonl files
 *   node ingest.js --file <path>    # ingest one specific file
 *   node ingest.js --dry-run        # parse & count, no API calls, no DB writes
 *
 * Env vars required (see .env.example):
 *   VOYAGE_API_KEY
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import 'dotenv/config';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

// ---------- Config ----------
const CHUNKS_DIR = process.env.CHUNKS_DIR
  || '/Users/anneleenplettinx/Desktop/RAG content/chunks';
const VOYAGE_MODEL = 'voyage-3-large';      // 1024 dims, multilingual
const BATCH_SIZE = 32;                      // texts per Voyage call
const UPSERT_BATCH = 100;                   // rows per Supabase upsert

// ---------- Args ----------
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FILE_FLAG_IDX = args.indexOf('--file');
const ONLY_FILE = FILE_FLAG_IDX >= 0 ? args[FILE_FLAG_IDX + 1] : null;

// ---------- Env check ----------
function requireEnv(name) {
  const v = process.env[name];
  if (!v || v.startsWith('PASTE_') || v === '') {
    console.error(`❌ Missing env var: ${name}`);
    console.error(`   Edit scripts/.env and fill in your key.`);
    process.exit(1);
  }
  return v;
}
if (!DRY_RUN) {
  requireEnv('VOYAGE_API_KEY');
  requireEnv('SUPABASE_URL');
  requireEnv('SUPABASE_SERVICE_ROLE_KEY');
}

// ---------- Supabase client ----------
const supabase = DRY_RUN ? null : createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// ---------- Helpers ----------
async function readJsonl(filePath) {
  const raw = await readFile(filePath, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  const rows = [];
  for (const [i, line] of lines.entries()) {
    try {
      rows.push(JSON.parse(line));
    } catch (e) {
      console.error(`  ✗ Parse error in ${filePath} line ${i + 1}: ${e.message}`);
    }
  }
  return rows;
}

async function embedBatch(texts) {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: texts,
      model: VOYAGE_MODEL,
      input_type: 'document',
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Voyage API ${res.status}: ${errBody}`);
  }
  const data = await res.json();
  // Sort by index to match input order (Voyage returns out of order sometimes).
  const sorted = [...data.data].sort((a, b) => a.index - b.index);
  return {
    embeddings: sorted.map((d) => d.embedding),
    tokens: data.usage?.total_tokens ?? 0,
  };
}

function normalizeRow(chunk, fileSource) {
  // Accept either 'source' from chunk or fallback to filename.
  const source = chunk.source || fileSource;
  return {
    id: chunk.id,
    source,
    title: chunk.title || '',
    content: chunk.content || chunk.text || '',
    category: chunk.category || null,
    age_min_months: chunk.age_min_months ?? null,
    age_max_months: chunk.age_max_months ?? null,
    page_refs: Array.isArray(chunk.page_refs) ? chunk.page_refs : null,
    metadata: chunk.metadata || {},
  };
}

async function upsertBatch(rows) {
  const { error } = await supabase
    .from('documents')
    .upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`Supabase upsert: ${error.message}`);
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---------- Main ----------
async function main() {
  console.log(`\n🥣 Pril Leven RAG ingestion\n`);
  console.log(`   Mode:       ${DRY_RUN ? 'DRY RUN (no API, no DB)' : 'LIVE'}`);
  console.log(`   Chunks dir: ${CHUNKS_DIR}`);
  console.log(`   Model:      ${VOYAGE_MODEL} (1024 dims)\n`);

  // Find JSONL files
  let files;
  if (ONLY_FILE) {
    files = [ONLY_FILE];
  } else {
    const entries = await readdir(CHUNKS_DIR);
    files = entries.filter((f) => f.endsWith('.jsonl')).map((f) => join(CHUNKS_DIR, f));
  }

  if (files.length === 0) {
    console.error('❌ No .jsonl files found.');
    process.exit(1);
  }

  let totalChunks = 0;
  let totalTokens = 0;
  let totalUpserted = 0;

  for (const filePath of files) {
    const fileName = filePath.split('/').pop();
    const fileSource = fileName.replace(/\.jsonl$/, '');
    console.log(`📄 ${fileName}`);

    const rows = await readJsonl(filePath);
    console.log(`   Parsed ${rows.length} chunks`);
    totalChunks += rows.length;

    if (rows.length === 0) continue;

    // Normalize shape
    const normalized = rows.map((r) => normalizeRow(r, fileSource));

    if (DRY_RUN) {
      const sample = normalized[0];
      console.log(`   Sample: id=${sample.id}  category=${sample.category}  words=${sample.content.split(/\s+/).length}`);
      continue;
    }

    // Embed in batches
    const batches = chunkArray(normalized, BATCH_SIZE);
    const withEmbeddings = [];

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const texts = batch.map((r) => `${r.title}\n\n${r.content}`);
      process.stdout.write(`   Embedding batch ${i + 1}/${batches.length} (${batch.length} chunks)...`);
      const { embeddings, tokens } = await embedBatch(texts);
      totalTokens += tokens;
      batch.forEach((row, idx) => {
        withEmbeddings.push({ ...row, embedding: embeddings[idx] });
      });
      console.log(` ✓ ${tokens} tokens`);
    }

    // Upsert to Supabase in chunks
    const upsertBatches = chunkArray(withEmbeddings, UPSERT_BATCH);
    for (let i = 0; i < upsertBatches.length; i++) {
      process.stdout.write(`   Upsert batch ${i + 1}/${upsertBatches.length} (${upsertBatches[i].length} rows)...`);
      await upsertBatch(upsertBatches[i]);
      totalUpserted += upsertBatches[i].length;
      console.log(' ✓');
    }

    console.log('');
  }

  console.log(`\n✅ Done.`);
  console.log(`   Files:     ${files.length}`);
  console.log(`   Chunks:    ${totalChunks}`);
  if (!DRY_RUN) {
    console.log(`   Tokens:    ${totalTokens.toLocaleString()} (free tier limit: 200,000,000)`);
    console.log(`   Upserted:  ${totalUpserted} rows into public.documents\n`);
  }
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});
