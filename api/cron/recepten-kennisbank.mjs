// GET /api/cron/recepten-kennisbank — Vercel Cron, elke nacht (zie "crons" in vercel.json).
// Synchroniseert de weekschema-recepten met de kennisbank van HapjesHeld: nieuwe en
// gewijzigde recepten worden ge-embed, verwijderde gaan eruit (zie _lib/recipe-knowledge.mjs).
//
// Vercel stuurt `Authorization: Bearer <CRON_SECRET>` mee als die env-var bestaat.
// Zonder CRON_SECRET weigert deze endpoint alles: hij schrijft naar productie en
// roept Voyage aan, dus hij mag niet publiek aan te roepen zijn.

import { syncRecipeKnowledge } from '../_lib/recipe-knowledge.mjs';

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return json(res, 401, { error: 'Niet toegestaan.' });
  }

  try {
    const r = await syncRecipeKnowledge({ schrijf: true });
    const samenvatting = {
      recepten: r.recepten,
      nieuw: r.nieuw.map(f => f.title),
      gewijzigd: r.gewijzigd.map(f => f.title),
      verwijderd: r.verwijderd,
      gekoppeld: r.gekoppeld.map(k => `${k.name} → ${k.docId}`),
      ontkoppeld: r.ontkoppeld.map(k => k.docId),
    };
    console.log('[cron][recepten-kennisbank]', JSON.stringify(samenvatting));
    return json(res, 200, samenvatting);
  } catch (e) {
    console.error('[cron][recepten-kennisbank]', e.message);
    return json(res, 500, { error: e.message });
  }
}
