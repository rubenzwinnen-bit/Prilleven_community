// Catch-all router voor alle /api/community/* endpoints.
// Wordt door Vercel als ÉÉN serverless function geteld i.p.v. één per pad.
// Ontstond onder de Hobby-limiet (12 functions); sinds Vercel Pro niet meer nodig,
// maar de catch-all blijft omdat alle community-routes bij elkaar horen.
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
//   GET    /api/community/blocks            → eigen blocklijst
//   POST   /api/community/blocks            → gebruiker blokkeren { blocked_id }
//   DELETE /api/community/blocks/:id        → gebruiker deblokkeren
//   GET    /api/community/app-badges?since= → tijdlijn-badge teller { timeline }

import { requireAuth, requireAdmin, AuthError } from './_lib/auth.mjs';
import { supabase } from './_lib/clients.mjs';
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
  loadAdminUserIds,
  loadReplies,
  sanitizeReplyInput,
  createReply,
  toggleLike,
  loadMyLikesForReplies,
  loadReplyLikeCounts,
  toggleReplyLike,
  createImageUploadUrl,
  createAvatarUploadUrl,
  signImageUrls,
  sanitizePollInput,
  loadPollsForPosts,
  votePoll,
  editPost,
  deletePost,
  editReply,
  deleteReply,
  createReport,
  adminTogglePin,
  adminListReports,
  adminResolveReport,
  adminResolveAndDelete,
  loadMyNotifications,
  countUnreadNotifications,
  markAllNotificationsRead,
  loadBlockedUserIds,
  loadMyBlocks,
  blockUser,
  unblockUser,
} from './_lib/community.mjs';
import { findBlockedWord } from './_lib/moderation.mjs';
import {
  countTimelineBadge,
  loadFollowedChatroomTopics,
} from './_lib/badges.mjs';
import {
  upsertPushToken,
  deletePushToken,
  notifyNewActivity,
} from './_lib/push.mjs';


function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

