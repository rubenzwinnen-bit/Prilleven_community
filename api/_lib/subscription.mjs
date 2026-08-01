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
const TZ = 'Europe/Brussels';

/** Kalenderdag (y/m/d + ISO-weekdag 1-7) van een datum in Brusselse tijd. */
function brusselsDay(date) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(date);
  const get = (t) => p.find((x) => x.type === t)?.value;
  const isoDow = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[get('weekday')];
  return { y: +get('year'), m: +get('month'), d: +get('day'), isoDow };
}

/**
 * Het werkelijke moment waarop toegang vervalt, in ms.
 *
 * Twee correcties op de ruwe subscription_end_date:
 *
 *  1. Toegang loopt tot het EINDE van de einddatum, niet tot 00:00 ervan.
 *     Plug&Pay levert de incassodatum zonder tijd; zonder deze correctie
 *     verliest iemand toegang op de ochtend van de dag dat hij betaalt.
 *
 *  2. Valt de einddatum in een weekend, dan schuift hij naar de eerstvolgende
 *     dinsdag. SEPA-incasso's worden enkel op bankwerkdagen aangeboden: een
 *     incasso van zaterdag of zondag wordt pas maandag verwerkt. Zonder deze
 *     marge sluiten we betalende leden buiten voor geld dat de bank nog moet
 *     overmaken. Dinsdag i.p.v. maandag geeft de webhook een dag speling.
 *
 * Geldt voor iedereen — huidige en toekomstige leden, ongeacht of de datum
 * via de webhook, met de hand of via een import in de tabel kwam.
 */
export function effectiveExpiry(endDate) {
  const raw = new Date(endDate);
  if (Number.isNaN(raw.getTime())) return Infinity;

  const { y, m, d, isoDow } = brusselsDay(raw);
  const extra = isoDow === 6 ? 3 : isoDow === 7 ? 2 : 0; // za -> di, zo -> di

  // Middernacht ná de (eventueel verschoven) laatste dag, in Brusselse tijd.
  // Date.UTC + de offset van dat moment, zodat zomer/wintertijd klopt.
  const naiveUtc = Date.UTC(y, m - 1, d + extra + 1);
  const offsetMin = brusselsOffsetMinutes(new Date(naiveUtc));
  return naiveUtc - offsetMin * 60 * 1000;
}

/** UTC-offset van Europe/Brussels op een gegeven moment, in minuten. */
function brusselsOffsetMinutes(at) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, timeZoneName: 'longOffset',
  }).formatToParts(at).find((x) => x.type === 'timeZoneName')?.value || 'GMT+00:00';
  const mm = /GMT([+-])(\d{2}):(\d{2})/.exec(p);
  if (!mm) return 0;
  return (mm[1] === '-' ? -1 : 1) * (Number(mm[2]) * 60 + Number(mm[3]));
}

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

  // Check end_date (als gezet), met de weekend-marge uit effectiveExpiry()
  const endExpired = endDate && effectiveExpiry(endDate) < now;

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
