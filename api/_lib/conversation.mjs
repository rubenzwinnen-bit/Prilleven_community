// Conversatie- en message-management voor de chat-bot.
// Alle queries gebruiken de SERVICE ROLE supabase client; user-isolatie gebeurt
// in de code (expliciete user_id-checks). RLS is ook nog steeds aan als backstop.

import { supabase, anthropic } from './clients.mjs';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Haal een bestaande conversation op of maak er een nieuwe.
 * - conversationId meegegeven: valideer ownership en return.
 * - Geen id: maak een nieuwe aan (lege conversaties blijven beperkt doordat
 *   we pas een conversation maken zodra de user iets vraagt).
 */
export async function getOrCreateConversation(userId, conversationId) {
  if (conversationId) {
    const { data, error } = await supabase
      .from('conversations')
      .select('id, user_id, title, created_at, updated_at')
      .eq('id', conversationId)
      .maybeSingle();
    if (error) throw new Error('Conversation lookup: ' + error.message);
    if (!data) throw new Error('Conversation niet gevonden.');
    if (data.user_id !== userId) {
      const err = new Error('Geen toegang tot dit gesprek.');
      err.status = 403;
      throw err;
    }
    return data;
  }

  const { data, error } = await supabase
    .from('conversations')
    .insert({ user_id: userId })
    .select('id, user_id, title, created_at, updated_at')
    .single();
  if (error) throw new Error('Conversation create: ' + error.message);
  return data;
}

/** Laatste N messages laden (voor LLM-context) of alles (voor UI). */
export async function loadConversationMessages(conversationId, { limit } = {}) {
  let q = supabase
    .from('messages')
    .select('id, role, content, created_at, retrieved_ids, had_image, model')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (limit) {
    // Voor limit: laatste N; sorteren desc, limit, daarna omdraaien
    const { data, error } = await supabase
      .from('messages')
      .select('id, role, content, created_at, retrieved_ids, had_image, model')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error('Load messages: ' + error.message);
    return (data || []).reverse();
  }
  const { data, error } = await q;
  if (error) throw new Error('Load messages: ' + error.message);
  return data || [];
}

/** Insert 1 message, returnt id. */
export async function storeMessage(conversationId, {
  role,
  content,
  retrievedIds = null,
  tokensIn = 0,
  tokensOut = 0,
  model = null,
  hadImage = false,
}) {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      role,
      content,
      retrieved_ids: retrievedIds,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      model,
      had_image: hadImage,
    })
    .select('id')
    .single();
  if (error) throw new Error('Store message: ' + error.message);
  // Tik de parent-conversatie aan zodat updated_at klopt
  await supabase.from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId);
  return data.id;
}

/** Haiku-call voor een korte conversatie-titel (max 40 tekens, NL). */
export async function generateConversationTitle(firstQuestion) {
  try {
    const response = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 30,
      system: 'Geef een zeer korte Nederlandstalige titel (maximum 40 tekens) voor dit chat-gesprek op basis van de eerste vraag. Geen aanhalingstekens, geen punt aan het einde. Antwoord alleen met de titel.',
      messages: [{ role: 'user', content: firstQuestion }],
    });
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    // Strip aanhalingstekens en trunc
    const cleaned = text.replace(/^["'«»]+|["'«»]+$/g, '').slice(0, 40).trim();
    return cleaned || null;
  } catch {
    return null;
  }
}

/** Update title van een conversatie (check ownership door caller). */
export async function setConversationTitle(conversationId, title) {
  const { error } = await supabase
    .from('conversations')
    .update({ title })
    .eq('id', conversationId);
  if (error) throw new Error('Set title: ' + error.message);
}

/** Lijst alle conversations van een user (voor sidebar). */
export async function listConversations(userId) {
  const { data, error } = await supabase
    .from('conversations')
    .select('id, title, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw new Error('List conversations: ' + error.message);
  return data || [];
}

/** Verwijder een conversatie (cascade gaat via FK). */
export async function deleteConversation(userId, conversationId) {
  // Ownership check
  const { data: conv } = await supabase
    .from('conversations')
    .select('user_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (!conv || conv.user_id !== userId) {
    const err = new Error('Geen toegang tot dit gesprek.');
    err.status = 403;
    throw err;
  }
  const { error } = await supabase
    .from('conversations')
    .delete()
    .eq('id', conversationId);
  if (error) throw new Error('Delete conversation: ' + error.message);
}

/** Update-title endpoint-logica (ownership check + set). */
export async function renameConversation(userId, conversationId, title) {
  const trimmed = (title || '').trim().slice(0, 80);
  if (!trimmed) throw new Error('Titel mag niet leeg zijn.');
  const { data: conv } = await supabase
    .from('conversations')
    .select('user_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (!conv || conv.user_id !== userId) {
    const err = new Error('Geen toegang tot dit gesprek.');
    err.status = 403;
    throw err;
  }
  await setConversationTitle(conversationId, trimmed);
  return trimmed;
}
