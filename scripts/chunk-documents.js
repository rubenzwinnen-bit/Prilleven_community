/**
 * RAG Document Chunking Pipeline
 * ───────────────────────────────────────────────────────────────────
 * Reads PDF / DOCX / TXT documents from a folder, splits them into
 * semantic chunks, enriches each chunk with metadata via Claude Haiku,
 * and outputs JSONL files ready for Voyage AI embedding + Supabase.
 *
 * Output schema matches /Users/anneleenplettinx/Desktop/RAG content/chunks/gids-eerste-hapjes.jsonl
 *
 * Usage:
 *   node chunk-documents.js                    # process all new files
 *   node chunk-documents.js --dry-run          # show plan + cost, no API calls
 *   node chunk-documents.js --file "ROADMAP.pdf"   # one specific file
 *   node chunk-documents.js --force            # re-process even if output exists
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import mammoth from 'mammoth';

// pdf-parse is CommonJS — load via require to avoid its debug-mode quirk
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

// ─── Configuration ─────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_DIR =
  process.env.INPUT_DIR || '/Users/anneleenplettinx/Desktop/RAG content';
const OUTPUT_DIR =
  process.env.OUTPUT_DIR ||
  '/Users/anneleenplettinx/Desktop/RAG content/chunks';

const TARGET_WORDS_PER_CHUNK = 350; // sweet spot: 300-500
const MIN_WORDS_PER_CHUNK = 80; // smaller = merge with neighbour
const MAX_WORDS_PER_CHUNK = 600; // larger = force split
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// Allowed taxonomy — keeps Haiku from inventing new categories
const ALLOWED_CATEGORIES = [
  'algemeen',
  'microbioom',
  'voorbereiding',
  'consistentie',
  'allergenen',
  'materiaal',
  'dagschema',
  'bereiding',
  'stukjes',
  'ontwikkeling',
  'melk',
  'praktisch',
  'worksheet-warm',
  'worksheet-fruit',
  'worksheet-ontbijt',
  'recept-warm',
  'recept-fruit',
  'recept-ontbijt',
  'snack',
];

// Per-file source name + ID prefix overrides
const SOURCE_MAP = {
  'Gids eerste hapjes.pdf': { source: 'Gids eerste hapjes', prefix: 'geh' },
  'Is mijn kindje klaar om te starten-3.pdf': {
    source: 'Is mijn kindje klaar om te starten',
    prefix: 'imk',
  },
  'ROADMAP.pdf': { source: 'Roadmap', prefix: 'rmp' },
  'Recepten25.pdf': { source: 'Recepten 2025', prefix: 'rec' },
  'Social Media.docx': { source: 'Social Media content', prefix: 'sm' },
  'Masterclass vaste voeding kopie.txt': {
    source: 'Masterclass vaste voeding',
    prefix: 'mc',
  },
  'FAQ DATABASE HAPJESHELD-2.pdf': {
    source: 'FAQ Database Hapjesheld',
    prefix: 'faq',
  },
};

// ─── CLI flags ─────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');
const fileArgIndex = args.indexOf('--file');
const SINGLE_FILE = fileArgIndex >= 0 ? args[fileArgIndex + 1] : null;

// ─── Text extraction ───────────────────────────────────────────────
async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = await fs.readFile(filePath);

  if (ext === '.pdf') {
    const data = await pdfParse(buffer);
    return { text: data.text, pageCount: data.numpages };
  }
  if (ext === '.docx') {
    const { value } = await mammoth.extractRawText({ buffer });
    return { text: value, pageCount: null };
  }
  if (ext === '.txt' || ext === '.md') {
    return { text: buffer.toString('utf-8'), pageCount: null };
  }
  throw new Error(`Unsupported file type: ${ext}`);
}

// ─── Smart chunking ────────────────────────────────────────────────
/**
 * Split raw text into semantically meaningful chunks.
 *
 * Strategy:
 *   1. Detect headings (short standalone lines that look like titles)
 *   2. Split into sections by heading
 *   3. Within each section, group paragraphs into ~350-word chunks
 *   4. Recipes are kept intact (detected by ingredient lists)
 *   5. Tiny sections are merged into the next one
 */
