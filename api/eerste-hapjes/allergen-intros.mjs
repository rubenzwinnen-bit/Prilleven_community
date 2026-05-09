// GET   /api/eerste-hapjes/allergen-intros?child_id=...&allergen_key=...
//        → intro-logs voor een kindje (optioneel gefilterd op allergeen)
// POST  /api/eerste-hapjes/allergen-intros
//        → nieuwe intro-poging vastleggen
//
// Eerste Hapjes Traject — brok H.2.

import { requireAuth, AuthError } from '../_lib/auth.mjs';
import {
  loadIntroLogsForChild,
  sanitizeIntroLogInput,
  createIntroLog,
  HttpError,
} from '../_lib/eersteHapjes-allergen-intros.mjs';

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
      const allergenKey = url.searchParams.get('allergen_key');
      try {
        const intros = await loadIntroLogsForChild(auth.userId, childId, {
          allergenKey: allergenKey || undefined,
        });
        return json(res, 200, { intros });
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
        clean = sanitizeIntroLogInput(body);
      } catch (err) {
        if (err instanceof HttpError) return json(res, err.status, { error: err.message });
        throw err;
      }
      try {
        const intro = await createIntroLog(auth.userId, clean);
        return json(res, 200, { intro });
      } catch (err) {
        if (err instanceof HttpError) return json(res, err.status, { error: err.message });
        throw err;
      }
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('[eerste-hapjes/allergen-intros]', err);
    return json(res, err.status || 500, { error: err.message || 'Er ging iets mis.' });
  }
}
