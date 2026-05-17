-- ============================================================
-- Recipe favorite counts — view voor totaal-aantal favorieten
-- per recept (over alle users heen).
-- ============================================================
-- Wordt gebruikt door recipeList om naast het hartje het aantal
-- keer te tonen dat een recept door iemand als favoriet is gemarkeerd.
-- security_invoker = true zodat de view de RLS van de onderliggende
-- favorites-tabel respecteert (die staat op "allow all").
-- ============================================================

drop view if exists public.recipe_favorite_counts;

create view public.recipe_favorite_counts
  with (security_invoker = true)
as
  select
    recipe_id,
    count(*)::int as favorite_count
  from public.favorites
  group by recipe_id;

-- Anon + authenticated mogen lezen.
grant select on public.recipe_favorite_counts to anon, authenticated;
