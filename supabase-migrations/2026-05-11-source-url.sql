-- ============================================================
-- Pril Leven RAG — voeg `source_url` toe aan documents
-- Voor bronvermelding (bv. partner-link met UTM-tracking)
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- 1. Nieuwe nullable kolom
alter table public.documents
  add column if not exists source_url text;

-- 2. match_documents() bijwerken zodat de URL meekomt in retrieval
-- Postgres laat geen wijziging van return-type toe via CREATE OR REPLACE,
-- dus eerst droppen.
drop function if exists public.match_documents(vector, int, int, text[]);

create function public.match_documents (
  query_embedding  vector(1024),
  match_count      int default 6,
  filter_age       int default null,
  filter_sources   text[] default null
)
returns table (
  id          text,
  source      text,
  source_url  text,
  title       text,
  content     text,
  category    text,
  similarity  float
)
language sql stable
as $$
  select
    d.id,
    d.source,
    d.source_url,
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
