// Mogelijke tikfout in het e-mailadres van een nieuwe betaling (sinds 2026-11-15).
//
// Plug&Pay controleert niet of een adres bestaat. Wie bij het afrekenen
// "outliok.com" typt, betaalt gewoon, en de webhook zet dat foute adres in
// allowed_users. Registreren met het echte adres lukt dan niet ("niet bekend"),
// en verlengingen blijven op het foute adres binnenkomen. Gezien bij
// jolita_smets@outliok.com (07-11-2026, outliok.com is een geparkeerd domein).
//
// Lijkt het domein sterk op een bekend maildomein zonder het te zijn, dan krijgt
// het team een mail. Die gaat nooit naar de klant zelf: dat adres werkt niet.

const BEKENDE_DOMEINEN = [
  'gmail.com', 'googlemail.com',
  'hotmail.com', 'hotmail.be', 'hotmail.nl', 'hotmail.fr',
  'outlook.com', 'outlook.be', 'outlook.nl',
  'live.com', 'live.be', 'live.nl', 'msn.com',
  'icloud.com', 'me.com', 'mac.com',
  'yahoo.com', 'yahoo.fr',
  'telenet.be', 'skynet.be', 'proximus.be', 'scarlet.be',
  'kpnmail.nl', 'ziggo.nl', 'planet.nl', 'home.nl',
];
const BEKEND = new Set(BEKENDE_DOMEINEN);

const VAN_ADRES = 'Pril Leven <noreply@prilleven.be>';
const TEAM_MAIL = 'hallo@prilleven.be';
const MAIL_TIMEOUT_MS = 3000;

// Bewerkingsafstand met omwisselen van twee letters als één fout ("gmial").
function afstand(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const kost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + kost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/**
 * Geeft het vermoedelijk bedoelde adres terug ("…@outlook.com"), of null.
 * Korte domeinen (≤ 8 tekens) mogen 1 fout bevatten, langere 2 — anders lijkt
 * bv. "me.com" op "mac.com".
 */
export function vermoedelijkeTikfout(email) {
  const [lokaal, domein] = String(email || '').toLowerCase().trim().split('@');
  if (!lokaal || !domein || BEKEND.has(domein)) return null;
  const max = domein.length <= 8 ? 1 : 2;
  let beste = null;
  for (const kandidaat of BEKENDE_DOMEINEN) {
    const a = afstand(domein, kandidaat);
    if (a <= max && (!beste || a < beste.a)) beste = { kandidaat, a };
  }
  return beste ? `${lokaal}@${beste.kandidaat}` : null;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * Mailt het team bij een vermoedelijke tikfout. Gooit nooit en wacht hooguit
 * 3 s: een betaling verwerken gaat altijd voor.
 * @returns {Promise<string|null>} het voorgestelde adres als er gemaild is
 */
export async function meldMogelijkeTikfout({ email, customerId }) {
  try {
    const suggestie = vermoedelijkeTikfout(email);
    if (!suggestie) return null;
    console.warn(`[email-typo] mogelijke tikfout: ${email} → ${suggestie}`);
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      console.error('[email-typo] RESEND_API_KEY ontbreekt — geen mail verstuurd');
      return null;
    }
    const html = `
      <p>Er kwam een betaling binnen voor een e-mailadres dat op een tikfout lijkt.</p>
      <ul>
        <li><strong>Adres in Plug&amp;Pay:</strong> ${escapeHtml(email)}</li>
        <li><strong>Bedoeld waarschijnlijk:</strong> ${escapeHtml(suggestie)}</li>
        <li><strong>Plug&amp;Pay-klantnummer:</strong> ${escapeHtml(customerId || 'onbekend')}</li>
      </ul>
      <p>Met dit adres kan de klant zich niet registreren, en verlengingen komen op het
         foute adres binnen. Vraag het juiste adres na (de klant krijgt geen mail op het
         foute adres), verbeter het bij de klant in Plug&amp;Pay, en pas het daarna aan in
         <code>allowed_users</code>.</p>
    `;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: VAN_ADRES,
        to: [TEAM_MAIL],
        subject: `Mogelijke tikfout in e-mailadres: ${email}`,
        html,
      }),
      signal: AbortSignal.timeout(MAIL_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error('[email-typo] Resend gaf', res.status, await res.text().catch(() => ''));
      return null;
    }
    return suggestie;
  } catch (err) {
    console.error('[email-typo] melden mislukt', err.message);
    return null;
  }
}
