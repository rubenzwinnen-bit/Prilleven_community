// Catch-all router voor alle /api/community/* endpoints.
// Wordt door Vercel als ÉÉN serverless function geteld i.p.v. één per pad.
// Dit houdt ons onder de Hobby-limiet (12 functions per deployment).
//
// Vercel routet hier naartoe via een rewrite in vercel.json:
//   /api/community/(.*) → /api/community
//
// Routes (intern):
//   GET    /api/community/profile
//   PUT    /api/community/profile
//   GET    /api/community/posts?category=&before=&limit=
//   POST   /api/community/posts
//   GET    /api/community/posts/:id/replies
//   POST   /api/community/posts/:id/replies
//   POST   /api/community/posts/:id/like
//   POST   /api/community/upload-url

import { requireAuth, AuthError } from './_lib/auth.mjs';
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
  createImageUploadUrl,
  signImageUrls,
  sanitizePollInput,
  loadPollsForPosts,
  votePoll,
} from './_lib/community.mjs';
import { findBlockedWord } from './_lib/moderation.mjs';

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
 * Gebruikt req.query.path (Vercel catch-all conventie): voor request
 *   /api/community/posts/abc/replies
 * is req.query.path === ['posts','abc','replies'] (of soms een /-string).
 */
/**
 * Verzamel pad-segmenten ná /api/community/.
 * Probeert eerst req.query.path (Vercel auto-parse), valt terug op
 * parsen van req.url (zoals andere api/*[id].mjs in dit project).
 */
function getSegments(req) {
  const raw = req.query?.path;
  if (Array.isArray(raw) && raw.length > 0) return raw;
  if (typeof raw === 'string' && raw.length > 0) {
    return raw.split('/').filter(Boolean);
  }
  if (req.url) {
    const pathname = new URL(req.url, 'http://x').pathname;
    const stripped = pathname.replace(/^\/api\/community\/?/, '');
    return stripped.split('/').filter(Boolean);
  }
  return [];
}

function matchRoute(req) {
  const segments = getSegments(req);
  const method = req.method;

  // /profile
  if (segments.length === 1 && segments[0] === 'profile') {
    if (method === 'GET') return { route: 'profile.get' };
    if (method === 'PUT') return { route: 'profile.put' };
  }

  // /posts
  if (segments.length === 1 && segments[0] === 'posts') {
    if (method === 'GET')  return { route: 'posts.list' };
    if (method === 'POST') return { route: 'posts.create' };
  }

  // /posts/:id/replies
  if (segments.length === 3 && segments[0] === 'posts' && segments[2] === 'replies') {
    const id = segments[1];
    if (method === 'GET')  return { route: 'replies.list',   params: { id } };
    if (method === 'POST') return { route: 'replies.create', params: { id } };
  }

  // /posts/:id/like
  if (segments.length === 3 && segments[0] === 'posts' && segments[2] === 'like') {
    if (method === 'POST') return { route: 'like.toggle', params: { id: segments[1] } };
  }

  // /upload-url
  if (segments.length === 1 && segments[0] === 'upload-url' && method === 'POST') {
    return { route: 'upload.url' };
  }

  // /posts/:id/poll/vote
  if (segments.length === 4 && segments[0] === 'posts' && segments[2] === 'poll' && segments[3] === 'vote') {
    if (method === 'POST') return { route: 'poll.vote', params: { id: segments[1] } };
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

  // Voor query-params (category=, before=, limit=) parsen we wel req.url.
  const url = new URL(req.url, `http://${req.headers.host || 'x'}`);
  const matched = matchRoute(req);
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
      const postIds = posts.map(p => p.id);
      const pollIds = posts.filter(p => p.has_poll).map(p => p.id);
      const [likedSet, signedMap, pollMap] = await Promise.all([
        loadMyLikesForPosts(auth.userId, postIds),
        signImageUrls(posts.map(p => p.image_path).filter(Boolean)),
        loadPollsForPosts(auth.userId, pollIds),
      ]);
      const enriched = posts.map(p => ({
        ...p,
        liked_by_me: likedSet.has(p.id),
        image_url: p.image_path ? (signedMap.get(p.image_path) || null) : null,
        poll: p.has_poll ? (pollMap.get(p.id) || null) : null,
      }));
      return json(res, 200, { posts: enriched });
    }
    if (route === 'posts.create') {
      const body = parseBody(req);
      if (body === null) return json(res, 400, { error: 'Ongeldige JSON.' });

      const profile = await loadCommunityProfile(auth.userId);
      if (!profile) return json(res, 412, { error: 'Stel eerst een nickname in.' });

      let clean, pollClean = null;
      try {
        clean = sanitizePostInput(body);
        pollClean = sanitizePollInput(body.poll);
      }
      catch (err) { return json(res, err.status || 422, { error: err.message }); }

      // Image_path moet onder de eigen user-folder zitten (anti-spoof).
      if (clean.image_path && !clean.image_path.startsWith(auth.userId + '/')) {
        return json(res, 403, { error: 'Ongeldig pad voor afbeelding.' });
      }

      if (findBlockedWord(clean.body)) {
        return json(res, 422, {
          error: 'Bericht bevat ongepaste taal en kan niet worden geplaatst.',
        });
      }
      // Ook poll-vraag checken op blacklist
      if (pollClean && findBlockedWord(pollClean.question)) {
        return json(res, 422, {
          error: 'Poll-vraag bevat ongepaste taal.',
        });
      }
      const post = await createPost(auth.userId, { ...clean, poll: pollClean });
      const [signedMap, pollMap] = await Promise.all([
        post.image_path ? signImageUrls([post.image_path]) : Promise.resolve(new Map()),
        post.has_poll  ? loadPollsForPosts(auth.userId, [post.id]) : Promise.resolve(new Map()),
      ]);
      return json(res, 201, {
        post: {
          ...post,
          liked_by_me: false,
          image_url: post.image_path ? (signedMap.get(post.image_path) || null) : null,
          poll:      post.has_poll  ? (pollMap.get(post.id) || null) : null,
        },
      });
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

    /* ----- upload ----- */
    if (route === 'upload.url') {
      const profile = await loadCommunityProfile(auth.userId);
      if (!profile) return json(res, 412, { error: 'Stel eerst een nickname in.' });
      const result = await createImageUploadUrl(auth.userId);
      return json(res, 200, result);
    }

    /* ----- poll vote ----- */
    if (route === 'poll.vote') {
      if (!isUuid(params.id)) return json(res, 400, { error: 'Ongeldige post-id.' });
      const body = parseBody(req);
      if (body === null) return json(res, 400, { error: 'Ongeldige JSON.' });
      const optionIdx = parseInt(body.option_idx, 10);
      try {
        const result = await votePoll(auth.userId, params.id, optionIdx);
        return json(res, 200, { poll: result });
      } catch (err) {
        return json(res, err.status || 500, { error: err.message });
      }
    }

    return json(res, 404, { error: 'Endpoint niet gevonden.' });
  } catch (err) {
    console.error('[community]', err);
    return json(res, 500, { error: err.message || 'Er ging iets mis.' });
  }
}
