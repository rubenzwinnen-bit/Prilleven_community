// =====================================================================
// BADGES — server-side tellers voor de app-icoon-push
//
// Één bron van waarheid voor "hoeveel nieuwe items heeft gebruiker X?".
// Wordt gebruikt door:
//   - api/community.mjs        → GET /api/community/app-badges (tijdlijn-teller)
//   - api/_lib/push.mjs        → computeTotalBadge() voor het absolute
//                                app-icoon-getal dat met elke push meegaat.
//
// De telregel spiegelt exact de app (src/services/notifications.ts):
//   - tijdlijn:    nieuwe community-posts + replies (admin-only voor gewone
//                  gebruikers, alles voor admins) + nieuwe gevolgde
//                  chatruimte-topics.
//   - chatruimtes: per topic het nieuwe topic zelf + nieuwe replies, over
//                  ALLE rooms; admin-only voor gewone gebruikers.
//
// Vervaltermijn: items ouder dan 6 weken tellen nooit nog als nieuw.
// Geblokkeerde auteurs tellen niet mee.
// =====================================================================

import { supabase } from './clients.mjs';
import { loadAdminUserIds, loadBlockedUserIds } from './community.mjs';

// Ondergrens: items ouder dan 6 weken tellen nooit nog als "nieuw".
export const BADGE_MAX_AGE_MS = 6 * 7 * 24 * 60 * 60 * 1000;

/** Geeft het LAATSTE van `since` en "nu − 6 weken" terug (ISO). */
function withExpiry(since) {
  const cutoff = new Date(Date.now() - BADGE_MAX_AGE_MS).toISOString();
  if (!since) return cutoff;
  return new Date(since).getTime() > new Date(cutoff).getTime()
    ? new Date(since).toISOString()
    : cutoff;
}

/** Effectief referentiepunt voor één topic: het laatste van de globale
 *  baseline `since` en het per-topic markeerpunt (indien recenter). */
function effectiveSince(topicId, since, topicReads) {
  const read = topicReads?.[topicId];
  if (!read) return since;
  if (!since) return read;
  return new Date(read).getTime() > new Date(since).getTime() ? read : since;
}

/**
 * Laad topics van gevolgde chatruimtes + direct gevolgde topics voor de
 * tijdlijn. Returned items krijgen source_type: 'chatroom'.
 * (Verplaatst uit api/community.mjs zodat de tijdlijn-teller hier woont.)
 */
export async function loadFollowedChatroomTopics(userId, { before = null, limit = 20 } = {}) {
  const [{ data: roomFollows }, { data: topicFollows }] = await Promise.all([
    supabase.from('chat_room_followers').select('room_id, followed_at').eq('user_id', userId),
    supabase.from('chat_topic_followers').select('topic_id, followed_at').eq('user_id', userId),
  ]);

  const followedRoomIds  = (roomFollows  || []).map(f => f.room_id);
  const followedTopicIds = (topicFollows || []).map(f => f.topic_id);
  if (followedRoomIds.length === 0 && followedTopicIds.length === 0) return [];

  let roomTopics = [];
  if (followedRoomIds.length > 0) {
    let q = supabase
      .from('chat_topics_view')
      .select('id, room_id, user_id, title, body, is_pinned, replies_count, last_reply_at, created_at, edited_at, nickname, avatar_path')
      .in('room_id', followedRoomIds)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (before) q = q.lt('created_at', before);
    const { data } = await q;
    roomTopics = data || [];
  }

  let directTopics = [];
  if (followedTopicIds.length > 0) {
    const { data } = await supabase
      .from('chat_topics_view')
      .select('id, room_id, user_id, title, body, is_pinned, replies_count, last_reply_at, created_at, edited_at, nickname, avatar_path')
      .in('id', followedTopicIds)
      .order('created_at', { ascending: false });
    directTopics = data || [];
  }

  const seen = new Set();
  const allTopics = [];
  for (const t of [...roomTopics, ...directTopics]) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    allTopics.push(t);
  }

  const roomIds = [...new Set(allTopics.map(t => t.room_id).filter(Boolean))];
  let roomMap = new Map();
  if (roomIds.length > 0) {
    const { data: rooms } = await supabase
      .from('chat_rooms').select('id, slug, title').in('id', roomIds);
    roomMap = new Map((rooms || []).map(r => [r.id, r]));
  }

  return allTopics.map(t => {
    const room = roomMap.get(t.room_id) || {};
    return {
      ...t,
      source_type: 'chatroom',
      source_room_title: room.title || null,
      source_room_slug:  room.slug  || null,
      is_pinned: t.is_pinned || false,
      liked_by_me: false,
      image_path: null,
      image_url: null,
      has_poll: false,
      poll: null,
    };
  });
}

/**
 * Tijdlijn-badge: nieuwe posts + replies + gevolgde chatroom-topics sinds
 * `since`. Admin ziet alles, gewone gebruiker enkel admin-content.
 * (Verplaatst uit api/community.mjs.)
 */