function chunkText(rawText) {
  // Normalise whitespace
  const text = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Split into paragraphs first
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // Group paragraphs into chunks targeting ~350 words
  const chunks = [];
  let current = { paragraphs: [], wordCount: 0, isRecipe: false };

  for (const para of paragraphs) {
    const wordCount = para.split(/\s+/).length;
    const looksLikeHeading =
      wordCount <= 8 &&
      para.length < 80 &&
      !para.endsWith('.') &&
      !para.endsWith(',');
    const looksLikeRecipeStart =
      /^(\d+g\s|\d+\s?(eetlepel|theelepel|koffielepel|ml|stuks?))/im.test(
        para
      ) || /\bingrediënten\b/i.test(para);

    // Heading → start a new chunk if current has content
    if (looksLikeHeading && current.wordCount >= MIN_WORDS_PER_CHUNK) {
      chunks.push(current);
      current = { paragraphs: [para], wordCount, isRecipe: false };
      continue;
    }

    // Recipe content → mark and try to keep together
    if (looksLikeRecipeStart) {
      current.isRecipe = true;
    }

    // Adding this para would exceed max → flush first
    if (
      current.wordCount + wordCount > MAX_WORDS_PER_CHUNK &&
      current.wordCount >= MIN_WORDS_PER_CHUNK &&
      !current.isRecipe // don't split mid-recipe
    ) {
      chunks.push(current);
      current = { paragraphs: [para], wordCount, isRecipe: false };
      continue;
    }

    current.paragraphs.push(para);
    current.wordCount += wordCount;

    // Hit target → flush (unless we're in a recipe block)
    if (current.wordCount >= TARGET_WORDS_PER_CHUNK && !current.isRecipe) {
      chunks.push(current);
      current = { paragraphs: [], wordCount: 0, isRecipe: false };
    }
  }

  if (current.wordCount > 0) {
    // Merge tiny final chunk into previous one
    if (current.wordCount < MIN_WORDS_PER_CHUNK && chunks.length > 0) {
      const last = chunks[chunks.length - 1];
      last.paragraphs.push(...current.paragraphs);
      last.wordCount += current.wordCount;
    } else {
      chunks.push(current);
    }
  }

  return chunks.map((c) => ({
    content: c.paragraphs.join('\n\n'),
    wordCount: c.wordCount,
    isRecipe: c.isRecipe,
  }));
}

// ─── Metadata enrichment via Haiku ─────────────────────────────────
const ENRICHMENT_SYSTEM = `Je bent een expert in het classificeren van Nederlandstalige content over baby- en peutervoeding.
Je krijgt een tekstfragment en geeft een JSON object terug met:
  - title: een korte beschrijvende titel (max 60 tekens, in het Nederlands)
  - category: één van: ${ALLOWED_CATEGORIES.join(', ')}
  - age_min_months: leeftijd vanaf wanneer dit relevant is (geheel getal, 0-36)
  - age_max_months: leeftijd tot wanneer dit relevant is (geheel getal, 0-99, gebruik 99 voor 'altijd')

Categorie-richtlijnen:
  - recept-warm/fruit/ontbijt: enkel voor concrete recepten met ingrediënten
  - worksheet-warm/fruit/ontbijt: voor formules en overzichten om maaltijden samen te stellen
  - microbioom: gezondheidsprincipes (omega 3, bloedsuiker, vezels, ...)
  - voorbereiding: wanneer en hoe te starten met vaste voeding
  - stukjes: tips voor het aanbieden in stukjes per voedingsgroep
  - allergenen: introductie van allergenen
  - melk: borstvoeding, kunstvoeding, melkproducten
  - materiaal: kinderstoel, bestek, bekertjes
  - praktisch: kant-en-klaar, basisingrediënten, koopgidsen
  - dagschema: hoe een dag eruit ziet per leeftijd
  - bereiding: hoe te bereiden (papjes, stomen, ...)
  - ontwikkeling: motorische mijlpalen relevant voor eten
  - snack: tussendoortjes
  - consistentie: tekstuur en veiligheid
  - algemeen: alles wat niet in een specifieke categorie past

Antwoord ENKEL met geldige JSON, geen uitleg.`;

