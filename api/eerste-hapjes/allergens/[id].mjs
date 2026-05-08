// PATCH  /api/eerste-hapjes/allergens/[id]   → wijzigen
// DELETE /api/eerste-hapjes/allergens/[id]   → verwijderen
//
// Eerste Hapjes Traject — brok D.

import { requireAuth, AuthError } from '../../_lib/auth.mjs';
import {
  sanitizeAllergenPatch,
  updateAllergen,
  deleteAllergen,
  HttpError,
} from '../../_lib/eersteHapjes-allergens.mjs';

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
      let updates;
      try {
        updates = sanitizeAllergenPatch(body);
      } catch (err) {
        if (err instanceof HttpError) return json(res, err.status, { error: err.message });
        throw err;
      }
      try {
        const allergen = await updateAllergen(auth.userId, id, updates);
        return json(res, 200, { allergen });
      } catch (err) {
        if (err instanceof HttpError) return json(res, err.status, { error: err.message });
        throw err;
      }
    }

    if (req.method === 'DELETE') {
      try {
        await deleteAllergen(auth.userId, id);
        return json(res, 200, { ok: true });
      } catch (err) {
        if (err instanceof HttpError) return json(res, err.status, { error: err.message });
        throw err;
      }
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('[eerste-hapjes/allergens/[id]]', err);
    return json(res, err.status || 500, { error: err.message || 'Er ging iets mis.' });
  }
}
