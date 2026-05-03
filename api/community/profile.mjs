// GET /api/community/profile  → { profile } of { profile: null }
// PUT /api/community/profile  → { nickname } in body, returnt { profile }
//
// Voor de community feed. Los van /api/profile (dat blijft chat-profiel).

import { requireAuth, AuthError } from '../_lib/auth.mjs';
import {
  loadCommunityProfile,
  validateNickname,
  isNicknameReserved,
  isNicknameTaken,
  upsertCommunityProfile,
} from '../_lib/community.mjs';

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
      const profile = await loadCommunityProfile(auth.userId);
      return json(res, 200, { profile });
    }

    if (req.method === 'PUT') {
      let body;
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      } catch {
        return json(res, 400, { error: 'Ongeldige JSON.' });
      }

      const validation = validateNickname(body.nickname);
      if (!validation.ok) {
        return json(res, 422, { error: validation.error });
      }
      const nickname = validation.value;

      if (await isNicknameReserved(nickname)) {
        return json(res, 409, { error: 'Deze nickname is gereserveerd. Kies een andere.' });
      }

      if (await isNicknameTaken(nickname, auth.userId)) {
        return json(res, 409, { error: 'Deze nickname is al in gebruik.' });
      }

      try {
        const profile = await upsertCommunityProfile(auth.userId, nickname);
        return json(res, 200, { profile });
      } catch (err) {
        if (err.status === 409) return json(res, 409, { error: err.message });
        throw err;
      }
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('[community/profile]', err);
    return json(res, 500, { error: err.message || 'Er ging iets mis.' });
  }
}
