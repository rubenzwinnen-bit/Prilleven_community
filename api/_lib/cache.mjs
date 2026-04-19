// Answer cache: SHA-256 hash of normalized question → cached answer.
// Skips Claude call on a hit. Invalidated manually if source chunks change.

import { createHash } from 'node:crypto';
import { supabase } from './clients.mjs';

function normalize(q) {
  return q
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')   // strip accents
    .replace(/[^\w\s]/g, ' ')           // strip punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

export function questionHash(question) {
  return createHash('sha256').update(normalize(question)).digest('hex');
}

export async function getCached(question) {
  const hash = questionHash(question);
  const { data, error } = await supabase
    .from('answer_cache')
    .select('answer, retrieved_ids, hits')
    .eq('question_hash', hash)
    .maybeSingle();
  if (error) {
    console.error(`[cache.get] ${error.message}`);
    return null;
  }
  if (!data) return null;

  // Fire-and-forget: bump hits counter.
  supabase
    .from('answer_cache')
    .update({ hits: (data.hits || 0) + 1, last_hit_at: new Date().toISOString() })
    .eq('question_hash', hash)
    .then(({ error }) => error && console.error(`[cache.bump] ${error.message}`));

  return { answer: data.answer, retrievedIds: data.retrieved_ids };
}

export async function setCached(question, answer, retrievedIds) {
  const hash = questionHash(question);
  const { error } = await supabase
    .from('answer_cache')
    .upsert({
      question_hash: hash,
      question,
      answer,
      retrieved_ids: retrievedIds,
      hits: 0,
      last_hit_at: new Date().toISOString(),
    }, { onConflict: 'question_hash' });
  if (error) console.error(`[cache.set] ${error.message}`);
}
