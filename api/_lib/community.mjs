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

  // image_path is optioneel; valideer formaat als aanwezig
  let image_path = null;
  if (typeof input?.image_path === 'string' && input.image_path.trim()) {
    const p = input.image_path.trim();
    if (!/^[A-Za-z0-9/_.-]{1,200}$/.test(p)) {
      throw Object.assign(new Error('Ongeldige afbeelding-pad.'), { status: 422 });
    }
    image_path = p;
  }

  return { body, category, image_path };
}

/** Maak een nieuwe post aan. Returnt de hydrated row uit de view. */
export async function createPost(userId, { body, category, image_path = null, poll = null }) {
  const { data: inserted, error } = await supabase
    .from('community_posts')
    .insert({ user_id: userId, body, category, image_path })
    .select('id')
    .single();
  if (error) throw new Error('Post insert: ' + error.message);

  // Optionele poll meteen toevoegen.
  if (poll) {
    const { error: pollErr } = await supabase
      .from('community_polls')
      .insert({
        post_id: inserted.id,
        question: poll.question,
        options: poll.options,
      });
    if (pollErr) {
      // Rollback: post zonder poll bestaat al, beter weggooien zodat
      // de feed niet "has_poll = false" toont voor een mislukte poll-create.
      await supabase.from('community_posts').delete().eq('id', inserted.id);
      throw new Error('Poll insert: ' + pollErr.message);
    }
  }

  // Hydrate via view (krijgt nickname + counts mee).
  const { data: hydrated, error: viewErr } = await supabase
    .from('community_posts_view')
    .select('*')
    .eq('id', inserted.id)
    .single();
  if (viewErr) throw new Error('Post hydrate: ' + viewErr.message);

  return hydrated;
}

/** Validatie + sanitisatie van poll-input. Returnt object of null. */
export function sanitizePollInput(input) {
  if (!input || typeof input !== 'object') return null;
  const question = typeof input.question === 'string' ? input.question.trim() : '';
  if (!question) {
    throw Object.assign(new Error('Poll-vraag mag niet leeg zijn.'), { status: 422 });
  }
  if (question.length > 200) {
    throw Object.assign(new Error('Poll-vraag mag maximaal 200 tekens zijn.'), { status: 422 });
  }
  if (!Array.isArray(input.options)) {
    throw Object.assign(new Error('Poll moet opties bevatten.'), { status: 422 });
  }
  const options = input.options
    .map(o => typeof o === 'string' ? o.trim() : '')
    .filter(Boolean);
  if (options.length < 2 || options.length > 4) {
    throw Object.assign(new Error('Poll moet 2 tot 4 opties hebben.'), { status: 422 });
  }
  for (const o of options) {
    if (o.length > 80) {
      throw Object.assign(new Error('Poll-optie mag maximaal 80 tekens zijn.'), { status: 422 });
    }
  }
  return { question, options };
}

/* ============================================
   STORAGE — community-images bucket
============================================ */

const BUCKET = 'community-images';
const SIGNED_READ_TTL_SEC = 60 * 60;        // 1u — feed wordt vaak ververst
const SIGNED_UPLOAD_TTL_SEC = 5 * 60;       // 5 min — upload moet snel gebeuren

/**
 * Maak een signed upload URL voor een nieuwe foto van deze user.
 * Pad: <userId>/<random>.jpg — RLS staat alleen owner uploads toe.
 */
export async function createImageUploadUrl(userId) {
  const id = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const path = `${userId}/${id}.jpg`;
  const { data, error } = await supabase
    .storage.from(BUCKET)
    .createSignedUploadUrl(path);
  if (error) throw new Error('Upload URL: ' + error.message);
  return {
    path,
    uploadUrl: data.signedUrl,
    token: data.token,
  };
}

/**
 * Genereer signed read-URLs voor een lijst image_paths.
 * Returnt Map<path, signedUrl>. Onbestaande paden worden overgeslagen.
 */
