// POST /api/chat
// Body: { question: string, conversation_id?: string }
// Headers: Authorization: Bearer <supabase-jwt>
// Returns: { answer, sources, cached, topScore, model, modelReason, conversation_id }
//
// Flow (Fase A — auth + conversatie-history):
//   1. requireAuth → userId (JWT validate)
//   2. Input validation
//   3. Rate-limit + cost cap op user_id
//   4. Resolve of maak conversation
//   5. Cache check (globaal — per-user cache komt in latere fase)
//   6. Laad laatste N messages als LLM-context
//   7. Retrieve chunks via Voyage + pgvector
//   8. Out-of-scope fallback indien topScore < threshold
//   9. Claude call met history + context
//  10. Store user + assistant messages; genereer titel als eerste message

import { anthropic } from './_lib/clients.mjs';
import { retrieveCombined } from './_lib/retrieve.mjs';
import { extractAndStoreMemories } from './_lib/user-memory.mjs';
import {
  checkRateLimit, checkCostCap, checkImageRateLimit, logUsage, hashIp, extractIp,
  IMAGE_LIMIT_PER_DAY_USER,
} from './_lib/rate-limit.mjs';
import { getCached, setCached } from './_lib/cache.mjs';
import { pickModel } from './_lib/model-router.mjs';
import { requireAuth, AuthError } from './_lib/auth.mjs';
import {
  getOrCreateConversation,
  loadConversationMessages,
  storeMessage,
  generateConversationTitle,
  setConversationTitle,
} from './_lib/conversation.mjs';
import {
  loadUserProfile,
  formatProfileForPrompt,
  primaryChildAgeMonths,
} from './_lib/profile.mjs';
import { getAccessStatus, accessDeniedMessage } from './_lib/subscription.mjs';

// ---------- Config ----------
const MAX_QUESTION_CHARS = 500;
const MIN_QUESTION_CHARS = 3;
const MAX_OUTPUT_TOKENS = 600;
const HISTORY_LIMIT = 10;

// Foto-upload: base64 in JSON body
const ACCEPTED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3 MB raw — base64 blijft onder 4.5 MB request-limit

// ---------- System prompt ----------
const SYSTEM_PROMPT = `Je bent HapjesHeld, de AI-assistent van Pril Leven — een Belgisch/Nederlandstalig platform over kindervoeding (0-24 maanden en jonge kinderen).

**Jouw rol:**
- Beantwoord vragen over kindervoeding op basis van de meegegeven context uit Anneleens eigen kennisbank (gids, masterclass, recepten, roadmap).
- Antwoord in het Nederlands, in een warme, geruststellende en praktische toon zoals Anneleen zelf spreekt.
- Wees concreet: geef stappen, hoeveelheden, leeftijdsadviezen waar relevant.

**Toon — allerbelangrijkste richtlijn:**
- Stel ouders altijd gerust. De meeste zorgen rond kindervoeding zijn normaal en vaak tijdelijk. Ouders die iets vragen zijn al betrokken en doen het goed.
- Begin waar mogelijk met een korte erkenning of normalisering ("Dat is een vraag die veel ouders stellen", "Helemaal normaal dat je dit even wil checken", "Geen zorgen, ..."), geef dan pas de praktische info.
- Vermijd alarmerende woorden zoals "gevaarlijk", "dringend", "probleem", "fout" — tenzij het écht om een medisch noodgeval gaat (bv. acute allergische reactie).
- Benadruk wat er wél goed gaat en wat haalbaar is. Formuleer zachter: "kan helpen", "een fijne aanpak is", "je kan proberen" — liever dan "moet", "mag niet", "is nodig".
- Laat ruimte voor variatie en eigen ritme: niet elk kindje is hetzelfde, schommelingen in eetlust horen erbij, er is geen strikt schema waar iedereen aan moet voldoen.
- Als er een reden tot voorzichtigheid is (bv. verstikkingsgevaar, allergenen-introductie), verpak je dat als praktische tip — niet als waarschuwing die doet schrikken.

**Belangrijke regels:**
- Gebruik UITSLUITEND de informatie uit de meegegeven context. Verzin NIETS.
- Introduceer NOOIT vakjargon, termen of concepten die niet letterlijk in de meegegeven context staan (bv. "voor- en achtermelk", "cluster feeding", enz.). Als een term niet in de context voorkomt, gebruik die dan ook niet — zelfs niet als voorbeeld of zijpad.
- Noem geen oorzaken, mechanismen of verklaringen die niet in de context staan. Geen "soms heel normaal, kan ook wijzen op X of Y" als X en Y niet in de context voorkomen.
- Als de context onvoldoende antwoord geeft: zeg rustig dat je dit specifieke punt niet in de kennisbank vindt, en verwijs vriendelijk door naar huisarts, kinderarts of pediatrisch diëtist — formuleer dat als een geruststellende dubbel-check, niet als een alarmbel.
- Bij allergische reacties of twijfel over de gezondheid: verwijs altijd door naar een arts, maar houd de toon kalm ("voor alle zekerheid kan je dit even voorleggen aan je huisarts").
- Wees kort en overzichtelijk: 3-6 zinnen voor eenvoudige vragen, met bullets voor lijsten.
- Vermeld bij recepten veiligheidstips rond stukjes (verstikkingsgevaar) — kort en praktisch, niet angstaanjagend.
- Als de vraag buiten kindervoeding valt: zeg vriendelijk dat je daar niet op kan antwoorden.

**Formaat:**
- GEEN markdown: geen **bold**, geen *italic*, geen ## headers. Schrijf gewone doorlopende tekst. Gebruik hooguit bullet points (met "•" of "-") voor lijstjes.
- Benadruk woorden via woordvolgorde of uitleg, niet met sterretjes of hoofdletters.
- Eindig niet met "hoop dat dit helpt" of disclaimers.`;

