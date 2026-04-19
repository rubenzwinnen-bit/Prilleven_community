// GET /api/admin/global-stats
// Returnt aggregaat-cijfers voor het admin dashboard.

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
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now);
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    // Actieve users (subscription_active=true)
    const { count: activeUsers } = await supabase
      .from('allowed_users')
      .select('*', { count: 'exact', head: true })
      .eq('subscription_active', true);

    // Totaal users in DB
    const { count: totalUsers } = await supabase
      .from('allowed_users')
      .select('*', { count: 'exact', head: true });

    // Queries vandaag
    const { count: queriesToday } = await supabase
      .from('usage_log')
      .select('*', { count: 'exact', head: true })
      .eq('event', 'query')
      .gte('created_at', todayStart.toISOString());

    // Queries deze maand
    const { count: queriesMonth } = await supabase
      .from('usage_log')
      .select('*', { count: 'exact', head: true })
      .eq('event', 'query')
      .gte('created_at', monthStart.toISOString());

    // Cache-hits vandaag
    const { count: cacheHitsToday } = await supabase
      .from('usage_log')
      .select('*', { count: 'exact', head: true })
      .eq('event', 'cache_hit')
      .gte('created_at', todayStart.toISOString());

    // Kosten vandaag + deze maand (aggregatie via JS want Supabase sum is RPC-only)
    const { data: costsToday } = await supabase
      .from('usage_log')
      .select('cost_cents, tokens_in, tokens_out')
      .gte('created_at', todayStart.toISOString());
    const costCentsToday = (costsToday || []).reduce((s, r) => s + Number(r.cost_cents || 0), 0);
    const tokensInToday = (costsToday || []).reduce((s, r) => s + Number(r.tokens_in || 0), 0);
    const tokensOutToday = (costsToday || []).reduce((s, r) => s + Number(r.tokens_out || 0), 0);

    const { data: costsMonth } = await supabase
      .from('usage_log')
      .select('cost_cents')
      .gte('created_at', monthStart.toISOString());
    const costCentsMonth = (costsMonth || []).reduce((s, r) => s + Number(r.cost_cents || 0), 0);

    // Rate-limit hits vandaag
    const { count: rateLimitHits } = await supabase
      .from('usage_log')
      .select('*', { count: 'exact', head: true })
      .eq('event', 'blocked_rate_limit')
      .gte('created_at', todayStart.toISOString());

    // Cache hit rate
    const totalQueries = (queriesToday || 0) + (cacheHitsToday || 0);
    const cacheHitRate = totalQueries > 0 ? (cacheHitsToday || 0) / totalQueries : 0;

    return json(res, 200, {
      users: {
        active: activeUsers || 0,
        total: totalUsers || 0,
      },
      today: {
        queries: queriesToday || 0,
        cache_hits: cacheHitsToday || 0,
        cache_hit_rate: cacheHitRate,
        cost_cents: costCentsToday,
        tokens_in: tokensInToday,
        tokens_out: tokensOutToday,
        rate_limit_hits: rateLimitHits || 0,
      },
      month: {
        queries: queriesMonth || 0,
        cost_cents: costCentsMonth,
      },
    });
  } catch (err) {
    console.error('[admin/global-stats]', err);
    return json(res, 500, { error: err.message || 'Er ging iets mis.' });
  }
}
