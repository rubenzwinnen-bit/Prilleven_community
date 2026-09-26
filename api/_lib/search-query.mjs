// Vervolgvragen herschrijven tot een zelfstandige zoekvraag (sinds 2026-09-26).
//
// De retrieval zoekt enkel op de laatste vraag. Bij "en zonder courgette?" of
// "kan ik dit invriezen?" vindt de vectorzoek dan de verkeerde fragmenten, ook al
// kent Claude het gesprek. Daarom maakt een klein model er eerst een volledige
// zoekvraag van ("wafels zonder courgette recept"). Enkel voor het zoeken: het
// antwoord zelf gaat nog altijd over de echte vraag, met de volledige geschiedenis.
//
// Bij een fout of na REWRITE_TIMEOUT_MS zoeken we gewoon met de originele vraag.

import { anthropic } from './clients.mjs';
import { MODELS } from './model-router.mjs';

export const REWRITE_MODEL = MODELS.HAIKU;
const REWRITE_TIMEOUT_MS = 3000;
// Laatste 3 beurten (vraag + antwoord) volstaan om het onderwerp te kennen.
const HISTORY_MESSAGES = 6;
// Lange antwoorden (dagplannen, recepten) inkorten: het onderwerp staat vooraan.
const MAX_ANSWER_CHARS = 600;

const SYSTEM = `Je herschrijft de laatste vraag uit een gesprek met een chatbot over kindervoeding tot één zelfstandige zoekvraag voor een kennisbank.

- Vul aan met het onderwerp uit het gesprek waar de vraag naar verwijst (bv. "dit", "die", "en zonder …?", "hoe lang?"), zodat de zoekvraag zonder het gesprek te begrijpen is.
- Voeg niets toe dat niet in het gesprek of de vraag staat. Geen eigen kennis, geen antwoord.
- Staat de vraag al op zichzelf, geef ze dan ongewijzigd terug.
- Behoud een leeftijd of allergie die in het gesprek genoemd wordt als die voor de vraag van belang is.
- Antwoord ALLEEN met de zoekvraag, in het Nederlands, zonder aanhalingstekens.`;

/**
 * @param {Array<{role: string, content: string}>} history — eerdere berichten, oudste eerst
 * @param {string} question — de nieuwe vraag
 * @param {{ model?: {id, costInCents, costOutCents} }} [opts]
 * @returns {Promise<{ query: string, rewritten: boolean, tokensIn: number, tokensOut: number, costCents: number }>}
 */
export async function rewriteFollowUpQuestion(history, question, { model = REWRITE_MODEL } = {}) {
  const result = { query: question, rewritten: false, tokensIn: 0, tokensOut: 0, costCents: 0 };
  const recent = (history || [])
    .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content)
    .slice(-HISTORY_MESSAGES);
  if (!question || recent.length === 0) return result;

  const transcript = recent
    .map(m => {
      const text = m.role === 'assistant' && m.content.length > MAX_ANSWER_CHARS
        ? m.content.slice(0, MAX_ANSWER_CHARS) + '…'
        : m.content;
      return `${m.role === 'user' ? 'Ouder' : 'Chatbot'}: ${text}`;
    })
    .join('\n\n');

  try {
    const r = await anthropic.messages.create({
      model: model.id,
      max_tokens: 100,
      thinking: { type: 'disabled' },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Gesprek tot nu toe:\n\n${transcript}\n\n---\n\nLaatste vraag: ${question}`,
      }],
    }, { timeout: REWRITE_TIMEOUT_MS, maxRetries: 0 });
    result.tokensIn = r.usage?.input_tokens ?? 0;
    result.tokensOut = r.usage?.output_tokens ?? 0;
    result.costCents = result.tokensIn * model.costInCents + result.tokensOut * model.costOutCents;
    const text = r.content.filter(b => b.type === 'text').map(b => b.text).join(' ').trim()
      .split('\n')[0].replace(/^["'«»]+|["'«»]+$/g, '').trim();
    if (text && text.length <= 300) {
      result.query = text;
      result.rewritten = text !== question;
    }
  } catch (e) {
    console.error('[search-query]', e.message);
  }
  return result;
}
