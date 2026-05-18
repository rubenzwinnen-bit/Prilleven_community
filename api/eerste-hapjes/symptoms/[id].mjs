// PATCH  /api/eerste-hapjes/symptoms/[id]   → wijzigen
// DELETE /api/eerste-hapjes/symptoms/[id]   → verwijderen

import { requireAuth, AuthError } from '../../_lib/auth.mjs';
import {
  sanitizeSymptomPatch,
  updateSymptom,
  deleteSymptom,
  HttpError,
} from '../../_lib/eersteHapjes-logs.mjs';

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
      const updates = sanitizeSymptomPatch(body);
      const symptom = await updateSymptom(auth.userId, id, updates);
      return json(res, 200, { symptom });
    }

    if (req.method === 'DELETE') {
      await deleteSymptom(auth.userId, id);
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    if (err instanceof HttpError) return json(res, err.status, { error: err.message });
    console.error('[eerste-hapjes/symptoms/[id]]', err);
    return json(res, 500, { error: err.message || 'Er ging iets mis.' });
  }
}
