#!/usr/bin/env node
/**
 * hapjesheld-eval.mjs — vaste testset voor HapjesHeld 2.0.
 *
 * Stelt elke vraag uit hapjesheld-vragen.json met dezelfde retrieval, system
 * prompt en modelkeuze als /api/chat, en laat Sonnet elk antwoord beoordelen.
 * Zo vergelijk je een wijziging aan de bot vóór en na, in plaats van op gevoel.
 *
 * Gebruik (vanuit de projectroot):
 *   node --env-file=.env.local scripts/eval/hapjesheld-eval.mjs
 *   node --env-file=.env.local scripts/eval/hapjesheld-eval.mjs --label reranker
 *   node --env-file=.env.local scripts/eval/hapjesheld-eval.mjs --alleen 1,5,26
 *   node --env-file=.env.local scripts/eval/hapjesheld-eval.mjs --vergelijk scripts/eval/resultaten/<vorige>.json
 *   node --env-file=.env.local scripts/eval/hapjesheld-eval.mjs --model sonnet   (modelkeuze forceren: haiku|sonnet|sonnet46)
 *   node --env-file=.env.local scripts/eval/hapjesheld-eval.mjs --model sonnet --denken laag --max-tokens 2000
 *     (--denken uit|laag|medium|hoog; zonder --denken geldt CHAT_THINKING uit chat.mjs)
 *   node --env-file=.env.local scripts/eval/hapjesheld-eval.mjs --herschrijf uit   (uit|haiku|sonnet)
 *
 * Verschil met de echte bot: geen gebruikersprofiel, geen geheugen en geen
 * cache. Wel het leeftijdsfilter als de vraag een leeftijd noemt (veld
 * leeftijd_maanden).
 *
 * Vervolgvragen (veld vorige_vraag): de bot beantwoordt eerst de vorige vraag,
 * daarna de vervolgvraag met dat gesprek als geschiedenis, zoals in /api/chat.
 * Zonder --herschrijf geldt de herschrijfstap van productie (REWRITE_MODEL).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { anthropic } from '../../api/_lib/clients.mjs';
import { retrieveCombined } from '../../api/_lib/retrieve.mjs';
import { pickModel, MODELS } from '../../api/_lib/model-router.mjs';
import { SYSTEM_PROMPT, formatContext, checkRecipeLinks, MAX_OUTPUT_TOKENS, CHAT_THINKING } from '../../api/chat.mjs';
import { rewriteFollowUpQuestion, REWRITE_MODEL } from '../../api/_lib/search-query.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const VRAGEN_BESTAND = path.join(HIER, 'hapjesheld-vragen.json');
const RESULTATEN_MAP = path.join(HIER, 'resultaten');

const GELIJKTIJDIG = 4;
const CRITERIA = ['bronnen', 'trouw', 'antwoord', 'toon', 'doorverwijzing'];

// ---------- Args ----------
const args = process.argv.slice(2);
function arg(naam) {
  const i = args.indexOf(naam);
  return i >= 0 ? args[i + 1] : null;
}
const label = arg('--label');
const alleen = arg('--alleen')?.split(',').map(Number);
const vergelijkMet = arg('--vergelijk');
// Kandidaat-modellen die (nog) niet in model-router.mjs staan. Prijzen in eurocent
// per token, zelfde omrekening als MODELS (× 0.92).
const EXTRA_MODELS = {
  SONNET46: { id: 'claude-sonnet-4-6', costInCents: 0.0003 * 0.92, costOutCents: 0.0015 * 0.92 },
};
const ALLE_MODELS = { ...MODELS, ...EXTRA_MODELS };
// De beoordelaar blijft vast op Sonnet 4.6, zodat runs onderling vergelijkbaar blijven.
const RECHTER = EXTRA_MODELS.SONNET46;
const forceerModel = arg('--model')?.toUpperCase();
if (forceerModel && !ALLE_MODELS[forceerModel]) throw new Error('--model moet haiku, sonnet of sonnet46 zijn');
const denken = arg('--denken');
const maxTokens = Number(arg('--max-tokens')) || MAX_OUTPUT_TOKENS;
const DENKEN = {
  uit: { thinking: { type: 'disabled' } },
  laag: { thinking: { type: 'adaptive' }, output_config: { effort: 'low' } },
  medium: { thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } },
  hoog: { thinking: { type: 'adaptive' }, output_config: { effort: 'high' } },
};
if (denken && !DENKEN[denken]) throw new Error('--denken moet uit, laag, medium of hoog zijn');
const HERSCHRIJF = { uit: null, haiku: MODELS.HAIKU, sonnet: MODELS.SONNET };
const herschrijfArg = arg('--herschrijf');
if (herschrijfArg && !(herschrijfArg in HERSCHRIJF)) throw new Error('--herschrijf moet uit, haiku of sonnet zijn');
const herschrijfModel = herschrijfArg ? HERSCHRIJF[herschrijfArg] : REWRITE_MODEL;

// ---------- Eén vraag door de bot ----------
async function beantwoord(vraag, { leeftijd, geschiedenis = [], zoekvraag = vraag }) {
  const { chunks, topScore } = await retrieveCombined(zoekvraag, {
    userId: null,
    filterAge: leeftijd ?? null,
    topKDocs: 10,
    includeMemory: false,
  });

  if (chunks.length === 0) {
    return { antwoord: '(fallback: niets gevonden)', model: 'fallback', reden: 'geen-chunks', topScore, chunks, kostCent: 0 };
  }

  const { model, reason } = forceerModel
    ? { model: ALLE_MODELS[forceerModel], reason: 'geforceerd' }
    : pickModel({ hasImage: false, question: vraag, topScore });
  const context = formatContext(chunks);
  const res = await anthropic.messages.create({
    model: model.id,
    max_tokens: maxTokens,
    ...(denken ? DENKEN[denken] : { thinking: CHAT_THINKING }),
    system: SYSTEM_PROMPT,
    messages: [
      ...geschiedenis,
      {
        role: 'user',
        content: `Context uit de kennisbank:\n\n${context}\n\n---\n\nVraag van de gebruiker: ${vraag}`,
      },
    ],
  });
  const antwoord = checkRecipeLinks(res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim(), chunks);
  const kostCent = res.usage.input_tokens * model.costInCents + res.usage.output_tokens * model.costOutCents;

  return { antwoord, model: model.id, reden: reason, topScore, chunks, kostCent, afgekapt: res.stop_reason === 'max_tokens' };
}

async function stelVraag(item) {
  const start = Date.now();
  if (!item.vorige_vraag) {
    const res = await beantwoord(item.vraag, { leeftijd: item.leeftijd_maanden });
    return { ...res, ms: Date.now() - start };
  }

  // Vervolgvraag: eerst de vorige vraag beantwoorden, dan verder met dat gesprek.
  const vorige = await beantwoord(item.vorige_vraag, { leeftijd: item.leeftijd_maanden });
  const geschiedenis = [
    { role: 'user', content: item.vorige_vraag },
    { role: 'assistant', content: vorige.antwoord },
  ];
  const start2 = Date.now();
  const herschreven = herschrijfModel
    ? await rewriteFollowUpQuestion(geschiedenis, item.vraag, { model: herschrijfModel })
    : { query: item.vraag, costCents: 0 };
  const res = await beantwoord(item.vraag, { leeftijd: item.leeftijd_maanden, geschiedenis, zoekvraag: herschreven.query });
  return {
    ...res,
    zoekvraag: herschreven.query,
    vorigAntwoord: vorige.antwoord,
    // Kost en duur van de vervolgvraag zelf (herschrijven + antwoord), zoals de ouder die ervaart.
    kostCent: res.kostCent + herschreven.costCents,
    totaalKostCent: vorige.kostCent + res.kostCent + herschreven.costCents,
    ms: Date.now() - start2,
  };
}

// ---------- Beoordeling ----------
const RECHTER_PROMPT = `Je beoordeelt antwoorden van HapjesHeld, een AI-assistent over kindervoeding voor Vlaamse ouders. HapjesHeld mag UITSLUITEND informatie uit de meegegeven bronnen gebruiken, moet warm en geruststellend klinken (zoals Anneleen van Pril Leven), en moet bij medische twijfel rustig doorverwijzen naar een arts.

Geef per criterium een score van 1 (slecht) tot 5 (uitstekend):
- bronnen: bevatten de opgehaalde bronnen de informatie die nodig is om de vraag te beantwoorden?
- trouw: staat alles in het antwoord ook echt in de bronnen? Elke verzonnen feit, hoeveelheid of term buiten de bronnen verlaagt de score sterk.
- antwoord: beantwoordt het antwoord de vraag concreet en bruikbaar? Als de bronnen het antwoord niet bevatten, is eerlijk zeggen "dat vind ik niet in de kennisbank" het juiste antwoord (score 5).
- toon: warm, geruststellend, niet alarmerend, kort en overzichtelijk, geen markdown. Uitzondering: een regel "Bron: [..](..)" en regels "Bekijk het recept: [..](..)" zijn toegestaan en gewenst.
- doorverwijzing: verwijst het rustig door naar huisarts/kinderarts/diëtist waar dat nodig is? Gebruik null als doorverwijzen bij deze vraag niet nodig is.

Antwoord ALLEEN met JSON, zonder uitleg eromheen:
{"bronnen": n, "trouw": n, "antwoord": n, "toon": n, "doorverwijzing": n|null, "toelichting": "max 2 zinnen, in het Nederlands"}`;

async function beoordeel(item, resultaat) {
  const bronnen = resultaat.chunks.length ? formatContext(resultaat.chunks) : '(geen bronnen gevonden)';
  const res = await anthropic.messages.create({
    model: RECHTER.id,
    max_tokens: 400,
    system: RECHTER_PROMPT,
    messages: [{
      role: 'user',
      content: `Categorie: ${item.categorie}\n\n${item.vorige_vraag ? `=== Eerder in het gesprek ===\nOuder: ${item.vorige_vraag}\nHapjesHeld: ${resultaat.vorigAntwoord}\n\n=== Vervolgvraag (beoordeel enkel het antwoord hierop) ===\n` : ''}Vraag: ${item.vraag}\n\n=== Opgehaalde bronnen ===\n${bronnen}\n\n=== Antwoord van HapjesHeld ===\n${resultaat.antwoord}`,
    }],
  });
  const tekst = res.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const kostCent = res.usage.input_tokens * RECHTER.costInCents + res.usage.output_tokens * RECHTER.costOutCents;
  const match = tekst.match(/\{[\s\S]*\}/);
  try {
    return { ...JSON.parse(match[0]), kostCent };
  } catch {
    return { fout: 'Beoordeling niet leesbaar', ruw: tekst, kostCent };
  }
}

// ---------- Helpers ----------
function gemiddelde(waarden) {
  const geldig = waarden.filter(v => typeof v === 'number');
  return geldig.length ? geldig.reduce((a, b) => a + b, 0) / geldig.length : null;
}

function totaalScore(oordeel) {
  return gemiddelde(CRITERIA.map(c => oordeel?.[c]));
}

function f(n) {
  return n === null || n === undefined ? '–' : n.toFixed(2);
}

async function inPakketjes(items, grootte, fn) {
  const uit = [];
  for (let i = 0; i < items.length; i += grootte) {
    const pakket = items.slice(i, i + grootte);
    uit.push(...await Promise.all(pakket.map(fn)));
  }
  return uit;
}

// ---------- Rapport ----------
function maakRapport(run, vorige) {
  const r = run.resultaten;
  const regels = [];
  regels.push(`# HapjesHeld-test ${run.gestart}${run.label ? ` — ${run.label}` : ''}`, '');
  regels.push(`${r.length} vragen · kost €${(run.kostCent / 100).toFixed(2)} · ${Math.round(run.duurMs / 1000)} s · herschrijven: ${run.herschrijf}`, '');
  const vervolg = r.filter(x => x.vorigeVraag);
  if (vervolg.length) {
    regels.push('## Zoekvragen bij vervolgvragen', '');
    for (const x of vervolg) regels.push(`- #${x.id} "${x.vraag}" → "${x.zoekvraag}"`);
    regels.push('');
  }
  const gemMs = gemiddelde(r.map(x => x.ms));
  const gemKost = gemiddelde(r.map(x => x.antwoordKostCent));
  regels.push(`Per antwoord: gemiddeld ${gemMs ? (gemMs / 1000).toFixed(1) : '–'} s en ${gemKost ? gemKost.toFixed(2) : '–'} cent (zonder beoordeling) · afgekapt op max_tokens: ${r.filter(x => x.afgekapt).length}`, '');

  regels.push('## Gemiddelde per criterium', '', '| Criterium | Score |' + (vorige ? ' Vorige | Verschil |' : ''), '|---|---|' + (vorige ? '---|---|' : ''));
  for (const c of [...CRITERIA, 'totaal']) {
    const nu = c === 'totaal' ? gemiddelde(r.map(x => totaalScore(x.oordeel))) : gemiddelde(r.map(x => x.oordeel?.[c]));
    let rij = `| ${c} | ${f(nu)} |`;
    if (vorige) {
      const toen = c === 'totaal'
        ? gemiddelde(vorige.resultaten.map(x => totaalScore(x.oordeel)))
        : gemiddelde(vorige.resultaten.map(x => x.oordeel?.[c]));
      rij += ` ${f(toen)} | ${nu !== null && toen !== null ? (nu - toen >= 0 ? '+' : '') + (nu - toen).toFixed(2) : '–'} |`;
    }
    regels.push(rij);
  }

  regels.push('', '## Per categorie', '', '| Categorie | Vragen | Totaal |', '|---|---|---|');
  const cats = [...new Set(r.map(x => x.categorie))];
  for (const cat of cats) {
    const groep = r.filter(x => x.categorie === cat);
    regels.push(`| ${cat} | ${groep.length} | ${f(gemiddelde(groep.map(x => totaalScore(x.oordeel))))} |`);
  }

  const modellen = {};
  for (const x of r) modellen[x.model] = (modellen[x.model] || 0) + 1;
  regels.push('', '## Modellen', '', ...Object.entries(modellen).map(([m, n]) => `- ${m}: ${n}`));

  if (vorige) {
    const toenPerId = new Map(vorige.resultaten.map(x => [x.id, totaalScore(x.oordeel)]));
    const verschoven = r
      .map(x => ({ x, delta: (totaalScore(x.oordeel) ?? 0) - (toenPerId.get(x.id) ?? 0) }))
      .filter(({ x, delta }) => toenPerId.has(x.id) && Math.abs(delta) >= 0.8)
      .sort((a, b) => a.delta - b.delta);
    regels.push('', '## Grootste verschuivingen (≥ 0,8)', '');
    if (!verschoven.length) regels.push('Geen.');
    for (const { x, delta } of verschoven) {
      regels.push(`- #${x.id} ${delta > 0 ? '+' : ''}${delta.toFixed(2)} — ${x.vraag}`);
    }
  }

  regels.push('', '## Zwakste 8 antwoorden', '');
  const zwakst = [...r].sort((a, b) => (totaalScore(a.oordeel) ?? 0) - (totaalScore(b.oordeel) ?? 0)).slice(0, 8);
  for (const x of zwakst) {
    regels.push(`### #${x.id} (${f(totaalScore(x.oordeel))}) ${x.vraag}`, '');
    regels.push(`- Model: ${x.model} (${x.reden}), topScore ${f(x.topScore)}`);
    if (x.vorigeVraag) regels.push(`- Vorige vraag: ${x.vorigeVraag}`, `- Zoekvraag: ${x.zoekvraag}`);
    regels.push(`- Bronnen: ${x.bronnen.slice(0, 5).join(' · ') || '–'}`);
    regels.push(`- Scores: ${CRITERIA.map(c => `${c} ${x.oordeel?.[c] ?? '–'}`).join(', ')}`);
    regels.push(`- Rechter: ${x.oordeel?.toelichting || x.oordeel?.fout || '–'}`, '');
    regels.push('> ' + x.antwoord.replace(/\n/g, '\n> '), '');
  }
  return regels.join('\n');
}

// ---------- Main ----------
async function main() {
  let vragen = JSON.parse(await readFile(VRAGEN_BESTAND, 'utf8'));
  if (alleen) vragen = vragen.filter(v => alleen.includes(v.id));

  const vorige = vergelijkMet ? JSON.parse(await readFile(vergelijkMet, 'utf8')) : null;
  const gestart = new Date();
  console.log(`HapjesHeld-test: ${vragen.length} vragen, ${GELIJKTIJDIG} tegelijk…`);

  const resultaten = await inPakketjes(vragen, GELIJKTIJDIG, async (item) => {
    try {
      const res = await stelVraag(item);
      const oordeel = await beoordeel(item, res);
      const totaal = totaalScore(oordeel);
      console.log(`  #${String(item.id).padStart(2)} ${f(totaal)}  ${res.model.replace('claude-', '')}  ${item.vraag.slice(0, 60)}`);
      return {
        id: item.id,
        categorie: item.categorie,
        vraag: item.vraag,
        ...(item.vorige_vraag ? { vorigeVraag: item.vorige_vraag, vorigAntwoord: res.vorigAntwoord, zoekvraag: res.zoekvraag } : {}),
        antwoord: res.antwoord,
        model: res.model,
        reden: res.reden,
        topScore: res.topScore,
        bronnen: res.chunks.map(c => `${c.source} / ${c.title} @${c.similarity?.toFixed(3)}${c.rerankScore != null ? ` r${c.rerankScore.toFixed(2)}` : ''}`),
        oordeel,
        kostCent: (res.totaalKostCent ?? res.kostCent) + (oordeel.kostCent || 0),
        antwoordKostCent: res.kostCent,
        ms: res.ms,
        afgekapt: res.afgekapt || false,
      };
    } catch (e) {
      console.error(`  #${item.id} FOUT: ${e.message}`);
      return { id: item.id, categorie: item.categorie, vraag: item.vraag, antwoord: '', model: 'fout', reden: e.message, topScore: null, bronnen: [], oordeel: null, kostCent: 0, ms: 0 };
    }
  });

  const run = {
    gestart: gestart.toISOString(),
    label,
    herschrijf: herschrijfModel ? herschrijfModel.id : 'uit',
    kostCent: resultaten.reduce((s, x) => s + x.kostCent, 0),
    duurMs: Date.now() - gestart.getTime(),
    resultaten,
  };

  await mkdir(RESULTATEN_MAP, { recursive: true });
  const stempel = gestart.toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const basis = path.join(RESULTATEN_MAP, `${stempel}${label ? '-' + label.replace(/[^a-z0-9-]/gi, '_') : ''}`);
  await writeFile(basis + '.json', JSON.stringify(run, null, 2));
  await writeFile(basis + '.md', maakRapport(run, vorige));

  console.log(`\nTotaal ${f(gemiddelde(resultaten.map(x => totaalScore(x.oordeel))))} · kost €${(run.kostCent / 100).toFixed(2)}`);
  console.log(`Rapport: ${path.relative(process.cwd(), basis + '.md')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
