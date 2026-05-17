// GET   /api/eerste-hapjes/state?child_id=<uuid>
//        → laad de state-rij voor een kindje (creëert default-rij als nog niet bestaat)
// PATCH /api/eerste-hapjes/state
//        body: { child_id, ...partial fields }
//        → updaten van readiness_check / current_phase / dietary / allergen_state / etc.

import { requireAuth, AuthError } from '../_lib/auth.mjs';
import {
  loadState,
  patchState,
  sanitizeStatePatch,
  HttpError,
} from '../_lib/eersteHapjes-state.mjs';

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
  return typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
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
      const state = await loadState(auth.userId, childId);
      return json(res, 200, { state });
    }

    if (req.method === 'PATCH') {
      const body = parseBody(req);
      if (body === null) return json(res, 400, { error: 'Ongeldige JSON.' });
      const childId = body.child_id;
      if (!childId || !isUuid(childId)) {
        return json(res, 400, { error: 'child_id is verplicht.' });
      }
      const patch = sanitizeStatePatch(body);
      if (Object.keys(patch).length === 0) {
        return json(res, 400, { error: 'Geen geldige velden om te patchen.' });
      }
      const state = await patchState(auth.userId, childId, patch);
      return json(res, 200, { state });
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    if (err instanceof HttpError) return json(res, err.status, { error: err.message });
    console.error('[eerste-hapjes/state]', err);
    return json(res, 500, { error: err.message || 'Er ging iets mis.' });
  }
}
