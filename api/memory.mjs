// GET    /api/memory        → lijst van alle memories van de user
// DELETE /api/memory         → verwijder alle memories van deze user

import { requireAuth, AuthError } from './_lib/auth.mjs';
import { supabase } from './_lib/clients.mjs';

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
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
        .from('chat_user_memory')
        .select('id, content, importance, created_at, last_used_at')
        .eq('user_id', auth.userId)
        .order('importance', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return json(res, 200, { memories: data || [] });
    }

    if (req.method === 'DELETE') {
      const { error } = await supabase
        .from('chat_user_memory')
        .delete()
        .eq('user_id', auth.userId);
      if (error) throw new Error(error.message);
      return json(res, 204, {});
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('[memory]', err);
    return json(res, 500, { error: err.message || 'Er ging iets mis.' });
  }
}