/** Kort fragment voor de push-body (max 120 tekens, whitespace genormaliseerd). */
function snippet(text, max = 120) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
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

  // /posts/:id   (edit / delete)
  if (segments.length === 2 && segments[0] === 'posts') {
    const id = segments[1];
    if (method === 'PATCH')  return { route: 'posts.edit',   params: { id } };
    if (method === 'DELETE') return { route: 'posts.delete', params: { id } };
  }

  // /posts/:id/replies
  if (segments.length === 3 && segments[0] === 'posts' && segments[2] === 'replies') {
    const id = segments[1];
    if (method === 'GET')  return { route: 'replies.list',   params: { id } };
    if (method === 'POST') return { route: 'replies.create', params: { id } };
  }

  // /replies/:id   (edit / delete)
  if (segments.length === 2 && segments[0] === 'replies') {
    const id = segments[1];
    if (method === 'PATCH')  return { route: 'replies.edit',   params: { id } };
    if (method === 'DELETE') return { route: 'replies.delete', params: { id } };
  }

  // /posts/:id/like
  if (segments.length === 3 && segments[0] === 'posts' && segments[2] === 'like') {
    if (method === 'POST') return { route: 'like.toggle', params: { id: segments[1] } };
  }

  // /replies/:id/like
  if (segments.length === 3 && segments[0] === 'replies' && segments[2] === 'like') {
    if (method === 'POST') return { route: 'reply.like.toggle', params: { id: segments[1] } };
  }

  // /report
  if (segments.length === 1 && segments[0] === 'report' && method === 'POST') {
    return { route: 'report.create' };
  }

  // /posts/:id/pin   (admin)
  if (segments.length === 3 && segments[0] === 'posts' && segments[2] === 'pin' && method === 'POST') {
    return { route: 'admin.pin', params: { id: segments[1] } };
  }

  // /admin/reports               (GET lijst)
  // /admin/reports/:id/resolve   (POST sluiten)
  if (segments[0] === 'admin' && segments[1] === 'reports') {
    if (segments.length === 2 && method === 'GET') return { route: 'admin.reports.list' };
    if (segments.length === 4 && segments[3] === 'resolve' && method === 'POST') {
      return { route: 'admin.reports.resolve', params: { id: segments[2] } };
    }
  }

  // /upload-url
  if (segments.length === 1 && segments[0] === 'upload-url' && method === 'POST') {
    return { route: 'upload.url' };
  }

  // /profile/avatar-url
  if (segments.length === 2 && segments[0] === 'profile' && segments[1] === 'avatar-url' && method === 'POST') {
    return { route: 'profile.avatar.url' };
  }

  // /posts/:id/poll/vote
  if (segments.length === 4 && segments[0] === 'posts' && segments[2] === 'poll' && segments[3] === 'vote') {
    if (method === 'POST') return { route: 'poll.vote', params: { id: segments[1] } };
  }

  // /notifications        → GET lijst + unread count
  // /notifications/read   → POST markeer alles gelezen
  if (segments[0] === 'notifications') {
    if (segments.length === 1 && method === 'GET')                        return { route: 'notifications.list' };
    if (segments.length === 2 && segments[1] === 'read' && method === 'POST') return { route: 'notifications.read' };
  }

  // /blocks         → GET eigen blocklijst, POST blokkeren { blocked_id }
  // /blocks/:id      → DELETE deblokkeren
  if (segments[0] === 'blocks') {
    if (segments.length === 1 && method === 'GET')  return { route: 'blocks.list' };
    if (segments.length === 1 && method === 'POST') return { route: 'blocks.create' };
    if (segments.length === 2 && method === 'DELETE') return { route: 'blocks.delete', params: { id: segments[1] } };
  }

  // /app-badges     → GET tijdlijn-badge teller { timeline }
  if (segments.length === 1 && segments[0] === 'app-badges' && method === 'GET') {
    return { route: 'app-badges' };
  }

  // /push/register  → POST token opslaan { token, platform }, DELETE { token }
  if (segments.length === 2 && segments[0] === 'push' && segments[1] === 'register') {
    if (method === 'POST')   return { route: 'push.register' };
    if (method === 'DELETE') return { route: 'push.deregister' };
  }

  // /badge-state    → PUT server-side "laatst gezien"-state syncen
  if (segments.length === 1 && segments[0] === 'badge-state' && method === 'PUT') {
    return { route: 'badge-state.put' };
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
      let avatar_url = null;
      if (profile?.avatar_path) {
        const m = await signImageUrls([profile.avatar_path]);
        avatar_url = m.get(profile.avatar_path) || null;
      }
      return json(res, 200, { profile: profile ? { ...profile, avatar_url } : null });
    }
    if (route === 'profile.put') {
      const body = parseBody(req);
      if (body === null) return json(res, 400, { error: 'Ongeldige JSON.' });

      const updates = {};

      // Nickname is optioneel — alleen valideren als meegestuurd.
      if (body.nickname !== undefined) {
        const validation = validateNickname(body.nickname);
        if (!validation.ok) return json(res, 422, { error: validation.error });
        const nickname = validation.value;
        if (await isNicknameReserved(nickname)) {
          return json(res, 409, { error: 'Deze nickname is gereserveerd. Kies een andere.' });
        }
        if (await isNicknameTaken(nickname, auth.userId)) {
          return json(res, 409, { error: 'Deze nickname is al in gebruik.' });
        }
        updates.nickname = nickname;
      }

      // Avatar_path is ook optioneel; null = verwijderen
      if (body.avatar_path !== undefined) {
        if (body.avatar_path === null) {
          updates.avatar_path = null;
        } else if (typeof body.avatar_path === 'string'
                && body.avatar_path.startsWith(auth.userId + '/avatars/')
                && /^[A-Za-z0-9/_.-]{1,200}$/.test(body.avatar_path)) {
          updates.avatar_path = body.avatar_path;
        } else {
          return json(res, 422, { error: 'Ongeldig avatar-pad.' });
        }
      }

      if (Object.keys(updates).length === 0) {
        return json(res, 422, { error: 'Geen wijzigingen meegegeven.' });
      }

      try {
        const profile = await upsertCommunityProfile(auth.userId, updates);
        // Voeg avatar_url toe aan response
        let avatar_url = null;
        if (profile.avatar_path) {
          const m = await signImageUrls([profile.avatar_path]);
          avatar_url = m.get(profile.avatar_path) || null;
        }
        return json(res, 200, { profile: { ...profile, avatar_url } });
      } catch (err) {
        if (err.status === 409) return json(res, 409, { error: err.message });
        throw err;
      }
    }

    /* ----- app-badges ----- */
    if (route === 'app-badges') {
      const since = url.searchParams.get('since');
      const timeline = await countTimelineBadge(auth.userId, since);
      return json(res, 200, { timeline });
    }

    /* ----- push register / deregister ----- */
    if (route === 'push.register') {
      const body = parseBody(req);
      if (body === null) return json(res, 400, { error: 'Ongeldige JSON.' });
      const token = String(body.token || '').trim();
      if (!token) return json(res, 400, { error: 'Token ontbreekt.' });
      await upsertPushToken(auth.userId, token, body.platform);
      return json(res, 200, { ok: true });
    }
    if (route === 'push.deregister') {
      const body = parseBody(req);
      if (body === null) return json(res, 400, { error: 'Ongeldige JSON.' });
      const token = String(body.token || '').trim();
      if (!token) return json(res, 400, { error: 'Token ontbreekt.' });
      await deletePushToken(auth.userId, token);
      return json(res, 200, { ok: true });
    }

    /* ----- badge-state (server-side "laatst gezien"-spiegel) ----- */
    if (route === 'badge-state.put') {
      const body = parseBody(req);
      if (body === null) return json(res, 400, { error: 'Ongeldige JSON.' });
      const patch = { user_id: auth.userId, updated_at: new Date().toISOString() };
      if (body.timeline_seen_at !== undefined)  patch.timeline_seen_at  = body.timeline_seen_at;
      if (body.chatrooms_seen_at !== undefined) patch.chatrooms_seen_at = body.chatrooms_seen_at;
      if (body.topic_reads !== undefined && body.topic_reads !== null) {
        patch.topic_reads = body.topic_reads;
      }
      const { error } = await supabase
        .from('user_badge_state')
        .upsert(patch, { onConflict: 'user_id' });
      if (error) return json(res, 500, { error: error.message });
      return json(res, 200, { ok: true });
    }

    /* ----- posts ----- */
    if (route === 'posts.list') {
      const category = url.searchParams.get('category');
      const before   = url.searchParams.get('before');
      const limit    = url.searchParams.get('limit');
      const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);

      // Haal community-posts, gevolgde chatroom-topics en blocklijst parallel op
      const [postsRaw, chatroomRaw, blockedIds] = await Promise.all([
        loadPosts({ category, before, limit }),
        loadFollowedChatroomTopics(auth.userId, { before, limit: safeLimit }),
        loadBlockedUserIds(auth.userId),
      ]);

      // Verberg content van geblokkeerde gebruikers (eenrichtings-block)
      const posts         = postsRaw.filter(p => !blockedIds.has(p.user_id));
      const chatroomItems = chatroomRaw.filter(t => !blockedIds.has(t.user_id));

      // Enrich community posts
      const postIds   = posts.map(p => p.id);
      const pollIds   = posts.filter(p => p.has_poll).map(p => p.id);
      const authorIds = [...new Set([...posts.map(p => p.user_id), ...chatroomItems.map(t => t.user_id)])];
      const allPaths  = [
        ...posts.map(p => p.image_path).filter(Boolean),
        ...posts.map(p => p.avatar_path).filter(Boolean),
        ...chatroomItems.map(t => t.avatar_path).filter(Boolean),
      ];
      const [likedSet, signedMap, pollMap, adminSet] = await Promise.all([
        loadMyLikesForPosts(auth.userId, postIds),
        allPaths.length ? signImageUrls(allPaths) : Promise.resolve(new Map()),
        pollIds.length  ? loadPollsForPosts(auth.userId, pollIds) : Promise.resolve(new Map()),
        authorIds.length ? loadAdminUserIds(authorIds) : Promise.resolve(new Set()),
      ]);
      const enrichedPosts = posts.map(p => ({
        ...p,
        source_type: 'community',
        liked_by_me: likedSet.has(p.id),
        image_url:  p.image_path  ? (signedMap.get(p.image_path)  || null) : null,
        avatar_url: p.avatar_path ? (signedMap.get(p.avatar_path) || null) : null,
        poll: p.has_poll ? (pollMap.get(p.id) || null) : null,
        author_is_admin: adminSet.has(p.user_id),
      }));
      const enrichedChatroom = chatroomItems.map(t => ({
        ...t,
        avatar_url: t.avatar_path ? (signedMap.get(t.avatar_path) || null) : null,
        author_is_admin: adminSet.has(t.user_id),
      }));

      // Meng en sorteer op created_at desc; pinned community-posts staan altijd bovenaan
      const pinnedPosts    = enrichedPosts.filter(p => p.is_pinned);
      const nonPinnedPosts = enrichedPosts.filter(p => !p.is_pinned);
      const mixed = [...nonPinnedPosts, ...enrichedChatroom]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, safeLimit);
      return json(res, 200, { posts: [...pinnedPosts, ...mixed] });
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
      const allPaths = [post.image_path, post.avatar_path].filter(Boolean);
      const [signedMap, pollMap, adminSet] = await Promise.all([
        allPaths.length ? signImageUrls(allPaths) : Promise.resolve(new Map()),
        post.has_poll   ? loadPollsForPosts(auth.userId, [post.id]) : Promise.resolve(new Map()),
        loadAdminUserIds([post.user_id]),
      ]);
      /* Push-notificatie (niet-blokkerend): een nieuwe tijdlijn-post gaat naar
         alle gebruikers met een token; hun app-icoon-badge wordt bijgewerkt. */
      await notifyNewActivity(
        'timeline_post',
        { authorId: post.user_id, postId: post.id, authorIsAdmin: adminSet.has(post.user_id) },
        { title: 'Nieuw bericht op de tijdlijn', body: snippet(post.body) }
      );
      return json(res, 201, {
        post: {
          ...post,
          liked_by_me: false,
          image_url:  post.image_path  ? (signedMap.get(post.image_path)  || null) : null,
          avatar_url: post.avatar_path ? (signedMap.get(post.avatar_path) || null) : null,
          poll:       post.has_poll    ? (pollMap.get(post.id) || null) : null,
          author_is_admin: adminSet.has(post.user_id),
        },
      });
    }

    /* ----- replies ----- */
    if (route === 'replies.list' || route === 'replies.create') {
      if (!isUuid(params.id)) return json(res, 400, { error: 'Ongeldige post-id.' });
    }
    if (route === 'replies.list') {
      const [repliesRaw, blockedIds] = await Promise.all([
        loadReplies(params.id),
        loadBlockedUserIds(auth.userId),
      ]);
      const replies = repliesRaw.filter(r => !blockedIds.has(r.user_id));
      const avatarPaths = replies.map(r => r.avatar_path).filter(Boolean);
      const replyIds = replies.map(r => r.id);
      const authorIds = replies.map(r => r.user_id);
      const [signedMap, likedSet, countMap, adminSet] = await Promise.all([
        avatarPaths.length ? signImageUrls(avatarPaths) : Promise.resolve(new Map()),
        loadMyLikesForReplies(auth.userId, replyIds),
        loadReplyLikeCounts(replyIds),
        loadAdminUserIds(authorIds),
      ]);
      const enriched = replies.map(r => ({
        ...r,
        avatar_url: r.avatar_path ? (signedMap.get(r.avatar_path) || null) : null,
        likes_count: countMap.get(r.id) || 0,
        liked_by_me: likedSet.has(r.id),
        author_is_admin: adminSet.has(r.user_id),
      }));
      return json(res, 200, { replies: enriched });
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
        const [me, adminSet] = await Promise.all([
          loadCommunityProfile(auth.userId),
          loadAdminUserIds([auth.userId]),
        ]);
        let avatar_url = null;
        if (me?.avatar_path) {
          const m = await signImageUrls([me.avatar_path]);
          avatar_url = m.get(me.avatar_path) || null;
        }
        /* Push (niet-blokkerend): een nieuwe reply telt voor admins altijd mee,
           voor gewone gebruikers enkel als de auteur admin is. */
        await notifyNewActivity(
          'timeline_reply',
          { authorId: auth.userId, postId: params.id, authorIsAdmin: adminSet.has(auth.userId) },
          { title: 'Nieuwe reactie op de tijdlijn', body: snippet(reply.body) }
        );
        return json(res, 201, {
          reply: {
            ...reply,
            avatar_path: me?.avatar_path || null,
            avatar_url,
            likes_count: 0,
            liked_by_me: false,
            author_is_admin: adminSet.has(auth.userId),
          },
        });
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
    if (route === 'reply.like.toggle') {
      if (!isUuid(params.id)) return json(res, 400, { error: 'Ongeldige reply-id.' });
      try {
        const result = await toggleReplyLike(auth.userId, params.id);
        return json(res, 200, result);
      } catch (err) {
        return json(res, err.status || 500, { error: err.message });
      }
    }

    /* ----- upload ----- */
    if (route === 'upload.url') {
      const profile = await loadCommunityProfile(auth.userId);
      if (!profile) return json(res, 412, { error: 'Stel eerst een nickname in.' });
      const result = await createImageUploadUrl(auth.userId);
      return json(res, 200, result);
    }
    if (route === 'profile.avatar.url') {
      // Avatar mag ook vóór nickname-set, want soms wil je avatar +
      // nickname samen kiezen in de profile-modal.
      const result = await createAvatarUploadUrl(auth.userId);
      return json(res, 200, result);
    }

    /* ----- poll vote ----- */
    if (route === 'poll.vote') {
      if (!isUuid(params.id)) return json(res, 400, { error: 'Ongeldige post-id.' });
      const body = parseBody(req);
      if (body === null) return json(res, 400, { error: 'Ongeldige JSON.' });
      const action = body.action === 'unvote' ? 'unvote'
                   : body.action === 'toggle' ? 'toggle'
                   : 'set';
      const optionIdx = action === 'unvote' ? -1 : parseInt(body.option_idx, 10);
      try {
        const result = await votePoll(auth.userId, params.id, optionIdx, action);
        return json(res, 200, { poll: result });
      } catch (err) {
        return json(res, err.status || 500, { error: err.message });
      }
    }

    /* ----- post edit / delete ----- */
    if (route === 'posts.edit') {
      if (!isUuid(params.id)) return json(res, 400, { error: 'Ongeldige post-id.' });
      const body = parseBody(req);
      if (body === null) return json(res, 400, { error: 'Ongeldige JSON.' });
      if (typeof body.body === 'string' && findBlockedWord(body.body)) {
        return json(res, 422, { error: 'Bericht bevat ongepaste taal.' });
      }
      try {
        const post = await editPost(auth.userId, params.id, body.body);
        const allPaths = [post.image_path, post.avatar_path].filter(Boolean);
        const [signedMap, pollMap, adminSet] = await Promise.all([
          allPaths.length ? signImageUrls(allPaths) : Promise.resolve(new Map()),
          post.has_poll   ? loadPollsForPosts(auth.userId, [post.id]) : Promise.resolve(new Map()),
          loadAdminUserIds([post.user_id]),
        ]);
        return json(res, 200, {
          post: {
            ...post,
            image_url:  post.image_path  ? (signedMap.get(post.image_path)  || null) : null,
            avatar_url: post.avatar_path ? (signedMap.get(post.avatar_path) || null) : null,
            poll:       post.has_poll    ? (pollMap.get(post.id) || null) : null,
            author_is_admin: adminSet.has(post.user_id),
          },
        });
      } catch (err) {
        return json(res, err.status || 500, { error: err.message });
      }
    }
    if (route === 'posts.delete') {
      if (!isUuid(params.id)) return json(res, 400, { error: 'Ongeldige post-id.' });
      try {
        await deletePost(auth.userId, params.id);
        return json(res, 200, { ok: true });
      } catch (err) {
        return json(res, err.status || 500, { error: err.message });
      }
    }

    /* ----- reply edit / delete ----- */
    if (route === 'replies.edit') {
      if (!isUuid(params.id)) return json(res, 400, { error: 'Ongeldige reply-id.' });
      const body = parseBody(req);
      if (body === null) return json(res, 400, { error: 'Ongeldige JSON.' });
      if (typeof body.body === 'string' && findBlockedWord(body.body)) {
        return json(res, 422, { error: 'Reactie bevat ongepaste taal.' });
      }
      try {
        const reply = await editReply(auth.userId, params.id, body.body);
        const [me, adminSet, likeCountMap, likedSet] = await Promise.all([
          loadCommunityProfile(auth.userId),
          loadAdminUserIds([auth.userId]),
          loadReplyLikeCounts([reply.id]),
          loadMyLikesForReplies(auth.userId, [reply.id]),
        ]);
        let avatar_url = null;
        if (me?.avatar_path) {
          const m = await signImageUrls([me.avatar_path]);
          avatar_url = m.get(me.avatar_path) || null;
        }
        return json(res, 200, {
          reply: {
            ...reply,
            avatar_path: me?.avatar_path || null,
            avatar_url,
            likes_count: likeCountMap.get(reply.id) || 0,
            liked_by_me: likedSet.has(reply.id),
            author_is_admin: adminSet.has(auth.userId),
          },
        });
      } catch (err) {
        return json(res, err.status || 500, { error: err.message });
      }
    }
    if (route === 'replies.delete') {
      if (!isUuid(params.id)) return json(res, 400, { error: 'Ongeldige reply-id.' });
      try {
        await deleteReply(auth.userId, params.id);
        return json(res, 200, { ok: true });
      } catch (err) {
        return json(res, err.status || 500, { error: err.message });
      }
    }

    /* ----- report ----- */
    if (route === 'report.create') {
      const body = parseBody(req);
      if (body === null) return json(res, 400, { error: 'Ongeldige JSON.' });
      try {
        await createReport(auth.userId, {
          target_type: body.target_type,
          target_id:   body.target_id,
          reason:      body.reason,
        });
        return json(res, 201, { ok: true });
      } catch (err) {
        return json(res, err.status || 500, { error: err.message });
      }
    }

    /* ----- notifications ----- */
    if (route === 'notifications.list') {
      const [items, unread] = await Promise.all([
        loadMyNotifications(auth.userId),
        countUnreadNotifications(auth.userId),
      ]);
      return json(res, 200, { notifications: items, unread });
    }
    if (route === 'notifications.read') {
      await markAllNotificationsRead(auth.userId);
      return json(res, 200, { ok: true });
    }

    /* ----- blocks (Guideline 1.2) ----- */
    if (route === 'blocks.list') {
      const blocks = await loadMyBlocks(auth.userId);
      return json(res, 200, { blocks });
    }
    if (route === 'blocks.create') {
      const body = parseBody(req);
      if (body === null) return json(res, 400, { error: 'Ongeldige JSON.' });
      try {
        await blockUser(auth.userId, body.blocked_id);
        return json(res, 201, { ok: true });
      } catch (err) {
        return json(res, err.status || 500, { error: err.message });
      }
    }
    if (route === 'blocks.delete') {
      try {
        await unblockUser(auth.userId, params.id);
        return json(res, 200, { ok: true });
      } catch (err) {
        return json(res, err.status || 500, { error: err.message });
      }
    }

    /* ----- ADMIN routes ----- */
    if (route.startsWith('admin.')) {
      // Re-auth voor admin-rechten
      try {
        await requireAdmin(req);
      } catch (e) {
        if (e instanceof AuthError) return json(res, e.status, { error: e.message });
        throw e;
      }

      if (route === 'admin.pin') {
        if (!isUuid(params.id)) return json(res, 400, { error: 'Ongeldige post-id.' });
        const body = parseBody(req) || {};
        try {
          const result = await adminTogglePin(params.id, {
            wantPinned: typeof body.pin === 'boolean' ? body.pin : undefined,
          });
          return json(res, 200, result);
        } catch (err) {
          return json(res, err.status || 500, { error: err.message });
        }
      }

      if (route === 'admin.reports.list') {
        const reports = await adminListReports();
        return json(res, 200, { reports });
      }

      if (route === 'admin.reports.resolve') {
        if (!isUuid(params.id)) return json(res, 400, { error: 'Ongeldige report-id.' });
        const body = parseBody(req) || {};
        try {
          if (body.delete_target === true) {
            await adminResolveAndDelete(params.id, auth.userId);
          } else {
            await adminResolveReport(params.id);
          }
          return json(res, 200, { ok: true });
        } catch (err) {
          return json(res, err.status || 500, { error: err.message });
        }
      }
    }

    return json(res, 404, { error: 'Endpoint niet gevonden.' });
  } catch (err) {
    console.error('[community]', err);
    return json(res, 500, { error: err.message || 'Er ging iets mis.' });
  }
}
