// Retrieval: embed user query via Voyage, then call match_documents RPC.

import { supabase, VOYAGE_API_KEY } from './clients.mjs';

const VOYAGE_MODEL = 'voyage-3-large';
const DEFAULT_TOP_K = 6;

// Minimum cosine similarity for a chunk to be considered relevant.
// Below this: probably off-topic — don't feed to Claude.
export const RELEVANCE_THRESHOLD = 0.55;

export async function embedQuery(text) {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: [text],
      model: VOYAGE_MODEL,
      input_type: 'query',
    }),
  });
  if (!res.ok) throw new Error(`Voyage ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return {
    embedding: data.data[0].embedding,
    tokens: data.usage?.total_tokens ?? 0,
  };
}

export async function retrieveChunks(question, { topK = DEFAULT_TOP_K, filterAge = null } = {}) {
  const { embedding, tokens } = await embedQuery(question);

  const { data, error } = await supabase.rpc('match_documents', {
    query_embedding: embedding,
    match_count: topK,
    filter_age: filterAge,
    filter_sources: null,
  });
  if (error) throw new Error(`Retrieval RPC: ${error.message}`);

  const chunks = data || [];
  const topScore = chunks[0]?.similarity ?? 0;
  const hasRelevant = topScore >= RELEVANCE_THRESHOLD;

  return { chunks, topScore, hasRelevant, embedTokens: tokens, embedding };
}

/**
 * Combined retrieval: kennisbank-chunks + user-memory in parallel.
 * Gebruikt één query-embedding voor beide.
 */
export async function retrieveCombined(question, {
  userId,
  filterAge = null,
  topKDocs = DEFAULT_TOP_K,
  topKMemory = 4,
  includeMemory = true,
} = {}) {
  const { embedding, tokens } = await embedQuery(question);

  const docsPromise = supabase.rpc('match_documents', {
    query_embedding: embedding,
    match_count: topKDocs,
    filter_age: filterAge,
    filter_sources: null,
  });

  const memoryPromise = (includeMemory && userId)
    ? supabase.rpc('match_user_memory', {
        query_embedding: embedding,
        target_user_id: userId,
        match_count: topKMemory,
      })
    : Promise.resolve({ data: [], error: null });

  const [docsRes, memRes] = await Promise.all([docsPromise, memoryPromise]);
  if (docsRes.error) throw new Error(`Docs RPC: ${docsRes.error.message}`);
  if (memRes.error) console.error('[retrieveCombined] memory error:', memRes.error.message);

  const docs = docsRes.data || [];
  const memories = (memRes.data || []).filter(m => m.similarity >= RELEVANCE_THRESHOLD);

  const topDocScore = docs[0]?.similarity ?? 0;
  const topMemScore = memories[0]?.similarity ?? 0;
  const topScore = Math.max(topDocScore, topMemScore);
  // Antwoorden als ÓF docs ÓF memories relevant zijn.
  // Bij alleen memory: bot gebruikt die persoonlijke context + een lagere-score doc als aanvulling.
  const hasRelevant = topScore >= RELEVANCE_THRESHOLD;

  // Fire-and-forget: update last_used_at voor opgehaalde memories
  if (memories.length > 0) {
    const ids = memories.map(m => m.id);
    supabase.from('chat_user_memory')
      .update({ last_used_at: new Date().toISOString() })
      .in('id', ids)
      .then(({ error: e }) => {
        if (e) console.error('[user-memory] last_used_at:', e.message);
      });
  }

  return {
    chunks: docs,
    memories,
    topScore,
    hasRelevant,
    embedTokens: tokens,
    embedding,
  };
}
