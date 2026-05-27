/* ============================================
   CHAT-ROOMS API HELPER
   Wrapt /api/chat-rooms/* calls met automatische
   sessie-refresh + Authorization header.
   Geeft altijd { ok, status, data, error } terug.
============================================ */

import { sessionRefreshIfNeeded } from './supabase.js?v=2.9.0';

async function call(path, { method = 'GET', body = null } = {}) {
  const session = await sessionRefreshIfNeeded();
  if (!session) {
    return { ok: false, status: 401, data: null, error: 'Niet ingelogd.' };
  }

  const res = await fetch('/api/chat-rooms' + path, {
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

/* ----- Rooms ----- */
export const listRooms = () => call('');
export const getRoom   = (slug) => call('/' + encodeURIComponent(slug));
export const editRoom  = (slug, updates) =>
  call('/' + encodeURIComponent(slug), { method: 'PATCH', body: updates });

/* ----- Topics ----- */
export const createTopic = (slug, { title, body }) =>
  call('/' + encodeURIComponent(slug) + '/topics', { method: 'POST', body: { title, body } });

export const getTopic    = (id) => call('/topics/' + encodeURIComponent(id));
export const editTopic   = (id, updates) =>
  call('/topics/' + encodeURIComponent(id), { method: 'PATCH', body: updates });
export const deleteTopic = (id) =>
  call('/topics/' + encodeURIComponent(id), { method: 'DELETE' });
export const pinTopic    = (id, pin) =>
  call('/topics/' + encodeURIComponent(id) + '/pin', { method: 'POST', body: { pin } });

/* ----- Replies ----- */
export const createReply = (topicId, body) =>
  call('/topics/' + encodeURIComponent(topicId) + '/replies',
       { method: 'POST', body: { body } });

export const editReply   = (id, body) =>
  call('/replies/' + encodeURIComponent(id), { method: 'PATCH', body: { body } });
export const deleteReply = (id) =>
  call('/replies/' + encodeURIComponent(id), { method: 'DELETE' });

/* ----- Volgen (rooms) ----- */
export const followRoom   = (slug) => call('/' + encodeURIComponent(slug) + '/follow', { method: 'POST' });
export const unfollowRoom = (slug) => call('/' + encodeURIComponent(slug) + '/follow', { method: 'DELETE' });
export const markRoomRead = (slug) => call('/' + encodeURIComponent(slug) + '/read',   { method: 'POST' });

/* ----- Volgen (topics) ----- */
export const followTopic   = (id) => call('/topics/' + encodeURIComponent(id) + '/follow', { method: 'POST' });
export const unfollowTopic = (id) => call('/topics/' + encodeURIComponent(id) + '/follow', { method: 'DELETE' });
export const markTopicRead = (id) => call('/topics/' + encodeURIComponent(id) + '/read',   { method: 'POST' });

/* ----- Ongelezen tellingen ----- */
export const getUnread = () => call('/unread');
