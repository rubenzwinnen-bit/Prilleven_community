// GET /api/subscription-status?email=foo@bar.be
// Publiek endpoint — returnt enkel non-sensitive velden (active, endDate, isAdmin).
// Gevoelige info (plugpay_customer_id, cancelled_at details) wordt NIET meegegeven.

import { getAccessStatus } from './_lib/subscription.mjs';

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  if (req.method !== 'GET') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  // Parse email uit querystring
  const url = new URL(req.url, 'http://x');
  const email = (url.searchParams.get('email') || '').trim().toLowerCase();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(res, 400, { error: 'Geldig email adres vereist.' });
  }

  try {
    const status = await getAccessStatus(email);
    return json(res, 200, {
      active: status.active,
      reason: status.reason,
      end_date: status.endDate,
      is_admin: status.isAdmin,
    });
  } catch (err) {
    console.error('[subscription-status]', err);
    return json(res, 500, { error: 'Kon status niet ophalen.' });
  }
}
