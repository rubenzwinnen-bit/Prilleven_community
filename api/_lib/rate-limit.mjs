// Rate limiting via public.usage_log.
// Flex-key: voor ingelogde users wordt gekeyed op user_id, anders op ip_hash.

import { createHash } from 'node:crypto';
import { supabase } from './clients.mjs';

// Anonymous (fallback) limits — blijven streng omdat onbekende IP's mogelijk scrapers zijn.
export const LIMIT_PER_HOUR = 10;
export const LIMIT_PER_DAY = 50;
export const COST_CAP_CENTS_PER_DAY = 50; // €0.50 per IP per dag

// Authenticated (paying) users — ruimere limieten.
export const LIMIT_PER_HOUR_USER = 50;
export const LIMIT_PER_DAY_USER = 500;
export const COST_CAP_CENTS_PER_DAY_USER = 50; // €0.50 per user per dag
export const COST_CAP_CENTS_PER_MONTH_USER = 250; // €2.50 per user per (kalender)maand

// Foto-upload limiet: apart van normale queries omdat vision-requests duurder zijn.
export const IMAGE_LIMIT_PER_DAY_USER = 50;

export function hashIp(ip) {
  return createHash('sha256').update(String(ip || 'unknown')).digest('hex');
}

export function extractIp(req) {
  return (
    req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers?.['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

/**
 * Check of deze key (user_id of ip_hash) rate-limits heeft overschreden.
 * @param {Object} opts
 * @param {string} opts.key            — user_id UUID of ip_hash string
 * @param {'user_id'|'ip_hash'} opts.keyCol — welke kolom in usage_log gebruikt wordt
 * @param {boolean} opts.isUser        — bepaalt of de user-limits gelden
 */
export async function checkRateLimit({ key, keyCol, isUser = false }) {
  const hourLimit = isUser ? LIMIT_PER_HOUR_USER : LIMIT_PER_HOUR;
  const dayLimit  = isUser ? LIMIT_PER_DAY_USER  : LIMIT_PER_DAY;

  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const dayAgo  = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const { count: hourCount, error: hourErr } = await supabase
    .from('usage_log')
    .select('*', { count: 'exact', head: true })
    .eq(keyCol, key)
    .eq('event', 'query')
    .gte('created_at', hourAgo);
  if (hourErr) throw new Error(`Rate limit hour query: ${hourErr.message}`);

  if (hourCount >= hourLimit) {
    return { allowed: false, reason: 'hour', remaining: 0, hourLimit, dayLimit };
  }

  const { count: dayCount, error: dayErr } = await supabase
    .from('usage_log')
    .select('*', { count: 'exact', head: true })
    .eq(keyCol, key)
    .eq('event', 'query')
    .gte('created_at', dayAgo);
  if (dayErr) throw new Error(`Rate limit day query: ${dayErr.message}`);

  if (dayCount >= dayLimit) {
    return { allowed: false, reason: 'day', remaining: 0, hourLimit, dayLimit };
  }

  return {
    allowed: true,
    reason: null,
    remaining: Math.min(hourLimit - hourCount, dayLimit - dayCount),
    hourLimit,
    dayLimit,
  };
}

/**
 * Check dagelijkse €-cost cap op dezelfde key.
 * Fail-open bij DB-fout (niet blokkeren als DB hikt).
 */
export async function checkCostCap({ key, keyCol, isUser = false }) {
  const cap = isUser ? COST_CAP_CENTS_PER_DAY_USER : COST_CAP_CENTS_PER_DAY;
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('usage_log')
    .select('cost_cents')
    .eq(keyCol, key)
    .gte('created_at', dayAgo);
  if (error) {
    console.error(`[cost-cap] ${error.message}`);
    return { allowed: true, spentCents: 0, cap };
  }
  const spentCents = (data || []).reduce((sum, r) => sum + Number(r.cost_cents || 0), 0);
  return {
    allowed: spentCents < cap,
    spentCents,
    cap,
  };
}

/**
 * Check maandelijkse €-cost cap (kalendermaand: sinds de 1e van de huidige maand).
 * Fail-open bij DB-fout.
 */
export async function checkMonthlyCostCap({ key, keyCol, isUser = false }) {
  // Enkel voor ingelogde users — anon. IPs hebben al een strenge dagcap.
  if (!isUser) return { allowed: true, spentCents: 0, cap: Infinity };
  const cap = COST_CAP_CENTS_PER_MONTH_USER;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).toISOString();
  const { data, error } = await supabase
    .from('usage_log')
    .select('cost_cents')
    .eq(keyCol, key)
    .gte('created_at', monthStart);
  if (error) {
    console.error(`[cost-cap-month] ${error.message}`);
    return { allowed: true, spentCents: 0, cap };
  }
  const spentCents = (data || []).reduce((sum, r) => sum + Number(r.cost_cents || 0), 0);
  return {
    allowed: spentCents < cap,
    spentCents,
    cap,
  };
}

/**
 * Check specifieke limiet voor image-queries (aparte teller).
 * Telt alle events met had_image=true in laatste 24h.
 * We gebruiken een aparte event-type 'query_with_image' voor simpelheid.
 */
export async function checkImageRateLimit({ key, keyCol }) {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('usage_log')
    .select('*', { count: 'exact', head: true })
    .eq(keyCol, key)
    .eq('event', 'query_with_image')
    .gte('created_at', dayAgo);
  if (error) {
    console.error(`[image-rate-limit] ${error.message}`);
    return { allowed: true, remaining: IMAGE_LIMIT_PER_DAY_USER, limit: IMAGE_LIMIT_PER_DAY_USER };
  }
  const used = count || 0;
  return {
    allowed: used < IMAGE_LIMIT_PER_DAY_USER,
    remaining: Math.max(0, IMAGE_LIMIT_PER_DAY_USER - used),
    limit: IMAGE_LIMIT_PER_DAY_USER,
  };
}

/**
 * Log 1 event naar usage_log.
 * ipHash en userId zijn beide optioneel — laat onbekende null.
 */
export async function logUsage({ userId = null, ipHash = null, event, tokensIn = 0, tokensOut = 0, costCents = 0 }) {
  const { error } = await supabase.from('usage_log').insert({
    user_id: userId,
    ip_hash: ipHash,
    event,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_cents: costCents,
  });
  if (error) console.error(`[usage_log] ${error.message}`);
}
