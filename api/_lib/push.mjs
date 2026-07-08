// =====================================================================
// PUSH — Expo-push-tokens beheren + notificaties versturen
//
// De app registreert bij (her)login een Expo-push-token; die slaan we op in
// push_tokens (gekoppeld aan de user_id). Bij een nieuwe post/reply bepaalt
// notifyNewActivity() de ontvangers, berekent per ontvanger het absolute
// app-icoon-getal (computeTotalBadge) en stuurt één Expo-push per token.
//
// Expo Push API: POST https://exp.host/--/api/v2/push/send
//   body: array van { to, title, body, badge, sound, priority }
//   max 100 messages per request.
//
// Alles is defensief: een push-fout mag NOOIT de post/reply-request breken.
// De trigger wordt daarom met await-in-try/catch aangeroepen, en de send
// zelf logt enkel bij fout.
// =====================================================================

import { supabase } from './clients.mjs';
import { loadAdminUserIds } from './community.mjs';
import { computeTotalBadge } from './badges.mjs';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/* ----------------------------------------
   Token-beheer
---------------------------------------- */
export async function upsertPushToken(userId, token, platform) {
  if (!userId || !token) return;
  const { error } = await supabase
    .from('push_tokens')
    .upsert(
      { token, user_id: userId, platform: platform || null, updated_at: new Date().toISOString() },
      { onConflict: 'token' }
    );
  if (error) console.warn(`[push] upsert token: ${error.message}`);
}

export async function deletePushToken(userId, token) {
  if (!token) return;
  let q = supabase.from('push_tokens').delete().eq('token', token);
  if (userId) q = q.eq('user_id', userId);
  const { error } = await q;
  if (error) console.warn(`[push] delete token: ${error.message}`);
}

/** Alle Expo-tokens voor een set user-ids → [{ token, user_id }]. */
async function getTokensForUsers(userIds) {
  const ids = [...userIds].filter(Boolean);
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('push_tokens')
    .select('token, user_id')
    .in('user_id', ids);
  if (error) {
    console.warn(`[push] getTokens: ${error.message}`);
    return [];
  }
  return data || [];
}

/* ----------------------------------------
   Expo Push versturen (chunks van 100)
---------------------------------------- */
async function sendExpoPush(messages) {
  if (!messages.length) return;
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const resp = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(chunk),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        console.warn(`[push] Expo send ${resp.status}: ${text.slice(0, 300)}`);
      }
    } catch (err) {
      console.warn(`[push] Expo send fout: ${err.message}`);
    }
  }
}

/* ----------------------------------------
   Ontvangers bepalen
   kind:
     'timeline_post'   → alle gebruikers met een token
     'timeline_reply'  → auteur-admin? alle : enkel admins
     'chatroom_topic'  → auteur-admin? alle : admins + room-volgers
     'chatroom_reply'  → auteur-admin? alle : admins + room-volgers + topic-volgers
   ctx: { authorId, roomId?, topicId?, authorIsAdmin }
   Steeds: minus de auteur zelf, minus wie de auteur geblokkeerd heeft.
---------------------------------------- */
async function loadAllAdminIds() {
  const { data } = await supabase.from('community_admin_user_ids').select('user_id');
  return new Set((data || []).map(r => r.user_id).filter(Boolean));
}

/** Wie heeft de auteur geblokkeerd? (blocked_id = author → blocker_id) */
async function loadBlockersOf(authorId) {
  const { data } = await supabase
    .from('user_blocks').select('blocker_id').eq('blocked_id', authorId);
  return new Set((data || []).map(r => r.blocker_id).filter(Boolean));
}

/** Alle gebruikers met minstens één push-token. */
async function loadAllTokenUserIds() {
  const { data } = await supabase.from('push_tokens').select('user_id');
  return new Set((data || []).map(r => r.user_id).filter(Boolean));
}

async function resolveRecipients(kind, ctx) {
  const { authorId, roomId = null, topicId = null, authorIsAdmin = false } = ctx;
  const recipients = new Set();

  if (kind === 'timeline_post' || authorIsAdmin) {
    // Iedereen met een token (admin-content of nieuwe post gaat naar allen).
    for (const id of await loadAllTokenUserIds()) recipients.add(id);
  } else {
    // Gewone-gebruiker-content → enkel admins zien het als "nieuw".
    for (const id of await loadAllAdminIds()) recipients.add(id);

    if (kind === 'chatroom_topic' || kind === 'chatroom_reply') {
      if (roomId) {
        const { data: rf } = await supabase
          .from('chat_room_followers').select('user_id').eq('room_id', roomId);
        for (const r of rf || []) recipients.add(r.user_id);
      }
    }
    if (kind === 'chatroom_reply' && topicId) {
      const { data: tf } = await supabase
        .from('chat_topic_followers').select('user_id').eq('topic_id', topicId);
      for (const t of tf || []) recipients.add(t.user_id);
    }
  }

  // Auteur zelf nooit, en niemand die de auteur geblokkeerd heeft.
  recipients.delete(authorId);
  const blockers = await loadBlockersOf(authorId);
  for (const b of blockers) recipients.delete(b);

  return recipients;
}

/* ----------------------------------------
   notifyNewActivity — hoofdingang voor de triggers
   kind:  zie resolveRecipients
   ctx:   { authorId, roomId?, topicId?, authorIsAdmin }
   notif: { title, body }
   Berekent per ontvanger het absolute app-icoon-getal en stuurt de pushes.
   Defensief: gooit nooit.
---------------------------------------- */
export async function notifyNewActivity(kind, ctx, notif) {
  try {
    const recipients = await resolveRecipients(kind, ctx);
    if (recipients.size === 0) return;

    const tokens = await getTokensForUsers(recipients);
    if (tokens.length === 0) return;

    // Absoluut badge-getal per gebruiker (één berekening per user, hergebruikt
    // voor eventueel meerdere tokens van dezelfde gebruiker).
    const badgeByUser = new Map();
    await Promise.all(
      [...recipients].map(async (uid) => {
        try { badgeByUser.set(uid, await computeTotalBadge(uid)); }
        catch { badgeByUser.set(uid, 1); }
      })
    );

    const messages = tokens.map(({ token, user_id }) => ({
      to: token,
      sound: 'default',
      title: notif.title,
      body: notif.body,
      badge: badgeByUser.get(user_id) ?? 1,
      priority: 'high',
    }));

    await sendExpoPush(messages);
  } catch (err) {
    console.warn(`[push] notifyNewActivity fout: ${err.message}`);
  }
}

/** Kleine helper: is deze auteur admin? (voor de triggers) */
export async function authorIsAdmin(userId) {
  const set = await loadAdminUserIds([userId]);
  return set.has(userId);
}
