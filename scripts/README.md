# RAG Document Chunking Scripts

Tools for preparing your nutrition content for the RAG assistant.

## What this does

Reads PDFs, DOCX, and TXT files from your `RAG content` folder, splits them into semantic chunks (~350 words each), classifies each chunk via Claude Haiku 4.5, and outputs JSONL files ready for embedding into Supabase + pgvector.

Output schema matches the manually-built `gids-eerste-hapjes.jsonl` reference file.

## Setup (one-time)

```bash
# 1. Install dependencies
cd /Users/anneleenplettinx/Desktop/Project_weekschema/scripts
npm install

# 2. Add your Anthropic API key
cp .env.example .env
# Edit .env and paste your key from https://console.anthropic.com/settings/keys
```

## Usage

```bash
# Dry run — see chunk counts and cost estimate, no API calls
npm run chunk:dry

# Process all files (skips ones already chunked)
npm run chunk

# Process one specific file
node chunk-documents.js --file "ROADMAP.pdf"

# Re-process a file (overwrite existing output)
node chunk-documents.js --file "ROADMAP.pdf" --force
```

## Expected costs (Haiku 4.5)

| Document | Approx chunks | Cost |
|---|---|---|
| Is mijn kindje klaar | ~30 | €0.02 |
| ROADMAP | ~50 | €0.03 |
| Recepten25 | ~150 | €0.10 |
| Social Media | ~40 | €0.03 |
| Masterclass transcript | ~80 | €0.05 |
| **Total** | **~350** | **~€0.25** |

## Output

Files appear in `/Users/anneleenplettinx/Desktop/RAG content/chunks/`:

```
chunks/
├── gids-eerste-hapjes.jsonl    (manual, gold reference)
├── is-mijn-kindje-klaar.jsonl  (script output)
├── roadmap.jsonl
├── recepten-2025.jsonl
├── social-media-content.jsonl
└── masterclass-vaste-voeding.jsonl
```

Each line is one chunk:
```json
{"id":"imk-001-…","source":"…","title":"…","content":"…","category":"…","age_min_months":6,"age_max_months":24,"page_refs":[]}
```

## Quality review checklist

After running the script on a document:

1. Open the output JSONL
2. Spot-check 5–10 random chunks:
   - Title makes sense?
   - Category fits?
   - Age range is correct?
   - Content is intact (no mid-sentence cuts)?
3. Recipes should be in single chunks, not split
4. Edit anything weird directly in the JSONL — this won't be regenerated

## Adding a new source document

1. Drop the file into `/Users/anneleenplettinx/Desktop/RAG content/`
2. Add an entry to `SOURCE_MAP` in `chunk-documents.js`:
   ```js
   'New File.pdf': { source: 'New File Display Name', prefix: 'nfp' }
   ```
3. Run `npm run chunk`

## Limitations

- **Page references not preserved** — `pdf-parse` strips page boundaries. If you need them, switch to `pdf2json` later.
- **Heading detection is heuristic** — works well for the gids-style PDFs, less well for free-form text. Manual review recommended.
- **Recipe detection is pattern-based** — looks for "Xg" or "X eetlepel" lines. Misses recipes with unusual formatting.

## Next steps after chunking

Once all JSONL files are reviewed and ready:
1. Embed each chunk via Voyage AI (`voyage-3-large`)
2. Insert into Supabase `documents` table with pgvector
3. Connect the `/api/chat` endpoint to query against it

That's the next phase — see the main project plan.
