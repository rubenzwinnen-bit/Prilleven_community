// GET /api/profile → { memory_enabled, usage, imageUsage }
// PUT /api/profile → body: { memory_enabled: boolean }
//
// Sinds de profiel-opschoning beheert dit endpoint alleen nog de
// memory-toggle van de RAG-bot. Kind- en dieet-data zitten in /api/children
// en /api/family.

import { requireAuth, AuthError } from './_lib/auth.mjs';
import { loadUserProfile, setMemoryEnabled } from './_lib/profile.mjs';
import { getMonthlyUsage, getDailyImageUsage } from './_lib/rate-limit.mjs';

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
      const [profile, usage, imageUsage] = await Promise.all([
        loadUserProfile(auth.userId),
        getMonthlyUsage({ userId: auth.userId }),
        getDailyImageUsage({ userId: auth.userId }),
      ]);
      return json(res, 200, {
        profile: { memory_enabled: profile.memory_enabled },
        usage,
        imageUsage,
      });
    }
    if (req.method === 'PUT') {
      let body;
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      } catch {
        return json(res, 400, { error: 'Ongeldige JSON.' });
      }
      if (typeof body?.memory_enabled !== 'boolean') {
        return json(res, 400, { error: 'memory_enabled (boolean) is verplicht.' });
      }
      const saved = await setMemoryEnabled(auth.userId, body.memory_enabled);
      return json(res, 200, { profile: { memory_enabled: saved.memory_enabled } });
    }
    return json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('[profile]', err);
    return json(res, 500, { error: err.message || 'Er ging iets mis.' });
  }
}
