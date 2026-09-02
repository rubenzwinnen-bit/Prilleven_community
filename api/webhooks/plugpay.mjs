// POST /api/webhooks/plugpay
//
// Webhook vanuit Plug&Pay zelf (Instellingen → Koppelingen → universele koppeling).
// Vervangt de oude route via het CRM van Joemen, die enkel contactvelden meestuurde
// en waarvan de verlengingen nooit doorkwamen.
//
// Twee regels in Plug&Pay, elk met een eigen URL:
//
//   Trigger "Bestelling betaald"    → POST /api/webhooks/plugpay?type=activated&key=<secret>
//   Trigger "Abonnement geëindigd"  → POST /api/webhooks/plugpay?type=expired&key=<secret>
//
// BELANGRIJK bij de eerste regel: vink
// "Regel ook uitvoeren bij automatische incasso's van abonnementen en termijnbetalingen"
// aan. Zonder dat vinkje vuurt hij alleen bij de eerste aankoop en schuift de
// einddatum bij een verlenging nooit op — precies de storing van vóór augustus 2026.
//
// Elke inkomende call wordt weggeschreven naar `subscription_events`, ook als de auth
// faalt of de body onleesbaar is. Zonder dat spoor is een misgelopen webhook onvindbaar.
//
// Testen zonder iets te wijzigen: hang &dryrun=1 aan de URL.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { supabase } from '../_lib/clients.mjs';
import { invalidateSubscriptionCache } from '../_lib/subscription.mjs';

const SECRET = process.env.PLUGPAY_WEBHOOK_SECRET || '';
// Gedeeld geheim. Plug&Pay laat bij een webhook-actie enkel een URL instellen,
// geen eigen headers — daarom mag dit ook als ?key= in de query staan.
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

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

function verifyAuth({ rawBody, signatureHeader, authHeader, urlKey }) {
  if (BEARER_SECRET) {
    // 1) ?key=<secret> in de URL — de enige optie die Plug&Pay's webhook-actie toelaat.
    if (urlKey && safeEqual(urlKey, BEARER_SECRET)) return true;
    // 2) Authorization: Bearer <secret> — voor calls met de hand of vanuit een tool.
    const match = /^Bearer\s+(.+)$/i.exec(authHeader || '');
    if (match && safeEqual(match[1].trim(), BEARER_SECRET)) return true;
    return false;
  }
  // 3) HMAC-SHA256 over de body.
  if (SECRET) {
    if (!signatureHeader) return false;
    try {
      const expected = createHmac('sha256', SECRET).update(rawBody).digest('hex');
      return safeEqual(expected, signatureHeader.toLowerCase().replace(/^sha256=/, ''));
    } catch (e) {
      console.error('[plugpay] signature verify error:', e.message);
      return false;
    }
  }
  console.warn('[plugpay] PLUGPAY_WEBHOOK_BEARER/SECRET niet gezet — trust-mode');
  return true;
}

/**
 * Zet een form-urlencoded body om naar een object, met bracket-notatie uitgeklapt:
 * `data[customer][email]=x` → `{ data: { customer: { email: 'x' } } }`.
 * Plug&Pay's klassieke webhook post form-encoded, de V2-variant JSON.
 */
function parseForm(raw) {
  const out = {};
  for (const [key, value] of new URLSearchParams(raw)) {
    const parts = key.replace(/\]/g, '').split('[');
    let node = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (typeof node[p] !== 'object' || node[p] === null) node[p] = {};
      node = node[p];
    }
    node[parts[parts.length - 1]] = value;
  }
  return out;
}

function parseBody(raw, contentType) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return {};

  /* De vorm van de body telt zwaarder dan het content-type. Plug&Pay stuurt
     sinds 2026-08-13 (regel 504592, webhook_event order_payment_completed)
     een JSON-body met content-type x-www-form-urlencoded. Ging het content-type
     voor, dan liet parseForm() zijn URLSearchParams los op die JSON: de hele
     string werd één sleutel en het e-mailadres was onvindbaar. Gevolg: 127
     events met 'geen_email_in_payload' en 87 betalende leden die hun
     verlenging niet kregen. Begint de body met { of [, dan is het JSON —
     ongeacht wat de header beweert. */
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      /* Toch geen geldige JSON: val terug op de form-parser hieronder. */
    }
  }
  return parseForm(trimmed);
}

