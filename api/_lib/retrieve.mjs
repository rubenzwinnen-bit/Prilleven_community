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

// Zacht leeftijdsfilter aan de bovenkant: een fragment getagd tot 24 maanden is vaak nog
// prima voor een peuter van 28 maanden (bv. vitamine D). Zulke fragmenten doen mee met
// een aftrek die groeit met het verschil (28 vs. tot 24 → 0.04; 30 vs. tot 12 → 0.11).
// Fragmenten voor OUDERE kinderen blijven hard gefilterd.
const AGE_PENALTY_BASE = 0.02;
const AGE_PENALTY_PER_MONTH = 0.005;

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
 * Voegt ongefilterde fragmenten die enkel door hun bovengrens wegvielen (age_max < filterAge)
 * terug toe, met een leeftijdsaftrek op hun rangschikking. `similarity` blijft de ruwe score.
 */
async function mergeYoungerChunks(filtered, unfiltered, filterAge, topK) {
  const seen = new Set(filtered.map(c => c.id));
  const extra = unfiltered.filter(c => !seen.has(c.id));
  if (extra.length === 0) return filtered;

  const { data: ages, error } = await supabase
    .from('documents')
    .select('id, age_min_months, age_max_months')
    .in('id', extra.map(c => c.id));
  if (error) {
    console.error('[retrieveCombined] leeftijden ophalen:', error.message);
    return filtered;
  }
  const byId = new Map(ages.map(a => [a.id, a]));
  const younger = extra.filter(c => {
    const a = byId.get(c.id);
    return a && (a.age_min_months == null || a.age_min_months <= filterAge)
      && a.age_max_months != null && a.age_max_months < filterAge;
  });
  if (younger.length === 0) return filtered;

  const rank = c => (c.similarity ?? 0) - (c.agePenalty ?? 0);
  const penalty = c => AGE_PENALTY_BASE + AGE_PENALTY_PER_MONTH * (filterAge - byId.get(c.id).age_max_months);
  return [...filtered, ...younger.map(c => ({ ...c, ageTooYoung: true, agePenalty: penalty(c) }))]
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, topK);
}

/**
 * Combined retrieval: kennisbank-chunks + user-memory in parallel.
 * Gebruikt één query-embedding voor beide.
 *
 * Met `filterAge` loopt er parallel een ongefilterde zoek mee. Fragmenten voor jongere
 * kinderen komen daaruit terug met een kleine aftrek (zie mergeYoungerChunks).
 * Fallback-gedrag: als er met `filterAge` geen relevante chunks worden gevonden,
 * gebruiken we die ongefilterde zoek integraal.
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

  // Ongefilterde zoek meteen parallel: nodig voor het zachte leeftijdsfilter én de fallback.
  const unfilteredPromise = filterAge !== null
    ? supabase.rpc('match_documents', {
        query_embedding: embedding,
        match_count: topKDocs * 2,
        filter_age: null,
        filter_sources: null,
      })
    : Promise.resolve({ data: null, error: null });

  const memoryPromise = (includeMemory && userId)
    ? supabase.rpc('match_user_memory', {
        query_embedding: embedding,
        target_user_id: userId,
        match_count: topKMemory,
      })
    : Promise.resolve({ data: [], error: null });

  const [docsRes, unfilteredRes, memRes] = await Promise.all([docsPromise, unfilteredPromise, memoryPromise]);
  if (docsRes.error) throw new Error(`Docs RPC: ${docsRes.error.message}`);
  if (unfilteredRes.error) console.error('[retrieveCombined] ongefilterde zoek:', unfilteredRes.error.message);
  if (memRes.error) console.error('[retrieveCombined] memory error:', memRes.error.message);

  let docs = docsRes.data || [];
  const memories = (memRes.data || []).filter(m => m.similarity >= RELEVANCE_THRESHOLD);

  if (filterAge !== null && unfilteredRes.data) {
    docs = await mergeYoungerChunks(docs, unfilteredRes.data, filterAge, topKDocs);
  }

  let topDocScore = Math.max(0, ...docs.map(c => c.similarity ?? 0));
  let ageFallbackUsed = false;

  // Fallback: leeftijd-gefilterd niets relevants gevonden? Neem de ongefilterde zoek
  // (ook fragmenten voor oudere kinderen, bv. "wanneer kan ik starten?" bij 4 maanden).
  if (filterAge !== null && topDocScore < RELEVANCE_THRESHOLD && unfilteredRes.data) {
    const fbData = unfilteredRes.data.slice(0, topKDocs);
    if (
      fbData.length > 0 &&
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
