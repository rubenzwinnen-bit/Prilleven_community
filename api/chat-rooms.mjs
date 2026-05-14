// Catch-all router voor /api/chat-rooms/* endpoints.
// Eén serverless function i.p.v. één per pad (zoals /api/community).
//
// Vercel routet hier naartoe via een rewrite in vercel.json:
//   /api/chat-rooms/(.*) → /api/chat-rooms
//
// Routes (intern):
//   GET    /api/chat-rooms                         → lijst actieve rooms
//   GET    /api/chat-rooms/:slug                   → room + topics
//   POST   /api/chat-rooms/:slug/topics            → topic aanmaken
//   GET    /api/chat-rooms/topics/:id              → topic + replies
//   PATCH  /api/chat-rooms/topics/:id              → eigen topic editten (15min)
//   DELETE /api/chat-rooms/topics/:id              → eigen of admin verwijderen
//   POST   /api/chat-rooms/topics/:id/pin          → admin pin toggle
//   POST   /api/chat-rooms/topics/:id/replies      → reply aanmaken
//   PATCH  /api/chat-rooms/replies/:id             → eigen reply editten (15min)
//   DELETE /api/chat-rooms/replies/:id             → eigen of admin verwijderen

import { requireAuth, requireAdmin, AuthError } from './_lib/auth.mjs';
import { supabase } from './_lib/clients.mjs';
import { findBlockedWord } from './_lib/moderation.mjs';
import { getAccessStatus } from './_lib/subscription.mjs';
import { signImageUrls, loadAdminUserIds } from './_lib/community.mjs';

async function attachAvatarUrls(rows) {
  if (!rows || rows.length === 0) return [];
  const paths = rows.map(r => r.avatar_path).filter(Boolean);
  const map = paths.length ? await signImageUrls(paths) : new Map();
  return rows.map(r => ({
    ...r,
    avatar_url: r.avatar_path ? (map.get(r.avatar_path) || null) : null,
  }));
}

async function attachAvatarUrl(row) {
  if (!row) return row;
  if (!row.avatar_path) return { ...row, avatar_url: null };
  const map = await signImageUrls([row.avatar_path]);
  return { ...row, avatar_url: map.get(row.avatar_path) || null };
}

async function attachAdminFlags(rows) {
  if (!rows || rows.length === 0) return [];
  const userIds = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
  const adminSet = userIds.length ? await loadAdminUserIds(userIds) : new Set();
  return rows.map(r => ({ ...r, author_is_admin: adminSet.has(r.user_id) }));
}

async function attachAdminFlag(row) {
  if (!row || !row.user_id) return row;
  const adminSet = await loadAdminUserIds([row.user_id]);
  return { ...row, author_is_admin: adminSet.has(row.user_id) };
}

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s));
}

function isSlug(s) {
  return /^[a-z0-9-]{2,40}$/.test(String(s));
}

function parseBody(req) {
  try {
    return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return null;
  }
}

function getSegments(req) {
  const raw = req.query?.path;
  if (Array.isArray(raw) && raw.length > 0) return raw;
  if (typeof raw === 'string' && raw.length > 0) return raw.split('/').filter(Boolean);
  if (req.url) {
    const pathname = new URL(req.url, 'http://x').pathname;
    const stripped = pathname.replace(/^\/api\/chat-rooms\/?/, '');
    return stripped.split('/').filter(Boolean);
  }
  return [];
}

function matchRoute(req) {
  const seg = getSegments(req);
  const m = req.method;

  // / (lijst rooms)
  if (seg.length === 0 && m === 'GET') return { route: 'rooms.list' };

  // /:slug   en  /:slug/topics
  if (seg.length === 1) {
    if (m === 'GET') return { route: 'room.get', params: { slug: seg[0] } };
  }
  if (seg.length === 2 && seg[1] === 'topics') {
    if (m === 'POST') return { route: 'topic.create', params: { slug: seg[0] } };
  }

  // /topics/:id
  if (seg.length === 2 && seg[0] === 'topics') {
    if (m === 'GET')    return { route: 'topic.get',    params: { id: seg[1] } };
    if (m === 'PATCH')  return { route: 'topic.edit',   params: { id: seg[1] } };
    if (m === 'DELETE') return { route: 'topic.delete', params: { id: seg[1] } };
  }

  // /topics/:id/pin   en   /topics/:id/replies
  if (seg.length === 3 && seg[0] === 'topics') {
    if (seg[2] === 'pin' && m === 'POST') return { route: 'topic.pin', params: { id: seg[1] } };
    if (seg[2] === 'replies') {
      if (m === 'POST') return { route: 'reply.create', params: { id: seg[1] } };
    }
  }

  // /replies/:id
  if (seg.length === 2 && seg[0] === 'replies') {
    if (m === 'PATCH')  return { route: 'reply.edit',   params: { id: seg[1] } };
    if (m === 'DELETE') return { route: 'reply.delete', params: { id: seg[1] } };
  }

  return null;
}

