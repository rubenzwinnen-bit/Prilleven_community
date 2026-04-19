// GET /api/admin/users-stats
// Per-user aggregaat over de laatste 30 dagen.

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
    // Alle users uit allowed_users (betaal-lijst)
    const { data: users, error: uErr } = await supabase
      .from('allowed_users')
      .select('email, has_registered, subscription_active, subscription_end_date, cancelled_at, is_admin');
    if (uErr) throw new Error(uErr.message);

    // Link email → auth.users.id via een RPC of handmatig query
    // We doen het via auth.users selectie: alleen admins met service role kunnen dit
    const { data: authUsers, error: aErr } = await supabase.auth.admin.listUsers();
    if (aErr) console.warn('[admin/users-stats] auth.listUsers error:', aErr.message);
    const emailToId = new Map();
    for (const u of (authUsers?.users || [])) {
      if (u.email) emailToId.set(u.email.toLowerCase(), u.id);
    }

    // Usage-log van laatste 30 dagen, gegroepeerd per user_id
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: usage, error: usErr } = await supabase
      .from('usage_log')
      .select('user_id, event, tokens_in, tokens_out, cost_cents, created_at')
      .gte('created_at', since);
    if (usErr) throw new Error(usErr.message);

    // Aggregeer per user_id
    const perUser = new Map();
    for (const row of (usage || [])) {
      if (!row.user_id) continue;
      let agg = perUser.get(row.user_id);
      if (!agg) {
        agg = {
          queries: 0, cache_hits: 0, rate_limit_hits: 0,
          tokens_in: 0, tokens_out: 0, cost_cents: 0,
          last_activity: null,
        };
        perUser.set(row.user_id, agg);
      }
      if (row.event === 'query') agg.queries++;
      else if (row.event === 'cache_hit') agg.cache_hits++;
      else if (row.event === 'blocked_rate_limit') agg.rate_limit_hits++;
      agg.tokens_in += Number(row.tokens_in || 0);
      agg.tokens_out += Number(row.tokens_out || 0);
      agg.cost_cents += Number(row.cost_cents || 0);
      if (!agg.last_activity || row.created_at > agg.last_activity) {
        agg.last_activity = row.created_at;
      }
    }

    // Memory-count per user
    const { data: memCounts } = await supabase
      .from('chat_user_memory')
      .select('user_id');
    const memPerUser = new Map();
    for (const m of (memCounts || [])) {
      memPerUser.set(m.user_id, (memPerUser.get(m.user_id) || 0) + 1);
    }

    // Conversatie-count per user
    const { data: convCounts } = await supabase
      .from('conversations')
      .select('user_id');
    const convPerUser = new Map();
    for (const c of (convCounts || [])) {
      if (!c.user_id) continue;
      convPerUser.set(c.user_id, (convPerUser.get(c.user_id) || 0) + 1);
    }

    // Combineer
    const rows = (users || []).map(u => {
      const userId = emailToId.get((u.email || '').toLowerCase()) || null;
      const stats = userId ? (perUser.get(userId) || {}) : {};
      return {
        email: u.email,
        subscription_active: u.subscription_active,
        subscription_end_date: u.subscription_end_date,
        cancelled_at: u.cancelled_at,
        has_registered: u.has_registered,
        is_admin: u.is_admin,
        queries_30d: stats.queries || 0,
        cache_hits_30d: stats.cache_hits || 0,
        rate_limit_hits_30d: stats.rate_limit_hits || 0,
        tokens_in_30d: stats.tokens_in || 0,
        tokens_out_30d: stats.tokens_out || 0,
        cost_cents_30d: stats.cost_cents || 0,
        conversations: userId ? (convPerUser.get(userId) || 0) : 0,
        memories: userId ? (memPerUser.get(userId) || 0) : 0,
        last_activity: stats.last_activity || null,
      };
    });

    return json(res, 200, { users: rows });
  } catch (err) {
    console.error('[admin/users-stats]', err);
    return json(res, 500, { error: err.message || 'Er ging iets mis.' });
  }
}
