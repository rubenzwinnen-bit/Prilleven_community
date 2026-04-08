/* ============================================
   STORE MODULE
   Centraal datamanagement via Supabase.
   Alle CRUD operaties voor recepten, beoordelingen,
   commentaren, favorieten en weekschema's.

   De gebruikersnaam blijft in localStorage staan
   omdat dit een lokale voorkeur is.
============================================ */

import { supabaseFetch, supabaseStorageDelete } from './supabase.js';

/* ============================================
   IN-MEMORY CACHE LAAG
   Met 150+ gebruikers willen we niet bij elke
   navigatie alles opnieuw uit Supabase trekken.
   Korte TTL houdt data fris zonder veel calls.
   Mutaties roepen invalidate() aan om stale
   reads te vermijden.

   Cache keys:
     recipes:all              - alle recepten
     recipe:<id>              - één recept
     favorites:<user>         - favoriete recept-ids voor user
     ratings:all              - alle gemiddelden
     ratings:user:<user>      - eigen ratings per user
     comments:<recipeId>      - reacties per recept
     schedules:<user>         - opgeslagen weekschema's
============================================ */
const CACHE_TTL = 30_000; // 30 seconden
const _cache = new Map();

function _cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.t > CACHE_TTL) {
    _cache.delete(key);
    return undefined;
  }
  return entry.v;
}

function _cacheSet(key, value) {
  _cache.set(key, { v: value, t: Date.now() });
}

/** Wis cache-entries die met een prefix beginnen.
 *  Geen prefix => wis alles. */
function _cacheInvalidate(prefix) {
  if (!prefix) {
    _cache.clear();
    return;
  }
  for (const key of [..._cache.keys()]) {
    if (key.startsWith(prefix)) _cache.delete(key);
  }
}

/** Externe helper om de cache handmatig te wissen
 *  (bv. wanneer de gebruiker een andere naam invult) */
export function clearCache() {
  _cacheInvalidate();
}

/* ----------------------------------------
   GEBRUIKERSBEHEER (blijft localStorage)
   De gebruikersnaam wordt lokaal bewaard.
---------------------------------------- */
const USER_KEY = 'receptenboek_user';

/** Haal de huidige gebruikersnaam op */
export function getCurrentUser() {
  try {
    const data = localStorage.getItem(USER_KEY);
    return data ? JSON.parse(data) : '';
  } catch {
    return '';
  }
}

/** Sla de gebruikersnaam op (en wis user-specifieke cache) */
export function setCurrentUser(name) {
  localStorage.setItem(USER_KEY, JSON.stringify(name));
  _cacheInvalidate('favorites:');
  _cacheInvalidate('ratings:user:');
  _cacheInvalidate('schedules:');
}

/* ----------------------------------------
   HULPFUNCTIES
   Converteren tussen DB-formaat en app-formaat
---------------------------------------- */

/** Converteer een DB-rij naar het formaat dat de app gebruikt */
function dbToRecipe(row) {
  return {
    id: row.id,
    name: row.name,
    image: row.image,
    mealMoments: row.meal_moments || [],
    cookingTime: row.cooking_time || 0,
    /* Aantal porties (standaard 1 voor oude recepten zonder waarde).
       De kolom `portions` in Supabase mag NULL zijn; we vangen dat hier op. */
    portions: row.portions != null ? Number(row.portions) : 1,
    ingredients: row.ingredients || [],
    allergens: row.allergens || [],
    preparation: row.preparation || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    /* Beoordelingen en commentaren komen uit aparte tabellen.
       Deze velden blijven leeg totdat ze apart opgehaald worden. */
    ratings: {},
    comments: [],
  };
}

/** Converteer app-data naar DB-formaat (snake_case kolommen) */
function recipeToDb(data) {
  /* Porties: minimaal 1, parseInt vangt "12 stuks" soort strings af */
  const portions = parseInt(data.portions);
  return {
    name: data.name || 'Naamloos recept',
    image: data.image || '',
    meal_moments: data.mealMoments || [],
    cooking_time: parseInt(data.cookingTime) || 0,
    portions: Number.isFinite(portions) && portions > 0 ? portions : 1,
    ingredients: data.ingredients || [],
    allergens: data.allergens || [],
    preparation: data.preparation || [],
  };
}

