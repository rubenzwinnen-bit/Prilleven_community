// DELETE /api/eerste-hapjes/allergen-intros/[id]   → intro-log verwijderen
//
// Eerste Hapjes Traject — brok H.2.

import { requireAuth, AuthError } from '../../_lib/auth.mjs';
import {
  deleteIntroLog,
  HttpError,
} from '../../_lib/eersteHapjes-allergen-intros.mjs';

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s));
}

function readId(req) {
  if (req.query && req.query.id) return req.query.id;
  try {
    const u = new URL(req.url, `http://${req.headers.host || 'x'}`);
    const parts = u.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  let auth;
  try {
    auth = await requireAuth(req);
  } catch (e) {
    if (e instanceof AuthError) return json(res, e.status, { error: e.message });
    throw e;
  }

  const id = readId(req);
  if (!id || !isUuid(id)) {
    return json(res, 400, { error: 'Ongeldig id.' });
  }

  try {
    if (req.method === 'DELETE') {
      try {
        await deleteIntroLog(auth.userId, id);
        return json(res, 200, { ok: true });
      } catch (err) {
        if (err instanceof HttpError) return json(res, err.status, { error: err.message });
        throw err;
      }
    }
    return json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('[eerste-hapjes/allergen-intros/[id]]', err);
    return json(res, err.status || 500, { error: err.message || 'Er ging iets mis.' });
  }
}
