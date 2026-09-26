// Voorgestelde vervolgvragen onder een antwoord (sinds 2026-09-26).
//
// Na het antwoord maakt een klein model 2 à 3 korte vragen die de ouder als
// volgende zou kunnen stellen. Ze worden als knopjes onder het antwoord getoond;
// een klik stuurt de vraag meteen door. De vragen blijven dicht bij de onderwerpen
// van de opgehaalde bronnen, zodat HapjesHeld ze ook echt kan beantwoorden.
//
// Bij een fout of na SUGGEST_TIMEOUT_MS: geen suggesties, het antwoord staat er al.

import { anthropic } from './clients.mjs';
import { MODELS } from './model-router.mjs';

export const SUGGEST_MODEL = MODELS.HAIKU;
const SUGGEST_TIMEOUT_MS = 4000;
const MAX_SUGGESTIONS = 3;
const MAX_SUGGESTION_CHARS = 80;
const MAX_ANSWER_CHARS = 1500;
const MAX_SOURCE_TITLES = 10;

const SYSTEM = `Je bedenkt korte vervolgvragen voor een chatbot over kindervoeding. Een ouder stelde een vraag en kreeg een antwoord. Geef 2 of 3 vragen die deze ouder daarna logisch zou kunnen stellen.

- Schrijf in de ik-vorm van de ouder, in het Nederlands, als echte vraag met een vraagteken (bv. "Kan ik dit ook invriezen?", "Welke groenten passen bij 7 maanden?").
- Maximum 10 woorden per vraag. Geen opsommingen, geen uitleg.
- Blijf bij de onderwerpen van het gesprek en van de bronnen hieronder: de chatbot kan enkel antwoorden wat in die kennisbank staat.
- Herhaal de vraag niet en vraag niets wat het antwoord al volledig uitlegt.
- Geen medische vragen over klachten of ziekte, tenzij de ouder daar zelf over begon.
- Zegt het antwoord dat het iets niet in de kennisbank vindt, stel dan vragen over een verwant onderwerp dat wél in de bronnen staat.
- Antwoord ALLEEN met de vragen, één per regel, zonder nummering of opsommingstekens.`;

/**
 * @param {{ question: string, answer: string, chunks?: Array<{title?: string, source?: string}>, model?: {id, costInCents, costOutCents} }} args
 * @returns {Promise<{ suggestions: string[], tokensIn: number, tokensOut: number, costCents: number }>}
 */
export async function suggestFollowUps({ question, answer, chunks = [], model = SUGGEST_MODEL }) {
  const result = { suggestions: [], tokensIn: 0, tokensOut: 0, costCents: 0 };
  if (!answer) return result;

  const titles = [...new Set(chunks.map(c => c.title).filter(Boolean))].slice(0, MAX_SOURCE_TITLES);
  const shortAnswer = answer.length > MAX_ANSWER_CHARS ? answer.slice(0, MAX_ANSWER_CHARS) + '…' : answer;

  try {
    const r = await anthropic.messages.create({
      model: model.id,
      max_tokens: 150,
      thinking: { type: 'disabled' },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Vraag van de ouder: ${question}\n\nAntwoord van de chatbot:\n${shortAnswer}${titles.length ? `\n\nBronnen uit de kennisbank:\n${titles.map(t => `- ${t}`).join('\n')}` : ''}`,
      }],
    }, { timeout: SUGGEST_TIMEOUT_MS, maxRetries: 0 });
    result.tokensIn = r.usage?.input_tokens ?? 0;
    result.tokensOut = r.usage?.output_tokens ?? 0;
    result.costCents = result.tokensIn * model.costInCents + result.tokensOut * model.costOutCents;
    const lower = question.trim().toLowerCase();
    result.suggestions = r.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
      .split('\n')
      .map(l => l.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').replace(/^["'«»]+|["'«»]+$/g, '').trim())
      .filter(l => l.endsWith('?') && l.length <= MAX_SUGGESTION_CHARS && l.toLowerCase() !== lower)
      .slice(0, MAX_SUGGESTIONS);
  } catch (e) {
    console.error('[follow-up-suggestions]', e.message);
  }
  return result;
}