/* ============================================
   RECEPTEN - CRUD OPERATIES
============================================ */

/** Haal alle recepten op (gecached) */
export async function getRecipes() {
  const cached = _cacheGet('recipes:all');
  if (cached) return cached;

  /* Range header om PostgREST's default 1000 rij limiet te omzeilen.
     Bij groei kan je dit verder verhogen. */
  const data = await supabaseFetch(
    '/rest/v1/recipes?select=*&order=created_at.desc',
    { headers: { 'Range-Unit': 'items', 'Range': '0-9999' } }
  );
  const recipes = (data || []).map(dbToRecipe);
  _cacheSet('recipes:all', recipes);
  /* Vul ook de individuele cache zodat getRecipe(id) gratis is */
  for (const r of recipes) _cacheSet(`recipe:${r.id}`, r);
  return recipes;
}

/** Haal een enkel recept op via ID (gecached) */
export async function getRecipe(id) {
  const cached = _cacheGet(`recipe:${id}`);
  if (cached) return cached;

  const data = await supabaseFetch(
    `/rest/v1/recipes?id=eq.${encodeURIComponent(id)}&select=*`
  );
  if (!data || data.length === 0) return null;
  const recipe = dbToRecipe(data[0]);
  _cacheSet(`recipe:${id}`, recipe);
  return recipe;
}

/** BATCH: haal meerdere recepten in één request op.
 *  Vervangt het N+1 patroon van Promise.all(ids.map(getRecipe)). */
export async function getRecipesByIds(ids) {
  if (!ids || ids.length === 0) return [];

  /* Eerst kijken wat er al in cache zit */
  const result = [];
  const missing = [];
  for (const id of ids) {
    const cached = _cacheGet(`recipe:${id}`);
    if (cached) result.push(cached);
    else missing.push(id);
  }
  if (missing.length === 0) return result;

  /* PostgREST in-filter: id=in.("rec-1","rec-2") */
  const filter = missing.map(id => `"${id}"`).join(',');
  const data = await supabaseFetch(
    `/rest/v1/recipes?id=in.(${filter})&select=*`
  );
  for (const row of (data || [])) {
    const recipe = dbToRecipe(row);
    _cacheSet(`recipe:${recipe.id}`, recipe);
    result.push(recipe);
  }
  return result;
}

/** Voeg een nieuw recept toe */
export async function addRecipe(recipeData) {
  const row = recipeToDb(recipeData);
  const data = await supabaseFetch('/rest/v1/recipes', {
    method: 'POST',
    body: row,
  });
  _cacheInvalidate('recipes:');
  _cacheInvalidate('recipe:');
  return dbToRecipe(data[0]);
}

/** Werk een bestaand recept bij */
export async function updateRecipe(id, updates) {
  const row = recipeToDb(updates);
  row.updated_at = new Date().toISOString();
  const data = await supabaseFetch(
    `/rest/v1/recipes?id=eq.${encodeURIComponent(id)}`,
    { method: 'PATCH', body: row }
  );
  _cacheInvalidate('recipes:');
  _cacheInvalidate('recipe:');
  if (!data || data.length === 0) return null;
  return dbToRecipe(data[0]);
}

