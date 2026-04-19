// GET /api/admin/subscription-events?limit=100
// Tijdlijn van subscription-events uit de audit-log.

import { requireAdmin, AuthError } from '../_lib/auth.mjs';
import { supabase } from '../_lib/clients.mjs';

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof AuthError) return json(res, e.status, { error: e.message });
    throw e;
  }

  try {
    const url = new URL(req.url, 'http://x');
    const limit = Math.min(500, parseInt(url.searchParams.get('limit') || '100', 10));
    const emailFilter = url.searchParams.get('email');

    let q = supabase
      .from('subscription_events')
      .select('id, email, event_type, category, cycle, applied, error, received_at')
      .order('received_at', { ascending: false })
      .limit(limit);
    if (emailFilter) q = q.ilike('email', emailFilter);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return json(res, 200, { events: data || [] });
  } catch (err) {
    console.error('[admin/subscription-events]', err);
    return json(res, 500, { error: err.message || 'Er ging iets mis.' });
  }
}
