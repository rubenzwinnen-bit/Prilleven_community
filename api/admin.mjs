// Admin dashboard endpoints — samengevoegd in 1 file om onder Vercel Hobby
// function-limit te blijven. Dispatches op ?section=... query param.
//
//   GET /api/admin?section=global            → globale statistieken
//   GET /api/admin?section=users             → per-user aggregaat (30 dagen)
//   GET /api/admin?section=queries&limit=50  → recente vragen
//   GET /api/admin?section=events&limit=100&email=X → subscription-events
//   GET /api/admin?section=conversations&email=X    → alle conversaties+berichten per user
//   GET /api/admin?section=chunks&ids=a,b,c          → document-details voor deze chunk-ids
//   GET /api/admin?section=fallbacks&limit=50        → enkel fallback / onbeantwoorde vragen

import { requireAdmin, AuthError } from './_lib/auth.mjs';
import { supabase } from './_lib/clients.mjs';

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
    const section = (url.searchParams.get('section') || 'global').toLowerCase();

    if (section === 'global') return json(res, 200, await getGlobalStats());
    if (section === 'users') return json(res, 200, await getUsersStats());
    if (section === 'queries') {
      const limit = Math.min(200, parseInt(url.searchParams.get('limit') || '50', 10));
      return json(res, 200, await getRecentQueries(limit));
    }
    if (section === 'events') {
      const limit = Math.min(500, parseInt(url.searchParams.get('limit') || '100', 10));
      const emailFilter = url.searchParams.get('email');
      return json(res, 200, await getSubscriptionEvents(limit, emailFilter));
    }
    if (section === 'conversations') {
      const email = url.searchParams.get('email');
      if (!email) return json(res, 400, { error: 'email query-param verplicht' });
      return json(res, 200, await getUserConversations(email));
    }
    if (section === 'chunks') {
      const ids = (url.searchParams.get('ids') || '').split(',').map(s => s.trim()).filter(Boolean);
      return json(res, 200, await getChunksByIds(ids));
    }
    if (section === 'fallbacks') {
      const limit = Math.min(200, parseInt(url.searchParams.get('limit') || '50', 10));
      return json(res, 200, await getFallbackQueries(limit));
    }
    return json(res, 400, { error: 'Unknown section. Use: global, users, queries, events, conversations, chunks, fallbacks.' });
  } catch (err) {
    console.error('[admin]', err);
    return json(res, 500, { error: err.message || 'Er ging iets mis.' });
  }
}

// ---------- Sections ----------

async function getGlobalStats() {
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  const { count: activeUsers } = await supabase
    .from('allowed_users').select('*', { count: 'exact', head: true })
    .eq('subscription_active', true);
  const { count: totalUsers } = await supabase
    .from('allowed_users').select('*', { count: 'exact', head: true });
  const { count: queriesToday } = await supabase
    .from('usage_log').select('*', { count: 'exact', head: true })
    .eq('event', 'query').gte('created_at', todayStart.toISOString());
  const { count: queriesMonth } = await supabase
    .from('usage_log').select('*', { count: 'exact', head: true })
    .eq('event', 'query').gte('created_at', monthStart.toISOString());
  const { count: cacheHitsToday } = await supabase
    .from('usage_log').select('*', { count: 'exact', head: true })
    .eq('event', 'cache_hit').gte('created_at', todayStart.toISOString());

  const { data: costsToday } = await supabase
    .from('usage_log').select('cost_cents, tokens_in, tokens_out')
    .gte('created_at', todayStart.toISOString());
  const costCentsToday = (costsToday || []).reduce((s, r) => s + Number(r.cost_cents || 0), 0);
  const tokensInToday = (costsToday || []).reduce((s, r) => s + Number(r.tokens_in || 0), 0);
  const tokensOutToday = (costsToday || []).reduce((s, r) => s + Number(r.tokens_out || 0), 0);

  const { data: costsMonth } = await supabase
    .from('usage_log').select('cost_cents').gte('created_at', monthStart.toISOString());
  const costCentsMonth = (costsMonth || []).reduce((s, r) => s + Number(r.cost_cents || 0), 0);

  const { count: rateLimitHits } = await supabase
    .from('usage_log').select('*', { count: 'exact', head: true })
    .eq('event', 'blocked_rate_limit').gte('created_at', todayStart.toISOString());

  const totalQueries = (queriesToday || 0) + (cacheHitsToday || 0);
  const cacheHitRate = totalQueries > 0 ? (cacheHitsToday || 0) / totalQueries : 0;

  return {
    users: { active: activeUsers || 0, total: totalUsers || 0 },
    today: {
      queries: queriesToday || 0,
      cache_hits: cacheHitsToday || 0,
      cache_hit_rate: cacheHitRate,
      cost_cents: costCentsToday,
      tokens_in: tokensInToday,
      tokens_out: tokensOutToday,
      rate_limit_hits: rateLimitHits || 0,
    },
    month: { queries: queriesMonth || 0, cost_cents: costCentsMonth },
  };
}

