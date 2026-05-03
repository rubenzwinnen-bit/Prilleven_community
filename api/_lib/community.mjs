// Helpers rond de community feed (nickname, posts, etc.).

import { supabase } from './clients.mjs';

const NICKNAME_RE = /^[A-Za-z0-9_\- ]{2,30}$/;

/** Eigen community-profiel ophalen of null. */
export async function loadCommunityProfile(userId) {
  const { data, error } = await supabase
    .from('community_profiles')
    .select('user_id, nickname, created_at, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error('Community profile load: ' + error.message);
  return data;
}

/**
 * Valideer een voorgestelde nickname.
 * Returnt { ok: true, value } of { ok: false, error }.
 */
export function validateNickname(input) {
  if (typeof input !== 'string') {
    return { ok: false, error: 'Nickname is verplicht.' };
  }
  // Trim + meerdere spaties → één spatie
  const cleaned = input.trim().replace(/\s+/g, ' ');
  if (!cleaned) {
    return { ok: false, error: 'Nickname is verplicht.' };
  }
  if (cleaned.length < 2) {
    return { ok: false, error: 'Nickname moet minstens 2 tekens bevatten.' };
  }
  if (cleaned.length > 30) {
    return { ok: false, error: 'Nickname mag maximaal 30 tekens lang zijn.' };
  }
  if (!NICKNAME_RE.test(cleaned)) {
    return {
      ok: false,
      error: 'Nickname mag alleen letters, cijfers, spaties, _ en - bevatten.',
    };
  }
  return { ok: true, value: cleaned };
}

/** Check of een nickname gereserveerd is (case-insensitive). */
export async function isNicknameReserved(nickname) {
  const { data, error } = await supabase
    .from('community_reserved_nicknames')
    .select('nickname')
    .ilike('nickname', nickname)
    .maybeSingle();
  if (error) throw new Error('Reserved check: ' + error.message);
  return !!data;
}

/** Check of een nickname al door iemand anders genomen is. */
export async function isNicknameTaken(nickname, exceptUserId = null) {
  let query = supabase
    .from('community_profiles')
    .select('user_id')
    .ilike('nickname', nickname);
  if (exceptUserId) query = query.neq('user_id', exceptUserId);
  const { data, error } = await query.maybeSingle();
  if (error && error.code !== 'PGRST116') {
    throw new Error('Nickname check: ' + error.message);
  }
  return !!data;
}

/** Upsert eigen nickname (wijzigt bestaande rij of maakt nieuwe). */
export async function upsertCommunityProfile(userId, nickname) {
  const { data, error } = await supabase
    .from('community_profiles')
    .upsert({ user_id: userId, nickname }, { onConflict: 'user_id' })
    .select('user_id, nickname, created_at, updated_at')
    .single();
  if (error) {
    // 23505 = unique violation (race condition op nickname)
    if (error.code === '23505') {
      throw Object.assign(new Error('Deze nickname is al in gebruik.'), { status: 409 });
    }
    throw new Error('Profile upsert: ' + error.message);
  }
  return data;
}

/* ============================================
   POSTS
============================================ */

const ALLOWED_CATEGORIES = new Set([
  'vraag','tip','mijlpaal','voeding','slapen','algemeen',
]);

/**
 * Laad posts voor de feed.
 * Sortering: pinned eerst (op pinned_at desc), daarna chronologisch desc.
 * Pagination via `before` (created_at cursor) — limit max 50.
 */
export async function loadPosts({ category = null, before = null, limit = 20 } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);

  let query = supabase
    .from('community_posts_view')
    .select('*')
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(safeLimit);

  if (category && ALLOWED_CATEGORIES.has(category)) {
    query = query.eq('category', category);
  }
  if (before) {
    query = query.lt('created_at', before);
  }

  const { data, error } = await query;
  if (error) throw new Error('Posts load: ' + error.message);
  return data || [];
}

/** Validatie + sanitisatie van post-input. */
export function sanitizePostInput(input) {
  const body = typeof input?.body === 'string' ? input.body.trim() : '';
  const category = typeof input?.category === 'string' && ALLOWED_CATEGORIES.has(input.category)
    ? input.category
    : 'algemeen';

  if (!body) {
    throw Object.assign(new Error('Bericht mag niet leeg zijn.'), { status: 422 });
  }
  if (body.length > 4000) {
    throw Object.assign(new Error('Bericht mag maximaal 4000 tekens lang zijn.'), { status: 422 });
  }

  return { body, category };
}

/** Maak een nieuwe post aan. Returnt de hydrated row uit de view. */
export async function createPost(userId, { body, category }) {
  const { data: inserted, error } = await supabase
    .from('community_posts')
    .insert({ user_id: userId, body, category })
    .select('id')
    .single();
  if (error) throw new Error('Post insert: ' + error.message);

  // Hydrate via view (krijgt nickname + counts mee).
  const { data: hydrated, error: viewErr } = await supabase
    .from('community_posts_view')
    .select('*')
    .eq('id', inserted.id)
    .single();
  if (viewErr) throw new Error('Post hydrate: ' + viewErr.message);

  return hydrated;
}

