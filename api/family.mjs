// GET /api/family → { family_diet: string[] }
// PUT /api/family → upsert community_profiles.family_diet
//
// Vereist een bestaand community_profile (nickname). Zonder profiel: 409 met
// duidelijke melding, gebruiker stelt eerst de nickname in via de bestaande
// "Nickname & foto wijzigen"-flow.

import { requireAuth, AuthError } from './_lib/auth.mjs';
import { supabase } from './_lib/clients.mjs';

const ALLOWED_DIET = new Set([
  'vegetarisch', 'veganistisch', 'glutenvrij', 'lactosevrij',
  'pescotarisch', 'halal', 'kosher', 'geen-varken', 'geen-rund',
]);

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function sanitizeDiet(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(
    input
      .map(v => (typeof v === 'string' ? v.toLowerCase().trim() : ''))
      .filter(v => ALLOWED_DIET.has(v))
  )].slice(0, 9);
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
      const { data, error } = await supabase
        .from('community_profiles')
        .select('family_diet')
        .eq('user_id', auth.userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return json(res, 200, { family_diet: data?.family_diet || [] });
    }

    if (req.method === 'PUT') {
      let body;
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      } catch {
        return json(res, 400, { error: 'Ongeldige JSON.' });
      }
      const diet = sanitizeDiet(body?.family_diet);

      const { data, error } = await supabase
        .from('community_profiles')
        .update({ family_diet: diet, updated_at: new Date().toISOString() })
        .eq('user_id', auth.userId)
        .select('family_diet')
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) {
        return json(res, 409, {
          error: 'Stel eerst je community-profiel in (nickname & foto wijzigen).',
        });
      }
      return json(res, 200, { family_diet: data.family_diet || [] });
    }

    return json(res, 405, { error: 'Method not allowed.' });
  } catch (err) {
    console.error('[family]', err);
    return json(res, 500, { error: err.message || 'Er ging iets mis.' });
  }
}
