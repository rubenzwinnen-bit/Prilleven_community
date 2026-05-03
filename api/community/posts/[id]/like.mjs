// POST /api/community/posts/:id/like  → { liked, count }
// Toggle: bestaat de like al → verwijderen; anders aanmaken.

import { requireAuth, AuthError } from '../../../_lib/auth.mjs';
import { toggleLike } from '../../../_lib/community.mjs';

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  let auth;
  try {
    auth = await requireAuth(req);
  } catch (e) {
    if (e instanceof AuthError) return json(res, e.status, { error: e.message });
    throw e;
  }

  const postId = req.query?.id || extractIdFromUrl(req.url);
  if (!postId || !isUuid(postId)) {
    return json(res, 400, { error: 'Ongeldige post-id.' });
  }

  try {
    const result = await toggleLike(auth.userId, postId);
    return json(res, 200, result);
  } catch (err) {
    console.error('[community/posts/:id/like]', err);
    return json(res, 500, { error: err.message || 'Er ging iets mis.' });
  }
}

function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s));
}
function extractIdFromUrl(url) {
  const m = /\/posts\/([^/?]+)\/like/i.exec(String(url || ''));
  return m ? m[1] : null;
}