export async function signImageUrls(paths) {
  const unique = [...new Set((paths || []).filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data, error } = await supabase
    .storage.from(BUCKET)
    .createSignedUrls(unique, SIGNED_READ_TTL_SEC);
  if (error) throw new Error('Signed URLs: ' + error.message);
  const map = new Map();
  for (const item of (data || [])) {
    if (item.signedUrl && !item.error) {
      map.set(item.path, item.signedUrl);
    }
  }
  return map;
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

/* ============================================
   EDIT / DELETE — posts en replies
   Server doet authoritatieve eigenaar + 15-min check.
============================================ */

const EDIT_WINDOW_MS = 15 * 60 * 1000;

export async function editPost(userId, postId, newBody) {
  const body = typeof newBody === 'string' ? newBody.trim() : '';
  if (!body) throw Object.assign(new Error('Bericht mag niet leeg zijn.'), { status: 422 });
  if (body.length > 4000) throw Object.assign(new Error('Bericht te lang.'), { status: 422 });

  const { data: existing, error: getErr } = await supabase
    .from('community_posts')
    .select('user_id, created_at')
    .eq('id', postId)
    .maybeSingle();
  if (getErr) throw new Error('Post fetch: ' + getErr.message);
  if (!existing) throw Object.assign(new Error('Post bestaat niet.'), { status: 404 });
  if (existing.user_id !== userId) {
    throw Object.assign(new Error('Geen rechten om deze post te wijzigen.'), { status: 403 });
  }
  if (Date.now() - new Date(existing.created_at).getTime() > EDIT_WINDOW_MS) {
    throw Object.assign(new Error('Bewerken kan alleen binnen 15 minuten na plaatsen.'), { status: 409 });
  }

  const { error } = await supabase
    .from('community_posts')
    .update({ body, edited_at: new Date().toISOString() })
    .eq('id', postId);
  if (error) throw new Error('Post update: ' + error.message);

  const { data, error: viewErr } = await supabase
    .from('community_posts_view')
    .select('*')
    .eq('id', postId)
    .single();
  if (viewErr) throw new Error('Post hydrate: ' + viewErr.message);
  return data;
}

export async function deletePost(userId, postId, { isAdmin = false } = {}) {
  const { data: existing, error: getErr } = await supabase
    .from('community_posts')
    .select('user_id, image_path')
    .eq('id', postId)
    .maybeSingle();
  if (getErr) throw new Error('Post fetch: ' + getErr.message);
  if (!existing) throw Object.assign(new Error('Post bestaat niet.'), { status: 404 });
  if (!isAdmin && existing.user_id !== userId) {
    throw Object.assign(new Error('Geen rechten om deze post te verwijderen.'), { status: 403 });
  }

  // Verwijder gekoppelde foto uit storage (best-effort).
  if (existing.image_path) {
    await supabase.storage.from(BUCKET).remove([existing.image_path]).catch(() => {});
  }

  const { error } = await supabase
    .from('community_posts')
    .delete()
    .eq('id', postId);
  if (error) throw new Error('Post delete: ' + error.message);
  return { ok: true };
}

export async function editReply(userId, replyId, newBody) {
  const body = typeof newBody === 'string' ? newBody.trim() : '';
  if (!body) throw Object.assign(new Error('Reactie mag niet leeg zijn.'), { status: 422 });
  if (body.length > 2000) throw Object.assign(new Error('Reactie te lang.'), { status: 422 });

  const { data: existing, error: getErr } = await supabase
    .from('community_replies')
    .select('user_id, created_at')
    .eq('id', replyId)
    .maybeSingle();
  if (getErr) throw new Error('Reply fetch: ' + getErr.message);
  if (!existing) throw Object.assign(new Error('Reactie bestaat niet.'), { status: 404 });
  if (existing.user_id !== userId) {
    throw Object.assign(new Error('Geen rechten om deze reactie te wijzigen.'), { status: 403 });
  }
  if (Date.now() - new Date(existing.created_at).getTime() > EDIT_WINDOW_MS) {
    throw Object.assign(new Error('Bewerken kan alleen binnen 15 minuten na plaatsen.'), { status: 409 });
  }

  const { error } = await supabase
    .from('community_replies')
    .update({ body, edited_at: new Date().toISOString() })
    .eq('id', replyId);
  if (error) throw new Error('Reply update: ' + error.message);

  const { data: prof } = await supabase
    .from('community_profiles')
    .select('nickname')
    .eq('user_id', userId)
    .maybeSingle();
  const { data: hydrated, error: hErr } = await supabase
    .from('community_replies')
    .select('id, post_id, user_id, body, edited_at, created_at')
    .eq('id', replyId)
    .single();
  if (hErr) throw new Error('Reply hydrate: ' + hErr.message);
  return { ...hydrated, nickname: prof?.nickname || null };
}

export async function deleteReply(userId, replyId, { isAdmin = false } = {}) {
  const { data: existing, error: getErr } = await supabase
    .from('community_replies')
    .select('user_id')
    .eq('id', replyId)
    .maybeSingle();
  if (getErr) throw new Error('Reply fetch: ' + getErr.message);
  if (!existing) throw Object.assign(new Error('Reactie bestaat niet.'), { status: 404 });
  if (!isAdmin && existing.user_id !== userId) {
    throw Object.assign(new Error('Geen rechten om deze reactie te verwijderen.'), { status: 403 });
  }

  const { error } = await supabase
    .from('community_replies')
    .delete()
    .eq('id', replyId);
  if (error) throw new Error('Reply delete: ' + error.message);
  return { ok: true };
}

/* ============================================
   REPORTS
============================================ */

export async function createReport(userId, { target_type, target_id, reason }) {
  if (!['post', 'reply'].includes(target_type)) {
    throw Object.assign(new Error('Ongeldig target_type.'), { status: 422 });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(target_id))) {
    throw Object.assign(new Error('Ongeldige target_id.'), { status: 422 });
  }
  const cleanReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : null;

  const { error } = await supabase
    .from('community_reports')
    .insert({
      target_type,
      target_id,
      reporter_id: userId,
      reason: cleanReason || null,
    });
  if (error) throw new Error('Report insert: ' + error.message);
  return { ok: true };
}

/* ============================================
   POLLS
============================================ */

/**
 * Voor een lijst van postIds: laad polls + vote-counts + my_vote.
 * Returnt Map<post_id, { question, options, closes_at, counts: int[],
 *                         total: int, my_vote: int|null, closed: bool }>.
 */
export async function loadPollsForPosts(userId, postIds) {
  const ids = (postIds || []).filter(Boolean);
  if (ids.length === 0) return new Map();

  // Load polls + votes in parallel
  const [pollsRes, votesRes] = await Promise.all([
    supabase
      .from('community_polls')
      .select('post_id, question, options, closes_at')
      .in('post_id', ids),
    supabase
      .from('community_poll_votes')
      .select('post_id, user_id, option_idx')
      .in('post_id', ids),
  ]);
  if (pollsRes.error) throw new Error('Polls load: ' + pollsRes.error.message);
  if (votesRes.error) throw new Error('Poll votes load: ' + votesRes.error.message);

  const map = new Map();
  const now = Date.now();
  for (const p of pollsRes.data || []) {
    const optsCount = Array.isArray(p.options) ? p.options.length : 0;
    map.set(p.post_id, {
      question: p.question,
      options: p.options,
      closes_at: p.closes_at,
      counts: new Array(optsCount).fill(0),
      total: 0,
      my_vote: null,
      closed: new Date(p.closes_at).getTime() <= now,
    });
  }
  for (const v of votesRes.data || []) {
    const entry = map.get(v.post_id);
    if (!entry) continue;
    if (v.option_idx >= 0 && v.option_idx < entry.counts.length) {
      entry.counts[v.option_idx] += 1;
      entry.total += 1;
      if (v.user_id === userId) entry.my_vote = v.option_idx;
    }
  }
  return map;
}

/**
 * Stem op een poll. Faalt als poll niet bestaat, gesloten is, of optie ongeldig.
 * Returnt vernieuwde poll-data: { counts, total, my_vote, closed }.
 */
export async function votePoll(userId, postId, optionIdx) {
  if (!Number.isInteger(optionIdx) || optionIdx < 0 || optionIdx > 3) {
    throw Object.assign(new Error('Ongeldige stem-optie.'), { status: 422 });
  }
  // Poll bestaat? Niet gesloten? Optie binnen range?
  const { data: poll, error: pollErr } = await supabase
    .from('community_polls')
    .select('post_id, options, closes_at')
    .eq('post_id', postId)
    .maybeSingle();
  if (pollErr) throw new Error('Poll check: ' + pollErr.message);
  if (!poll) throw Object.assign(new Error('Poll bestaat niet.'), { status: 404 });
  if (new Date(poll.closes_at).getTime() <= Date.now()) {
    throw Object.assign(new Error('Poll is gesloten.'), { status: 409 });
  }
  const optsCount = Array.isArray(poll.options) ? poll.options.length : 0;
  if (optionIdx >= optsCount) {
    throw Object.assign(new Error('Ongeldige stem-optie.'), { status: 422 });
  }

  // Upsert: één stem per (post_id, user_id) door PK; we staan toe te wijzigen.
  const { error: upErr } = await supabase
    .from('community_poll_votes')
    .upsert({ post_id: postId, user_id: userId, option_idx: optionIdx },
            { onConflict: 'post_id,user_id' });
  if (upErr) throw new Error('Vote upsert: ' + upErr.message);

  // Vernieuw counts
  const map = await loadPollsForPosts(userId, [postId]);
  return map.get(postId) || null;
}