/** Verwijder een recept (CASCADE wist ratings, comments en favorites) */
export async function deleteRecipe(id) {
  await supabaseFetch(`/rest/v1/recipes?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    prefer: 'return=minimal',
  });
  /* Probeer ook de afbeelding(en) te verwijderen uit storage */
  await supabaseStorageDelete(`recipes/${id}`).catch(() => {});
  _cacheInvalidate('recipes:');
  _cacheInvalidate('recipe:');
  _cacheInvalidate('favorites:');
  _cacheInvalidate('ratings:');
  _cacheInvalidate(`comments:${id}`);
}

/** Verwijder ALLE recepten */
export async function deleteAllRecipes() {
  /* PostgREST vereist een filter, dus filteren we op "naam is niet null" */
  await supabaseFetch('/rest/v1/recipes?name=not.is.null', {
    method: 'DELETE',
    prefer: 'return=minimal',
  });
  _cacheInvalidate(); // alles wissen
}

/** Importeer recepten vanuit een JSON array (bulk insert) */
export async function importRecipes(jsonArray) {
  if (!jsonArray || jsonArray.length === 0) return 0;
  const rows = jsonArray.map(item => recipeToDb(item));
  const data = await supabaseFetch('/rest/v1/recipes', {
    method: 'POST',
    body: rows,
  });
  _cacheInvalidate('recipes:');
  _cacheInvalidate('recipe:');
  return data ? data.length : 0;
}

/* ============================================
   BEOORDELINGEN (RATINGS)
============================================ */

/** Beoordeel een recept (1-5 sterren) voor de huidige gebruiker */
export async function rateRecipe(recipeId, rating) {
  const user = getCurrentUser();
  if (!user) return null;

  const clamped = Math.min(5, Math.max(1, parseInt(rating)));

  /* UPSERT: voeg toe of update als al bestaat (op recipe_id + user_name) */
  await supabaseFetch('/rest/v1/ratings', {
    method: 'POST',
    body: { recipe_id: recipeId, user_name: user, rating: clamped },
    headers: { 'Prefer': 'return=representation,resolution=merge-duplicates' },
  });

  /* Cache invalideren zodat de UI verse cijfers ziet */
  _cacheInvalidate('ratings:');

  return await getRecipe(recipeId);
}

/** Bereken de gemiddelde beoordeling voor een recept.
 *  Gebruikt de gecachede `ratings:all` als die er is om
 *  een aparte netwerkcall te vermijden. */
export async function getAverageRating(recipeId) {
  const allCached = _cacheGet('ratings:all');
  if (allCached) {
    return allCached[recipeId] || { average: 0, count: 0 };
  }

  const data = await supabaseFetch(
    `/rest/v1/ratings?recipe_id=eq.${encodeURIComponent(recipeId)}&select=rating`
  );
  if (!data || data.length === 0) return { average: 0, count: 0 };

  const sum = data.reduce((a, r) => a + r.rating, 0);
  return {
    average: Math.round((sum / data.length) * 10) / 10,
    count: data.length,
  };
}

/** Haal de beoordeling van de huidige gebruiker op.
 *  Gebruikt de gecachede `ratings:user:<user>` map als die er is. */
export async function getUserRating(recipeId) {
  const user = getCurrentUser();
  if (!user) return 0;

  const cached = _cacheGet(`ratings:user:${user}`);
  if (cached) return cached[recipeId] || 0;

  const data = await supabaseFetch(
    `/rest/v1/ratings?recipe_id=eq.${encodeURIComponent(recipeId)}` +
    `&user_name=eq.${encodeURIComponent(user)}&select=rating`
  );
  return data && data.length > 0 ? data[0].rating : 0;
}

/** Haal ALLE beoordelingen op (gecached + paginatie-vriendelijk).
 *  Met 150 gebruikers kan deze tabel snel >1000 rijen worden,
 *  dus we expliciet een Range mee. */
export async function getAllRatings() {
  const cached = _cacheGet('ratings:all');
  if (cached) return cached;

  const data = await supabaseFetch(
    '/rest/v1/ratings?select=recipe_id,rating',
    { headers: { 'Range-Unit': 'items', 'Range': '0-99999' } }
  );
  const map = {};
  for (const row of (data || [])) {
    if (!map[row.recipe_id]) map[row.recipe_id] = [];
    map[row.recipe_id].push(row.rating);
  }
  const result = {};
  for (const [id, ratings] of Object.entries(map)) {
    const sum = ratings.reduce((a, b) => a + b, 0);
    result[id] = {
      average: Math.round((sum / ratings.length) * 10) / 10,
      count: ratings.length,
    };
  }
  _cacheSet('ratings:all', result);
  return result;
}

/** Haal alle eigen beoordelingen van de huidige gebruiker op (gecached) */
export async function getAllUserRatings() {
  const user = getCurrentUser();
  if (!user) return {};

  const key = `ratings:user:${user}`;
  const cached = _cacheGet(key);
  if (cached) return cached;

  const data = await supabaseFetch(
    `/rest/v1/ratings?user_name=eq.${encodeURIComponent(user)}&select=recipe_id,rating`,
    { headers: { 'Range-Unit': 'items', 'Range': '0-9999' } }
  );
  const map = {};
  for (const row of (data || [])) {
    map[row.recipe_id] = row.rating;
  }
  _cacheSet(key, map);
  return map;
}

/* ============================================
   COMMENTAREN
============================================ */

/** Haal alle commentaren op voor een recept (gecached) */
export async function getComments(recipeId) {
  const key = `comments:${recipeId}`;
  const cached = _cacheGet(key);
  if (cached) return cached;

  const data = await supabaseFetch(
    `/rest/v1/comments?recipe_id=eq.${encodeURIComponent(recipeId)}&select=*&order=created_at.asc`
  );
  const comments = (data || []).map(c => ({
    id: c.id,
    userId: c.user_name,
    userName: c.user_name,
    text: c.text,
    date: c.created_at,
  }));
  _cacheSet(key, comments);
  return comments;
}

/** Voeg een commentaar toe aan een recept */
export async function addComment(recipeId, text) {
  const user = getCurrentUser();
  if (!user || !text.trim()) return null;

  const data = await supabaseFetch('/rest/v1/comments', {
    method: 'POST',
    body: {
      recipe_id: recipeId,
      user_name: user,
      text: text.trim(),
    },
  });

  /* Invalidate comments cache zodat de nieuwe direct mee komt */
  _cacheInvalidate(`comments:${recipeId}`);

  if (!data || data.length === 0) return null;

  return {
    id: data[0].id,
    userId: data[0].user_name,
    userName: data[0].user_name,
    text: data[0].text,
    date: data[0].created_at,
  };
}

/* ============================================
   FAVORIETE RECEPTEN (per gebruiker)
============================================ */

/** Haal alle favoriete recept-ID's op voor de huidige gebruiker (gecached) */
export async function getFavoriteRecipeIds() {
  const user = getCurrentUser();
  if (!user) return [];

  const key = `favorites:${user}`;
  const cached = _cacheGet(key);
  if (cached) return cached;

  const data = await supabaseFetch(
    `/rest/v1/favorites?user_name=eq.${encodeURIComponent(user)}&select=recipe_id`,
    { headers: { 'Range-Unit': 'items', 'Range': '0-9999' } }
  );
  const ids = (data || []).map(f => f.recipe_id);
  _cacheSet(key, ids);
  return ids;
}

/** Controleer of een recept een favoriet is */
export async function isFavorite(recipeId) {
  const favIds = await getFavoriteRecipeIds();
  return favIds.includes(recipeId);
}

/** Toggle de favorietstatus van een recept.
 *  Race-safe pattern: probeer eerst te DELETEN (idempotent).
 *  Als er iets verwijderd werd -> was al favoriet, nu verwijderd.
 *  Als er niets verwijderd werd -> was geen favoriet, dus INSERT nu.
 *  Als de INSERT alsnog een 409 geeft (race), vangen we dat af.
 */
export async function toggleFavorite(recipeId) {
  const user = getCurrentUser();
  if (!user) {
    throw new Error('Geen gebruikersnaam ingesteld. Vul bovenaan je naam in.');
  }

  /* Stap 1: probeer te DELETEN. Standaard Prefer 'return=representation'
     geeft de verwijderde rijen terug zodat we weten of er iets bestond. */
  const deleted = await supabaseFetch(
    `/rest/v1/favorites?user_name=eq.${encodeURIComponent(user)}` +
    `&recipe_id=eq.${encodeURIComponent(recipeId)}`,
    { method: 'DELETE' }
  );

  /* Cache invalideren ongeacht uitkomst */
  _cacheInvalidate(`favorites:${user}`);

  if (Array.isArray(deleted) && deleted.length > 0) {
    /* Bestond al -> nu verwijderd */
    return false;
  }

  /* Stap 2: bestond nog niet, dus INSERT. Gebruik merge-duplicates
     om 409 conflicts af te vangen bij race conditions. */
  try {
    await supabaseFetch('/rest/v1/favorites', {
      method: 'POST',
      body: { user_name: user, recipe_id: recipeId },
      prefer: 'return=minimal,resolution=merge-duplicates',
    });
    return true;
  } catch (err) {
    /* Als het alsnog een 409 is, bestaat de rij. Interpreteer als "was al favoriet" */
    if (err.message && err.message.includes('409')) {
      return true;
    }
    throw err;
  }
}

/** Haal alle favoriete recepten op (volledige objecten).
 *  Gebruikt de batch helper zodat alles via één call gaat
 *  én onderweg de individuele recipe-cache vult. */
export async function getFavoriteRecipes() {
  const favIds = await getFavoriteRecipeIds();
  if (favIds.length === 0) return [];
  return await getRecipesByIds(favIds);
}

/* ============================================
   WEEKSCHEMA'S (per gebruiker)
============================================ */

/** Haal alle opgeslagen weekschema's op voor de huidige gebruiker (gecached) */
export async function getSavedSchedules() {
  const user = getCurrentUser();
  if (!user) return [];

  const key = `schedules:${user}`;
  const cached = _cacheGet(key);
  if (cached) return cached;

  const data = await supabaseFetch(
    `/rest/v1/schedules?user_name=eq.${encodeURIComponent(user)}` +
    `&select=*&order=created_at.desc`
  );
  const schedules = (data || []).map(s => ({
    id: s.id,
    name: s.name,
    days: s.days || {},
    excludedAllergens: s.excluded_allergens || [],
    createdAt: s.created_at,
  }));
  _cacheSet(key, schedules);
  /* Vul ook de individuele schema cache zodat shopping-list snel is */
  for (const s of schedules) _cacheSet(`schedule:${s.id}`, s);
  return schedules;
}

/** Sla een weekschema op in favorieten */
export async function saveSchedule(schedule) {
  const user = getCurrentUser();
  if (!user) {
    throw new Error('Geen gebruikersnaam ingesteld. Vul bovenaan je naam in.');
  }

  const data = await supabaseFetch('/rest/v1/schedules', {
    method: 'POST',
    body: {
      user_name: user,
      name: schedule.name,
      days: schedule.days || {},
      excluded_allergens: schedule.excludedAllergens || [],
    },
  });

  _cacheInvalidate(`schedules:${user}`);

  if (!data || data.length === 0) return null;

  const s = data[0];
  return {
    id: s.id,
    name: s.name,
    days: s.days,
    excludedAllergens: s.excluded_allergens,
    createdAt: s.created_at,
  };
}

/** Haal een enkel weekschema op (gecached) */
export async function getSchedule(id) {
  const cached = _cacheGet(`schedule:${id}`);
  if (cached) return cached;

  const data = await supabaseFetch(
    `/rest/v1/schedules?id=eq.${encodeURIComponent(id)}&select=*`
  );
  if (!data || data.length === 0) return null;

  const s = data[0];
  const schedule = {
    id: s.id,
    name: s.name,
    days: s.days || {},
    excludedAllergens: s.excluded_allergens || [],
    createdAt: s.created_at,
  };
  _cacheSet(`schedule:${id}`, schedule);
  return schedule;
}

/** Verwijder een weekschema */
export async function deleteSchedule(id) {
  await supabaseFetch(`/rest/v1/schedules?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    prefer: 'return=minimal',
  });
  _cacheInvalidate('schedules:');
  _cacheInvalidate(`schedule:${id}`);
}

/* ============================================
   INITIALISATIE CHECK
   Controleer of we verbinding hebben met Supabase
============================================ */
export async function isInitialized() {
  try {
    await supabaseFetch('/rest/v1/recipes?select=id&limit=1');
    return true;
  } catch {
    return false;
  }
}
