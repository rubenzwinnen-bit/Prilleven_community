// Shared clients for Supabase + Anthropic.
// Imported by all /api routes — module-level instances are reused
// across warm Fluid Compute invocations.
//
// Vercel AI Gateway (P3): als AI_GATEWAY_API_KEY env-var aanwezig is,
// routeren we Anthropic-calls via AI Gateway. Voordelen:
// - Automatische caching van identieke prompt-sets (cost reduction).
// - Failover en observability vanuit Vercel-dashboard.
// - Geen code-wijzigingen nodig in de routes — alleen baseURL + key.
// Zonder env-var blijft de directe Anthropic API gebruikt — geen breaking
// change voor lokaal testen of als Gateway uit staat.
//
// Voyage embeddings blijven direct (AI Gateway heeft geen native Voyage-
// provider; embeddings caching op andere manier oplosbaar indien nodig).

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export const supabase = createClient(
  must('SUPABASE_URL'),
  must('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } }
);

const gatewayKey = process.env.AI_GATEWAY_API_KEY;
export const anthropic = gatewayKey
  ? new Anthropic({
      baseURL: 'https://ai-gateway.vercel.sh',
      apiKey: gatewayKey,
    })
  : new Anthropic({
      apiKey: must('ANTHROPIC_API_KEY'),
    });

// Bron-flag voor logging/observability (handig in chat.mjs).
export const ANTHROPIC_VIA_GATEWAY = !!gatewayKey;

// Helper: voeg 'anthropic/' prefix toe aan modelnaam wanneer Gateway actief is.
// AI Gateway routeert via provider/model-syntax; directe Anthropic API niet.
export function anthropicModel(id) {
  return ANTHROPIC_VIA_GATEWAY ? `anthropic/${id}` : id;
}

export const VOYAGE_API_KEY = must('VOYAGE_API_KEY');
