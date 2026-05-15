/* ============================================
   COMMUNITY API HELPER
   Wrapt /api/community/* calls met automatische
   sessie-refresh + Authorization header.
   Geeft altijd { ok, status, data, error } terug.
============================================ */

import { sessionRefreshIfNeeded } from './supabase.js?v=2.4.12';

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
export const updateMyProfile = (updates) =>
  call('/profile', { method: 'PUT', body: updates });
export const getAvatarUploadUrl = () =>
  call('/profile/avatar-url', { method: 'POST' });

/* ----- Posts ----- */
export function getPosts({ category = null, before = null, limit = 20 } = {}) {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (before)   params.set('before', before);
  if (limit)    params.set('limit', String(limit));
  const qs = params.toString();
  return call('/posts' + (qs ? '?' + qs : ''));
}
export const createPost = ({ body, category, image_path = null, poll = null }) =>
  call('/posts', { method: 'POST', body: { body, category, image_path, poll } });

/* ----- Polls -----
   action: 'set' (single, default) | 'toggle' (multi) | 'unvote' */
export const votePoll = (postId, optionIdx, action = 'set') =>
  call(`/posts/${encodeURIComponent(postId)}/poll/vote`, {
    method: 'POST',
    body: { option_idx: optionIdx, action },
  });

/* ----- Image upload (signed URL flow) ----- */
export const getUploadUrl = () => call('/upload-url', { method: 'POST' });

/**
 * Upload een Blob direct naar Supabase via de signed upload URL.
 * Returnt { ok, error }.
 */
export async function uploadToStorage(uploadUrl, blob) {
  try {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': blob.type || 'image/jpeg' },
      body: blob,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, error: `Upload mislukt (${res.status}): ${txt.slice(0, 100)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || 'Netwerkfout bij upload.' };
  }
}

/* ----- Replies ----- */
export const getReplies  = (postId)        => call(`/posts/${encodeURIComponent(postId)}/replies`);
export const createReply = (postId, body)  =>
  call(`/posts/${encodeURIComponent(postId)}/replies`, { method: 'POST', body: { body } });

/* ----- Likes ----- */
export const toggleLike  = (postId)        =>
  call(`/posts/${encodeURIComponent(postId)}/like`, { method: 'POST' });
export const toggleReplyLike = (replyId)   =>
  call(`/replies/${encodeURIComponent(replyId)}/like`, { method: 'POST' });

/* ----- Edit / delete ----- */
export const editPost   = (postId, body) =>
  call(`/posts/${encodeURIComponent(postId)}`, { method: 'PATCH', body: { body } });
export const deletePost = (postId) =>
  call(`/posts/${encodeURIComponent(postId)}`, { method: 'DELETE' });
export const editReply  = (replyId, body) =>
  call(`/replies/${encodeURIComponent(replyId)}`, { method: 'PATCH', body: { body } });
export const deleteReply = (replyId) =>
  call(`/replies/${encodeURIComponent(replyId)}`, { method: 'DELETE' });

/* ----- Report ----- */
export const reportTarget = ({ target_type, target_id, reason }) =>
  call('/report', { method: 'POST', body: { target_type, target_id, reason } });

/* ----- Admin ----- */
export const togglePin = (postId, pin) =>
  call(`/posts/${encodeURIComponent(postId)}/pin`, { method: 'POST', body: { pin } });
export const listReports = () =>
  call('/admin/reports');
export const resolveReport = (reportId, { delete_target = false } = {}) =>
  call(`/admin/reports/${encodeURIComponent(reportId)}/resolve`, {
    method: 'POST',
    body: { delete_target },
  });

/* ----- Notifications ----- */
export const getNotifications  = () => call('/notifications');
export const markNotificationsRead = () => call('/notifications/read', { method: 'POST' });
