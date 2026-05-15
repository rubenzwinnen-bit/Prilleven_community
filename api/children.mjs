// GET    /api/children         → lijst van eigen kinderen (niet gearchiveerd)
// POST   /api/children         → kind aanmaken
// PATCH  /api/children         → kind bijwerken (body: { id, ...velden })
// DELETE /api/children         → kind archiveren (body: { id })

import { requireAuth, AuthError } from './_lib/auth.mjs';
import { supabase } from './_lib/clients.mjs';

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

const VALID_TEXTURE = new Set(['puree', 'stukjes', 'combi']);

function sanitizeChild(input) {
  const out = {};

  if (typeof input?.name === 'string') {
    const name = input.name.trim().slice(0, 50);
    if (name) out.name = name;
  }
  if (typeof input?.birthdate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.birthdate)) {
    out.birthdate = input.birthdate;
  }
  if (VALID_TEXTURE.has(input?.texture_preference)) {
    out.texture_preference = input.texture_preference;
  } else if (input?.texture_preference === null || input?.texture_preference === '') {
    out.texture_preference = null;
  }
  if (typeof input?.has_eczema === 'boolean') {
    out.has_eczema = input.has_eczema;
  }
  if (Array.isArray(input?.known_allergies)) {
    out.known_allergies = input.known_allergies
      .map(a => (typeof a === 'string' ? a.trim().toLowerCase().slice(0, 50) : ''))
      .filter(Boolean)
      .slice(0, 30);
  }
  if (typeof input?.previous_reactions === 'string') {
    out.previous_reactions = input.previous_reactions.trim().slice(0, 1000) || null;
  }
  if (typeof input?.notes === 'string') {
    out.notes = input.notes.trim().slice(0, 500) || null;
  }

  return out;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  let auth;
  try {
    auth = await requireAuth(req);
  } catch (e) {
    if (e instanceof AuthError) return json(res, e.status, { error: e.message });
    throw e;
  }

  const userId = auth.userId;

  try {
    /* ----------------------------------------
       GET — lijst kinderen
    ---------------------------------------- */
    if (req.method === 'GET') {
      const { data: children, error: childErr } = await supabase
        .from('children')
        .select('*')
        .eq('user_id', userId)
        .is('archived_at', null)
        .order('created_at', { ascending: true });

      if (childErr) throw new Error(childErr.message);

      // Samenvatting geïntroduceerde allergenen per kind (uit HapjesHeld)
      let introMap = {};
      if (children && children.length > 0) {
        const childIds = children.map(c => c.id);
        const { data: doses } = await supabase
          .from('eerste_hapjes_allergen_doses')
          .select('child_id, allergen_key')
          .in('child_id', childIds);
        if (doses) {
          for (const dose of doses) {
            if (!introMap[dose.child_id]) introMap[dose.child_id] = new Set();
            introMap[dose.child_id].add(dose.allergen_key);
          }
        }
      }

      const result = (children || []).map(c => ({
        ...c,
        introduced_allergens: introMap[c.id] ? [...introMap[c.id]].sort() : [],
      }));

      return json(res, 200, { children: result });
    }

    /* ----------------------------------------
       POST — kind aanmaken
    ---------------------------------------- */
    if (req.method === 'POST') {
      let body;
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      } catch {
        return json(res, 400, { error: 'Ongeldige JSON.' });
      }

      const child = sanitizeChild(body);
      if (!child.name) return json(res, 400, { error: 'Naam is verplicht.' });
      if (!child.birthdate) return json(res, 400, { error: 'Geboortedatum is verplicht.' });

      const { data, error } = await supabase
        .from('children')
        .insert({ user_id: userId, ...child })
        .select('*')
        .single();

      if (error) throw new Error(error.message);
      return json(res, 201, { child: { ...data, introduced_allergens: [] } });
    }

    /* ----------------------------------------
       PATCH — kind bijwerken
    ---------------------------------------- */
    if (req.method === 'PATCH') {
      let body;
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      } catch {
        return json(res, 400, { error: 'Ongeldige JSON.' });
      }

      const { id, ...rest } = body;
      if (!id) return json(res, 400, { error: 'id is verplicht.' });

      const updates = sanitizeChild(rest);
      if (Object.keys(updates).length === 0) {
        return json(res, 400, { error: 'Geen velden om bij te werken.' });
      }

      const { data, error } = await supabase
        .from('children')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', userId)
        .is('archived_at', null)
        .select('*')
        .single();

      if (error) throw new Error(error.message);
      if (!data) return json(res, 404, { error: 'Kind niet gevonden.' });
      return json(res, 200, { child: data });
    }

    /* ----------------------------------------
       DELETE — kind archiveren (soft delete)
    ---------------------------------------- */
    if (req.method === 'DELETE') {
      let body;
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      } catch {
        return json(res, 400, { error: 'Ongeldige JSON.' });
      }

      const { id } = body;
      if (!id) return json(res, 400, { error: 'id is verplicht.' });

      const { error } = await supabase
        .from('children')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', userId)
        .is('archived_at', null);

      if (error) throw new Error(error.message);
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: 'Method not allowed.' });
  } catch (err) {
    console.error('[children]', err);
    return json(res, 500, { error: err.message || 'Er ging iets mis.' });
  }
}
