-- ============================================================
-- Pril Leven RAG schema — migration 001
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- Safe to run on existing project: uses IF NOT EXISTS everywhere.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Extensions
-- ------------------------------------------------------------
-- pgvector: vector similarity search (embeddings).
-- pgcrypto: gen_random_uuid() for primary keys.
create extension if not exists vector;
create extension if not exists pgcrypto;


-- ------------------------------------------------------------
-- 2. documents — the RAG knowledge base (chunks + embeddings)
-- ------------------------------------------------------------
-- One row per chunk from the JSONL files.
-- Embedding dim = 1024 (Voyage voyage-3-large).
create table if not exists public.documents (
  id              text primary key,                  -- e.g. 'geh-001', 'rec-012' (stable, from JSONL)
  source          text not null,                     -- e.g. 'gids-eerste-hapjes'
  title           text not null,
  content         text not null,
  category        text,                              -- e.g. 'allergenen', 'recept-warm'
  age_min_months  int,                               -- null if not age-specific
  age_max_months  int,
  page_refs       int[],                             -- original PDF page refs (optional)
  metadata        jsonb default '{}'::jsonb,         -- escape hatch for extra fields
  embedding       vector(1024),                      -- filled by ingestion script
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- HNSW index for fast cosine similarity search.
-- Built after ingestion for better quality; safe to create empty.
create index if not exists documents_embedding_hnsw
  on public.documents
  using hnsw (embedding vector_cosine_ops);

-- Filter indexes for metadata-based pre-filtering.
create index if not exists documents_source_idx   on public.documents (source);
create index if not exists documents_category_idx on public.documents (category);
create index if not exists documents_age_idx      on public.documents (age_min_months, age_max_months);


-- ------------------------------------------------------------
-- 3. conversations — one row per chat session
-- ------------------------------------------------------------
create table if not exists public.conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,  -- null = anonymous/guest
  title       text,                                               -- optional, auto-generated later
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists conversations_user_idx on public.conversations (user_id, created_at desc);


-- ------------------------------------------------------------
-- 4. messages — individual chat messages (TEXT ONLY, no images)
-- ------------------------------------------------------------
-- GDPR note: we deliberately do NOT store any images.
-- Photo queries are processed in-memory and discarded.
create table if not exists public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  role             text not null check (role in ('user', 'assistant', 'system')),
  content          text not null,
  had_image        boolean not null default false,   -- flag only, image itself is never stored
  retrieved_ids    text[],                            -- which document ids were used for this answer
  tokens_in        int,
  tokens_out       int,
  model            text,                              -- 'claude-sonnet-4-6' or 'claude-haiku-4-5'
  created_at       timestamptz not null default now()
);

create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at);


-- ------------------------------------------------------------
-- 5. usage_log — rate limiting & cost tracking
-- ------------------------------------------------------------
-- Append-only. Query last N minutes to enforce per-user rate limits.
create table if not exists public.usage_log (
  id          bigserial primary key,
  user_id     uuid references auth.users(id) on delete set null,
  ip_hash     text,                                   -- SHA-256(ip) for anonymous rate limiting
  event       text not null,                          -- 'query' | 'cache_hit' | 'blocked_rate_limit'
  tokens_in   int default 0,
  tokens_out  int default 0,
  cost_cents  numeric(10,4) default 0,
  created_at  timestamptz not null default now()
);

create index if not exists usage_log_user_time_idx on public.usage_log (user_id, created_at desc);
create index if not exists usage_log_ip_time_idx   on public.usage_log (ip_hash, created_at desc);


-- ------------------------------------------------------------
-- 6. answer_cache — FAQ cache to reduce Claude calls
-- ------------------------------------------------------------
-- Normalized question hash → cached answer.
-- Retrieved_ids frozen at cache time; cache invalidated if those chunks change.
create table if not exists public.answer_cache (
  id             uuid primary key default gen_random_uuid(),
  question_hash  text unique not null,                -- SHA-256 of normalized question
  question       text not null,                       -- original question (for debugging)
  answer         text not null,
  retrieved_ids  text[] not null,
  hits           int not null default 0,
  created_at     timestamptz not null default now(),
  last_hit_at    timestamptz not null default now()
);

create index if not exists answer_cache_hash_idx on public.answer_cache (question_hash);


-- ------------------------------------------------------------
-- 7. RLS (Row Level Security)
-- ------------------------------------------------------------
-- documents: readable by everyone (knowledge base), writes only via service role.
alter table public.documents       enable row level security;
alter table public.conversations   enable row level security;
alter table public.messages        enable row level security;
alter table public.usage_log       enable row level security;
alter table public.answer_cache    enable row level security;

-- Public read of documents (the RAG retrieval uses this).
drop policy if exists "documents readable by all" on public.documents;
create policy "documents readable by all"
  on public.documents for select
  using (true);

-- Users can read/write only their own conversations.
drop policy if exists "own conversations" on public.conversations;
create policy "own conversations"
  on public.conversations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Users can read/write only messages in their own conversations.
drop policy if exists "own messages" on public.messages;
create policy "own messages"
  on public.messages for all
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.user_id = auth.uid()
    )
  );

-- usage_log & answer_cache: only service role can read/write (no public policy).
-- (RLS enabled + no policy = locked down for anon/authenticated users.)


-- ------------------------------------------------------------
-- 8. match_documents() — the vector search RPC
-- ------------------------------------------------------------
-- Called by the /api/chat endpoint to retrieve top-k relevant chunks.
-- Supports optional age filtering and source filtering.
create or replace function public.match_documents (
  query_embedding  vector(1024),
  match_count      int default 6,
  filter_age       int default null,          -- baby age in months (null = no filter)
  filter_sources   text[] default null        -- e.g. ARRAY['recepten-2025'] (null = all)
)
returns table (
  id         text,
  source     text,
  title      text,
  content    text,
  category   text,
  similarity float
)
language sql stable
as $$
  select
    d.id,
    d.source,
    d.title,
    d.content,
    d.category,
    1 - (d.embedding <=> query_embedding) as similarity
  from public.documents d
  where
    d.embedding is not null
    and (filter_sources is null or d.source = any(filter_sources))
    and (
      filter_age is null
      or (
        (d.age_min_months is null or d.age_min_months <= filter_age)
        and (d.age_max_months is null or d.age_max_months >= filter_age)
      )
    )
  order by d.embedding <=> query_embedding
  limit match_count;
$$;


-- ------------------------------------------------------------
-- 9. updated_at trigger (housekeeping)
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_documents_updated_at on public.documents;
create trigger touch_documents_updated_at
  before update on public.documents
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_conversations_updated_at on public.conversations;
create trigger touch_conversations_updated_at
  before update on public.conversations
  for each row execute function public.touch_updated_at();

-- ============================================================
-- Done. Next step: ingestion script writes to public.documents.
-- ============================================================
