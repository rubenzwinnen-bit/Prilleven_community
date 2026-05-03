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
