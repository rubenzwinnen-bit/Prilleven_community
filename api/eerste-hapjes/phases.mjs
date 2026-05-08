// GET /api/eerste-hapjes/phases?child_id=...   → fase-state
//
// Eerste Hapjes Traject — brok F.3.

import { requireAuth, AuthError } from '../_lib/auth.mjs';
import { loadPhaseState, HttpError } from '../_lib/eersteHapjes-phases.mjs';

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
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
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

    const url = new URL(req.url, `http://${req.headers.host || 'x'}`);
    const childId = url.searchParams.get('child_id');
    if (!childId) return json(res, 422, { error: 'child_id is verplicht.' });

    const state = await loadPhaseState(auth.userId, childId);
    return json(res, 200, state);
  } catch (err) {
    if (err instanceof HttpError) return json(res, err.status, { error: err.message });
    console.error('[eerste-hapjes/phases]', err);
    return json(res, 500, { error: err.message || 'Er ging iets mis.' });
  }
}
