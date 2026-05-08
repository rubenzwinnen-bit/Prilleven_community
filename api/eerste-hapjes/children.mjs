// GET   /api/eerste-hapjes/children                 → eigen kindjes
// POST  /api/eerste-hapjes/children                 → nieuw kindje
//
// Eerste Hapjes Traject — brok B.1.

import { requireAuth, AuthError } from '../_lib/auth.mjs';
import {
  loadMyChildren,
  sanitizeChildInput,
  createChild,
  HttpError,
} from '../_lib/children.mjs';

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
      const includeArchived = url.searchParams.get('include_archived') === '1';
      const children = await loadMyChildren(auth.userId, { includeArchived });
      return json(res, 200, { children });
    }

    if (req.method === 'POST') {
      const body = parseBody(req);
      if (body === null) return json(res, 400, { error: 'Ongeldige JSON.' });
      let clean;
      try {
        clean = sanitizeChildInput(body);
      } catch (err) {
        if (err instanceof HttpError) return json(res, err.status, { error: err.message });
        throw err;
      }
      const child = await createChild(auth.userId, clean);
      return json(res, 201, { child });
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('[eerste-hapjes/children]', err);
    return json(res, err.status || 500, { error: err.message || 'Er ging iets mis.' });
  }
}
