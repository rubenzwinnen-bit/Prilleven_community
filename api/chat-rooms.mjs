// Catch-all router voor /api/chat-rooms/* endpoints.
// Eén serverless function i.p.v. één per pad (zoals /api/community).
//
// Vercel routet hier naartoe via een rewrite in vercel.json:
//   /api/chat-rooms/(.*) → /api/chat-rooms
//
// Routes (intern):
//   GET    /api/chat-rooms                         → lijst actieve rooms (+ follow-status)
//   GET    /api/chat-rooms/unread                  → ongelezen tellingen per gevolgde room/topic
//   GET    /api/chat-rooms/:slug                   → room + topics (+ is_followed)
//   PATCH  /api/chat-rooms/:slug                   → admin: room title/description aanpassen
//   POST   /api/chat-rooms/:slug/follow            → chatruimte volgen
//   DELETE /api/chat-rooms/:slug/follow            → chatruimte ontvolgen
//   POST   /api/chat-rooms/:slug/read              → last_read_at bijwerken (badges resetten)
//   POST   /api/chat-rooms/:slug/topics            → topic aanmaken
//   GET    /api/chat-rooms/topics/:id              → topic + replies (+ is_followed)
//   PATCH  /api/chat-rooms/topics/:id              → eigen topic editten
//   DELETE /api/chat-rooms/topics/:id              → eigen of admin verwijderen
//   POST   /api/chat-rooms/topics/:id/pin          → admin pin toggle
//   POST   /api/chat-rooms/topics/:id/follow       → topic volgen
//   DELETE /api/chat-rooms/topics/:id/follow       → topic ontvolgen
//   POST   /api/chat-rooms/topics/:id/read         → last_read_at bijwerken voor topic
//   POST   /api/chat-rooms/topics/:id/replies      → reply aanmaken
//   PATCH  /api/chat-rooms/replies/:id             → eigen reply editten
//   DELETE /api/chat-rooms/replies/:id             → eigen of admin verwijderen
//   POST   /api/chat-rooms/report                  → topic/reply rapporteren
//   GET    /api/chat-rooms/admin/reports           → admin: open reports
//   POST   /api/chat-rooms/admin/reports/:id/resolve → admin: report sluiten (+ delete)

