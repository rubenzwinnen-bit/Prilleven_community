// JWT-auth middleware voor de chat-API.
// Leest "Authorization: Bearer <jwt>" uit de request en valideert tegen
// Supabase /auth/v1/user. Resultaten worden 5 min gecached om overhead
// van validatie te beperken (onder Vercel Fluid Compute: module-level state
// wordt hergebruikt tussen warme invocations).

const SUPABASE_URL = process.env.SUPABASE_URL;
// Anon key is niet strikt geheim (is publiek in de frontend); maar als die niet
// in env staat, valt de validatie terug op de service role key — die werkt ook.
const SUPABASE_API_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // jwt → { userId, email, expiresAt }

export class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Valideer de JWT in de request-header.
 * Gooit AuthError(401) als ontbrekend of ongeldig.
 * Returnt { userId, email }.
 */
export async function requireAuth(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw new AuthError(401, 'Geen geldige sessie. Log opnieuw in.');
  const jwt = match[1].trim();

  // Cache hit?
  const now = Date.now();
  const cached = cache.get(jwt);
  if (cached && cached.expiresAt > now) {
    return { userId: cached.userId, email: cached.email, jwt };
  }

  if (!SUPABASE_URL || !SUPABASE_API_KEY) {
    throw new AuthError(500, 'Server is niet correct geconfigureerd (auth).');
  }

  // Valideer via Supabase
  const res = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: {
      apikey: SUPABASE_API_KEY,
      Authorization: 'Bearer ' + jwt,
    },
  });
  if (!res.ok) {
    throw new AuthError(401, 'Sessie verlopen. Log opnieuw in.');
  }
  const user = await res.json();
  if (!user?.id) throw new AuthError(401, 'Ongeldige sessie.');

  const entry = {
    userId: user.id,
    email: user.email || null,
    expiresAt: now + CACHE_TTL_MS,
  };
  cache.set(jwt, entry);

  // Cache-size cap zodat lang-lopende processen niet eindeloos groeien.
  if (cache.size > 500) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }

  return { userId: entry.userId, email: entry.email, jwt };
}
