// Model router: sinds 2026-09-26 gaat élke chatvraag naar Sonnet 4.6.
// Haiku vulde bij korte vragen te vaak zelf aan met kennis die niet in
// Anneleens kennisbank staat (testset: trouw 4,33 → 4,60 met enkel Sonnet).
// De reden blijft gelogd (vision / medical-keyword / default) voor de logs.
// Haiku wordt nog wel gebruikt voor titels, geheugen en foto-ingrediënten.

export const MODELS = {
  HAIKU: {
    id: 'claude-haiku-4-5',
    // Haiku 4.5: $1 input / $5 output per 1M tokens. Converted to eurocents/token.
    costInCents: 0.0001 * 0.92,
    costOutCents: 0.0005 * 0.92,
  },
  SONNET: {
    id: 'claude-sonnet-4-6',
    // Sonnet 4.6: $3 input / $15 output per 1M tokens.
    costInCents: 0.0003 * 0.92,
    costOutCents: 0.0015 * 0.92,
  },
};

// Medische trefwoorden → doorsluizen naar Sonnet voor hogere accuraatheid.
// Gefocust op signalen die op een medische zorg wijzen, NIET op educatieve
// termen zoals "allergeen introduceren" (= preventief leren omgaan).
const MEDICAL_PATTERNS = [
  /\bkoorts\b/i,
  /\banafylact/i,
  /\ballergische\s+reactie\b/i,
  /\ballergische\s+shock\b/i,
  /\bbraken\b/i,
  /\bovergeven\b/i,
  /\bdiarree\b/i,
  /\bdehydrat/i,
  /\buitgedroogd/i,
  /\bbloed\s+(in|bij|na)/i,
  /\bbloederige\b/i,
  /\bziek\b/i,
  /\bziekte\b/i,
  /\beczeem\b/i,
  /\buitslag\b/i,
  /\bhuiduitslag\b/i,
  /\bjeuk\b/i,
  /\bzwelling\b/i,
  /\bopgezwollen\b/i,
  /\bbenauwd/i,
  /\bademhaling\b/i,
  /\bverstikking/i,
  /\bgestikt\b/i,
  /\bkrampen\b/i,
  /\bdarmontsteking\b/i,
  /\bontsteking\b/i,
  /\bverstopping\b/i,
  /\bconstipatie\b/i,
  /\bhuilbaby\b/i,
  /\bgroeiachterstand\b/i,
  /\bondergewicht\b/i,
  /\bmedicijn/i,
  /\bmedicatie\b/i,
  /\bvoedselvergifti/i,
];

export function hasMedicalKeyword(text) {
  if (!text) return false;
  return MEDICAL_PATTERNS.some((re) => re.test(text));
}

/**
 * Kies het beste model voor een vraag.
 * @param {object} ctx
 * @param {boolean} ctx.hasImage      — foto in de request (vision)
 * @param {string}  ctx.question      — de gebruikersvraag
 * @param {number|null} ctx.topScore  — beste similarity score uit retrieval
 * @returns {{ model: {id, costInCents, costOutCents}, reason: string }}
 */
export function pickModel({ hasImage = false, question = '', topScore = null }) {
  if (hasImage) {
    return { model: MODELS.SONNET, reason: 'vision' };
  }
  if (hasMedicalKeyword(question)) {
    return { model: MODELS.SONNET, reason: 'medical-keyword' };
  }
  return { model: MODELS.SONNET, reason: 'default' };
}
