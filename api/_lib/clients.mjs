// Shared clients for Supabase + Anthropic.
// Imported by all /api routes — module-level instances are reused
// across warm Fluid Compute invocations.

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

export const anthropic = new Anthropic({
  apiKey: must('ANTHROPIC_API_KEY'),
});

export const VOYAGE_API_KEY = must('VOYAGE_API_KEY');
