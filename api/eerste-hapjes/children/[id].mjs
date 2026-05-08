// PATCH  /api/eerste-hapjes/children/[id]   → naam / birthdate / texture / archived
// DELETE /api/eerste-hapjes/children/[id]   → permanent verwijderen
//
// Eerste Hapjes Traject — brok B.1.

import { requireAuth, AuthError } from '../../_lib/auth.mjs';
import {
  sanitizeChildPatch,
  updateChild,
  deleteChild,
  HttpError,
} from '../../_lib/children.mjs';

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  try {
    return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return null;
  }
}

function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  // Vercel dev geeft query.id; fallback via URL parsing
  const id = req.query?.id ||
    (req.url ? new URL(req.url, 'http://x').pathname.split('/').filter(Boolean).pop() : null);
  if (!id || !isUuid(id)) return json(res, 400, { error: 'Ongeldige id.' });

  let auth;
  try {
    auth = await requireAuth(req);
  } catch (e) {
    if (e instanceof AuthError) return json(res, e.status, { error: e.message });
    throw e;
  }

  try {
    if (req.method === 'PATCH') {
      const body = parseBody(req);
      if (body === null) return json(res, 400, { error: 'Ongeldige JSON.' });
      let updates;
      try {
        updates = sanitizeChildPatch(body);
      } catch (err) {
        if (err instanceof HttpError) return json(res, err.status, { error: err.message });
        throw err;
      }
      try {
        const child = await updateChild(auth.userId, id, updates);
        return json(res, 200, { child });
      } catch (err) {
        if (err instanceof HttpError) return json(res, err.status, { error: err.message });
        throw err;
      }
    }

    if (req.method === 'DELETE') {
      try {
        await deleteChild(auth.userId, id);
        return json(res, 200, { ok: true });
      } catch (err) {
        if (err instanceof HttpError) return json(res, err.status, { error: err.message });
        throw err;
      }
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('[eerste-hapjes/children/[id]]', err);
    return json(res, err.status || 500, { error: err.message || 'Er ging iets mis.' });
  }
}
