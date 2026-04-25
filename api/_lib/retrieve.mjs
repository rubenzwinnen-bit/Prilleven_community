// Retrieval: embed user query via Voyage, then call match_documents RPC.

import { supabase, VOYAGE_API_KEY } from './clients.mjs';

const VOYAGE_MODEL = 'voyage-3-large';
const DEFAULT_TOP_K = 6;

// Minimum cosine similarity for a chunk to be considered relevant.
// Below this: probably off-topic — don't feed to Claude.
export const RELEVANCE_THRESHOLD = 0.55;

// Lagere drempel specifiek voor de age-filter fallback. Wanneer de age-gefilterde
// zoek al onder RELEVANCE_THRESHOLD zit (irrelevante chunks), is een ongefilterde
// zoek met score ≥ 0.40 die bovendien beter is dan de originele top, een strikte
// verbetering — ook al zit hij nog onder de globale drempel.
const AGE_FALLBACK_THRESHOLD = 0.40;

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
 *
 * Fallback-gedrag: als er met `filterAge` geen relevante chunks worden gevonden,
 * doen we een tweede RPC-call zonder leeftijdsfilter met dezelfde embedding.
 * Dit voorkomt dat vragen als "wanneer kan ik starten met vast eten?" een
 * fallback krijgen terwijl de baby nog net niet oud genoeg is (de relevante
 * voorbereiding-chunks zijn getagged vanaf 4-6 maanden).
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

  let docs = docsRes.data || [];
  const memories = (memRes.data || []).filter(m => m.similarity >= RELEVANCE_THRESHOLD);

  let topDocScore = docs[0]?.similarity ?? 0;
  let ageFallbackUsed = false;

  // Fallback: leeftijd-gefilterd niets relevants gevonden? Probeer ongefilterd.
  if (filterAge !== null && topDocScore < RELEVANCE_THRESHOLD) {
    const { data: fbData, error: fbErr } = await supabase.rpc('match_documents', {
      query_embedding: embedding,
      match_count: topKDocs,
      filter_age: null,
      filter_sources: null,
    });
    if (fbErr) {
      console.error('[retrieveCombined] age-fallback error:', fbErr.message);
    } else if (
      fbData && fbData.length > 0 &&
      (fbData[0].similarity ?? 0) >= AGE_FALLBACK_THRESHOLD &&
      (fbData[0].similarity ?? 0) > topDocScore
    ) {
      docs = fbData;
      topDocScore = docs[0].similarity ?? 0;
      ageFallbackUsed = true;
    }
  }

  const topMemScore = memories[0]?.similarity ?? 0;
  const topScore = Math.max(topDocScore, topMemScore);
  // Antwoorden als ÓF docs ÓF memories relevant zijn.
  // Bij alleen memory: bot gebruikt die persoonlijke context + een lagere-score doc als aanvulling.
  const hasRelevant = topScore >= RELEVANCE_THRESHOLD;

  if (ageFallbackUsed) {
    console.log('[retrieveCombined] age-filter fallback gebruikt',
      { filterAge, topScore: topDocScore.toFixed(3), docsFound: docs.length });
  }

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
