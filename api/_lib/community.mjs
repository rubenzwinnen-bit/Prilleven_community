// Helpers rond de community feed (nickname, posts, etc.).

import { supabase } from './clients.mjs';

const NICKNAME_RE = /^[A-Za-z0-9_\- ]{2,30}$/;

/** Eigen community-profiel ophalen of null. */
export async function loadCommunityProfile(userId) {
  const { data, error } = await supabase
    .from('community_profiles')
    .select('user_id, nickname, avatar_path, created_at, updated_at')
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

/**
 * Upsert eigen profiel. Velden die undefined zijn worden niet gewijzigd.
 * `nickname` is verplicht bij eerste insert. `avatar_path` mag null
 * zijn (= verwijder avatar).
 */
export async function upsertCommunityProfile(userId, { nickname, avatar_path } = {}) {
  // Bij eerste create moet nickname mee
  const existing = await loadCommunityProfile(userId);
  const row = { user_id: userId };
  if (nickname !== undefined) row.nickname = nickname;
  else if (existing) row.nickname = existing.nickname;
  if (avatar_path !== undefined) row.avatar_path = avatar_path;
  else if (existing) row.avatar_path = existing.avatar_path;

  const { data, error } = await supabase
    .from('community_profiles')
    .upsert(row, { onConflict: 'user_id' })
    .select('user_id, nickname, avatar_path, created_at, updated_at')
    .single();
  if (error) {
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
        allow_multi: !!poll.allow_multi,
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
  const allow_multi = input.allow_multi === true;
  return { question, options, allow_multi };
}

/* ============================================
   STORAGE — community-images bucket
============================================ */

const BUCKET = 'community-images';
const SIGNED_READ_TTL_SEC = 60 * 60;        // 1u — feed wordt vaak ververst
const SIGNED_UPLOAD_TTL_SEC = 5 * 60;       // 5 min — upload moet snel gebeuren

function newRandomId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Maak een signed upload URL voor een nieuwe post-foto.
 * Pad: <userId>/<random>.jpg — RLS staat alleen owner uploads toe.
 */
export async function createImageUploadUrl(userId) {
  const path = `${userId}/${newRandomId()}.jpg`;
  const { data, error } = await supabase
    .storage.from(BUCKET)
    .createSignedUploadUrl(path);
  if (error) throw new Error('Upload URL: ' + error.message);
  return { path, uploadUrl: data.signedUrl, token: data.token };
}

/**
 * Maak een signed upload URL voor een avatar (profielfoto).
 * Pad: <userId>/avatars/<random>.jpg — onder eigen folder, dezelfde
 * RLS-policy. Aparte sub-folder voorkomt verwarring met post-foto's.
 */
export async function createAvatarUploadUrl(userId) {
  const path = `${userId}/avatars/${newRandomId()}.jpg`;
  const { data, error } = await supabase
    .storage.from(BUCKET)
    .createSignedUploadUrl(path);
  if (error) throw new Error('Avatar URL: ' + error.message);
  return { path, uploadUrl: data.signedUrl, token: data.token };
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
   ADMIN-USERIDS — wie van een lijst user_ids is admin.
   Probeert eerst de community_admin_user_ids view; valt
   terug op een directe join via auth.admin.getUserById +
   allowed_users zodat het ook werkt zonder de view.
============================================ */
export async function loadAdminUserIds(userIds) {
  if (!userIds?.length) return new Set();
  const unique = [...new Set(userIds.filter(Boolean))];

  // Attempt 1: gebruik view (snel)
  const viewRes = await supabase
    .from('community_admin_user_ids')
    .select('user_id')
    .in('user_id', unique);
  if (!viewRes.error && Array.isArray(viewRes.data) && viewRes.data.length > 0) {
    return new Set(viewRes.data.map(r => r.user_id));
  }
  if (viewRes.error) {
    console.warn('[admin user_ids] view query error: ' + viewRes.error.message);
  }

  // Attempt 2: fallback via auth.admin (alleen service-role)
  // Haal admin-emails op + match user-ids via getUserById.
  try {
    const { data: adminRows, error: aErr } = await supabase
      .from('allowed_users')
      .select('email')
      .eq('is_admin', true);
    if (aErr) throw aErr;

    const adminEmails = new Set(
      (adminRows || []).map(r => String(r.email || '').toLowerCase().trim()).filter(Boolean)
    );
    if (adminEmails.size === 0) return new Set();

    const adminSet = new Set();
    await Promise.all(unique.map(async (uid) => {
      try {
        const { data } = await supabase.auth.admin.getUserById(uid);
        const email = String(data?.user?.email || '').toLowerCase().trim();
        if (email && adminEmails.has(email)) adminSet.add(uid);
      } catch { /* ignore individual lookups */ }
    }));
    return adminSet;
  } catch (err) {
    console.warn('[admin user_ids] fallback failed: ' + err.message);
    return new Set();
  }
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

    // Notificatie naar post-auteur (alleen bij toevoegen, niet bij unlike,
    // en niet als je je eigen post liked).
    const { data: post } = await supabase
      .from('community_posts')
      .select('user_id')
      .eq('id', postId)
      .maybeSingle();
    if (post && post.user_id !== userId) {
      await insertNotification({
        userId: post.user_id,
        type: 'like',
        postId,
        actorId: userId,
      }).catch(err => console.error('[notif:like]', err));
    }
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
   REPLY LIKES
============================================ */

export async function loadMyLikesForReplies(userId, replyIds) {
  if (!replyIds?.length) return new Set();
  const { data, error } = await supabase
    .from('community_reply_likes')
    .select('reply_id')
    .eq('user_id', userId)
    .in('reply_id', replyIds);
  if (error) {
    console.warn('[reply likes] ' + error.message);
    return new Set();
  }
  return new Set((data || []).map(r => r.reply_id));
}

export async function loadReplyLikeCounts(replyIds) {
  if (!replyIds?.length) return new Map();
  // 1 query met group by zou ideaal zijn maar Supabase JS heeft geen
  // directe group-by support. We doen een select all + reduce in JS.
  // Voor v1 is dit OK (aantal replies per feed-load is klein).
  const { data, error } = await supabase
    .from('community_reply_likes')
    .select('reply_id')
    .in('reply_id', replyIds);
  if (error) {
    console.warn('[reply like counts] ' + error.message);
    return new Map();
  }
  const map = new Map();
  for (const row of (data || [])) {
    map.set(row.reply_id, (map.get(row.reply_id) || 0) + 1);
  }
  return map;
}

export async function toggleReplyLike(userId, replyId) {
  const { data: existing } = await supabase
    .from('community_reply_likes')
    .select('reply_id')
    .eq('reply_id', replyId)
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('community_reply_likes')
      .delete()
      .eq('reply_id', replyId)
      .eq('user_id', userId);
    if (error) throw new Error('Reply-like remove: ' + error.message);
  } else {
    const { error } = await supabase
      .from('community_reply_likes')
      .insert({ reply_id: replyId, user_id: userId });
    if (error) throw new Error('Reply-like add: ' + error.message);
  }

  const { count, error: countErr } = await supabase
    .from('community_reply_likes')
    .select('*', { count: 'exact', head: true })
    .eq('reply_id', replyId);
  if (countErr) throw new Error('Reply-like count: ' + countErr.message);

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
      profile:community_profiles!community_replies_user_id_fkey(nickname, avatar_path)
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
    avatar_path: r.profile?.avatar_path || null,
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
  let profMap = new Map();
  if (userIds.length) {
    const { data: profs } = await supabase
      .from('community_profiles')
      .select('user_id, nickname, avatar_path')
      .in('user_id', userIds);
    profMap = new Map((profs || []).map(p => [p.user_id, p]));
  }
  return (replies || []).map(r => {
    const p = profMap.get(r.user_id);
    return { ...r, nickname: p?.nickname || null, avatar_path: p?.avatar_path || null };
  });
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

  // Notificatie naar post-auteur (niet naar zichzelf).
  if (post.user_id !== userId) {
    await insertNotification({
      userId: post.user_id,
      type: 'reply',
      postId: post.id,
      replyId: inserted.id,
      actorId: userId,
    }).catch(err => console.error('[notif:reply]', err));
  }

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
   ADMIN — pin + reports queue
============================================ */

const MAX_PINNED = 5;

/**
 * Toggle is_pinned op een post (admin-only). Houdt rekening met max
 * gepinde posts: weigert nieuwe pin als er al MAX_PINNED zijn.
 */
export async function adminTogglePin(postId, { wantPinned } = {}) {
  const { data: existing, error: getErr } = await supabase
    .from('community_posts')
    .select('id, is_pinned')
    .eq('id', postId)
    .maybeSingle();
  if (getErr) throw new Error('Post fetch: ' + getErr.message);
  if (!existing) throw Object.assign(new Error('Post bestaat niet.'), { status: 404 });

  const newVal = typeof wantPinned === 'boolean' ? wantPinned : !existing.is_pinned;

  if (newVal && !existing.is_pinned) {
    const { count, error: cErr } = await supabase
      .from('community_posts')
      .select('*', { count: 'exact', head: true })
      .eq('is_pinned', true);
    if (cErr) throw new Error('Pin count: ' + cErr.message);
    if ((count || 0) >= MAX_PINNED) {
      throw Object.assign(
        new Error(`Maximum ${MAX_PINNED} gepinde posts bereikt — maak er eerst een los.`),
        { status: 409 }
      );
    }
  }

  const { error } = await supabase
    .from('community_posts')
    .update({ is_pinned: newVal })
    .eq('id', postId);
  if (error) throw new Error('Pin update: ' + error.message);
  return { is_pinned: newVal };
}

/**
 * Lijst open (resolved_at IS NULL) reports, met gekoppelde target-content
 * voor snelle moderatie. Limiet 50.
 */
export async function adminListReports({ limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const { data: reports, error } = await supabase
    .from('community_reports')
    .select('id, target_type, target_id, reporter_id, reason, created_at')
    .is('resolved_at', null)
    .order('created_at', { ascending: false })
    .limit(safeLimit);
  if (error) throw new Error('Reports list: ' + error.message);

  const postIds  = [...new Set(reports.filter(r => r.target_type === 'post').map(r => r.target_id))];
  const replyIds = [...new Set(reports.filter(r => r.target_type === 'reply').map(r => r.target_id))];

  const [postsRes, repliesRes] = await Promise.all([
    postIds.length
      ? supabase.from('community_posts_view').select('id, body, nickname, user_id, created_at, image_path').in('id', postIds)
      : Promise.resolve({ data: [] }),
    replyIds.length
      ? supabase.from('community_replies').select('id, body, user_id, created_at').in('id', replyIds)
      : Promise.resolve({ data: [] }),
  ]);
  const postMap  = new Map((postsRes.data || []).map(p => [p.id, p]));
  const replyMap = new Map((repliesRes.data || []).map(r => [r.id, r]));

  return reports.map(r => ({
    id: r.id,
    target_type: r.target_type,
    target_id: r.target_id,
    reason: r.reason,
    created_at: r.created_at,
    target: r.target_type === 'post'
      ? (postMap.get(r.target_id) || null)
      : (replyMap.get(r.target_id) || null),
  }));
}

/** Markeer een report als opgelost (zonder verdere actie). */
export async function adminResolveReport(reportId) {
  const { error } = await supabase
    .from('community_reports')
    .update({ resolved_at: new Date().toISOString() })
    .eq('id', reportId);
  if (error) throw new Error('Resolve: ' + error.message);
  return { ok: true };
}

/** Markeer alle reports voor een target als opgelost (na delete-actie). */
export async function adminResolveReportsForTarget(targetType, targetId) {
  const { error } = await supabase
    .from('community_reports')
    .update({ resolved_at: new Date().toISOString() })
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .is('resolved_at', null);
  if (error) throw new Error('Resolve target: ' + error.message);
}

/**
 * Combo-actie: lees report → verwijder target → resolve alle reports
 * voor dat target. Wrapper rond bestaande helpers zodat /community.mjs
 * geen directe supabase-import nodig heeft.
 */
export async function adminResolveAndDelete(reportId, adminUserId) {
  const { data: rep, error } = await supabase
    .from('community_reports')
    .select('target_type, target_id')
    .eq('id', reportId)
    .maybeSingle();
  if (error) throw new Error('Report fetch: ' + error.message);
  if (!rep) throw Object.assign(new Error('Report bestaat niet.'), { status: 404 });

  if (rep.target_type === 'post')  await deletePost(adminUserId, rep.target_id, { isAdmin: true });
  if (rep.target_type === 'reply') await deleteReply(adminUserId, rep.target_id, { isAdmin: true });
  await adminResolveReportsForTarget(rep.target_type, rep.target_id);
}

/* ============================================
   NOTIFICATIES
============================================ */

/**
 * Insert een notificatie. Failt geen aanroepende actie als deze faalt
 * (callers gebruiken .catch om door te gaan).
 */
async function insertNotification({ userId, type, postId = null, replyId = null, actorId = null }) {
  const { error } = await supabase
    .from('community_notifications')
    .insert({
      user_id: userId,
      type,
      post_id: postId,
      reply_id: replyId,
      actor_id: actorId,
    });
  if (error) throw new Error('Notification insert: ' + error.message);
}

/**
 * Laad notificaties voor user, met actor-nickname + post-preview.
 * Sorteert ongelezen eerst, dan op datum desc. Limiet 30.
 *
 * NB: we vermijden `nullsFirst` op .order() omdat de optie in sommige
 * supabase-js versies niet correct wordt geserialiseerd. Sortering doen
 * we in JS na de fetch.
 */
export async function loadMyNotifications(userId, { limit = 30 } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);
  const { data: rawNotifs, error } = await supabase
    .from('community_notifications')
    .select('id, type, post_id, reply_id, actor_id, read_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(safeLimit);
  if (error) throw new Error('Notifications load: ' + error.message);
  if (!rawNotifs?.length) return [];
  // Re-sort in JS: ongelezen (read_at = null) eerst, dan chronologisch desc.
  const notifs = [...rawNotifs].sort((a, b) => {
    const aRead = a.read_at ? 1 : 0;
    const bRead = b.read_at ? 1 : 0;
    if (aRead !== bRead) return aRead - bRead;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const actorIds = [...new Set(notifs.map(n => n.actor_id).filter(Boolean))];
  const postIds  = [...new Set(notifs.map(n => n.post_id).filter(Boolean))];

  const [profsRes, postsRes] = await Promise.all([
    actorIds.length
      ? supabase.from('community_profiles').select('user_id, nickname').in('user_id', actorIds)
      : Promise.resolve({ data: [] }),
    postIds.length
      ? supabase.from('community_posts').select('id, body').in('id', postIds)
      : Promise.resolve({ data: [] }),
  ]);
  const nickMap = new Map((profsRes.data || []).map(p => [p.user_id, p.nickname]));
  const postMap = new Map((postsRes.data || []).map(p => [p.id, p]));

  return notifs.map(n => ({
    ...n,
    actor_nickname: n.actor_id ? (nickMap.get(n.actor_id) || null) : null,
    post_preview: n.post_id
      ? (postMap.get(n.post_id)?.body?.slice(0, 80) || null)
      : null,
  }));
}

/** Aantal ongelezen notificaties. */
export async function countUnreadNotifications(userId) {
  const { count, error } = await supabase
    .from('community_notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null);
  if (error) throw new Error('Unread count: ' + error.message);
  return count || 0;
}

/** Markeer alle notificaties van een user als gelezen. */
export async function markAllNotificationsRead(userId) {
  const { error } = await supabase
    .from('community_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);
  if (error) throw new Error('Mark read: ' + error.message);
}

/* ============================================
   POLLS
============================================ */

/**
 * Voor een lijst van postIds: laad polls + vote-counts + my_votes.
 * Returnt Map<post_id, { question, options, closes_at, counts: int[],
 *                         total: int, my_votes: int[], closed: bool,
 *                         allow_multi: bool }>.
 *
 * NB: my_votes is een array (kan 0..N opties bevatten); voor single-vote
 * polls is het max 1 element.
 */
export async function loadPollsForPosts(userId, postIds) {
  const ids = (postIds || []).filter(Boolean);
  if (ids.length === 0) return new Map();

  const [pollsRes, votesRes] = await Promise.all([
    supabase
      .from('community_polls')
      .select('post_id, question, options, closes_at, allow_multi')
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
      my_votes: [],
      closed: new Date(p.closes_at).getTime() <= now,
      allow_multi: !!p.allow_multi,
    });
  }
  for (const v of votesRes.data || []) {
    const entry = map.get(v.post_id);
    if (!entry) continue;
    if (v.option_idx >= 0 && v.option_idx < entry.counts.length) {
      entry.counts[v.option_idx] += 1;
      entry.total += 1;
      if (v.user_id === userId) entry.my_votes.push(v.option_idx);
    }
  }
  return map;
}

/**
 * Stem op een poll. Drie acties mogelijk:
 *   - 'set'    (single-vote): vervang bestaande stem met deze optie.
 *              Als zelfde optie als huidige → unvote (verwijder).
 *   - 'toggle' (multi-vote):  toggle deze optie aan/uit.
 *   - 'unvote' (beide):       verwijder alle stemmen van deze user.
 *
 * Returnt vernieuwde poll-data uit loadPollsForPosts.
 */
export async function votePoll(userId, postId, optionIdx, action = 'set') {
  if (action !== 'unvote' && (!Number.isInteger(optionIdx) || optionIdx < 0 || optionIdx > 3)) {
    throw Object.assign(new Error('Ongeldige stem-optie.'), { status: 422 });
  }
  const { data: poll, error: pollErr } = await supabase
    .from('community_polls')
    .select('post_id, options, closes_at, allow_multi')
    .eq('post_id', postId)
    .maybeSingle();
  if (pollErr) throw new Error('Poll check: ' + pollErr.message);
  if (!poll) throw Object.assign(new Error('Poll bestaat niet.'), { status: 404 });
  if (new Date(poll.closes_at).getTime() <= Date.now()) {
    throw Object.assign(new Error('Poll is gesloten.'), { status: 409 });
  }
  const optsCount = Array.isArray(poll.options) ? poll.options.length : 0;
  if (action !== 'unvote' && optionIdx >= optsCount) {
    throw Object.assign(new Error('Ongeldige stem-optie.'), { status: 422 });
  }

  const allowMulti = !!poll.allow_multi;

  if (action === 'unvote') {
    // Verwijder alle stemmen van deze user op deze poll.
    const { error } = await supabase
      .from('community_poll_votes')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', userId);
    if (error) throw new Error('Vote unvote: ' + error.message);
  } else if (allowMulti) {
    // Toggle: bestaat (post_id, user_id, option_idx)? → delete; anders insert.
    const { data: existing } = await supabase
      .from('community_poll_votes')
      .select('option_idx')
      .eq('post_id', postId)
      .eq('user_id', userId)
      .eq('option_idx', optionIdx)
      .maybeSingle();
    if (existing) {
      const { error } = await supabase
        .from('community_poll_votes')
        .delete()
        .eq('post_id', postId)
        .eq('user_id', userId)
        .eq('option_idx', optionIdx);
      if (error) throw new Error('Vote toggle delete: ' + error.message);
    } else {
      const { error } = await supabase
        .from('community_poll_votes')
        .insert({ post_id: postId, user_id: userId, option_idx: optionIdx });
      if (error) throw new Error('Vote toggle insert: ' + error.message);
    }
  } else {
    // Single-vote: huidige stemmen ophalen, vergelijken met nieuwe.
    const { data: current } = await supabase
      .from('community_poll_votes')
      .select('option_idx')
      .eq('post_id', postId)
      .eq('user_id', userId);
    const currentIdx = current?.[0]?.option_idx;
    if (currentIdx === optionIdx) {
      // Klik op huidige optie = unvote
      const { error } = await supabase
        .from('community_poll_votes')
        .delete()
        .eq('post_id', postId)
        .eq('user_id', userId);
      if (error) throw new Error('Vote single delete: ' + error.message);
    } else {
      // Vervang: delete bestaande + insert nieuwe
      await supabase
        .from('community_poll_votes')
        .delete()
        .eq('post_id', postId)
        .eq('user_id', userId);
      const { error } = await supabase
        .from('community_poll_votes')
        .insert({ post_id: postId, user_id: userId, option_idx: optionIdx });
      if (error) throw new Error('Vote single insert: ' + error.message);
    }
  }

  const map = await loadPollsForPosts(userId, [postId]);
  return map.get(postId) || null;
}
