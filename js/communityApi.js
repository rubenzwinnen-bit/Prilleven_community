/* ============================================
   COMMUNITY API HELPER
   Wrapt /api/community/* calls met automatische
   sessie-refresh + Authorization header.
   Geeft altijd { ok, status, data, error } terug.
============================================ */

import { sessionRefreshIfNeeded } from './supabase.js?v=2.0.1';

async function call(path, { method = 'GET', body = null } = {}) {
  const session = await sessionRefreshIfNeeded();
  if (!session) {
    return { ok: false, status: 401, data: null, error: 'Niet ingelogd.' };
  }

  const res = await fetch('/api/community' + path, {
    method,
    headers: {
      'Authorization': 'Bearer ' + session.access_token,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try { data = await res.json(); } catch { /* lege body ok */ }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      data,
      error: data?.error || `Server-fout (${res.status}).`,
    };
  }
  return { ok: true, status: res.status, data, error: null };
}

/* ----- Profile ----- */
export const getMyProfile  = ()         => call('/profile');
export const setMyNickname = (nickname) => call('/profile', { method: 'PUT', body: { nickname } });

/* ----- Posts ----- */
export function getPosts({ category = null, before = null, limit = 20 } = {}) {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (before)   params.set('before', before);
  if (limit)    params.set('limit', String(limit));
  const qs = params.toString();
  return call('/posts' + (qs ? '?' + qs : ''));
}
export const createPost = ({ body, category }) =>
  call('/posts', { method: 'POST', body: { body, category } });

/* ----- Replies ----- */
export const getReplies  = (postId)        => call(`/posts/${encodeURIComponent(postId)}/replies`);
export const createReply = (postId, body)  =>
  call(`/posts/${encodeURIComponent(postId)}/replies`, { method: 'POST', body: { body } });

/* ----- Likes ----- */
export const toggleLike  = (postId)        =>
  call(`/posts/${encodeURIComponent(postId)}/like`, { method: 'POST' });
