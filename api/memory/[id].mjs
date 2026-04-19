// DELETE /api/memory/[id] → verwijder één memory-entry

import { requireAuth, AuthError } from '../_lib/auth.mjs';
import { supabase } from '../_lib/clients.mjs';

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  const id = req.query?.id ||
    (req.url ? new URL(req.url, 'http://x').pathname.split('/').filter(Boolean).pop() : null);
  if (!id) return json(res, 400, { error: 'Missing memory id.' });

  let auth;
  try {
    auth = await requireAuth(req);
  } catch (e) {
    if (e instanceof AuthError) return json(res, e.status, { error: e.message });
    throw e;
  }

  try {
    if (req.method !== 'DELETE') {
      return json(res, 405, { error: 'Method not allowed' });
    }
    // Ownership check + delete in één query
    const { data, error } = await supabase
      .from('chat_user_memory')
      .delete()
      .eq('id', id)
      .eq('user_id', auth.userId)
      .select('id')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return json(res, 404, { error: 'Niet gevonden.' });
    return json(res, 204, {});
  } catch (err) {
    console.error('[memory/[id]]', err);
    return json(res, 500, { error: err.message || 'Er ging iets mis.' });
  }
}
