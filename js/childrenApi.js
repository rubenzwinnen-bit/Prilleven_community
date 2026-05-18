/* ============================================
   CHILDREN API HELPER
   Wrapt /api/children calls met automatische
   sessie-refresh + Authorization header.
   Geeft altijd { ok, status, data, error } terug.
============================================ */

import { sessionRefreshIfNeeded } from './supabase.js?v=2.5.6';

async function call(path, { method = 'GET', body = null } = {}) {
  const session = await sessionRefreshIfNeeded();
  if (!session) {
    return { ok: false, status: 401, data: null, error: 'Niet ingelogd.' };
  }

  const res = await fetch('/api/children' + path, {
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

export const getChildren    = ()           => call('');
export const createChild    = (child)      => call('', { method: 'POST', body: child });
export const updateChild    = (id, fields) => call('', { method: 'PATCH', body: { id, ...fields } });
export const archiveChild   = (id)         => call('', { method: 'DELETE', body: { id } });
