-- ============================================================
-- Pril Leven chat — persoonlijk vector-geheugen (Fase C)
-- Run in: Supabase Dashboard → SQL Editor → New query
-- Safe to run twice: uses IF NOT EXISTS / OR REPLACE.
-- ============================================================

-- 1. Tabel: chat_user_memory
-- Elk record = één duurzaam feit over de gebruiker/het gezin,
-- extracted uit een chat-uitwisseling.
create table if not exists public.chat_user_memory (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,

  -- Natuurlijk-talige samenvatting ("Lou weigert melk sinds 7 mnd")
  content            text not null,

  -- Vector embedding (Voyage voyage-3-large, 1024 dims, zelfde als documents)
  embedding          vector(1024),

  -- Waar dit feit vandaan komt (optioneel — mag null worden bij message-delete)
  source_message_id  uuid references public.messages(id) on delete set null,

  -- 1-5 (5 = medisch/allergie kritisch, 1 = trivia)
  importance         int not null default 3 check (importance between 1 and 5),

  created_at         timestamptz not null default now(),
  last_used_at       timestamptz
);

-- 2. Indexen
create index if not exists chat_user_memory_user_idx
  on public.chat_user_memory (user_id);

create index if not exists chat_user_memory_embedding_hnsw
  on public.chat_user_memory
  using hnsw (embedding vector_cosine_ops);

-- 3. Row-Level Security
alter table public.chat_user_memory enable row level security;

drop policy if exists "own memory" on public.chat_user_memory;
create policy "own memory"
  on public.chat_user_memory for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 4. RPC: match_user_memory — vector search beperkt tot één user
-- De service-role-client slaat RLS automatisch door; deze RPC doet de
-- user-scoping expliciet in de WHERE.
create or replace function public.match_user_memory (
  query_embedding  vector(1024),
  target_user_id   uuid,
  match_count      int default 4
)
returns table (
  id          uuid,
  content     text,
  importance  int,
  similarity  float
)
language sql stable
as $$
  select
    m.id,
    m.content,
    m.importance,
    1 - (m.embedding <=> query_embedding) as similarity
  from public.chat_user_memory m
  where m.user_id = target_user_id
    and m.embedding is not null
  order by m.embedding <=> query_embedding
  limit match_count;
$$;

-- 5. Prune-functie: dagelijks/wekelijks draaien via cron of handmatig
-- Regels:
--   a) verwijder memories met importance <= 2 die al > 180 dagen niet gebruikt zijn
--   b) cap op 500 entries per user: de overtollige minst-waardevolle worden verwijderd
--      (sort op importance desc, last_used_at desc, created_at desc)
create or replace function public.prune_user_memory()
returns int
language plpgsql
as $$
declare
  deleted_count int := 0;
  ranked_over int := 0;
begin
  -- a) lage-importance + oud + ongebruikt
  with del as (
    delete from public.chat_user_memory
    where importance <= 2
      and created_at < now() - interval '180 days'
      and (last_used_at is null or last_used_at < now() - interval '180 days')
    returning 1
  )
  select count(*) into deleted_count from del;

  -- b) Cap per user op 500
  with ranked as (
    select id,
           row_number() over (partition by user_id
                              order by importance desc,
                                       last_used_at desc nulls last,
                                       created_at desc) as rn
    from public.chat_user_memory
  ),
  del2 as (
    delete from public.chat_user_memory
    where id in (select id from ranked where rn > 500)
    returning 1
  )
  select count(*) into ranked_over from del2;

  return deleted_count + ranked_over;
end;
$$;

-- ============================================================
-- Klaar.
-- Suggestie: plan een wekelijkse cron die prune_user_memory() aanroept.
--   bv. via Supabase Scheduled Functions, pg_cron, of externe cron.
-- ============================================================
