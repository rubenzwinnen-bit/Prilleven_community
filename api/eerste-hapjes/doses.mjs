// GET    /api/eerste-hapjes/doses?child_id=<uuid>[&allergen_key=<key>]
//          → alle doses voor een kindje (optioneel gefilterd op allergeen)
// POST   /api/eerste-hapjes/doses
//          body: { child_id, allergen_key, dose_number (1-3), reaction (geen/mild/ernstig),
//                  intro_date?, notes?, meal_log_id?, linked_symptom_id? }
//          → registreer nieuwe dose. UNIQUE (child, allergen, dose_number) → 409 als dubbel.
// DELETE /api/eerste-hapjes/doses/[id]  (zie doses/[id].mjs)

import { requireAuth, AuthError } from '../_lib/auth.mjs';
import {
  loadDoses,
  createDose,
  sanitizeDoseInput,
  HttpError,
} from '../_lib/eersteHapjes-state.mjs';

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
      const allergenKey = url.searchParams.get('allergen_key') || undefined;
      const doses = await loadDoses(auth.userId, childId, { allergenKey });
      return json(res, 200, { doses });
    }

    if (req.method === 'POST') {
      const body = parseBody(req);
      if (body === null) return json(res, 400, { error: 'Ongeldige JSON.' });
      const clean = sanitizeDoseInput(body);
      const dose = await createDose(auth.userId, clean);
      return json(res, 200, { dose });
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    if (err instanceof HttpError) return json(res, err.status, { error: err.message });
    console.error('[eerste-hapjes/doses]', err);
    return json(res, 500, { error: err.message || 'Er ging iets mis.' });
  }
}
