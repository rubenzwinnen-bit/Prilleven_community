// Server-side subscription check.
// Gebruikt de get_user_access RPC (efficiënt — returnt exactly wat we nodig hebben).

import { supabase } from './clients.mjs';

const CACHE_TTL_MS = 60 * 1000; // 1 minuut: kort genoeg voor snelle propagatie, lang genoeg voor performance
const cache = new Map(); // email → { status, expiresAt }

/**
 * Geef de huidige toegangsstatus van een user.
 *
 * Returnt:
 *   {
 *     active: boolean,             // mag gebruiker de site/chat gebruiken?
 *     reason: string|null,         // 'expired' | 'cancelled' | 'not_registered' | null
 *     endDate: ISO string|null,    // wanneer abonnement afloopt
 *     cancelledAt: ISO string|null,
 *     isAdmin: boolean,
 *   }
 *
 * Regels:
 *   - subscription_active = false → geen toegang (reason 'expired' of 'cancelled')
 *   - subscription_end_date in verleden → geen toegang (reason 'expired')
 *   - email bestaat niet in allowed_users → geen toegang (reason 'not_registered')
 *   - anders → toegang
 * Admins krijgen altijd toegang (is_admin=true override).
 */
export async function getAccessStatus(email) {
  if (!email) return { active: false, reason: 'not_registered', endDate: null, cancelledAt: null, isAdmin: false };

  const normalized = String(email).toLowerCase().trim();
  const now = Date.now();

  // Cache hit?
  const cached = cache.get(normalized);
  if (cached && cached.expiresAt > now) return cached.status;

  // Hard pruning: als cache te groot, oudste verwijderen
  if (cache.size > 500) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }

  const { data, error } = await supabase.rpc('get_user_access', { target_email: normalized });
  if (error) {
    console.error('[subscription] rpc error:', error.message);
    // Fail-open bij DB-fout — niet iedereen plots buiten zetten
    return { active: true, reason: null, endDate: null, cancelledAt: null, isAdmin: false };
  }

  const row = Array.isArray(data) ? data[0] : null;
  if (!row) {
    const status = { active: false, reason: 'not_registered', endDate: null, cancelledAt: null, isAdmin: false };
    cache.set(normalized, { status, expiresAt: now + CACHE_TTL_MS });
    return status;
  }

  const isAdmin = !!row.is_admin;
  const endDate = row.subscription_end_date;
  const cancelledAt = row.cancelled_at;

  // Admin altijd toegang
  if (isAdmin) {
    const status = { active: true, reason: null, endDate, cancelledAt, isAdmin: true };
    cache.set(normalized, { status, expiresAt: now + CACHE_TTL_MS });
    return status;
  }

  // Check end_date (als gezet)
  const endExpired = endDate && new Date(endDate).getTime() < now;

  let active = row.subscription_active === true && !endExpired;
  let reason = null;
  if (!active) {
    if (endExpired) reason = 'expired';
    else if (cancelledAt) reason = 'cancelled';
    else reason = 'expired';
  }

  const status = { active, reason, endDate, cancelledAt, isAdmin: false };
  cache.set(normalized, { status, expiresAt: now + CACHE_TTL_MS });
  return status;
}

/** Invalideer cache voor 1 email (bv. na een subscription-update via webhook). */
export function invalidateSubscriptionCache(email) {
  if (!email) return;
  cache.delete(String(email).toLowerCase().trim());
}

/** Hulp-tekst voor error responses. */
export function accessDeniedMessage(status) {
  if (!status) return 'Je hebt geen toegang. Log opnieuw in.';
  if (status.reason === 'not_registered')
    return 'Je account is niet geregistreerd. Neem contact op als dit een fout is.';
  if (status.reason === 'cancelled' || status.reason === 'expired')
    return 'Je abonnement is verlopen. Verleng je lidmaatschap op prilleven.be om weer toegang te krijgen.';
  return 'Je hebt momenteel geen toegang tot deze app.';
}