import { requireAuth, requireAdmin, AuthError } from './_lib/auth.mjs';
import { supabase } from './_lib/clients.mjs';
import { findBlockedWord } from './_lib/moderation.mjs';
import { getAccessStatus } from './_lib/subscription.mjs';
import { signImageUrls, loadAdminUserIds, loadBlockedUserIds } from './_lib/community.mjs';

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

  // /unread
  if (seg.length === 1 && seg[0] === 'unread' && m === 'GET') return { route: 'unread.get' };

  // /:slug   en  /:slug/topics  +  /:slug/follow  +  /:slug/read
  if (seg.length === 1) {
    if (m === 'GET')   return { route: 'room.get',  params: { slug: seg[0] } };
    if (m === 'PATCH') return { route: 'room.edit', params: { slug: seg[0] } };
  }
  if (seg.length === 2) {
    if (seg[1] === 'topics' && m === 'POST') return { route: 'topic.create', params: { slug: seg[0] } };
    if (seg[1] === 'follow') {
      if (m === 'POST')   return { route: 'room.follow',   params: { slug: seg[0] } };
      if (m === 'DELETE') return { route: 'room.unfollow', params: { slug: seg[0] } };
    }
    if (seg[1] === 'read' && m === 'POST') return { route: 'room.read', params: { slug: seg[0] } };
  }

  // /topics/:id
  if (seg.length === 2 && seg[0] === 'topics') {
    if (m === 'GET')    return { route: 'topic.get',    params: { id: seg[1] } };
    if (m === 'PATCH')  return { route: 'topic.edit',   params: { id: seg[1] } };
    if (m === 'DELETE') return { route: 'topic.delete', params: { id: seg[1] } };
  }

  // /topics/:id/pin  /topics/:id/replies  /topics/:id/follow  /topics/:id/read
  if (seg.length === 3 && seg[0] === 'topics') {
    if (seg[2] === 'pin' && m === 'POST')     return { route: 'topic.pin',      params: { id: seg[1] } };
    if (seg[2] === 'replies' && m === 'POST') return { route: 'reply.create',   params: { id: seg[1] } };
    if (seg[2] === 'follow') {
      if (m === 'POST')   return { route: 'topic.follow',   params: { id: seg[1] } };
      if (m === 'DELETE') return { route: 'topic.unfollow', params: { id: seg[1] } };
    }
    if (seg[2] === 'read' && m === 'POST') return { route: 'topic.read', params: { id: seg[1] } };
  }

  // /replies/:id
  if (seg.length === 2 && seg[0] === 'replies') {
    if (m === 'PATCH')  return { route: 'reply.edit',   params: { id: seg[1] } };
    if (m === 'DELETE') return { route: 'reply.delete', params: { id: seg[1] } };
  }

  // /report
  if (seg.length === 1 && seg[0] === 'report' && m === 'POST') {
    return { route: 'report.create' };
  }

  // /admin/reports               (GET lijst)
  // /admin/reports/:id/resolve   (POST sluiten)
  if (seg[0] === 'admin' && seg[1] === 'reports') {
    if (seg.length === 2 && m === 'GET') return { route: 'admin.reports.list' };
    if (seg.length === 4 && seg[3] === 'resolve' && m === 'POST') {
      return { route: 'admin.reports.resolve', params: { id: seg[2] } };
    }
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
    .select('id, slug, title, description, sort_order, is_active, admin_intro_message, admin_intro_user_id, admin_intro_updated_at')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function buildAdminIntro(room) {
  if (!room || !room.admin_intro_message || !room.admin_intro_user_id) return null;
  const profile = await loadCommunityProfile(room.admin_intro_user_id);
  const withAvatar = await attachAvatarUrl({
    user_id: room.admin_intro_user_id,
    nickname: profile?.nickname || null,
    avatar_path: profile?.avatar_path || null,
  });
  const withFlag = await attachAdminFlag(withAvatar);
  return {
    message: room.admin_intro_message,
    updated_at: room.admin_intro_updated_at,
    user_id: room.admin_intro_user_id,
    nickname: withFlag.nickname,
    avatar_path: withFlag.avatar_path,
    avatar_url: withFlag.avatar_url,
    author_is_admin: withFlag.author_is_admin,
  };
}

function stripAdminIntroFields(room) {
  if (!room) return room;
  const { admin_intro_message, admin_intro_user_id, admin_intro_updated_at, ...rest } = room;
  return rest;
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

/* ---------------- Reports (Guideline 1.2) ---------------- */

/** Maak een report aan voor een chat-topic of -reply. */
async function createChatReport(userId, { target_type, target_id, reason }) {
  if (!['topic', 'reply'].includes(target_type)) {
    throw Object.assign(new Error('Ongeldig target_type.'), { status: 422 });
  }
  if (!isUuid(target_id)) {
    throw Object.assign(new Error('Ongeldige target_id.'), { status: 422 });
  }
  const cleanReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : null;
  const { error } = await supabase
    .from('chat_reports')
    .insert({ target_type, target_id, reporter_id: userId, reason: cleanReason || null });
  if (error) throw new Error('Chat report insert: ' + error.message);
  return { ok: true };
}

/** Lijst open reports met gekoppelde target-content (admin-queue). */
async function adminListChatReports({ limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const { data: reports, error } = await supabase
    .from('chat_reports')
    .select('id, target_type, target_id, reporter_id, reason, created_at')
    .is('resolved_at', null)
    .order('created_at', { ascending: false })
    .limit(safeLimit);
  if (error) throw new Error('Chat reports list: ' + error.message);

  const topicIds = [...new Set(reports.filter(r => r.target_type === 'topic').map(r => r.target_id))];
  const replyIds = [...new Set(reports.filter(r => r.target_type === 'reply').map(r => r.target_id))];
  const [topicsRes, repliesRes] = await Promise.all([
    topicIds.length
      ? supabase.from('chat_topics').select('id, body, title, user_id, created_at').in('id', topicIds)
      : Promise.resolve({ data: [] }),
    replyIds.length
      ? supabase.from('chat_replies').select('id, body, user_id, created_at').in('id', replyIds)
      : Promise.resolve({ data: [] }),
  ]);
  const topicMap = new Map((topicsRes.data || []).map(t => [t.id, t]));
  const replyMap = new Map((repliesRes.data || []).map(r => [r.id, r]));

  return reports.map(r => ({
    id: r.id,
    target_type: r.target_type,
    target_id: r.target_id,
    reason: r.reason,
    created_at: r.created_at,
    target: r.target_type === 'topic'
      ? (topicMap.get(r.target_id) || null)
      : (replyMap.get(r.target_id) || null),
  }));
}

/** Markeer alle reports voor één target als opgelost. */
async function resolveChatReportsForTarget(targetType, targetId) {
  const { error } = await supabase
    .from('chat_reports')
    .update({ resolved_at: new Date().toISOString() })
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .is('resolved_at', null);
  if (error) throw new Error('Resolve chat target: ' + error.message);
}

/** Resolve één report; optioneel het target verwijderen. */
async function resolveChatReport(reportId, { deleteTarget = false } = {}) {
  if (deleteTarget) {
    const { data: rep, error } = await supabase
      .from('chat_reports')
      .select('target_type, target_id')
      .eq('id', reportId)
      .maybeSingle();
    if (error) throw new Error('Chat report fetch: ' + error.message);
    if (!rep) throw Object.assign(new Error('Report bestaat niet.'), { status: 404 });
    const table = rep.target_type === 'topic' ? 'chat_topics' : 'chat_replies';
    const { error: delErr } = await supabase.from(table).delete().eq('id', rep.target_id);
    if (delErr) throw new Error('Chat target delete: ' + delErr.message);
    await resolveChatReportsForTarget(rep.target_type, rep.target_id);
    return { ok: true };
  }
  const { error } = await supabase
    .from('chat_reports')
    .update({ resolved_at: new Date().toISOString() })
    .eq('id', reportId);
  if (error) throw new Error('Resolve chat report: ' + error.message);
  return { ok: true };
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
      const [{ data, error }, { data: followData }] = await Promise.all([
        supabase
          .from('chat_rooms')
          .select('id, slug, title, description, sort_order')
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true }),
        supabase
          .from('chat_room_followers')
          .select('room_id, followed_at, last_read_at')
          .eq('user_id', auth.userId),
      ]);
      if (error) throw error;
      const followMap = new Map((followData || []).map(f => [f.room_id, f]));
      const rooms = (data || []).map(room => {
        const follow = followMap.get(room.id);
        return { ...room, is_followed: !!follow };
      });
      return json(res, 200, { rooms });
    }

    if (route === 'unread.get') {
      const [{ data: roomFollows }, { data: topicFollows }] = await Promise.all([
        supabase
          .from('chat_room_followers')
          .select('room_id, followed_at, last_read_at')
          .eq('user_id', auth.userId),
        supabase
          .from('chat_topic_followers')
          .select('topic_id, followed_at, last_read_at')
          .eq('user_id', auth.userId),
      ]);
      // Unread topics per gevolgde room
      const roomUnread = {};
      await Promise.all((roomFollows || []).map(async follow => {
        const since = follow.last_read_at || follow.followed_at;
        const { count } = await supabase
          .from('chat_topics')
          .select('*', { count: 'exact', head: true })
          .eq('room_id', follow.room_id)
          .gt('created_at', since);
        if (count > 0) roomUnread[follow.room_id] = count;
      }));
      // Unread replies per gevolgd topic
      const topicUnread = {};
      await Promise.all((topicFollows || []).map(async follow => {
        const since = follow.last_read_at || follow.followed_at;
        const { count } = await supabase
          .from('chat_replies')
          .select('*', { count: 'exact', head: true })
          .eq('topic_id', follow.topic_id)
          .gt('created_at', since);
        if (count > 0) topicUnread[follow.topic_id] = count;
      }));
      return json(res, 200, { rooms: roomUnread, topics: topicUnread });
    }

    if (route === 'room.follow') {
      if (!isSlug(params.slug)) return json(res, 400, { error: 'Ongeldige slug.' });
      const room = await loadRoomBySlug(params.slug);
      if (!room || !room.is_active) return json(res, 404, { error: 'Room niet gevonden.' });
      const { error } = await supabase
        .from('chat_room_followers')
        .upsert({ user_id: auth.userId, room_id: room.id }, { onConflict: 'user_id,room_id' });
      if (error) throw error;
      return json(res, 200, { ok: true });
    }

    if (route === 'room.unfollow') {
      if (!isSlug(params.slug)) return json(res, 400, { error: 'Ongeldige slug.' });
      const room = await loadRoomBySlug(params.slug);
      if (!room) return json(res, 404, { error: 'Room niet gevonden.' });
      const { error } = await supabase
        .from('chat_room_followers')
        .delete()
        .eq('user_id', auth.userId)
        .eq('room_id', room.id);
      if (error) throw error;
      return json(res, 200, { ok: true });
    }

    if (route === 'room.read') {
      if (!isSlug(params.slug)) return json(res, 400, { error: 'Ongeldige slug.' });
      const room = await loadRoomBySlug(params.slug);
      if (!room) return json(res, 404, { error: 'Room niet gevonden.' });
      await supabase
        .from('chat_room_followers')
        .update({ last_read_at: new Date().toISOString() })
        .eq('user_id', auth.userId)
        .eq('room_id', room.id);
      return json(res, 200, { ok: true });
    }

    if (route === 'room.get') {
      if (!isSlug(params.slug)) return json(res, 400, { error: 'Ongeldige slug.' });
      const room = await loadRoomBySlug(params.slug);
      if (!room || !room.is_active) return json(res, 404, { error: 'Room niet gevonden.' });
      const [adminIntro, topicsRaw, { data: followRow }, blockedIds] = await Promise.all([
        buildAdminIntro(room),
        loadTopicsForRoom(room.id),
        supabase
          .from('chat_room_followers')
          .select('followed_at')
          .eq('user_id', auth.userId)
          .eq('room_id', room.id)
          .maybeSingle(),
        loadBlockedUserIds(auth.userId),
      ]);
      // Verberg topics van geblokkeerde gebruikers (eenrichtings-block)
      const topicsFiltered = topicsRaw.filter(t => !blockedIds.has(t.user_id));
      const signed = await attachAvatarUrls(topicsFiltered);
      const withFlags = await attachAdminFlags(signed);
      return json(res, 200, {
        room: { ...stripAdminIntroFields(room), admin_intro: adminIntro, is_followed: !!followRow },
        topics: withFlags,
      });
    }

    /* ----- room edit (admin: title/description) ----- */
    if (route === 'room.edit') {
      try { await requireAdmin(req); }
      catch (e) {
        if (e instanceof AuthError) return json(res, e.status, { error: e.message });
        throw e;
      }
      if (!isSlug(params.slug)) return json(res, 400, { error: 'Ongeldige slug.' });
      const body = parseBody(req);
      if (body === null) return json(res, 400, { error: 'Ongeldige JSON.' });

      const room = await loadRoomBySlug(params.slug);
      if (!room) return json(res, 404, { error: 'Room niet gevonden.' });

      const updates = {};
      if (typeof body.title === 'string') {
        const t = body.title.trim();
        if (t.length < 1 || t.length > 80) {
          return json(res, 422, { error: 'Titel moet 1-80 tekens zijn.' });
        }
        if (findBlockedWord(t)) return json(res, 422, { error: 'Titel bevat ongepaste taal.' });
        updates.title = t;
      }
      if (typeof body.description === 'string') {
        const d = body.description.trim();
        if (d.length > 500) return json(res, 422, { error: 'Beschrijving max 500 tekens.' });
        if (d && findBlockedWord(d)) return json(res, 422, { error: 'Beschrijving bevat ongepaste taal.' });
        updates.description = d || null;
      }

      // admin_intro_message: string = zetten/updaten, null/lege string = verwijderen
      if ('admin_intro_message' in body) {
        const raw = body.admin_intro_message;
        if (raw === null || (typeof raw === 'string' && raw.trim() === '')) {
          updates.admin_intro_message    = null;
          updates.admin_intro_user_id    = null;
          updates.admin_intro_updated_at = null;
        } else if (typeof raw === 'string') {
          const msg = raw.trim();
          if (msg.length < 1 || msg.length > 4000) {
            return json(res, 422, { error: 'Welkomsbericht moet 1-4000 tekens zijn.' });
          }
          if (findBlockedWord(msg)) {
            return json(res, 422, { error: 'Welkomsbericht bevat ongepaste taal.' });
          }
          updates.admin_intro_message    = msg;
          updates.admin_intro_user_id    = auth.userId;
          updates.admin_intro_updated_at = new Date().toISOString();
        } else {
          return json(res, 422, { error: 'Ongeldig welkomsbericht.' });
        }
      }

      if (Object.keys(updates).length === 0) return json(res, 422, { error: 'Geen wijzigingen.' });

      const { data, error } = await supabase
        .from('chat_rooms')
        .update(updates)
        .eq('id', room.id)
        .select('id, slug, title, description, sort_order, is_active, admin_intro_message, admin_intro_user_id, admin_intro_updated_at')
        .single();
      if (error) throw error;
      const adminIntro = await buildAdminIntro(data);
      return json(res, 200, { room: { ...stripAdminIntroFields(data), admin_intro: adminIntro } });
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
      const [topicSigned, repliesRaw, { data: topicFollow }, blockedIds] = await Promise.all([
        attachAdminFlag(await attachAvatarUrl(topic)),
        loadRepliesForTopic(topic.id),
        supabase
          .from('chat_topic_followers')
          .select('followed_at')
          .eq('user_id', auth.userId)
          .eq('topic_id', params.id)
          .maybeSingle(),
        loadBlockedUserIds(auth.userId),
      ]);
      // Verberg reacties van geblokkeerde gebruikers (eenrichtings-block)
      const repliesFiltered = repliesRaw.filter(r => !blockedIds.has(r.user_id));
      const replies = await attachAdminFlags(repliesFiltered);
      return json(res, 200, { topic: { ...topicSigned, is_followed: !!topicFollow }, replies });
    }

    /* ----- topic follow / unfollow / read ----- */
    if (route === 'topic.follow') {
      if (!isUuid(params.id)) return json(res, 400, { error: 'Ongeldige topic-id.' });
      const topic = await loadTopicById(params.id);
      if (!topic) return json(res, 404, { error: 'Topic niet gevonden.' });
      const { error } = await supabase
        .from('chat_topic_followers')
        .upsert({ user_id: auth.userId, topic_id: params.id }, { onConflict: 'user_id,topic_id' });
      if (error) throw error;
      return json(res, 200, { ok: true });
    }

    if (route === 'topic.unfollow') {
      if (!isUuid(params.id)) return json(res, 400, { error: 'Ongeldige topic-id.' });
      const { error } = await supabase
        .from('chat_topic_followers')
        .delete()
        .eq('user_id', auth.userId)
        .eq('topic_id', params.id);
      if (error) throw error;
      return json(res, 200, { ok: true });
    }

    if (route === 'topic.read') {
      if (!isUuid(params.id)) return json(res, 400, { error: 'Ongeldige topic-id.' });
      await supabase
        .from('chat_topic_followers')
        .update({ last_read_at: new Date().toISOString() })
        .eq('user_id', auth.userId)
        .eq('topic_id', params.id);
      return json(res, 200, { ok: true });
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

    /* ----- report ----- */
    if (route === 'report.create') {
      const body = parseBody(req);
      if (body === null) return json(res, 400, { error: 'Ongeldige JSON.' });
      try {
        await createChatReport(auth.userId, {
          target_type: body.target_type,
          target_id:   body.target_id,
          reason:      body.reason,
        });
        return json(res, 201, { ok: true });
      } catch (err) {
        return json(res, err.status || 500, { error: err.message });
      }
    }

    /* ----- ADMIN reports ----- */
    if (route === 'admin.reports.list' || route === 'admin.reports.resolve') {
      try { await requireAdmin(req); }
      catch (e) {
        if (e instanceof AuthError) return json(res, e.status, { error: e.message });
        throw e;
      }
      if (route === 'admin.reports.list') {
        const reports = await adminListChatReports();
        return json(res, 200, { reports });
      }
      if (route === 'admin.reports.resolve') {
        if (!isUuid(params.id)) return json(res, 400, { error: 'Ongeldige report-id.' });
        const body = parseBody(req) || {};
        try {
          await resolveChatReport(params.id, { deleteTarget: body.delete_target === true });
          return json(res, 200, { ok: true });
        } catch (err) {
          return json(res, err.status || 500, { error: err.message });
        }
      }
    }

    return json(res, 404, { error: 'Endpoint niet gevonden.' });
  } catch (err) {
    console.error('[chat-rooms]', err);
    return json(res, 500, { error: err.message || 'Er ging iets mis.' });
  }
}
