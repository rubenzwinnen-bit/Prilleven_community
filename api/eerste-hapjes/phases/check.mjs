// POST /api/eerste-hapjes/phases/check
// body: { child_id, phase_number, check_key, checked }
//
// Eerste Hapjes Traject — brok F.3.

import { requireAuth, AuthError } from '../../_lib/auth.mjs';
import {
  togglePhaseCheck,
  sanitizeCheckInput,
  HttpError,
} from '../../_lib/eersteHapjes-phases.mjs';

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
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
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

    const body = parseBody(req);
    if (body === null) return json(res, 400, { error: 'Ongeldige JSON.' });

    let clean;
    try {
      clean = sanitizeCheckInput(body);
    } catch (err) {
      if (err instanceof HttpError) return json(res, err.status, { error: err.message });
      throw err;
    }

    await togglePhaseCheck(auth.userId, clean);
    return json(res, 200, { ok: true });
  } catch (err) {
    if (err instanceof HttpError) return json(res, err.status, { error: err.message });
    console.error('[eerste-hapjes/phases/check]', err);
    return json(res, 500, { error: err.message || 'Er ging iets mis.' });
  }
}