async function enrichChunk(client, chunk) {
  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 200,
    system: ENRICHMENT_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Tekstfragment:\n\n${chunk.content}`,
      },
    ],
  });

  const text = response.content[0].text.trim();
  // Strip markdown code fences if Haiku adds them
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.warn(`  ⚠ Failed to parse Haiku response, using fallback:`, text);
    parsed = {
      title: chunk.content.split('\n')[0].slice(0, 60),
      category: 'algemeen',
      age_min_months: 6,
      age_max_months: 24,
    };
  }

  // Validate category
  if (!ALLOWED_CATEGORIES.includes(parsed.category)) {
    console.warn(`  ⚠ Invalid category "${parsed.category}", using 'algemeen'`);
    parsed.category = 'algemeen';
  }

  return {
    ...parsed,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

// ─── ID generation ─────────────────────────────────────────────────
function makeChunkId(prefix, index, title) {
  const slug = (title || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  const padded = String(index + 1).padStart(3, '0');
  return slug ? `${prefix}-${padded}-${slug}` : `${prefix}-${padded}`;
}

// ─── Cost estimation ───────────────────────────────────────────────
// Haiku 4.5 pricing (per million tokens, USD as of 2025)
const HAIKU_INPUT_PRICE = 1.0;
const HAIKU_OUTPUT_PRICE = 5.0;

function estimateCost(chunks) {
  // Rough estimate: ~500 tokens input per chunk (system + content), ~80 tokens output
  const totalInput = chunks.length * 500;
  const totalOutput = chunks.length * 80;
  const usd =
    (totalInput / 1_000_000) * HAIKU_INPUT_PRICE +
    (totalOutput / 1_000_000) * HAIKU_OUTPUT_PRICE;
  const eur = usd * 0.92;
  return { totalInput, totalOutput, usd, eur };
}

// ─── Main pipeline ─────────────────────────────────────────────────
async function processFile(client, fileName) {
  const inputPath = path.join(INPUT_DIR, fileName);
  const sourceInfo = SOURCE_MAP[fileName];

  if (!sourceInfo) {
    console.log(`  ⊘ Skipping ${fileName} (no SOURCE_MAP entry)`);
    return null;
  }

  const outputName = sourceInfo.source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const outputPath = path.join(OUTPUT_DIR, `${outputName}.jsonl`);

  // Skip if already processed (unless --force)
  if (!FORCE) {
    try {
      await fs.access(outputPath);
      console.log(`  ⊘ Skipping ${fileName} (output exists, use --force to override)`);
      return null;
    } catch {
      /* doesn't exist, continue */
    }
  }

  console.log(`\n📄 ${fileName}`);
  console.log(`  Reading...`);
  const { text, pageCount } = await extractText(inputPath);
  console.log(`  Extracted ${text.length} chars${pageCount ? ` from ${pageCount} pages` : ''}`);

  console.log(`  Chunking...`);
  const chunks = chunkText(text);
  console.log(`  → ${chunks.length} chunks (avg ${Math.round(chunks.reduce((s, c) => s + c.wordCount, 0) / chunks.length)} words)`);

  if (DRY_RUN) {
    const cost = estimateCost(chunks);
    console.log(`  💰 Estimated cost: ~€${cost.eur.toFixed(3)} for ${chunks.length} Haiku calls`);
    console.log(`  (dry run — no API calls, no output written)`);
    return { fileName, chunkCount: chunks.length, cost };
  }

  // Enrich each chunk with metadata
  console.log(`  Enriching with Haiku...`);
  const enriched = [];
  let totalIn = 0;
  let totalOut = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    process.stdout.write(`    [${i + 1}/${chunks.length}] `);
    try {
      const meta = await enrichChunk(client, chunk);
      const id = makeChunkId(sourceInfo.prefix, i, meta.title);
      enriched.push({
        id,
        source: sourceInfo.source,
        title: meta.title,
        content: chunk.content,
        category: meta.category,
        age_min_months: meta.age_min_months,
        age_max_months: meta.age_max_months,
        page_refs: [], // pdf-parse doesn't preserve page boundaries reliably
      });
      totalIn += meta.inputTokens;
      totalOut += meta.outputTokens;
      console.log(`${meta.category.padEnd(20)} ${meta.title}`);
    } catch (err) {
      console.error(`✗ Failed: ${err.message}`);
    }
  }

  // Write JSONL
  const jsonl = enriched.map((c) => JSON.stringify(c)).join('\n') + '\n';
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, jsonl, 'utf-8');

  const actualCost =
    (totalIn / 1_000_000) * HAIKU_INPUT_PRICE +
    (totalOut / 1_000_000) * HAIKU_OUTPUT_PRICE;

  console.log(`  ✓ Wrote ${enriched.length} chunks to ${outputPath}`);
  console.log(`  💰 Actual cost: €${(actualCost * 0.92).toFixed(4)} (${totalIn} in / ${totalOut} out)`);

  return { fileName, chunkCount: enriched.length, costEur: actualCost * 0.92 };
}

async function main() {
  console.log('━'.repeat(60));
  console.log('RAG Document Chunking Pipeline');
  console.log('━'.repeat(60));
  console.log(`Input:  ${INPUT_DIR}`);
  console.log(`Output: ${OUTPUT_DIR}`);
  if (DRY_RUN) console.log('Mode:   DRY RUN (no API calls, no files written)');
  if (FORCE) console.log('Mode:   FORCE (re-processing existing outputs)');
  if (SINGLE_FILE) console.log(`File:   ${SINGLE_FILE} (single-file mode)`);

  // Validate API key (skip in dry-run)
  if (!DRY_RUN && !process.env.ANTHROPIC_API_KEY) {
    console.error('\n✗ ANTHROPIC_API_KEY not set. Copy .env.example to .env and add your key.');
    process.exit(1);
  }

  const client = DRY_RUN ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Find files to process
  let files;
  if (SINGLE_FILE) {
    files = [SINGLE_FILE];
  } else {
    files = (await fs.readdir(INPUT_DIR)).filter((f) =>
      ['.pdf', '.docx', '.txt', '.md'].includes(path.extname(f).toLowerCase())
    );
  }

  if (files.length === 0) {
    console.log('\n⊘ No supported files found.');
    return;
  }

  console.log(`\nFound ${files.length} file(s) to consider:`);
  files.forEach((f) => console.log(`  • ${f}`));

  // Process each
  const results = [];
  for (const file of files) {
    try {
      const result = await processFile(client, file);
      if (result) results.push(result);
    } catch (err) {
      console.error(`\n✗ Failed on ${file}:`, err.message);
    }
  }

  // Summary
  console.log('\n' + '━'.repeat(60));
  console.log('Summary');
  console.log('━'.repeat(60));
  if (results.length === 0) {
    console.log('Nothing processed.');
  } else {
    let totalChunks = 0;
    let totalCost = 0;
    for (const r of results) {
      const cost = r.costEur ?? r.cost?.eur ?? 0;
      console.log(`  ${r.fileName.padEnd(45)} ${String(r.chunkCount).padStart(4)} chunks  €${cost.toFixed(4)}`);
      totalChunks += r.chunkCount;
      totalCost += cost;
    }
    console.log('─'.repeat(60));
    console.log(`  TOTAL${' '.repeat(40)} ${String(totalChunks).padStart(4)} chunks  €${totalCost.toFixed(4)}`);
  }
}

main().catch((err) => {
  console.error('\n✗ Fatal error:', err);
  process.exit(1);
});