function pickPath(obj, ...paths) {
  for (const p of paths) {
    let v = obj;
    for (const k of p.split('.')) { v = v?.[k]; if (v === undefined) break; }
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

function classifyEvent(rawType) {
  if (!rawType) return 'unknown';
  const t = String(rawType).toLowerCase();
  if (t.includes('cancel') || t.includes('geannuleerd')) return 'cancelled';
  if (t.includes('refund') || t.includes('expire') || t.includes('fail')
    || t.includes('chargeback') || t.includes('geeindigd') || t.includes('geëindigd')) return 'expired';
  if (t.includes('paid') || t.includes('betaald') || t.includes('renew')
    || t.includes('activ') || t.includes('success') || t.includes('complete')) return 'activated';
  return 'unknown';
}

function detectCycle(body, urlCycle) {
  if (urlCycle === 'monthly' || urlCycle === 'quarterly' || urlCycle === 'yearly') return urlCycle;
  const c = pickPath(body, 'cycle', 'interval', 'plan_interval', 'billing_cycle',
    'subscription.interval', 'subscription.cycle', 'data.subscription.interval');
  if (!c) return null;
  const s = String(c).toLowerCase();
  if (s.includes('year') || s.includes('annual') || s.includes('jaar')) return 'yearly';
  if (s.includes('quarter') || s.includes('kwartaal')) return 'quarterly';
  if (s.includes('month') || s.includes('maand')) return 'monthly';
  return null;
}

/** De volgende incassodatum uit de payload, of null als Plug&Pay hem niet meestuurt. */
function pickNextDate(body) {
  const raw = pickPath(body,
    'next_billing_date', 'next_collection_date', 'next_invoice_date', 'next_payment_date',
    'subscription.next_billing_date', 'subscription.next_collection_date', 'subscription.next_invoice_date',
    'data.subscription.next_billing_date', 'data.next_billing_date',
    'order.subscription.next_billing_date',
    'end_date', 'valid_until', 'expires_at', 'period_end', 'current_period_end',
    'subscription.end_date', 'data.subscription.end_date');
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Terugvaldatum als de payload er geen bevat. Bewust ruim: iemand ten onrechte
 * buitensluiten is erger dan iemand een paar dagen te lang toegang geven.
 * Elke keer dat dit gebeurt komt er een `fallback_datum:` regel in de audit-log.
 */
function fallbackEndDate(cycle) {
  const d = new Date();
  if (cycle === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else if (cycle === 'quarterly') d.setMonth(d.getMonth() + 3);
  else d.setDate(d.getDate() + 30);
  return d.toISOString();
}

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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Signature, X-Plug-Signature');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method === 'GET') {
    return json(res, 200, {
      status: 'ready',
      endpoint: 'plugpay webhook',
      hint: 'POST met ?type=activated|expired&key=<secret>. Voeg &dryrun=1 toe om te testen zonder te schrijven.',
    });
  }

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed. Use POST.' });
  }

  const url = new URL(req.url, 'http://x');
  const urlType = (url.searchParams.get('type') || '').toLowerCase().trim() || null;
  const urlCycle = (url.searchParams.get('cycle') || '').toLowerCase().trim() || null;
  const urlKey = url.searchParams.get('key') || '';
  const dryrun = url.searchParams.get('dryrun') === '1';

  let raw;
  try {
    raw = await readRawBody(req);
  } catch {
    await logEvent({
      email: null, eventType: urlType, category: 'unknown', cycle: urlCycle,
      payload: { _fout: 'body_onleesbaar' }, applied: false, error: 'body_onleesbaar',
    });
    return json(res, 400, { error: 'Could not read body' });
  }

  const authHeader = req.headers['authorization'] || '';
  const sigHeader = req.headers['x-plug-signature']
    || req.headers['x-plugpay-signature']
    || req.headers['x-signature']
    || '';

  if (!verifyAuth({ rawBody: raw, signatureHeader: sigHeader, authHeader, urlKey })) {
    console.warn('[plugpay] invalid auth');
    // Bewust wél loggen: anders is een verkeerd ingestelde webhook-URL onzichtbaar.
    await logEvent({
      email: null, eventType: urlType, category: 'unknown', cycle: urlCycle,
      payload: { _fout: 'auth_geweigerd', _body: String(raw).slice(0, 2000) },
      applied: false, error: 'auth_geweigerd',
    });
    return json(res, 401, { error: 'Invalid auth' });
  }

  let body;
  try {
    body = parseBody(raw, req.headers['content-type']);
  } catch {
    await logEvent({
      email: null, eventType: urlType, category: 'unknown', cycle: urlCycle,
      payload: { _fout: 'body_niet_parsebaar', _body: String(raw).slice(0, 2000) },
      applied: false, error: 'body_niet_parsebaar',
    });
    return json(res, 400, { error: 'Invalid body' });
  }

  const email = pickPath(body, 'email', 'customer_email', 'customer.email', 'contact.email',
    'billing.email', 'data.customer.email', 'data.email', 'order.customer.email',
    'order.customer_email', 'subscriber.email');
  const bodyEventType = pickPath(body, 'trigger_type', 'event', 'event_type', 'type', 'action');
  const customerId = pickPath(body, 'customer.id', 'customer_id', 'data.customer.id',
    'order.customer.id', 'subscriber.id');
  const nextDate = pickNextDate(body);

  const rawType = urlType || bodyEventType || null;
  const category = classifyEvent(rawType);
  const cycle = detectCycle(body, urlCycle);

  console.log(`[plugpay] type=${rawType || '(none)'} category=${category} email=${email || '(none)'} datum=${nextDate || '(none)'} cycle=${cycle || '(none)'}${dryrun ? ' DRYRUN' : ''}`);

  if (!email) {
    await logEvent({
      email: null, eventType: rawType, category, cycle, payload: body,
      applied: false, error: 'geen_email_in_payload',
    });
    return json(res, 400, { error: 'Email missing in webhook payload' });
  }

  const emailLower = String(email).toLowerCase().trim();
  let update = {};
  let wantInsert = false;
  let note = null;

  if (category === 'activated') {
    // Grendel: iemand die zonet betaald heeft mag nooit een einddatum in het verleden
    // krijgen — dan sluit zijn eigen betaling hem buiten. Pakken we per ongeluk een
    // verkeerd veld (een orderdatum, een vorige periode), dan valt hij hier weg.
    const datumIsVerleden = nextDate && new Date(nextDate).getTime() < Date.now();
    const eindDatum = (!nextDate || datumIsVerleden) ? fallbackEndDate(cycle) : nextDate;
    if (datumIsVerleden) note = `datum_in_verleden_genegeerd:${nextDate}`;
    else if (!nextDate) note = `fallback_datum:${cycle || 'monthly'}`;
    update = {
      subscription_active: true,
      cancelled_at: null,
      subscription_end_date: eindDatum,
    };
    if (customerId) update.plugpay_customer_id = String(customerId);
    wantInsert = true;
  } else if (category === 'cancelled') {
    // Opgezegd maar nog betaald tot de einddatum — enkel een marker, geen intrekking.
    update.cancelled_at = new Date().toISOString();
    if (nextDate) update.subscription_end_date = nextDate;
  } else if (category === 'expired') {
    update = { subscription_active: false };
    if (nextDate) update.subscription_end_date = nextDate;
  }

  if (dryrun) {
    await logEvent({
      email: emailLower, eventType: rawType, category, cycle, payload: body,
      applied: false, error: 'dryrun',
    });
    return json(res, 200, { received: true, dryrun: true, category, zou_schrijven: update });
  }

  let applied = false;
  let applyError = null;
  if (category !== 'unknown') {
    try {
      const q = wantInsert
        ? supabase.from('allowed_users').upsert({ email: emailLower, ...update }, { onConflict: 'email' })
        : supabase.from('allowed_users').update(update).ilike('email', emailLower);
      const { error } = await q;
      if (error) throw new Error(error.message);
      invalidateSubscriptionCache(emailLower);
      applied = true;
    } catch (err) {
      applyError = err.message;
      console.error('[plugpay] db error:', err.message);
    }
  }

  await logEvent({
    email: emailLower, eventType: rawType, category, cycle,
    payload: body, applied, error: applyError || note,
  });

  if (category === 'unknown') {
    return json(res, 200, { received: true, ignored: true, reason: 'unknown_event_type' });
  }
  if (!applied) {
    return json(res, 500, { received: true, applied: false, error: applyError });
  }
  return json(res, 200, { received: true, applied: category, end_date: update.subscription_end_date || null });
}
