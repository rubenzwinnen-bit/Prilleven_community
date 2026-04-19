// POST /api/webhooks/plugpay
//
// Flexibele Plug&Pay webhook-handler. Bepaalt het event-type in 3 prioriteiten:
//   1. URL-query (?type=cancelled&cycle=yearly)   ← aanbevolen als je 3 aparte webhooks in Plug&Pay instelt
//   2. Veld in body.event / body.event_type / body.type / body.action
//   3. Heuristiek op basis van velden (bv. "cancelled_at" in body)
//
// Velden die uit de body worden gehaald (best-effort, diverse naamgevingen):
//   - email (verplicht)
//   - customer_id (optioneel)
//   - end_date / next_billing_date (optioneel — anders default op cycle)
//   - cycle / plan_interval / billing_cycle (optioneel — anders default monthly)
//
// Gebruik in Plug&Pay:
//   - Event "order.paid" / "subscription.activated"   → POST /api/webhooks/plugpay?type=activated&cycle=monthly
//   - Event "subscription.cancelled"                  → POST /api/webhooks/plugpay?type=cancelled
//   - Event "subscription.expired"                    → POST /api/webhooks/plugpay?type=expired
// (cycle kan ook 'yearly' zijn voor jaarabonnementen)
//
// Security: HMAC-SHA256 verify via header x-plug-signature of x-signature.
// Zet PLUGPAY_WEBHOOK_SECRET in env. Zonder secret → trust-mode (dev only).

import { createHmac, timingSafeEqual } from 'node:crypto';
import { supabase } from '../_lib/clients.mjs';
import { invalidateSubscriptionCache } from '../_lib/subscription.mjs';

const SECRET = process.env.PLUGPAY_WEBHOOK_SECRET || '';
// Alternatief voor Joemen (dat geen HMAC-signing ondersteunt):
// een simpele shared-secret die in een Authorization header meegegeven wordt.
const BEARER_SECRET = process.env.PLUGPAY_WEBHOOK_BEARER || '';

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