/* ---------------- Helpers ---------------- */

async function isAdminUser(email) {
  if (!email) return false;
  try {
    const status = await getAccessStatus(email);
    return !!status?.isAdmin;
  } catch {
    return false;
  }
}

async function loadCommunityProfile(userId) {
  const { data, error } = await supabase
    .from('community_profiles')
    .select('user_id, nickname, avatar_path')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function sanitizeTopicInput(body) {
  const title = String(body?.title || '').trim();
  const text  = String(body?.body || '').trim();
  if (title.length < 1 || title.length > 120) {
    const e = new Error('Titel moet 1-120 tekens zijn.'); e.status = 422; throw e;
  }
  if (text.length < 1 || text.length > 4000) {
    const e = new Error('Bericht moet 1-4000 tekens zijn.'); e.status = 422; throw e;
  }
  return { title, body: text };
}

function sanitizeReplyInput(body) {
  const text = String(body?.body || '').trim();
  if (text.length < 1 || text.length > 2000) {
    const e = new Error('Reactie moet 1-2000 tekens zijn.'); e.status = 422; throw e;
  }
  return { body: text };
}

async function loadRoomBySlug(slug) {
  const { data, error } = await supabase
    .from('chat_rooms')
    .select('id, slug, title, description, sort_order, is_active')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadTopicsForRoom(roomId) {
  const { data, error } = await supabase
    .from('chat_topics_view')
    .select('*')
    .eq('room_id', roomId)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data || [];
}

async function loadTopicById(id) {
  const { data, error } = await supabase
    .from('chat_topics_view')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadRepliesForTopic(topicId) {
  const { data, error } = await supabase
    .from('chat_replies')
    .select('id, topic_id, user_id, body, edited_at, created_at')
    .eq('topic_id', topicId)
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) throw error;
  if (!data || data.length === 0) return [];
  const userIds = [...new Set(data.map(r => r.user_id))];
  const { data: profs } = await supabase
    .from('community_profiles')
    .select('user_id, nickname, avatar_path')
    .in('user_id', userIds);
  const profMap = new Map((profs || []).map(p => [p.user_id, p]));
  const enriched = data.map(r => {
    const p = profMap.get(r.user_id);
    return {
      ...r,
      nickname: p?.nickname || null,
      avatar_path: p?.avatar_path || null,
    };
  });
  return attachAvatarUrls(enriched);
}

/* ---------------- Handler ---------------- */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  let auth;
  try { auth = await requireAuth(req); }
  catch (e) {
    if (e instanceof AuthError) return json(res, e.status, { error: e.message });
    throw e;
  }

  const matched = matchRoute(req);
  if (!matched) return json(res, 404, { error: 'Endpoint niet gevonden.' });

  try {
    const { route, params } = matched;

    /* ----- rooms ----- */
    if (route === 'rooms.list') {
      const { data, error } = await supabase
        .from('chat_rooms')
        .select('id, slug, title, description, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return json(res, 200, { rooms: data || [] });
    }

    if (route === 'room.get') {
      if (!isSlug(params.slug)) return json(res, 400, { error: 'Ongeldige slug.' });
      const room = await loadRoomBySlug(params.slug);
      if (!room || !room.is_active) return json(res, 404, { error: 'Room niet gevonden.' });
      const topics = await loadTopicsForRoom(room.id);
      const signed = await attachAvatarUrls(topics);
      const withFlags = await attachAdminFlags(signed);
      return json(res, 200, { room, topics: withFlags });
    }

    /* ----- topic create ----- */
    if (route === 'topic.create') {
      if (!isSlug(params.slug)) return json(res, 400, { error: 'Ongeldige slug.' });
      const body = parseBody(req);
      if (body === null) return json(res, 400, { error: 'Ongeldige JSON.' });
      const profile = await loadCommunityProfile(auth.userId);
      if (!profile) return json(res, 412, { error: 'Stel eerst een nickname in.' });

      const room = await loadRoomBySlug(params.slug);
      if (!room || !room.is_active) return json(res, 404, { error: 'Room niet gevonden.' });

      let clean;
      try { clean = sanitizeTopicInput(body); }
      catch (err) { return json(res, err.status || 422, { error: err.message }); }

      if (findBlockedWord(clean.title) || findBlockedWord(clean.body)) {
        return json(res, 422, { error: 'Bericht bevat ongepaste taal.' });
      }

      const { data, error } = await supabase
        .from('chat_topics')
        .insert({
          room_id: room.id,
          user_id: auth.userId,
          title: clean.title,
          body: clean.body,
        })
        .select('id, room_id, user_id, title, body, is_pinned, edited_at, created_at')
        .single();
      if (error) throw error;
      const topicOut = await attachAdminFlag(await attachAvatarUrl({
        ...data,
        nickname: profile.nickname,
        avatar_path: profile.avatar_path || null,
        replies_count: 0,
        last_reply_at: null,
      }));
      return json(res, 201, { topic: topicOut });
    }

    /* ----- topic get ----- */
    if (route === 'topic.get') {
      if (!isUuid(params.id)) return json(res, 400, { error: 'Ongeldige topic-id.' });
      const topic = await loadTopicById(params.id);
      if (!topic) return json(res, 404, { error: 'Topic niet gevonden.' });
      const topicSigned = await attachAdminFlag(await attachAvatarUrl(topic));
      const repliesRaw = await loadRepliesForTopic(topic.id);
      const replies = await attachAdminFlags(repliesRaw);
      return json(res, 200, { topic: topicSigned, replies });
    }

    /* ----- topic edit ----- */
    if (route === 'topic.edit') {
      if (!isUuid(params.id)) return json(res, 400, { error: 'Ongeldige topic-id.' });
      const body = parseBody(req);
      if (body === null) return json(res, 400, { error: 'Ongeldige JSON.' });

      const { data: existing, error: getErr } = await supabase
        .from('chat_topics')
        .select('id, user_id, created_at')
        .eq('id', params.id)
        .maybeSingle();
      if (getErr) throw getErr;
      if (!existing) return json(res, 404, { error: 'Topic niet gevonden.' });
      if (existing.user_id !== auth.userId) return json(res, 403, { error: 'Niet jouw topic.' });

      const updates = {};
      if (typeof body.title === 'string') {
        const t = body.title.trim();
        if (t.length < 1 || t.length > 120) return json(res, 422, { error: 'Titel moet 1-120 tekens zijn.' });
        if (findBlockedWord(t)) return json(res, 422, { error: 'Titel bevat ongepaste taal.' });
        updates.title = t;
      }
      if (typeof body.body === 'string') {
        const b = body.body.trim();
        if (b.length < 1 || b.length > 4000) return json(res, 422, { error: 'Bericht moet 1-4000 tekens zijn.' });
        if (findBlockedWord(b)) return json(res, 422, { error: 'Bericht bevat ongepaste taal.' });
        updates.body = b;
      }
      if (Object.keys(updates).length === 0) return json(res, 422, { error: 'Geen wijzigingen.' });
      updates.edited_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('chat_topics')
        .update(updates)
        .eq('id', params.id)
        .select('id, room_id, user_id, title, body, is_pinned, edited_at, created_at')
        .single();
      if (error) throw error;
      const enriched = await loadTopicById(data.id);
      const signed = enriched ? await attachAdminFlag(await attachAvatarUrl(enriched)) : await attachAdminFlag(data);
      return json(res, 200, { topic: signed });
    }

    /* ----- topic delete (eigen OF admin) ----- */
    if (route === 'topic.delete') {
      if (!isUuid(params.id)) return json(res, 400, { error: 'Ongeldige topic-id.' });
      const { data: existing, error: getErr } = await supabase
        .from('chat_topics')
        .select('id, user_id')
        .eq('id', params.id)
        .maybeSingle();
      if (getErr) throw getErr;
      if (!existing) return json(res, 404, { error: 'Topic niet gevonden.' });

      const admin = await isAdminUser(auth.email);
      if (existing.user_id !== auth.userId && !admin) {
        return json(res, 403, { error: 'Geen rechten.' });
      }
      const { error } = await supabase.from('chat_topics').delete().eq('id', params.id);
      if (error) throw error;
      return json(res, 200, { ok: true });
    }

    /* ----- topic pin (admin) ----- */
    if (route === 'topic.pin') {
      try { await requireAdmin(req); }
      catch (e) {
        if (e instanceof AuthError) return json(res, e.status, { error: e.message });
        throw e;
      }
      if (!isUuid(params.id)) return json(res, 400, { error: 'Ongeldige topic-id.' });
      const body = parseBody(req) || {};
      const { data: existing, error: getErr } = await supabase
        .from('chat_topics')
        .select('id, is_pinned')
        .eq('id', params.id)
        .maybeSingle();
      if (getErr) throw getErr;
      if (!existing) return json(res, 404, { error: 'Topic niet gevonden.' });

      const next = typeof body.pin === 'boolean' ? body.pin : !existing.is_pinned;
      const { error } = await supabase
        .from('chat_topics')
        .update({ is_pinned: next })
        .eq('id', params.id);
      if (error) throw error;
      return json(res, 200, { id: params.id, is_pinned: next });
    }

    /* ----- reply create ----- */
    if (route === 'reply.create') {
      if (!isUuid(params.id)) return json(res, 400, { error: 'Ongeldige topic-id.' });
      const body = parseBody(req);
      if (body === null) return json(res, 400, { error: 'Ongeldige JSON.' });
      const profile = await loadCommunityProfile(auth.userId);
      if (!profile) return json(res, 412, { error: 'Stel eerst een nickname in.' });

      const { data: topic, error: tErr } = await supabase
        .from('chat_topics').select('id').eq('id', params.id).maybeSingle();
      if (tErr) throw tErr;
      if (!topic) return json(res, 404, { error: 'Topic niet gevonden.' });

      let clean;
      try { clean = sanitizeReplyInput(body); }
      catch (err) { return json(res, err.status || 422, { error: err.message }); }
      if (findBlockedWord(clean.body)) {
        return json(res, 422, { error: 'Reactie bevat ongepaste taal.' });
      }

      const { data, error } = await supabase
        .from('chat_replies')
        .insert({ topic_id: params.id, user_id: auth.userId, body: clean.body })
        .select('id, topic_id, user_id, body, edited_at, created_at')
        .single();
      if (error) throw error;
      const replyOut = await attachAdminFlag(await attachAvatarUrl({
        ...data,
        nickname: profile.nickname,
        avatar_path: profile.avatar_path || null,
      }));
      return json(res, 201, { reply: replyOut });
    }

    /* ----- reply edit ----- */
    if (route === 'reply.edit') {
      if (!isUuid(params.id)) return json(res, 400, { error: 'Ongeldige reply-id.' });
      const body = parseBody(req);
      if (body === null) return json(res, 400, { error: 'Ongeldige JSON.' });

      const { data: existing, error: getErr } = await supabase
        .from('chat_replies')
        .select('id, user_id, created_at')
        .eq('id', params.id)
        .maybeSingle();
      if (getErr) throw getErr;
      if (!existing) return json(res, 404, { error: 'Reactie niet gevonden.' });
      if (existing.user_id !== auth.userId) return json(res, 403, { error: 'Niet jouw reactie.' });

      const text = String(body.body || '').trim();
      if (text.length < 1 || text.length > 2000) {
        return json(res, 422, { error: 'Reactie moet 1-2000 tekens zijn.' });
      }
      if (findBlockedWord(text)) return json(res, 422, { error: 'Reactie bevat ongepaste taal.' });

      const { data, error } = await supabase
        .from('chat_replies')
        .update({ body: text, edited_at: new Date().toISOString() })
        .eq('id', params.id)
        .select('id, topic_id, user_id, body, edited_at, created_at')
        .single();
      if (error) throw error;
      const profile = await loadCommunityProfile(auth.userId);
      const replyOut = await attachAdminFlag(await attachAvatarUrl({
        ...data,
        nickname: profile?.nickname || null,
        avatar_path: profile?.avatar_path || null,
      }));
      return json(res, 200, { reply: replyOut });
    }

    /* ----- reply delete (eigen OF admin) ----- */
    if (route === 'reply.delete') {
      if (!isUuid(params.id)) return json(res, 400, { error: 'Ongeldige reply-id.' });
      const { data: existing, error: getErr } = await supabase
        .from('chat_replies')
        .select('id, user_id')
        .eq('id', params.id)
        .maybeSingle();
      if (getErr) throw getErr;
      if (!existing) return json(res, 404, { error: 'Reactie niet gevonden.' });

      const admin = await isAdminUser(auth.email);
      if (existing.user_id !== auth.userId && !admin) {
        return json(res, 403, { error: 'Geen rechten.' });
      }
      const { error } = await supabase.from('chat_replies').delete().eq('id', params.id);
      if (error) throw error;
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: 'Endpoint niet gevonden.' });
  } catch (err) {
    console.error('[chat-rooms]', err);
    return json(res, 500, { error: err.message || 'Er ging iets mis.' });
  }
}
