-- Maak icon_url nullable zodat een ingrediënt een weergavenaam/aliassen kan
-- hebben zonder (nog) een geüpload icoon. Voorheen brak "Hernoem" op een
-- ingrediënt zonder icoon met error 23502 (NOT NULL violation) omdat de
-- UPSERT dan een INSERT werd zonder icon_url.
ALTER TABLE ingredient_icons
  ALTER COLUMN icon_url DROP NOT NULL;
