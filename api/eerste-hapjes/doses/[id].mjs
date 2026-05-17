// DELETE /api/eerste-hapjes/doses/<id>
//   → verwijder één dose. Service-role + expliciete eq('user_id') als ownership-check.

import { requireAuth, AuthError } from '../../_lib/auth.mjs';
import { deleteDose, HttpError } from '../../_lib/eersteHapjes-state.mjs';

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = status;
  res.end(JSON.stringify(body));
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

  if (req.method !== 'DELETE') return json(res, 405, { error: 'Method not allowed' });

  try {
    const id = req.query?.id || (req.url.split('/').pop() || '').split('?')[0];
    const result = await deleteDose(auth.userId, id);
    return json(res, 200, result);
  } catch (err) {
    if (err instanceof HttpError) return json(res, err.status, { error: err.message });
    console.error('[eerste-hapjes/doses/[id]]', err);
    return json(res, 500, { error: err.message || 'Er ging iets mis.' });
  }
}
