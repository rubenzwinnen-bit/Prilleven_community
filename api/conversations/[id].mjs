// GET    /api/conversations/[id]  → full messages
// PATCH  /api/conversations/[id]  → rename (body: { title })
// DELETE /api/conversations/[id]  → verwijder

import { requireAuth, AuthError } from '../_lib/auth.mjs';
import {
  getOrCreateConversation,
  loadConversationMessages,
  renameConversation,
  deleteConversation,
} from '../_lib/conversation.mjs';

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  // Vercel dev gives query.id; ook robuust fallback via URL parsing
  const id = req.query?.id ||
    (req.url ? new URL(req.url, 'http://x').pathname.split('/').filter(Boolean).pop() : null);
  if (!id) return json(res, 400, { error: 'Missing conversation id.' });

  let auth;
  try {
    auth = await requireAuth(req);
  } catch (e) {
    if (e instanceof AuthError) return json(res, e.status, { error: e.message });
    throw e;
  }

  try {
    if (req.method === 'GET') {
      // Ownership check via getOrCreateConversation met bestaande id
      const conv = await getOrCreateConversation(auth.userId, id);
      const messages = await loadConversationMessages(conv.id);
      return json(res, 200, { conversation: conv, messages });
    }
    if (req.method === 'PATCH') {
      let body;
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      } catch {
        return json(res, 400, { error: 'Ongeldige JSON.' });
      }
      const title = await renameConversation(auth.userId, id, body.title);
      return json(res, 200, { id, title });
    }
    if (req.method === 'DELETE') {
      await deleteConversation(auth.userId, id);
      return json(res, 204, {});
    }
    return json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('[conversations/[id]]', err);
    return json(res, err.status || 500, { error: err.message || 'Er ging iets mis.' });
  }
}