async function getUsersStats() {
  const { data: users, error: uErr } = await supabase
    .from('allowed_users')
    .select('email, has_registered, subscription_active, subscription_end_date, cancelled_at, is_admin');
  if (uErr) throw new Error(uErr.message);

  const { data: authUsers } = await supabase.auth.admin.listUsers();
  const emailToId = new Map();
  for (const u of (authUsers?.users || [])) {
    if (u.email) emailToId.set(u.email.toLowerCase(), u.id);
  }

  // Kalendermaand (sinds 1e) — zelfde venster als de cost-cap en de overview-tab.
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).toISOString();
  const { data: usage } = await supabase
    .from('usage_log').select('user_id, event, tokens_in, tokens_out, cost_cents, created_at')
    .gte('created_at', monthStart);

  const emptyAgg = () => ({
    queries: 0, cache_hits: 0, rate_limit_hits: 0,
    tokens_in: 0, tokens_out: 0, cost_cents: 0, last_activity: null,
  });
  const mergeRow = (agg, row) => {
    if (row.event === 'query' || row.event === 'query_with_image') agg.queries++;
    else if (row.event === 'cache_hit') agg.cache_hits++;
    else if (row.event === 'blocked_rate_limit') agg.rate_limit_hits++;
    agg.tokens_in += Number(row.tokens_in || 0);
    agg.tokens_out += Number(row.tokens_out || 0);
    agg.cost_cents += Number(row.cost_cents || 0);
    if (!agg.last_activity || row.created_at > agg.last_activity) {
      agg.last_activity = row.created_at;
    }
  };

  const perUser = new Map();
  const nullUserAgg = emptyAgg(); // usage_log rijen zonder user_id
  let nullUserCount = 0;
  for (const row of (usage || [])) {
    if (!row.user_id) {
      mergeRow(nullUserAgg, row);
      nullUserCount = 1; // markeren dat er iets is
      continue;
    }
    let agg = perUser.get(row.user_id);
    if (!agg) { agg = emptyAgg(); perUser.set(row.user_id, agg); }
    mergeRow(agg, row);
  }

  const { data: memCounts } = await supabase.from('chat_user_memory').select('user_id');
  const memPerUser = new Map();
  for (const m of (memCounts || [])) {
    memPerUser.set(m.user_id, (memPerUser.get(m.user_id) || 0) + 1);
  }

  const { data: convCounts } = await supabase.from('conversations').select('user_id');
  const convPerUser = new Map();
  for (const c of (convCounts || [])) {
    if (!c.user_id) continue;
    convPerUser.set(c.user_id, (convPerUser.get(c.user_id) || 0) + 1);
  }

  const mappedUserIds = new Set();
  const rows = (users || []).map(u => {
    const userId = emailToId.get((u.email || '').toLowerCase()) || null;
    if (userId) mappedUserIds.add(userId);
    const stats = userId ? (perUser.get(userId) || {}) : {};
    return {
      email: u.email,
      subscription_active: u.subscription_active,
      subscription_end_date: u.subscription_end_date,
      cancelled_at: u.cancelled_at,
      has_registered: u.has_registered,
      is_admin: u.is_admin,
      queries_month: stats.queries || 0,
      cache_hits_month: stats.cache_hits || 0,
      rate_limit_hits_month: stats.rate_limit_hits || 0,
      tokens_in_month: stats.tokens_in || 0,
      tokens_out_month: stats.tokens_out || 0,
      cost_cents_month: stats.cost_cents || 0,
      conversations: userId ? (convPerUser.get(userId) || 0) : 0,
      memories: userId ? (memPerUser.get(userId) || 0) : 0,
      last_activity: stats.last_activity || null,
    };
  });

  // "Onbekend / verwijderd" — alle usage van user_ids die niet in allowed_users staan
  // plus usage zonder user_id. Zo klopt het totaal met de overview-statistieken.
  const orphanAgg = emptyAgg();
  let orphanUserCount = 0;
  let orphanConversations = 0;
  let orphanMemories = 0;
  for (const [uid, agg] of perUser.entries()) {
    if (mappedUserIds.has(uid)) continue;
    orphanUserCount++;
    orphanAgg.queries += agg.queries;
    orphanAgg.cache_hits += agg.cache_hits;
    orphanAgg.rate_limit_hits += agg.rate_limit_hits;
    orphanAgg.tokens_in += agg.tokens_in;
    orphanAgg.tokens_out += agg.tokens_out;
    orphanAgg.cost_cents += agg.cost_cents;
    if (!orphanAgg.last_activity || (agg.last_activity && agg.last_activity > orphanAgg.last_activity)) {
      orphanAgg.last_activity = agg.last_activity;
    }
    orphanConversations += convPerUser.get(uid) || 0;
    orphanMemories += memPerUser.get(uid) || 0;
  }
  // Null-user_id rijen erbij optellen
  orphanAgg.queries += nullUserAgg.queries;
  orphanAgg.cache_hits += nullUserAgg.cache_hits;
  orphanAgg.rate_limit_hits += nullUserAgg.rate_limit_hits;
  orphanAgg.tokens_in += nullUserAgg.tokens_in;
  orphanAgg.tokens_out += nullUserAgg.tokens_out;
  orphanAgg.cost_cents += nullUserAgg.cost_cents;
  if (nullUserAgg.last_activity && (!orphanAgg.last_activity || nullUserAgg.last_activity > orphanAgg.last_activity)) {
    orphanAgg.last_activity = nullUserAgg.last_activity;
  }

  const hasOrphanActivity = orphanAgg.queries > 0 || orphanAgg.cache_hits > 0
    || orphanAgg.cost_cents > 0 || orphanConversations > 0 || orphanMemories > 0
    || nullUserCount > 0;

  if (hasOrphanActivity) {
    rows.push({
      email: nullUserCount && orphanUserCount === 0
        ? 'Onbekend (geen user_id)'
        : `Onbekend / verwijderd${orphanUserCount ? ` (${orphanUserCount} user${orphanUserCount > 1 ? 's' : ''})` : ''}`,
      subscription_active: null,
      subscription_end_date: null,
      cancelled_at: null,
      has_registered: false,
      is_admin: false,
      orphan: true,
      queries_month: orphanAgg.queries,
      cache_hits_month: orphanAgg.cache_hits,
      rate_limit_hits_month: orphanAgg.rate_limit_hits,
      tokens_in_month: orphanAgg.tokens_in,
      tokens_out_month: orphanAgg.tokens_out,
      cost_cents_month: orphanAgg.cost_cents,
      conversations: orphanConversations,
      memories: orphanMemories,
      last_activity: orphanAgg.last_activity,
    });
  }

  return { users: rows };
}

