// Persoonlijk vector-geheugen per user.
// Werkt parallel met de gedeelde kennisbank (documents + match_documents).
//
// Twee hoofdfuncties:
//   1. retrieveUserMemory(userId, queryEmbedding, topK) → top-K relevante memories
//   2. extractAndStoreMemories(userId, question, answer, sourceMessageId)
//      → Haiku analyseert de uitwisseling, extraheert max 5 duurzame feiten,
//        deduplicate via embedding-sim, insert nieuwe records.

import { supabase, anthropic } from './clients.mjs';
import { embedQuery } from './retrieve.mjs';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const DEDUPLICATE_THRESHOLD = 0.92; // > 0.92 sim → duplicaat, skip

const EXTRACT_SYSTEM = `Je analyseert een chat-uitwisseling tussen een ouder en HapjesHeld (kindervoeding-assistent) om duurzame feiten over de gebruiker, hun kind(eren) of gezin te extraheren. Deze feiten worden in toekomstige gesprekken hergebruikt zodat HapjesHeld persoonlijke antwoorden kan geven.

FOCUS op duurzame, persoonlijke feiten:
- Allergieën en intoleranties
- Dieet-keuzes en langdurige voedingspatronen
- Gezondheidszaken (eczeem, reflux, groeiachterstand, enz.)
- Ontwikkelingsmijlpalen (pincetgreep, zelfstandig eten, enz.)
- Bevestigde voorkeuren en afkeer van voedsel
- Gezinscontext (opvang, school, broer/zus, partner die kookt, enz.)
- Introductie-plannen en geplande stappen van de ouder

SKIP:
- Tijdelijke informatie ("vandaag koortsachtig", "gisteren geweigerd")
- Algemene kennisvragen zonder persoonlijke info ("hoeveel vitamine D?")
- Feiten die al duidelijk in het profiel staan (naam, geboortedatum, dieet checkbox)
- Speculaties, vermoedens, hypothetische vragen

Elke feit moet:
- Kort en feitelijk (1 zin, max 120 tekens)
- In de derde persoon ("Kind X heeft...")
- Concreet verifieerbaar

IMPORTANCE (1-5):
- 5 = medisch kritisch (allergie, medicatie, serieuze aandoening)
- 4 = langdurig dieet of gezondheid (vegetarisch, eczeem, reflux)
- 3 = bevestigde voorkeur of geplande stap
- 2 = observatie over gedrag/voorkeur
- 1 = trivia

Retourneer UITSLUITEND geldige JSON (geen markdown, geen uitleg):
[{"content": "...", "importance": 3}, ...]

Als er geen duurzame feiten te extraheren zijn, retourneer exact: []
Maximum 5 items per call.`;

/**
 * Retrieveer top-K relevante memories voor een user-query.
 * Updates `last_used_at` async voor de gevonden memories.
 */
export async function retrieveUserMemory(userId, queryEmbedding, { topK = 4, minSimilarity = 0.55 } = {}) {
  const { data, error } = await supabase.rpc('match_user_memory', {
    query_embedding: queryEmbedding,
    target_user_id: userId,
    match_count: topK,
  });
  if (error) {
    console.error('[user-memory] retrieve:', error.message);
    return [];
  }
  const memories = (data || []).filter(m => m.similarity >= minSimilarity);

  // Fire-and-forget: update last_used_at
  if (memories.length > 0) {
    const ids = memories.map(m => m.id);
    supabase.from('chat_user_memory')
      .update({ last_used_at: new Date().toISOString() })
      .in('id', ids)
      .then(({ error: e }) => {
        if (e) console.error('[user-memory] update last_used_at:', e.message);
      });
  }

  return memories;
}

/**
 * Haiku-call om duurzame feiten te extraheren uit een chat-turn.
 * Returnt array van { content, importance } of [] als niets te vinden.
 */
async function extractFactsFromTurn(userQuestion, assistantAnswer) {
  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 500,
    system: EXTRACT_SYSTEM,
    messages: [{
      role: 'user',
      content: `Gebruiker-vraag:\n${userQuestion}\n\nHapjesHeld-antwoord:\n${assistantAnswer}`,
    }],
  });
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();

  // Strip eventuele markdown code fences
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.warn('[user-memory] extract: kon JSON niet parsen, skip:', text.slice(0, 120));
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter(f => f && typeof f === 'object' && typeof f.content === 'string')
    .slice(0, 5)
    .map(f => ({
      content: f.content.trim().slice(0, 200),
      importance: Number.isInteger(f.importance) && f.importance >= 1 && f.importance <= 5 ? f.importance : 3,
    }))
    .filter(f => f.content.length > 5);
}

/**
 * Check of een nieuw feit al in memory bestaat (via embedding-sim).
 * Returnt true = duplicaat → skip.
 */
async function isDuplicate(userId, embedding) {
  const { data, error } = await supabase.rpc('match_user_memory', {
    query_embedding: embedding,
    target_user_id: userId,
    match_count: 1,
  });
  if (error || !data?.length) return false;
  return data[0].similarity >= DEDUPLICATE_THRESHOLD;
}

/**
 * Volledige pipeline: extract feiten uit een exchange, embed, dedupe, insert.
 * Wordt aangeroepen via waitUntil (async, niet-blokkerend).
 */
export async function extractAndStoreMemories(userId, userQuestion, assistantAnswer, sourceMessageId) {
  try {
    const facts = await extractFactsFromTurn(userQuestion, assistantAnswer);
    if (facts.length === 0) return { stored: 0, skipped: 0 };

    let stored = 0;
    let skipped = 0;
    const rows = [];

    for (const fact of facts) {
      const { embedding } = await embedQuery(fact.content);
      if (await isDuplicate(userId, embedding)) {
        skipped++;
        continue;
      }
      rows.push({
        user_id: userId,
        content: fact.content,
        importance: fact.importance,
        embedding,
        source_message_id: sourceMessageId,
      });
    }

    if (rows.length > 0) {
      const { error } = await supabase.from('chat_user_memory').insert(rows);
      if (error) {
        console.error('[user-memory] insert:', error.message);
      } else {
        stored = rows.length;
      }
    }

    console.log(`[user-memory] user ${userId.slice(0, 8)}: extracted=${facts.length} stored=${stored} skipped=${skipped}`);
    return { stored, skipped };
  } catch (err) {
    console.error('[user-memory] extract pipeline:', err.message);
    return { stored: 0, skipped: 0 };
  }
}
