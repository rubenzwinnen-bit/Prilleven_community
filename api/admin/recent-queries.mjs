// GET /api/admin/recent-queries?limit=50
// Laatste chat-berichten met bron-info (voor debugging en kennisbank-gaten).

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
    const limit = Math.min(200, parseInt(url.searchParams.get('limit') || '50', 10));

    // Laatste assistant-messages met hun context
    const { data: msgs, error } = await supabase
      .from('messages')
      .select('id, conversation_id, role, content, retrieved_ids, tokens_in, tokens_out, model, had_image, created_at')
      .eq('role', 'assistant')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);

    // Per assistant-message: vind de voorgaande user-vraag in hetzelfde gesprek
    const conversationIds = [...new Set((msgs || []).map(m => m.conversation_id))];
    const { data: convs } = await supabase
      .from('conversations')
      .select('id, user_id, title')
      .in('id', conversationIds);
    const convMap = new Map((convs || []).map(c => [c.id, c]));

    // User-ids → emails
    const userIds = [...new Set((convs || []).map(c => c.user_id).filter(Boolean))];
    const { data: authUsers } = await supabase.auth.admin.listUsers();
    const idToEmail = new Map();
    for (const u of (authUsers?.users || [])) {
      if (u.email) idToEmail.set(u.id, u.email);
    }

    // Voor elke assistant-msg, vind de user-msg ervoor (in dezelfde conversatie, vlak ervoor)
    const { data: allUserMsgs } = await supabase
      .from('messages')
      .select('id, conversation_id, content, created_at')
      .eq('role', 'user')
      .in('conversation_id', conversationIds)
      .order('created_at', { ascending: true });

    const userMsgsByConv = new Map();
    for (const u of (allUserMsgs || [])) {
      if (!userMsgsByConv.has(u.conversation_id)) userMsgsByConv.set(u.conversation_id, []);
      userMsgsByConv.get(u.conversation_id).push(u);
    }

    const rows = (msgs || []).map(m => {
      const conv = convMap.get(m.conversation_id);
      const userMsgs = userMsgsByConv.get(m.conversation_id) || [];
      // Vind de laatste user-msg vóór deze assistant-msg
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

    return json(res, 200, { queries: rows });
  } catch (err) {
    console.error('[admin/recent-queries]', err);
    return json(res, 500, { error: err.message || 'Er ging iets mis.' });
  }
}
