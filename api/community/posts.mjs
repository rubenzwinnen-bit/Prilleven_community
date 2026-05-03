// GET  /api/community/posts?category=&before=&limit=20  → { posts }
// POST /api/community/posts  body: { body, category? }   → { post }
//
// POST vereist een aangemaakt nickname-profiel + woord-blacklist check.

import { requireAuth, AuthError } from '../_lib/auth.mjs';
import {
  loadPosts,
  sanitizePostInput,
  createPost,
  loadCommunityProfile,
} from '../_lib/community.mjs';
import { findBlockedWord } from '../_lib/moderation.mjs';

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
      const url = new URL(req.url, `http://${req.headers.host || 'x'}`);
      const category = url.searchParams.get('category');
      const before   = url.searchParams.get('before');
      const limit    = url.searchParams.get('limit');
      const posts = await loadPosts({ category, before, limit });
      return json(res, 200, { posts });
    }

    if (req.method === 'POST') {
      let body;
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      } catch {
        return json(res, 400, { error: 'Ongeldige JSON.' });
      }

      // Vereist een ingestelde nickname.
      const profile = await loadCommunityProfile(auth.userId);
      if (!profile) {
        return json(res, 412, { error: 'Stel eerst een nickname in.' });
      }

      let clean;
      try {
        clean = sanitizePostInput(body);
      } catch (err) {
        return json(res, err.status || 422, { error: err.message });
      }

      const blocked = findBlockedWord(clean.body);
      if (blocked) {
        return json(res, 422, {
          error: 'Bericht bevat ongepaste taal en kan niet worden geplaatst.',
        });
      }

      const post = await createPost(auth.userId, clean);
      return json(res, 201, { post });
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('[community/posts]', err);
    return json(res, 500, { error: err.message || 'Er ging iets mis.' });
  }
}