export async function countTimelineBadge(userId, since) {
  if (!since) return 0;
  const sinceDate = new Date(since);
  if (Number.isNaN(sinceDate.getTime())) return 0;
  const refIso = withExpiry(since);

  const [selfAdminSet, blockedIds] = await Promise.all([
    loadAdminUserIds([userId]),
    loadBlockedUserIds(userId),
  ]);
  const isAdmin = selfAdminSet.has(userId);

  let adminIds = [];
  if (!isAdmin) {
    const { data: adminRows } = await supabase
      .from('community_admin_user_ids').select('user_id');
    adminIds = (adminRows || []).map(r => r.user_id).filter(Boolean);
  }

  const blocked = [...blockedIds];
  const applyBlocked = (q) =>
    blocked.length ? q.not('user_id', 'in', `(${blocked.join(',')})`) : q;

  const countTable = async (table) => {
    if (!isAdmin && adminIds.length === 0) return 0;
    let q = supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .gt('created_at', refIso);
    if (!isAdmin) q = q.in('user_id', adminIds);
    q = applyBlocked(q);
    const { count, error } = await q;
    if (error) {
      console.warn(`[badges] ${table} count: ${error.message}`);
      return 0;
    }
    return count || 0;
  };

  const countFollowedTopics = async () => {
    const topics = await loadFollowedChatroomTopics(userId, { limit: 100 });
    const ref = new Date(refIso);
    return topics.filter(t =>
      !blockedIds.has(t.user_id) && new Date(t.created_at) > ref
    ).length;
  };

  const [posts, replies, followed] = await Promise.all([
    countTable('community_posts'),
    countTable('community_replies'),
    countFollowedTopics(),
  ]);
  return posts + replies + followed;
}

/**
 * Chatruimtes-badge: over ALLE rooms de nieuwe (admin-)topics + replies
 * tellen sinds de chatruimtes-baseline `since`, met per-topic markeerpunten
 * (`topicReads`: { topic_id: ISO }). Admin telt alles, gewone gebruiker
 * enkel admin-geschreven activiteit. Geblokkeerde auteurs tellen niet mee.
 */
export async function countChatroomBadge(userId, since, topicReads = {}) {
  const baseSince = withExpiry(since);

  const [selfAdminSet, blockedIds] = await Promise.all([
    loadAdminUserIds([userId]),
    loadBlockedUserIds(userId),
  ]);
  const isAdmin = selfAdminSet.has(userId);

  // Alle topics ophalen (chatruimtes zijn laag-volume).
  const { data: topics, error: tErr } = await supabase
    .from('chat_topics_view')
    .select('id, user_id, created_at, last_reply_at')
    .gt('last_reply_at', baseSince);
  if (tErr) {
    console.warn(`[badges] chat_topics count: ${tErr.message}`);
  }

  // We hebben ook topics nodig waarvan enkel het topic zelf nieuw is (geen
  // replies) — die kunnen een last_reply_at === null hebben. Haal die apart.
  const { data: freshTopics } = await supabase
    .from('chat_topics_view')
    .select('id, user_id, created_at, last_reply_at')
    .gt('created_at', baseSince);

  const topicMap = new Map();
  for (const t of [...(topics || []), ...(freshTopics || [])]) {
    topicMap.set(t.id, t);
  }
  const allTopics = [...topicMap.values()];

  // Voor gewone gebruikers: de globale admin-set om auteurs te filteren.
  let adminSet = selfAdminSet;
  if (!isAdmin) {
    const authorIds = [...new Set(allTopics.map(t => t.user_id).filter(Boolean))];
    adminSet = authorIds.length ? await loadAdminUserIds(authorIds) : new Set();
  }
  const authorOk = (uid) =>
    !blockedIds.has(uid) && (isAdmin || adminSet.has(uid));

  let total = 0;
  const scanReplyTopicIds = [];

  for (const t of allTopics) {
    const effSince = effectiveSince(t.id, baseSince, topicReads);
    const ref = new Date(effSince).getTime();
    if (authorOk(t.user_id) && new Date(t.created_at).getTime() > ref) {
      total += 1;
    }
    if (t.last_reply_at && new Date(t.last_reply_at).getTime() > ref) {
      scanReplyTopicIds.push({ id: t.id, effSince });
    }
  }

  if (scanReplyTopicIds.length > 0) {
    const ids = scanReplyTopicIds.map(s => s.id);
    const { data: replies } = await supabase
      .from('chat_replies')
      .select('id, topic_id, user_id, created_at')
      .in('topic_id', ids)
      .gt('created_at', baseSince);

    // Auteur-set voor replies (gewone gebruiker filtert op admin).
    let replyAdminSet = adminSet;
    if (!isAdmin) {
      const rAuthors = [...new Set((replies || []).map(r => r.user_id).filter(Boolean))];
      replyAdminSet = rAuthors.length ? await loadAdminUserIds(rAuthors) : new Set();
    }
    const effByTopic = new Map(scanReplyTopicIds.map(s => [s.id, s.effSince]));

    for (const r of replies || []) {
      const eff = effByTopic.get(r.topic_id);
      if (!eff) continue;
      const ref = new Date(eff).getTime();
      const ok = !blockedIds.has(r.user_id) && (isAdmin || replyAdminSet.has(r.user_id));
      if (ok && new Date(r.created_at).getTime() > ref) total += 1;
    }
  }

  return total;
}

/**
 * Het absolute app-icoon-getal voor één gebruiker = tijdlijn + chatruimtes,
 * op basis van de server-side gespiegelde "laatst gezien"-state.
 * Ontbreekt de state → 0 (eerste run telt niets).
 */
export async function computeTotalBadge(userId) {
  const { data: state } = await supabase
    .from('user_badge_state')
    .select('timeline_seen_at, chatrooms_seen_at, topic_reads')
    .eq('user_id', userId)
    .maybeSingle();

  const timelineSeen  = state?.timeline_seen_at  || null;
  const chatroomsSeen = state?.chatrooms_seen_at || null;
  const topicReads    = state?.topic_reads || {};

  const [tl, cr] = await Promise.all([
    countTimelineBadge(userId, timelineSeen),
    countChatroomBadge(userId, chatroomsSeen, topicReads),
  ]);
  return tl + cr;
}
