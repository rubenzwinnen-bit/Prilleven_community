// GET  /api/community/posts/:id/replies  → { replies }
// POST /api/community/posts/:id/replies  body: { body } → { reply }
//
// Replies vereisen ingelogde user + nickname-profiel + blacklist-check.

import { requireAuth, AuthError } from '../../../_lib/auth.mjs';
import {
  loadReplies,
  sanitizeReplyInput,
  createReply,
  loadCommunityProfile,
} from '../../../_lib/community.mjs';
import { findBlockedWord } from '../../../_lib/moderation.mjs';

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

  const postId = req.query?.id || extractIdFromUrl(req.url);
  if (!postId || !isUuid(postId)) {
    return json(res, 400, { error: 'Ongeldige post-id.' });
  }

  try {
    if (req.method === 'GET') {
      const replies = await loadReplies(postId);
      return json(res, 200, { replies });
    }

    if (req.method === 'POST') {
      let body;
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      } catch {
        return json(res, 400, { error: 'Ongeldige JSON.' });
      }

      const profile = await loadCommunityProfile(auth.userId);
      if (!profile) {
        return json(res, 412, { error: 'Stel eerst een nickname in.' });
      }

      let clean;
      try {
        clean = sanitizeReplyInput(body);
      } catch (err) {
        return json(res, err.status || 422, { error: err.message });
      }

      const blocked = findBlockedWord(clean.body);
      if (blocked) {
        return json(res, 422, {
          error: 'Reactie bevat ongepaste taal en kan niet worden geplaatst.',
        });
      }

      try {
        const reply = await createReply(auth.userId, postId, clean);
        return json(res, 201, { reply });
      } catch (err) {
        if (err.status === 404) return json(res, 404, { error: err.message });
        throw err;
      }
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('[community/posts/:id/replies]', err);
    return json(res, 500, { error: err.message || 'Er ging iets mis.' });
  }
}

function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s));
}
function extractIdFromUrl(url) {
  // /api/community/posts/<uuid>/replies(?...)
  const m = /\/posts\/([^/?]+)\/replies/i.exec(String(url || ''));
  return m ? m[1] : null;
}