/* ============================================
   LIKES — vraag op welke posts deze user al likete.
   Gebruikt door /api/community/posts om "liked_by_me"
   te kunnen mergen op de feed-rows.
============================================ */
export async function loadMyLikesForPosts(userId, postIds) {
  if (!postIds?.length) return new Set();
  const { data, error } = await supabase
    .from('community_likes')
    .select('post_id')
    .eq('user_id', userId)
    .in('post_id', postIds);
  if (error) throw new Error('Likes load: ' + error.message);
  return new Set((data || []).map(r => r.post_id));
}

/** Toggle een like. Returnt { liked: boolean, count: int }. */
export async function toggleLike(userId, postId) {
  // Bestaat de like al? → delete; anders insert.
  const { data: existing } = await supabase
    .from('community_likes')
    .select('post_id')
    .eq('post_id', postId)
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('community_likes')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', userId);
    if (error) throw new Error('Like remove: ' + error.message);
  } else {
    const { error } = await supabase
      .from('community_likes')
      .insert({ post_id: postId, user_id: userId });
    if (error) throw new Error('Like add: ' + error.message);
  }

  // Tel opnieuw
  const { count, error: countErr } = await supabase
    .from('community_likes')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', postId);
  if (countErr) throw new Error('Like count: ' + countErr.message);

  return { liked: !existing, count: count || 0 };
}

/* ============================================
   REPLIES
============================================ */

/**
 * Laad replies voor een post, oudste boven (chronologisch).
 * Joint nickname via view-style aanpak: we doen een select met embed
 * op community_profiles via FK alias.
 */
export async function loadReplies(postId, { limit = 100 } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 200);
  const { data, error } = await supabase
    .from('community_replies')
    .select(`
      id, post_id, user_id, body, edited_at, created_at,
      profile:community_profiles!community_replies_user_id_fkey(nickname)
    `)
    .eq('post_id', postId)
    .order('created_at', { ascending: true })
    .limit(safeLimit);
  if (error) {
    // Fallback zonder embed als de FK-naam niet matcht (sommige Supabase-versies)
    if (error.code === 'PGRST200' || /relationship/i.test(error.message)) {
      return loadRepliesFallback(postId, safeLimit);
    }
    throw new Error('Replies load: ' + error.message);
  }
  return (data || []).map(r => ({
    ...r,
    nickname: r.profile?.nickname || null,
    profile: undefined,
  }));
}

async function loadRepliesFallback(postId, limit) {
  const { data: replies, error } = await supabase
    .from('community_replies')
    .select('id, post_id, user_id, body, edited_at, created_at')
    .eq('post_id', postId)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error('Replies load: ' + error.message);

  const userIds = [...new Set((replies || []).map(r => r.user_id))];
  let nickMap = new Map();
  if (userIds.length) {
    const { data: profs } = await supabase
      .from('community_profiles')
      .select('user_id, nickname')
      .in('user_id', userIds);
    nickMap = new Map((profs || []).map(p => [p.user_id, p.nickname]));
  }
  return (replies || []).map(r => ({ ...r, nickname: nickMap.get(r.user_id) || null }));
}

export function sanitizeReplyInput(input) {
  const body = typeof input?.body === 'string' ? input.body.trim() : '';
  if (!body) {
    throw Object.assign(new Error('Reactie mag niet leeg zijn.'), { status: 422 });
  }
  if (body.length > 2000) {
    throw Object.assign(new Error('Reactie mag maximaal 2000 tekens lang zijn.'), { status: 422 });
  }
  return { body };
}

export async function createReply(userId, postId, { body }) {
  // Check eerst of de post bestaat (anders krijgen we een lelijke FK-error).
  const { data: post, error: postErr } = await supabase
    .from('community_posts')
    .select('id, user_id')
    .eq('id', postId)
    .maybeSingle();
  if (postErr) throw new Error('Reply parent check: ' + postErr.message);
  if (!post) {
    throw Object.assign(new Error('Post bestaat niet (meer).'), { status: 404 });
  }

  const { data: inserted, error } = await supabase
    .from('community_replies')
    .insert({ post_id: postId, user_id: userId, body })
    .select('id, post_id, user_id, body, edited_at, created_at')
    .single();
  if (error) throw new Error('Reply insert: ' + error.message);

  // Voeg nickname toe vanuit profile.
  const { data: prof } = await supabase
    .from('community_profiles')
    .select('nickname')
    .eq('user_id', userId)
    .maybeSingle();

  return { ...inserted, nickname: prof?.nickname || null, post_author_id: post.user_id };
}
