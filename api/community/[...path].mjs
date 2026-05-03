// Catch-all router voor alle /api/community/* endpoints.
// Wordt door Vercel als ÉÉN serverless function geteld i.p.v. één per pad.
// Dit houdt ons onder de Hobby-limiet (12 functions per deployment).
//
// Routes:
//   GET    /api/community/profile
//   PUT    /api/community/profile
//   GET    /api/community/posts?category=&before=&limit=
//   POST   /api/community/posts
//   GET    /api/community/posts/:id/replies
//   POST   /api/community/posts/:id/replies
//   POST   /api/community/posts/:id/like

import { requireAuth, AuthError } from '../_lib/auth.mjs';
import {
  loadCommunityProfile,
  validateNickname,
  isNicknameReserved,
  isNicknameTaken,
  upsertCommunityProfile,
  loadPosts,
  sanitizePostInput,
  createPost,
  loadMyLikesForPosts,
  loadReplies,
  sanitizeReplyInput,
  createReply,
  toggleLike,
} from '../_lib/community.mjs';
import { findBlockedWord } from '../_lib/moderation.mjs';

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s));
}

function parseBody(req) {
  try {
    return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return null;
  }
}

/**
 * Bepaal welke route past bij het pad. Returnt { route, params } of null.
 * Pad is wat na /api/community/ komt (zonder leading slash).
 */
function matchRoute(pathname, method) {
  // Strip /api/community prefix (Vercel geeft volledig pad in req.url).
  let p = pathname.replace(/^\/api\/community\/?/, '');
  // Drop trailing slash
  p = p.replace(/\/+$/, '');

  if (p === 'profile') {
    if (method === 'GET') return { route: 'profile.get' };
    if (method === 'PUT') return { route: 'profile.put' };
  }

  if (p === 'posts') {
    if (method === 'GET')  return { route: 'posts.list' };
    if (method === 'POST') return { route: 'posts.create' };
  }

  // /posts/:id/replies
  let m = /^posts\/([^/]+)\/replies$/.exec(p);
  if (m) {
    const id = m[1];
    if (method === 'GET')  return { route: 'replies.list',   params: { id } };
    if (method === 'POST') return { route: 'replies.create', params: { id } };
  }

  // /posts/:id/like
  m = /^posts\/([^/]+)\/like$/.exec(p);
  if (m && method === 'POST') {
    return { route: 'like.toggle', params: { id: m[1] } };
  }

  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  // Auth voor alle community-endpoints (allemaal vereisen ingelogd).
  let auth;
  try {
    auth = await requireAuth(req);
  } catch (e) {
    if (e instanceof AuthError) return json(res, e.status, { error: e.message });
    throw e;
  }

  // Vercel zet het volledige pad in req.url (zonder host).
  const url = new URL(req.url, `http://${req.headers.host || 'x'}`);
  const matched = matchRoute(url.pathname, req.method);
  if (!matched) {
    return json(res, 404, { error: 'Endpoint niet gevonden.' });
  }

  try {
    const { route, params } = matched;

    /* ----- profile ----- */
    if (route === 'profile.get') {
      const profile = await loadCommunityProfile(auth.userId);
      return json(res, 200, { profile });
    }
    if (route === 'profile.put') {
      const body = parseBody(req);
      if (body === null) return json(res, 400, { error: 'Ongeldige JSON.' });

      const validation = validateNickname(body.nickname);
      if (!validation.ok) return json(res, 422, { error: validation.error });
      const nickname = validation.value;

      if (await isNicknameReserved(nickname)) {
        return json(res, 409, { error: 'Deze nickname is gereserveerd. Kies een andere.' });
      }
      if (await isNicknameTaken(nickname, auth.userId)) {
        return json(res, 409, { error: 'Deze nickname is al in gebruik.' });
      }
      try {
        const profile = await upsertCommunityProfile(auth.userId, nickname);
        return json(res, 200, { profile });
      } catch (err) {
        if (err.status === 409) return json(res, 409, { error: err.message });
        throw err;
      }
    }

    /* ----- posts ----- */
    if (route === 'posts.list') {
      const category = url.searchParams.get('category');
      const before   = url.searchParams.get('before');
      const limit    = url.searchParams.get('limit');
      const posts = await loadPosts({ category, before, limit });
      const likedSet = await loadMyLikesForPosts(auth.userId, posts.map(p => p.id));
      const enriched = posts.map(p => ({ ...p, liked_by_me: likedSet.has(p.id) }));
      return json(res, 200, { posts: enriched });
    }
    if (route === 'posts.create') {
      const body = parseBody(req);
      if (body === null) return json(res, 400, { error: 'Ongeldige JSON.' });

      const profile = await loadCommunityProfile(auth.userId);
      if (!profile) return json(res, 412, { error: 'Stel eerst een nickname in.' });

      let clean;
      try { clean = sanitizePostInput(body); }
      catch (err) { return json(res, err.status || 422, { error: err.message }); }

      if (findBlockedWord(clean.body)) {
        return json(res, 422, {
          error: 'Bericht bevat ongepaste taal en kan niet worden geplaatst.',
        });
      }
      const post = await createPost(auth.userId, clean);
      return json(res, 201, { post: { ...post, liked_by_me: false } });
    }

    /* ----- replies ----- */
    if (route === 'replies.list' || route === 'replies.create') {
      if (!isUuid(params.id)) return json(res, 400, { error: 'Ongeldige post-id.' });
    }
    if (route === 'replies.list') {
      const replies = await loadReplies(params.id);
      return json(res, 200, { replies });
    }
    if (route === 'replies.create') {
      const body = parseBody(req);
      if (body === null) return json(res, 400, { error: 'Ongeldige JSON.' });

      const profile = await loadCommunityProfile(auth.userId);
      if (!profile) return json(res, 412, { error: 'Stel eerst een nickname in.' });

      let clean;
      try { clean = sanitizeReplyInput(body); }
      catch (err) { return json(res, err.status || 422, { error: err.message }); }

      if (findBlockedWord(clean.body)) {
        return json(res, 422, {
          error: 'Reactie bevat ongepaste taal en kan niet worden geplaatst.',
        });
      }
      try {
        const reply = await createReply(auth.userId, params.id, clean);
        return json(res, 201, { reply });
      } catch (err) {
        if (err.status === 404) return json(res, 404, { error: err.message });
        throw err;
      }
    }

    /* ----- likes ----- */
    if (route === 'like.toggle') {
      if (!isUuid(params.id)) return json(res, 400, { error: 'Ongeldige post-id.' });
      const result = await toggleLike(auth.userId, params.id);
      return json(res, 200, result);
    }

    return json(res, 404, { error: 'Endpoint niet gevonden.' });
  } catch (err) {
    console.error('[community]', err);
    return json(res, 500, { error: err.message || 'Er ging iets mis.' });
  }
}
