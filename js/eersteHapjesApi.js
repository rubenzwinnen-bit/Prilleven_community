/* ============================================
   EERSTE HAPJES API HELPER
   Wrapt /api/eerste-hapjes/* calls met automatische
   sessie-refresh + Authorization header.
   Geeft altijd { ok, status, data, error } terug.
============================================ */

import { sessionRefreshIfNeeded } from './supabase.js?v=2.3.0';

async function call(path, { method = 'GET', body = null } = {}) {
  const session = await sessionRefreshIfNeeded();
  if (!session) {
    return { ok: false, status: 401, data: null, error: 'Niet ingelogd.' };
  }

  const res = await fetch('/api/eerste-hapjes' + path, {
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

/* ----- Children ----- */
export const getMyChildren = ({ includeArchived = false } = {}) =>
  call('/children' + (includeArchived ? '?include_archived=1' : ''));

export const createChild = ({ name, birthdate, texture_preference = null }) =>
  call('/children', {
    method: 'POST',
    body: { name, birthdate, texture_preference },
  });

export const updateChild = (id, updates) =>
  call(`/children/${encodeURIComponent(id)}`, { method: 'PATCH', body: updates });

export const deleteChild = (id) =>
  call(`/children/${encodeURIComponent(id)}`, { method: 'DELETE' });