async function readRawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf-8');
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function verifyAuth(rawBody, signatureHeader, authHeader) {
  // 1) Bearer shared-secret (makkelijkst voor Joemen)
  if (BEARER_SECRET) {
    if (!authHeader) return false;
    const match = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (!match) return false;
    const provided = match[1].trim();
    const a = Buffer.from(provided);
    const b = Buffer.from(BEARER_SECRET);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
  // 2) HMAC-SHA256 signature (als Plug&Pay direct calls)
  if (SECRET) {
    if (!signatureHeader) return false;
    try {
      const expected = createHmac('sha256', SECRET).update(rawBody).digest('hex');
      const provided = signatureHeader.toLowerCase().replace(/^sha256=/, '');
      const a = Buffer.from(expected);
      const b = Buffer.from(provided);
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    } catch (e) {
      console.error('[plugpay] signature verify error:', e.message);
      return false;
    }
  }
  // 3) Geen secret gezet → trust-mode (dev/test only)
  console.warn('[plugpay] PLUGPAY_WEBHOOK_BEARER/SECRET niet gezet — trust-mode');
  return true;
}

// Best-effort deep-field pickers voor diverse payload-formaten
function pickPath(obj, ...paths) {
  for (const p of paths) {
    const parts = p.split('.');
    let v = obj;
    for (const k of parts) { v = v?.[k]; if (v === undefined) break; }
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

function classifyEvent(rawType) {
  if (!rawType) return 'unknown';
  const t = String(rawType).toLowerCase();
  if (t.includes('cancel')) return 'cancelled';
  if (t.includes('refund') || t.includes('expire') || t.includes('fail') || t.includes('chargeback'))
    return 'expired';
  if (t.includes('paid') || t.includes('renew') || t.includes('activ') || t.includes('success') || t.includes('complete'))
    return 'activated';
  return 'unknown';
}

function detectCycle(body, urlCycle) {
  if (urlCycle === 'monthly' || urlCycle === 'yearly') return urlCycle;
  const c = pickPath(body, 'cycle', 'plan_interval', 'billing_cycle', 'interval', 'subscription.interval');
  if (!c) return null;
  const s = String(c).toLowerCase();
  if (s.includes('year') || s.includes('annual') || s.includes('jaar')) return 'yearly';
  if (s.includes('month') || s.includes('maand')) return 'monthly';
  return null;
}

function computeEndDate(endDateRaw, cycle) {
  if (endDateRaw) {
    const d = new Date(endDateRaw);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const d = new Date();
  if (cycle === 'yearly') {
    d.setFullYear(d.getFullYear() + 1);
  } else {
    // default monthly
    d.setDate(d.getDate() + 30);
  }
  return d.toISOString();
}

// Log het event in audit-tabel (fire-and-forget, mag niet response blokkeren)
async function logEvent({ email, eventType, category, cycle, payload, applied, error }) {
  try {
    await supabase.from('subscription_events').insert({
      email: email || '(unknown)',
      event_type: eventType || 'unspecified',
      category,
      cycle: cycle || null,
      payload,
      applied,
      error: error || null,
    });
  } catch (e) {
    console.error('[plugpay][log] insert failed:', e.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  // URL-parameters (fallback bron voor type en cycle)
  const url = new URL(req.url, 'http://x');
  const urlType = (url.searchParams.get('type') || '').toLowerCase().trim() || null;
  const urlCycle = (url.searchParams.get('cycle') || '').toLowerCase().trim() || null;

  // Raw body voor signature verify
  let raw;
  try {
    raw = await readRawBody(req);
  } catch {
    return json(res, 400, { error: 'Could not read body' });
  }

  const sigHeader = req.headers['x-plug-signature']
    || req.headers['x-plugpay-signature']
    || req.headers['x-signature']
    || '';
  const authHeader = req.headers['authorization'] || '';
  if (!verifyAuth(raw, sigHeader, authHeader)) {
    console.warn('[plugpay] invalid auth');
    return json(res, 401, { error: 'Invalid auth' });
  }

  let body;
  try {
    body = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return json(res, 400, { error: 'Invalid JSON' });
  }

  // Extract fields
  const email = pickPath(body, 'email', 'customer.email', 'data.customer.email',
    'order.customer_email', 'subscriber.email');
  const bodyEventType = pickPath(body, 'event', 'event_type', 'type', 'action');
  const customerId = pickPath(body, 'customer.id', 'customer_id', 'subscriber.id', 'data.customer.id');
  const endDateRaw = pickPath(body, 'next_billing_date', 'end_date', 'valid_until',
    'subscription.next_billing_date', 'subscription.end_date',
    'period_end', 'current_period_end');

  // Determine type — URL wins, then body
  const rawType = urlType || bodyEventType || null;
  const category = classifyEvent(rawType);
  const cycle = detectCycle(body, urlCycle);

  console.log(`[plugpay] type=${rawType || '(none)'} category=${category} email=${email || '(none)'} cycle=${cycle || '(none)'}`);

  if (!email) {
    await logEvent({
      email: null, eventType: rawType, category, cycle, payload: body,
      applied: false, error: 'no_email_in_payload',
    });
    return json(res, 400, { error: 'Email missing in webhook payload' });
  }

  const emailLower = String(email).toLowerCase();
  let update = {};
  let wantInsert = false;
  let applyError = null;

  if (category === 'activated') {
    update = {
      subscription_active: true,
      cancelled_at: null,
      subscription_end_date: computeEndDate(endDateRaw, cycle),
    };
    if (customerId) update.plugpay_customer_id = String(customerId);
    wantInsert = true;
  } else if (category === 'cancelled') {
    // Blijft actief tot end_date — zet alleen cancelled_at marker
    update.cancelled_at = new Date().toISOString();
    if (endDateRaw) {
      update.subscription_end_date = new Date(endDateRaw).toISOString();
    } else {
      // Bestaande users (handmatig in DB, pre-webhook) hebben geen end_date.
      // Fallback: als DB nog geen end_date heeft, zetten we +30/365 dagen
      // zodat ze niet "eeuwig" actief blijven als Plug&Pay later geen expired-event stuurt.
      try {
        const { data: existing } = await supabase
          .from('allowed_users')
          .select('subscription_end_date')
          .ilike('email', emailLower)
          .maybeSingle();
        if (!existing?.subscription_end_date) {
          update.subscription_end_date = computeEndDate(null, cycle);
        }
      } catch {
        update.subscription_end_date = computeEndDate(null, cycle);
      }
    }
  } else if (category === 'expired') {
    update = { subscription_active: false };
    if (endDateRaw) update.subscription_end_date = new Date(endDateRaw).toISOString();
  }

  // Apply DB change (tenzij unknown)
  let applied = false;
  if (category !== 'unknown') {
    try {
      if (wantInsert) {
        const { error } = await supabase
          .from('allowed_users')
          .upsert({ email: emailLower, ...update }, { onConflict: 'email' });
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase
          .from('allowed_users')
          .update(update)
          .ilike('email', emailLower);
        if (error) throw new Error(error.message);
      }
      invalidateSubscriptionCache(emailLower);
      applied = true;
    } catch (err) {
      applyError = err.message;
      console.error('[plugpay] db error:', err.message);
    }
  }

  // Log in audit-tabel (altijd — ook voor unknown/ignored)
  await logEvent({
    email: emailLower, eventType: rawType, category, cycle,
    payload: body, applied, error: applyError,
  });

  if (category === 'unknown') {
    return json(res, 200, { received: true, ignored: true, reason: 'unknown_event_type' });
  }
  if (!applied) {
    return json(res, 500, { received: true, applied: false, error: applyError });
  }
  return json(res, 200, { received: true, applied: category, cycle });
}
