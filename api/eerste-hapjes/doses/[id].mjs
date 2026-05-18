// PATCH  /api/eerste-hapjes/doses/<id>  → wijzig 1 dose (intro_date / notes / reaction)
// DELETE /api/eerste-hapjes/doses/<id>  → verwijder 1 dose
// Service-role + expliciete eq('user_id') als ownership-check.

import { requireAuth, AuthError } from '../../_lib/auth.mjs';
import {
  deleteDose,
  updateDose,
  sanitizeDosePatch,
  HttpError,
} from '../../_lib/eersteHapjes-state.mjs';

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
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, DELETE, OPTIONS');
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
    const id = req.query?.id || (req.url.split('/').pop() || '').split('?')[0];

    if (req.method === 'PATCH') {
      const body = parseBody(req);
      if (body === null) return json(res, 400, { error: 'Ongeldige JSON.' });
      const patch = sanitizeDosePatch(body);
      const dose = await updateDose(auth.userId, id, patch);
      return json(res, 200, { dose });
    }

    if (req.method === 'DELETE') {
      const result = await deleteDose(auth.userId, id);
      return json(res, 200, result);
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    if (err instanceof HttpError) return json(res, err.status, { error: err.message });
    console.error('[eerste-hapjes/doses/[id]]', err);
    return json(res, 500, { error: err.message || 'Er ging iets mis.' });
  }
}
