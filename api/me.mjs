// GET    /api/me/export  → JSON-download van alle persoonlijke data
// DELETE /api/me         → verwijder alle persoonlijke data (right-to-be-forgotten)
//
// Allebei voor de huidige user (JWT-auth). Géén admin nodig.

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
  const { userId, email } = auth;

  try {
    // Pad gebruik: detect of "?action=export" of path eindigt op /export.
    // We accepteren beide: GET = export, DELETE = delete-me.
    if (req.method === 'GET') {
      return await exportUserData(res, userId, email);
    }
    if (req.method === 'DELETE') {
      return await deleteUserData(res, userId, email);
    }
    return json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('[me]', err);
    return json(res, 500, { error: err.message || 'Er ging iets mis.' });
  }
}

async function exportUserData(res, userId, email) {
  // Profiel
  const { data: profile } = await supabase
    .from('chat_user_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  // Conversaties + messages
  const { data: conversations } = await supabase
    .from('conversations')
    .select('id, title, created_at, updated_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  const conversationIds = (conversations || []).map(c => c.id);
  let messages = [];
  if (conversationIds.length > 0) {
    const { data } = await supabase
      .from('messages')
      .select('id, conversation_id, role, content, had_image, retrieved_ids, model, tokens_in, tokens_out, created_at')
      .in('conversation_id', conversationIds)
      .order('created_at', { ascending: true });
    messages = data || [];
  }

  // Memories
  const { data: memories } = await supabase
    .from('chat_user_memory')
    .select('id, content, importance, source_message_id, created_at, last_used_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  // Allowed_users entry (subscription info)
  const { data: allowedRow } = await supabase
    .from('allowed_users')
    .select('email, subscription_active, subscription_end_date, cancelled_at, is_admin, has_registered')
    .ilike('email', email || '')
    .maybeSingle();

  // Subscription events
  const { data: subEvents } = await supabase
    .from('subscription_events')
    .select('event_type, category, cycle, applied, received_at')
    .ilike('email', email || '')
    .order('received_at', { ascending: true });

  const payload = {
    exported_at: new Date().toISOString(),
    account: {
      user_id: userId,
      email,
    },
    subscription: allowedRow || null,
    subscription_events: subEvents || [],
    profile: profile || null,
    conversations: (conversations || []).map(c => ({
      ...c,
      messages: messages.filter(m => m.conversation_id === c.id),
    })),
    memories: memories || [],
  };

  // Forceer download met filename
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="pril-leven-export-${Date.now()}.json"`);
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 200;
  res.end(JSON.stringify(payload, null, 2));
}

async function deleteUserData(res, userId, email) {
  const errors = [];

  // Verwijder in dependency-volgorde
  const deleteFrom = async (table, col, value) => {
    const { error } = await supabase.from(table).delete().eq(col, value);
    if (error) errors.push(`${table}: ${error.message}`);
  };

  // 1. User memory
  await deleteFrom('chat_user_memory', 'user_id', userId);

  // 2. Conversations (cascade naar messages via FK)
  await deleteFrom('conversations', 'user_id', userId);

  // 3. Profile
  await deleteFrom('chat_user_profiles', 'user_id', userId);

  // 4. Usage log (bevat cost/tokens info per user — GDPR-wise ook user-data)
  await deleteFrom('usage_log', 'user_id', userId);

  // 5. Community-tabellen gebruiken `user_name` (een string, meestal de
  //    e-mail zoals bij login ingevoerd). Ratings worden lowercased opgeslagen,
  //    andere tabellen slaan de waarde as-entered op. Matchen we op beide
  //    varianten om robuust te zijn bij case-verschillen.
  const nameVariants = email
    ? Array.from(new Set([email, email.toLowerCase(), email.toUpperCase()].filter(Boolean)))
    : [];

  if (nameVariants.length > 0) {
    // 5a. Ratings → anonimiseren (community behoudt rating-data)
    {
      const { error } = await supabase
        .from('ratings')
        .update({ user_name: 'Anoniem' })
        .in('user_name', nameVariants);
      if (error) errors.push(`ratings: ${error.message}`);
    }

    // 5b. Comments → anonimiseren (community behoudt reacties onder recepten)
    {
      const { error } = await supabase
        .from('comments')
        .update({ user_name: 'Anoniem' })
        .in('user_name', nameVariants);
      if (error) errors.push(`comments: ${error.message}`);
    }

    // 5c. Favorites → verwijderen (persoonlijke bookmarks, geen community-waarde)
    {
      const { error } = await supabase
        .from('favorites')
        .delete()
        .in('user_name', nameVariants);
      if (error) errors.push(`favorites: ${error.message}`);
    }

    // 5d. Schedules → verwijderen (persoonlijke weekschema's)
    {
      const { error } = await supabase
        .from('schedules')
        .delete()
        .in('user_name', nameVariants);
      if (error) errors.push(`schedules: ${error.message}`);
    }
  }

  // 6. Cache: geen user-specifieke cache in answer_cache (global)
  //    Subscription_events houden we bij (audit-trail, alleen email zonder persoonlijke info)
  //    allowed_users blijft staan (bevat betaalstatus — geen chat-data)

  // 7. Verwijder ook de Supabase auth-user zelf (optioneel — dit deactiveert login)
  //    De user kan dan niet meer inloggen met die email.
  //    Als ze later opnieuw een account willen: ze kunnen registreren (allowed_users staat nog).
  try {
    const { error: authErr } = await supabase.auth.admin.deleteUser(userId);
    if (authErr) errors.push(`auth.users: ${authErr.message}`);
  } catch (e) {
    errors.push(`auth.users: ${e.message}`);
  }

  if (errors.length > 0) {
    return json(res, 207, {
      ok: false,
      message: 'Sommige onderdelen konden niet verwijderd worden.',
      errors,
    });
  }

  return json(res, 200, {
    ok: true,
    message: 'Al je persoonlijke data is verwijderd.',
  });
}
