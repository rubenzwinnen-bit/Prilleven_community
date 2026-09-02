// GET  /api/opzegverzoek  → staat er al een open verzoek voor deze user?
// POST /api/opzegverzoek  → leg een opzegverzoek vast en mail het team
//
// Klanten kunnen niet zelf opzeggen in Plug&Pay: dat zit enkel in het
// Ultimate-pakket en wij draaien op Premium. Het verzoek loopt dus via ons.
// De rij in cancellation_requests is leidend — die kan niet in een spamfilter
// verdwijnen. De mail is een seintje, geen opslag.
//
// Het e-mailadres komt uit het geverifieerde JWT, nooit uit de body: anders
// kan iemand een opzegging voor een ander account indienen.

import { requireAuth, AuthError } from './_lib/auth.mjs';
import { supabase } from './_lib/clients.mjs';
import { getAccessStatus } from './_lib/subscription.mjs';

const TEAM_MAIL = 'hallo@prilleven.be';
/* Resend verstuurt enkel vanaf een geverifieerd domein. prilleven.be is dat al
   (Supabase Auth gebruikt het voor wachtwoord-resets). */
const VAN_ADRES = 'Pril Leven <noreply@prilleven.be>';

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function leesBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

/* ----------------------------------------
   MAIL VERSTUREN VIA RESEND
   Plain fetch naar de REST API — geen extra dependency.
   Faalt de mail, dan blijft de rij staan; die is de echte opslag.
---------------------------------------- */
async function stuurMail({ email, reden, einddatum }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error('[opzegverzoek] RESEND_API_KEY ontbreekt — verzoek is wel opgeslagen');
    return false;
  }

  const tot = einddatum
    ? new Date(einddatum).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'onbekend';

  const html = `
    <p>Er is een opzegverzoek binnengekomen.</p>
    <ul>
      <li><strong>E-mailadres:</strong> ${escapeHtml(email)}</li>
      <li><strong>Toegang loopt tot:</strong> ${escapeHtml(tot)}</li>
      <li><strong>Reden:</strong> ${reden ? escapeHtml(reden) : '(niet opgegeven)'}</li>
    </ul>
    <p>Zeg het abonnement op in Plug&amp;Pay en zet het verzoek daarna op
       <em>verwerkt</em> in de tabel <code>cancellation_requests</code>.</p>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: VAN_ADRES,
        to: [TEAM_MAIL],
        reply_to: email,
        subject: `Opzegverzoek: ${email}`,
        html,
      }),
    });
    if (!res.ok) {
      console.error('[opzegverzoek] Resend gaf', res.status, await res.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (err) {
    console.error('[opzegverzoek] mail mislukt', err);
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
  if (!email) return json(res, 400, { error: 'Geen e-mailadres bekend voor dit account.' });

  try {
    /* --- Staat er al een open verzoek? --- */
    const { data: bestaand, error: leesFout } = await supabase
      .from('cancellation_requests')
      .select('id, created_at, status')
      .eq('user_id', userId)
      .eq('status', 'open')
      .maybeSingle();
    if (leesFout) throw leesFout;

    if (req.method === 'GET') {
      return json(res, 200, {
        open_verzoek: bestaand ? { aangevraagd_op: bestaand.created_at } : null,
      });
    }

    if (req.method !== 'POST') {
      return json(res, 405, { error: 'Method not allowed' });
    }

    /* Tweemaal indienen mag geen tweede mail opleveren. */
    if (bestaand) {
      return json(res, 200, {
        ok: true,
        al_ingediend: true,
        aangevraagd_op: bestaand.created_at,
      });
    }

    const body = await leesBody(req);
    /* Reden is optioneel en wordt afgekapt: dit veld gaat in een mail. */
    const reden = String(body.reden || '').trim().slice(0, 1000) || null;

    /* Einddatum vastleggen zoals hij nú is, als bewijs achteraf. */
    let einddatum = null;
    try {
      const status = await getAccessStatus(email);
      einddatum = status?.endDate || null;
    } catch {
      /* Niet blokkerend: het verzoek is belangrijker dan de datum erbij. */
    }

    const { data: rij, error: schrijfFout } = await supabase
      .from('cancellation_requests')
      .insert({
        user_id: userId,
        email,
        reden,
        einddatum_bij_verzoek: einddatum,
      })
      .select('id, created_at')
      .single();
    if (schrijfFout) throw schrijfFout;

    const gemaild = await stuurMail({ email, reden, einddatum });
    if (gemaild) {
      await supabase
        .from('cancellation_requests')
        .update({ mail_verstuurd: true })
        .eq('id', rij.id);
    }

    console.log(`[opzegverzoek] ${email} id=${rij.id} gemaild=${gemaild}`);

    /* Ook als de mail faalde is het verzoek geldig: de rij staat er. */
    return json(res, 201, { ok: true, aangevraagd_op: rij.created_at });
  } catch (err) {
    console.error('[opzegverzoek]', err);
    return json(res, 500, { error: 'Kon het opzegverzoek niet indienen.' });
  }
}
