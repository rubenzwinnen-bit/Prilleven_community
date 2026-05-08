// GET   /api/eerste-hapjes/allergens?child_id=...   → allergenen-lijst
// POST  /api/eerste-hapjes/allergens                → upsert per (child, allergen)
//
// Eerste Hapjes Traject — brok D.

import { requireAuth, AuthError } from '../_lib/auth.mjs';
import {
  loadAllergensForChild,
  sanitizeAllergenInput,
  upsertAllergen,
  HttpError,
} from '../_lib/eersteHapjes-allergens.mjs';

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  let auth;
  try {
    auth = await requireAuth(req);
  } catch (e) {
    if (e instanceof AuthError) return json(res, e.status, { error: e.message });
    throw e;
  }

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, `http://${req.headers.host || 'x'}`);
      const childId = url.searchParams.get('child_id');
      if (!childId || !isUuid(childId)) {
        return json(res, 400, { error: 'child_id is verplicht.' });
      }
      try {
        const allergens = await loadAllergensForChild(auth.userId, childId);
        return json(res, 200, { allergens });
      } catch (err) {
        if (err instanceof HttpError) return json(res, err.status, { error: err.message });
        throw err;
      }
    }

    if (req.method === 'POST') {
      const body = parseBody(req);
      if (body === null) return json(res, 400, { error: 'Ongeldige JSON.' });
      let clean;
      try {
        clean = sanitizeAllergenInput(body);
      } catch (err) {
        if (err instanceof HttpError) return json(res, err.status, { error: err.message });
        throw err;
      }
      try {
        const allergen = await upsertAllergen(auth.userId, clean);
        return json(res, 200, { allergen });
      } catch (err) {
        if (err instanceof HttpError) return json(res, err.status, { error: err.message });
        throw err;
      }
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('[eerste-hapjes/allergens]', err);
    return json(res, err.status || 500, { error: err.message || 'Er ging iets mis.' });
  }
}