async function getRecentQueries(limit) {
  const { data: msgs, error } = await supabase
    .from('messages')
    .select('id, conversation_id, role, content, retrieved_ids, tokens_in, tokens_out, model, had_image, created_at')
    .eq('role', 'assistant')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  const conversationIds = [...new Set((msgs || []).map(m => m.conversation_id))];
  const { data: convs } = await supabase
    .from('conversations').select('id, user_id, title').in('id', conversationIds);
  const convMap = new Map((convs || []).map(c => [c.id, c]));

  const { data: authUsers } = await supabase.auth.admin.listUsers();
  const idToEmail = new Map();
  for (const u of (authUsers?.users || [])) {
    if (u.email) idToEmail.set(u.id, u.email);
  }

  const { data: allUserMsgs } = await supabase
    .from('messages').select('id, conversation_id, content, created_at')
    .eq('role', 'user').in('conversation_id', conversationIds)
    .order('created_at', { ascending: true });

  const userMsgsByConv = new Map();
  for (const u of (allUserMsgs || [])) {
    if (!userMsgsByConv.has(u.conversation_id)) userMsgsByConv.set(u.conversation_id, []);
    userMsgsByConv.get(u.conversation_id).push(u);
  }

  const rows = (msgs || []).map(m => {
    const conv = convMap.get(m.conversation_id);
    const userMsgs = userMsgsByConv.get(m.conversation_id) || [];
    const prevUser = [...userMsgs].reverse().find(u => u.created_at < m.created_at);
    return {
      timestamp: m.created_at,
      email: conv?.user_id ? idToEmail.get(conv.user_id) || '(onbekend)' : '(anoniem)',
      conversation_id: m.conversation_id,
      conversation_title: conv?.title || '(geen titel)',
      question: prevUser?.content || '(geen vraag gevonden)',
      answer_preview: (m.content || '').slice(0, 140),
      model: m.model,
      tokens_in: m.tokens_in,
      tokens_out: m.tokens_out,
      had_image: m.had_image,
      retrieved_count: (m.retrieved_ids || []).length,
      retrieved_ids: m.retrieved_ids || [],
    };
  });
  return { queries: rows };
}