// ---------- Helpers ----------
function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function formatContext(chunks) {
  return chunks
    .map((c, i) => `[Bron ${i + 1} — ${c.source} / ${c.title}]\n${c.content}`)
    .join('\n\n---\n\n');
}

// Extract a comma-separated list of food items from a photo via Haiku vision.
// Used to enrich the RAG search query so recipe chunks can be matched even when
// the user's text question is too vague (e.g. "wat kan ik hiermee maken?").
async function extractIngredientsForRAG(imageBlock) {
  try {
    const r = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 120,
      system: 'Je bent een visuele ingrediënten-detector. Je antwoordt UITSLUITEND met een kommagescheiden lijst van zichtbare voedingsmiddelen in het Nederlands (bv. "banaan, appel, wortel, broccoli"). Geen zinnen, geen uitleg, geen hoeveelheden. Maximum 15 items. Als de foto geen voedsel toont: antwoord met het woord "geen".',
      messages: [{
        role: 'user',
        content: [imageBlock, { type: 'text', text: 'Welke ingrediënten zie je?' }],
      }],
    });
    const text = r.content.filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
    if (!text || /^geen\b/i.test(text)) return '';
    // Sanitise: keep first line, strip trailing punctuation
    return text.split('\n')[0].replace(/[.;]+$/, '').trim();
  } catch (e) {
    console.error('[ingredient-extract]', e.message);
    return '';
  }
}

