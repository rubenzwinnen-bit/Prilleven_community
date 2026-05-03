// Lichtgewicht woord-blacklist voor de community feed.
// Aanvullingen op deze lijst hier toevoegen — bewust kort houden om
// false positives te beperken. Bij twijfel: niet opnemen.
//
// Match-strategie: case-insensitive, woord-grenzen (\b...\b) zodat "klootzak"
// niet matcht in "voetbalclubzak". Diakritieken worden eerst genormaliseerd.

const BLOCKED_WORDS = [
  // Scheldwoorden / beledigingen (hard)
  'kankerlijer', 'kankerhoer', 'kanker hoer',
  'klootzak', 'eikel', 'lul',
  'hoer', 'slet', 'teef',
  'mongool', 'mongolen',
  // Discriminatie
  'neger', 'nikker',
  // Spam triggers
  'viagra', 'cialis', 'casino', 'crypto pump',
  // Voeg hier toe wanneer rapporten dat aantonen.
];

function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // accenten weg
    .toLowerCase();
}

/**
 * Returnt het eerste geblokkeerde woord dat in de tekst voorkomt, of null.
 * Gebruikt woord-grenzen om binnen-woord matches te voorkomen.
 */
export function findBlockedWord(text) {
  const normalized = normalize(text);
  for (const word of BLOCKED_WORDS) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    if (re.test(normalized)) return word;
  }
  return null;
}

export function containsBlockedWord(text) {
  return findBlockedWord(text) !== null;
}