async function getUserConversations(email) {
  // Resolve email → user_id via auth.admin.listUsers
  const { data: authUsers } = await supabase.auth.admin.listUsers();
  const user = (authUsers?.users || []).find(
    u => (u.email || '').toLowerCase() === email.toLowerCase()
  );
  if (!user) return { email, conversations: [] };

  const { data: convs, error: cErr } = await supabase
    .from('conversations')
    .select('id, title, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });
  if (cErr) throw new Error(cErr.message);

  const convIds = (convs || []).map(c => c.id);
  if (convIds.length === 0) return { email, conversations: [] };

  const { data: msgs, error: mErr } = await supabase
    .from('messages')
    .select('id, conversation_id, role, content, had_image, model, tokens_in, tokens_out, created_at')
    .in('conversation_id', convIds)
    .order('created_at', { ascending: true });
  if (mErr) throw new Error(mErr.message);

  const byConv = new Map();
  for (const m of (msgs || [])) {
    if (!byConv.has(m.conversation_id)) byConv.set(m.conversation_id, []);
    byConv.get(m.conversation_id).push(m);
  }

  const result = (convs || []).map(c => ({
    id: c.id,
    title: c.title || '(geen titel)',
    created_at: c.created_at,
    updated_at: c.updated_at,
    messages: byConv.get(c.id) || [],
  }));
  return { email, conversations: result };
}

async function getChunksByIds(ids) {
  if (!ids || ids.length === 0) return { chunks: [] };
  const { data, error } = await supabase
    .from('documents')
    .select('id, source, title, content, category, age_min_months, age_max_months')
    .in('id', ids);
  if (error) throw new Error(error.message);
  // Preserve order van de ids-array
  const byId = new Map((data || []).map(d => [d.id, d]));
  const ordered = ids.map(id => byId.get(id) || { id, missing: true });
  return { chunks: ordered };
}

async function getFallbackQueries(limit) {
  // Fallback = assistant-antwoord waar de bot niet kon antwoorden (out-of-scope).
  // Chat-endpoint zet dan model='fallback'.
  const { data: msgs, error } = await supabase
    .from('messages')
    .select('id, conversation_id, role, content, retrieved_ids, had_image, model, created_at')
    .eq('role', 'assistant')
    .eq('model', 'fallback')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  const conversationIds = [...new Set((msgs || []).map(m => m.conversation_id))];
  if (conversationIds.length === 0) return { fallbacks: [] };

  const { data: convs } = await supabase
    .from('conversations').select('id, user_id, title').in('id', conversationIds);
  const convMap = new Map((convs || []).map(c => [c.id, c]));

  const { data: authUsers } = await supabase.auth.admin.listUsers();
  const idToEmail = new Map();
  for (const u of (authUsers?.users || [])) {
    if (u.email) idToEmail.set(u.id, u.email);
  }

  // Voor elke fallback het laatste user-bericht ervoor zoeken (de vraag)
  const { data: allUserMsgs } = await supabase
    .from('messages').select('id, conversation_id, content, created_at')
    .eq('role', 'user').in('conversation_id', conversationIds)
    .order('created_at', { ascending: true });

  const userMsgsByConv = new Map();
  for (const u of (allUserMsgs || [])) {
    if (!userMsgsByConv.has(u.conversation_id)) userMsgsByConv.set(u.conversation_id, []);
    userMsgsByConv.get(u.conversation_id).push(u);
  }

  const rows = (msgs || []).map(m => {
    const conv = convMap.get(m.conversation_id);
    const userMsgs = userMsgsByConv.get(m.conversation_id) || [];
    const prevUser = [...userMsgs].reverse().find(u => u.created_at < m.created_at);
    return {
      timestamp: m.created_at,
      email: conv?.user_id ? idToEmail.get(conv.user_id) || '(verwijderd)' : '(onbekend)',
      conversation_id: m.conversation_id,
      conversation_title: conv?.title || '(geen titel)',
      question: prevUser?.content || '(geen vraag gevonden)',
      answer: m.content || '',
      had_image: m.had_image,
      retrieved_ids: m.retrieved_ids || [],
      retrieved_count: (m.retrieved_ids || []).length,
    };
  });
  return { fallbacks: rows };
}

async function getSubscriptionEvents(limit, emailFilter) {
  let q = supabase
    .from('subscription_events')
    .select('id, email, event_type, category, cycle, applied, error, received_at')
    .order('received_at', { ascending: false })
    .limit(limit);
  if (emailFilter) q = q.ilike('email', emailFilter);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return { events: data || [] };
}
