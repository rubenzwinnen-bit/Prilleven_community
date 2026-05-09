// GET   /api/eerste-hapjes/symptoms?child_id=...&from=...&to=...   → symptomen
// POST  /api/eerste-hapjes/symptoms                                → nieuw symptoom
//
// Eerste Hapjes Traject — brok C.

import { requireAuth, AuthError } from '../_lib/auth.mjs';
import {
  loadSymptomsForChild,
  sanitizeSymptomInput,
  createSymptom,
  detectRedFlag,
  HttpError,
} from '../_lib/eersteHapjes-logs.mjs';

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
      const from = url.searchParams.get('from') || undefined;
      const to   = url.searchParams.get('to')   || undefined;
      try {
        const symptoms = await loadSymptomsForChild(auth.userId, childId, { from, to });
        return json(res, 200, { symptoms });
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
        clean = sanitizeSymptomInput(body);
      } catch (err) {
        if (err instanceof HttpError) return json(res, err.status, { error: err.message });
        throw err;
      }
      try {
        const symptom = await createSymptom(auth.userId, clean);
        const red_flag = detectRedFlag(symptom.symptom_type, symptom.severity);
        return json(res, 201, { symptom, red_flag });
      } catch (err) {
        if (err instanceof HttpError) return json(res, err.status, { error: err.message });
        throw err;
      }
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('[eerste-hapjes/symptoms]', err);
    return json(res, err.status || 500, { error: err.message || 'Er ging iets mis.' });
  }
}
