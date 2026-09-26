// GET    /api/chat-feedback?conversation_id=X  → { feedback: { [message_id]: { rating, reden } } }
// POST   /api/chat-feedback  body { message_id, rating: 1|-1, reden? }  → { ok: true }
// DELETE /api/chat-feedback?message_id=X  → 204
//
// 👍/👎 per antwoord van HapjesHeld. Vervangt "Dit helpt mij", dat enkel in
// localStorage stond. Het overzicht voor admins zit in /api/admin?section=feedback.
//
// Het user_id komt uit het JWT, nooit uit de body, en we controleren telkens
// dat het antwoord in een gesprek van de gebruiker zelf staat.

import { requireAuth, AuthError } from './_lib/auth.mjs';
import { supabase } from './_lib/clients.mjs';

const MAX_REDEN = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

async function leesBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

// Is dit een antwoord van de bot in een gesprek van deze gebruiker?
async function isEigenAntwoord(userId, messageId) {
  const { data, error } = await supabase
    .from('messages')
    .select('id, role, conversations!inner(user_id)')
    .eq('id', messageId)
    .eq('conversations.user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data && data.role === 'assistant');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  let auth;
  try {
    auth = await requireAuth(req);
  } catch (e) {
    if (e instanceof AuthError) return json(res, e.status, { error: e.message });
    return json(res, 500, { error: 'Er ging iets mis bij authenticatie.' });
  }
  const userId = auth.userId;
  const url = new URL(req.url, 'http://x');

  try {
    if (req.method === 'GET') {
      const conversationId = url.searchParams.get('conversation_id') || '';
      if (!UUID_RE.test(conversationId)) return json(res, 400, { error: 'conversation_id ontbreekt.' });

      const { data, error } = await supabase
        .from('chat_feedback')
        .select('message_id, rating, reden, messages!inner(conversation_id)')
        .eq('user_id', userId)
        .eq('messages.conversation_id', conversationId);
      if (error) throw new Error(error.message);

      const feedback = {};
      for (const r of data || []) feedback[r.message_id] = { rating: r.rating, reden: r.reden };
      return json(res, 200, { feedback });
    }

    if (req.method === 'POST') {
      const body = await leesBody(req);
      const messageId = String(body.message_id || '');
      const rating = Number(body.rating);
      if (!UUID_RE.test(messageId)) return json(res, 400, { error: 'message_id ontbreekt.' });
      if (rating !== 1 && rating !== -1) return json(res, 400, { error: 'rating moet 1 of -1 zijn.' });
      const reden = rating === -1 && typeof body.reden === 'string'
        ? body.reden.trim().slice(0, MAX_REDEN) || null
        : null;

      if (!(await isEigenAntwoord(userId, messageId))) {
        return json(res, 404, { error: 'Antwoord niet gevonden.' });
      }

      const { error } = await supabase
        .from('chat_feedback')
        .upsert({
          message_id: messageId,
          user_id: userId,
          rating,
          reden,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'message_id,user_id' });
      if (error) throw new Error(error.message);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'DELETE') {
      const messageId = url.searchParams.get('message_id') || '';
      if (!UUID_RE.test(messageId)) return json(res, 400, { error: 'message_id ontbreekt.' });
      const { error } = await supabase
        .from('chat_feedback')
        .delete()
        .eq('message_id', messageId)
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
      res.statusCode = 204;
      return res.end();
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('[chat-feedback]', err);
    return json(res, 500, { error: 'Er ging iets mis. Probeer het later opnieuw.' });
  }
}
