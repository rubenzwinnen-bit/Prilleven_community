// GET /api/profile → profiel of null
// PUT /api/profile → upsert (body = sanitized input)

import { requireAuth, AuthError } from './_lib/auth.mjs';
import {
  loadUserProfile,
  sanitizeProfileInput,
  upsertUserProfile,
} from './_lib/profile.mjs';
import { getMonthlyUsage } from './_lib/rate-limit.mjs';

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
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
      const [profile, usage] = await Promise.all([
        loadUserProfile(auth.userId),
        getMonthlyUsage({ userId: auth.userId }),
      ]);
      return json(res, 200, { profile, usage });
    }
    if (req.method === 'PUT') {
      let body;
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      } catch {
        return json(res, 400, { error: 'Ongeldige JSON.' });
      }
      const clean = sanitizeProfileInput(body);
      const saved = await upsertUserProfile(auth.userId, clean);
      return json(res, 200, { profile: saved });
    }
    return json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('[profile]', err);
    return json(res, 500, { error: err.message || 'Er ging iets mis.' });
  }
}