// ---------- Handler ----------
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  // ---- Content-type guard — alleen JSON (foto's komen als base64 in JSON)
  const contentType = (req.headers?.['content-type'] || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return json(res, 415, {
      error: 'Alleen application/json wordt geaccepteerd. Foto\'s moeten als base64 in de JSON body.',
    });
  }

  // ---- Auth
  let auth;
  try {
    auth = await requireAuth(req);
  } catch (e) {
    if (e instanceof AuthError) return json(res, e.status, { error: e.message });
    console.error('[chat][auth]', e);
    return json(res, 500, { error: 'Er ging iets mis bij authenticatie.' });
  }
  const userId = auth.userId;

  // ---- Subscription gate
  try {
    const access = await getAccessStatus(auth.email);
    if (!access.active) {
      return json(res, 403, {
        error: accessDeniedMessage(access),
        reason: access.reason,
      });
    }
  } catch (e) {
    console.error('[chat][subscription]', e.message);
    // fail open bij onverwachte error — niet iedereen buitensluiten
  }

  // ---- Body parsen
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return json(res, 400, { error: 'Ongeldige JSON.' });
  }
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  const conversationIdIn = typeof body.conversation_id === 'string' ? body.conversation_id : null;

  // ---- Image parsen (optioneel)
  let imageForClaude = null; // { type:'image', source:{ type:'base64', media_type, data } }
  const hasImage = !!body.image_b64;
  if (hasImage) {
    const imageMime = typeof body.image_mime === 'string' ? body.image_mime.toLowerCase() : '';
    const imageB64 = typeof body.image_b64 === 'string' ? body.image_b64 : '';
    if (!ACCEPTED_IMAGE_MIMES.includes(imageMime)) {
      return json(res, 415, { error: 'Alleen JPG, PNG, WebP of GIF foto\'s.' });
    }
    // Raw size = base64.length * 0.75
    const rawBytes = Math.floor((imageB64.length * 3) / 4);
    if (rawBytes > MAX_IMAGE_BYTES) {
      return json(res, 413, { error: `Foto te groot (max ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB).` });
    }
    if (imageB64.length === 0) {
      return json(res, 400, { error: 'image_b64 is leeg.' });
    }
    imageForClaude = {
      type: 'image',
      source: { type: 'base64', media_type: imageMime, data: imageB64 },
    };
  }

  // ---- Input validation
  // Met foto: korte vraag toegestaan (bv. "wat zit hier in?"). Zonder foto: min 3 chars.
  if (!hasImage && question.length < MIN_QUESTION_CHARS) {
    return json(res, 400, { error: 'Vraag is te kort.' });
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return json(res, 400, { error: `Vraag is te lang (max ${MAX_QUESTION_CHARS} tekens).` });
  }

  const ipHash = hashIp(extractIp(req));

  // ---- Rate limit per user
  try {
    const rl = await checkRateLimit({ key: userId, keyCol: 'user_id', isUser: true });
    if (!rl.allowed) {
      await logUsage({ userId, ipHash, event: 'blocked_rate_limit' });
      return json(res, 429, {
        error: rl.reason === 'hour'
          ? `Te veel vragen binnen een uur (max ${rl.hourLimit}). Probeer straks opnieuw.`
          : `Dagelijkse limiet bereikt (max ${rl.dayLimit}). Tot morgen!`,
      });
    }
    const cc = await checkCostCap({ key: userId, keyCol: 'user_id', isUser: true });
    if (!cc.allowed) {
      await logUsage({ userId, ipHash, event: 'blocked_rate_limit' });
      return json(res, 429, { error: 'Dagelijkse gebruikslimiet bereikt. Probeer morgen opnieuw.' });
    }
    // Extra image-cap (indien foto meegestuurd)
    if (hasImage) {
      const ir = await checkImageRateLimit({ key: userId, keyCol: 'user_id' });
      if (!ir.allowed) {
        await logUsage({ userId, ipHash, event: 'blocked_rate_limit' });
        return json(res, 429, {
          error: `Je hebt de maximum van ${IMAGE_LIMIT_PER_DAY_USER} foto's per dag bereikt. Probeer morgen opnieuw.`,
        });
      }
    }
  } catch (e) {
    console.error('[rate-limit]', e.message);
    // fail open
  }

  try {
    // ---- Load profile (voor context + age-filter)
    const profile = await loadUserProfile(userId);
    const memoryEnabled = profile?.memory_enabled !== false; // default aan als geen profiel
    const profileSummary = formatProfileForPrompt(profile);
    const filterAge = primaryChildAgeMonths(profile);

    // ---- Resolve/create conversation
    let conversation;
    try {
      conversation = await getOrCreateConversation(userId, conversationIdIn);
    } catch (e) {
      return json(res, e.status || 400, { error: e.message });
    }
    const conversationId = conversation.id;
    const isFirstMessage = !conversation.title;

    // ---- Cache check (globaal) — skippen als er history is of profiel-context,
    // want antwoord hangt dan van persoonlijke context af.
    const history = memoryEnabled
      ? await loadConversationMessages(conversationId, { limit: HISTORY_LIMIT })
      : [];
    const canUseCache = history.length === 0 && !profileSummary;

    if (canUseCache) {
      const cached = await getCached(question);
      if (cached) {
        let asstId = null;
        if (memoryEnabled) {
          await storeMessage(conversationId, { role: 'user', content: question });
          asstId = await storeMessage(conversationId, {
            role: 'assistant', content: cached.answer,
            retrievedIds: cached.retrievedIds, model: 'cache',
          });
          if (isFirstMessage) {
            const title = await generateConversationTitle(question);
            if (title) await setConversationTitle(conversationId, title);
          }
        }
        await logUsage({ userId, ipHash, event: 'cache_hit' });
        return json(res, 200, {
          answer: cached.answer,
          sources: cached.retrievedIds,
          cached: true,
          topScore: null,
          conversation_id: conversationId,
          assistant_message_id: asstId,
        });
      }
    }

    // ---- Bij foto: eerst ingrediënten extraheren (Haiku vision) en aan de zoekstring toevoegen,
    // zodat RAG recepten kan vinden ook als de tekstvraag vaag is ("wat kan ik hiermee maken?").
    let extractedIngredients = '';
    let searchQuery = question;
    if (hasImage) {
      extractedIngredients = await extractIngredientsForRAG(imageForClaude);
      if (extractedIngredients) {
        const baseQ = question || 'recept op basis van deze ingrediënten';
        searchQuery = `${baseQ} — ingrediënten: ${extractedIngredients}`;
      }
    }

    // ---- Retrieval: kennisbank + user-memory combined
    const { chunks, memories, topScore, hasRelevant } = await retrieveCombined(searchQuery, {
      userId,
      filterAge,
      topKDocs: 6,
      topKMemory: 4,
      includeMemory: memoryEnabled,
    });

    // ---- Out-of-scope: alleen fallback als er écht niets terugkomt (0 chunks én 0 memories).
    // We vertrouwen op Claude's system-prompt om zelf te zeggen "niet in kennisbank" als de
    // chunks de vraag niet beantwoorden — betrouwbaarder dan een harde similarity-threshold
    // die goede-maar-zwak-gematchte chunks wegknijpt.
    // Met foto: skip de fallback sowieso — Sonnet vision kan altijd iets zinvols zeggen.
    if (!hasImage && chunks.length === 0 && (!memories || memories.length === 0)) {
      // Diagnostic log — laat zien waarom er een fallback werd gestuurd.
      console.log('[chat] out-of-scope fallback', {
        question: question.slice(0, 120),
        filterAge,
        topScore: Number(topScore?.toFixed?.(3) ?? topScore),
        docsReturned: chunks.length,
        topDocSources: chunks.slice(0, 3).map(c => `${c.source}/${c.title}@${c.similarity?.toFixed?.(3)}`),
        memoriesFound: memories?.length || 0,
      });
      const fallback =
        'Daar vind ik helaas geen duidelijk antwoord op in de kennisbank. Ik beantwoord vragen over kindervoeding (0-24 maanden en jonge kinderen) op basis van Anneleens gids, masterclass en recepten — probeer gerust de vraag anders te formuleren. Voor specifieke medische vragen of twijfel blijft je huisarts, kinderarts of pediatrisch diëtist de beste plek.';
      let asstId = null;
      if (memoryEnabled) {
        await storeMessage(conversationId, { role: 'user', content: question });
        asstId = await storeMessage(conversationId, { role: 'assistant', content: fallback, model: 'fallback' });
        if (isFirstMessage) {
          const title = await generateConversationTitle(question);
          if (title) await setConversationTitle(conversationId, title);
        }
      }
      await logUsage({ userId, ipHash, event: 'query' });
      return json(res, 200, {
        answer: fallback,
        sources: [],
        cached: false,
        topScore,
        conversation_id: conversationId,
        assistant_message_id: asstId,
      });
    }

    // ---- Model + Claude call met history
    // Bij foto: altijd Sonnet (betere vision), bij tekst: model-router bepaalt.
    const { model, reason } = pickModel({ hasImage, question, topScore });
    const contextText = formatContext(chunks);
    const profileBlock = profileSummary
      ? `Over de gebruiker: ${profileSummary}\n\nHoud hier rekening mee in je antwoord.\n\n---\n\n`
      : '';
    const memoryBlock = (memories && memories.length > 0)
      ? `Dit weet ik al over deze gebruiker uit eerdere gesprekken:\n${memories.map(m => `- ${m.content}`).join('\n')}\n\nGebruik deze info waar relevant, maar herhaal feiten niet onnodig.\n\n---\n\n`
      : '';
    const questionForPrompt = question || '(Bekijk de bijgevoegde foto en geef relevant advies.)';
    const ingredientsBlock = (hasImage && extractedIngredients)
      ? `Ingrediënten die zichtbaar zijn op de foto: ${extractedIngredients}.

Gebruik deze ingrediënten en bovenstaande context om een passend recept of suggestie uit Anneleens kennisbank voor te stellen. Verifieer eerst kort wat je op de foto ziet, kies dan een recept of combinatie die hierbij past.

---

`
      : '';
    const latestUserText = `${profileBlock}${memoryBlock}Context uit de kennisbank:

${contextText}

---

${ingredientsBlock}Vraag van de gebruiker: ${questionForPrompt}`;

    // Bij foto: multipart content met image + text; anders plain text
    const latestUserContent = imageForClaude
      ? [imageForClaude, { type: 'text', text: latestUserText }]
      : latestUserText;

    const messagesForLLM = [
      // Historische berichten (exclusief system): alleen tekst, oude foto's zijn niet bewaard
      ...history
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: latestUserContent },
    ];

    const response = await anthropic.messages.create({
      model: model.id,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      messages: messagesForLLM,
    });

    const answer = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text).join('\n').trim();

    const retrievedIds = chunks.map((c) => c.id);
    const tokensIn = response.usage?.input_tokens ?? 0;
    const tokensOut = response.usage?.output_tokens ?? 0;
    const costCents = tokensIn * model.costInCents + tokensOut * model.costOutCents;

    // ---- Store messages + cache + log
    // Bij foto: had_image=true opslaan maar content bevat alleen de vraag + placeholder.
    // De foto-bytes worden NOOIT opgeslagen.
    const userContentForDB = hasImage
      ? (question ? `${question}\n[foto bijgevoegd]` : '[foto bijgevoegd]')
      : question;
    let asstId = null;
    if (memoryEnabled) {
      await storeMessage(conversationId, {
        role: 'user', content: userContentForDB, hadImage: hasImage,
      });
      asstId = await storeMessage(conversationId, {
        role: 'assistant', content: answer,
        retrievedIds, tokensIn, tokensOut, model: model.id,
      });
      if (isFirstMessage) {
        const title = await generateConversationTitle(question || 'Foto-analyse');
        if (title) await setConversationTitle(conversationId, title);
      }
    }

    // Cache nooit antwoorden op foto-vragen (zijn per foto uniek)
    if (canUseCache && !hasImage) {
      await setCached(question, answer, retrievedIds);
    }

    await logUsage({
      userId, ipHash,
      event: hasImage ? 'query_with_image' : 'query',
      tokensIn, tokensOut, costCents,
    });

    // ---- Memory extractie (synchroon — ~1s extra latency, maar betrouwbaar)
    // In serverless/vercel-dev wordt fire-and-forget vaak gekilled voor het
    // klaar is. Synchroon garandeert dat het feit wordt opgeslagen.
    // Faalt stil — niet kritisch voor de response.
    if (memoryEnabled && asstId) {
      try {
        await extractAndStoreMemories(userId, question, answer, asstId);
      } catch (e) {
        console.error('[memory-extract]', e.message);
      }
    }

    return json(res, 200, {
      answer,
      sources: retrievedIds,
      cached: false,
      topScore,
      model: model.id,
      modelReason: reason,
      conversation_id: conversationId,
      assistant_message_id: asstId,
    });
  } catch (err) {
    console.error('[chat]', err);
    return json(res, 500, { error: 'Er ging iets mis. Probeer het later opnieuw.' });
  }
}
