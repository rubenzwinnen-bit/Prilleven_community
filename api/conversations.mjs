// GET  /api/conversations        → lijst voor sidebar
// POST /api/conversations        → nieuwe aanmaken, return { id }

import { requireAuth, AuthError } from './_lib/auth.mjs';
import { listConversations, getOrCreateConversation } from './_lib/conversation.mjs';

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  let auth;
  try {
    auth = await requireAuth(req);
  } catch (e) {
    if (e instanceof AuthError) return json(res, e.status, { error: e.message });
    throw e;
  }

  try {
    if (req.method === 'GET') {
      const list = await listConversations(auth.userId);
      return json(res, 200, { conversations: list });
    }
    if (req.method === 'POST') {
      const conv = await getOrCreateConversation(auth.userId, null);
      return json(res, 201, { id: conv.id, title: conv.title, created_at: conv.created_at });
    }
    return json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('[conversations]', err);
    return json(res, err.status || 500, { error: err.message || 'Er ging iets mis.' });
  }
}
