// GET   /api/eerste-hapjes/state?child_id=<uuid>[&include=doses,symptoms]
//        → laad de state-rij voor een kindje (creëert default-rij als nog niet bestaat)
//        → met `include` komen doses en/of symptomen in hetzelfde antwoord mee.
//          De mobiele app haalde die uit drie aparte functies, wat drie koude
//          starts kon betekenen: gemeten 3,8 s voor doses alleen. Nu één
//          functie, die daardoor ook vaker geraakt wordt en dus warm blijft.
// PATCH /api/eerste-hapjes/state
//        body: { child_id, ...partial fields }
//        → updaten van readiness_check / current_phase / dietary / allergen_state / etc.

import { requireAuth, AuthError } from '../_lib/auth.mjs';
import {
  loadState,
  loadDoses,
  patchState,
  sanitizeStatePatch,
  HttpError,
} from '../_lib/eersteHapjes-state.mjs';
import { loadSymptomsForChild } from '../_lib/eersteHapjes-logs.mjs';

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
      const include = new Set(
        (url.searchParams.get('include') || '')
          .split(',')
          .map(v => v.trim())
          .filter(Boolean)
      );

      /* Naast elkaar: de drie queries staan vlak bij de database, dus dit
         kost nauwelijks meer dan de state alleen. */
      const [state, doses, symptoms] = await Promise.all([
        loadState(auth.userId, childId),
        include.has('doses') ? loadDoses(auth.userId, childId) : null,
        include.has('symptoms')
          ? loadSymptomsForChild(auth.userId, childId, { limit: 200 })
          : null,
      ]);

      const payload = { state };
      if (include.has('doses')) payload.doses = doses || [];
      if (include.has('symptoms')) payload.symptoms = symptoms || [];
      return json(res, 200, payload);
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
