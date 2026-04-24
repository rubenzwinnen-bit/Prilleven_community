/* ============================================
   ROUTER MODULE
   Simpele hash-gebaseerde router voor SPA navigatie.
   Luistert naar veranderingen in de URL hash
   en roept de juiste handler aan.
============================================ */

/* ----------------------------------------
   ROUTE REGISTRATIE
   Bevat alle geregistreerde routes
---------------------------------------- */
const routes = {};
let notFoundHandler = null;

/* Bijhouden welk pad we verlaten, zodat we de scroll-positie
   kunnen onthouden (zie handleRoute). Null = nog niet genavigeerd
   binnen de app — handig om te weten of een "terug" knop
   history.back() mag gebruiken of moet fallbacken. */
let previousPath = null;

/* ----------------------------------------
   ROUTE REGISTREREN
   Registreer een handler voor een bepaald pad.
   Pad kan parameters bevatten met :param syntax.
   Voorbeeld: 'recipe/:id'
---------------------------------------- */
export function on(path, handler) {
  routes[path] = handler;
}

/* ----------------------------------------
   NAVIGEREN
   Navigeer naar een bepaald pad door de hash te veranderen.
---------------------------------------- */
export function navigate(path) {
  window.location.hash = '#/' + path;
}

/* ----------------------------------------
   404 HANDLER
   Stel een handler in voor onbekende routes.
---------------------------------------- */
export function onNotFound(handler) {
  notFoundHandler = handler;
}

/* ----------------------------------------
   HUIDIGE ROUTE OPHALEN
   Geeft het huidige hash-pad terug (zonder #/)
---------------------------------------- */
export function getCurrentPath() {
  const hash = window.location.hash.slice(2); // verwijder #/
  return hash || '';
}

/* ----------------------------------------
   HEEFT IN-APP GESCHIEDENIS?
   Gebruik om te beslissen of een "terug" knop
   history.back() mag gebruiken, of moet fallbacken
   naar een expliciete route (bv. bij direct openen
   van een URL zonder voorgaande navigatie).
---------------------------------------- */
export function hasHistory() {
  return previousPath !== null;
}

/* ----------------------------------------
   ROUTE MATCHING
   Vergelijkt het huidige pad met geregistreerde routes
   en extraheert eventuele parameters.
---------------------------------------- */
function matchRoute(currentPath) {
  /* Probeer eerst een exacte match */
  if (routes[currentPath]) {
    return { handler: routes[currentPath], params: {} };
  }

  /* Probeer route met parameters te matchen */
  const currentParts = currentPath.split('/');

  for (const [routePath, handler] of Object.entries(routes)) {
    const routeParts = routePath.split('/');

    if (routeParts.length !== currentParts.length) continue;

    const params = {};
    let match = true;

    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(':')) {
        /* Dit is een parameter */
        params[routeParts[i].slice(1)] = decodeURIComponent(currentParts[i]);
      } else if (routeParts[i] !== currentParts[i]) {
        match = false;
        break;
      }
    }

    if (match) {
      return { handler, params };
    }
  }

  return null;
}

/* ----------------------------------------
   ROUTE AFHANDELING
   Wordt aangeroepen bij elke hash-verandering.
   Voor de route-wissel: bewaar de scroll-positie van de
   verlaten pagina in sessionStorage zodat we die kunnen
   herstellen als de gebruiker terugkomt.
---------------------------------------- */
function handleRoute() {
  /* Scroll-positie van de verlaten pagina bewaren */
  if (previousPath !== null) {
    try {
      sessionStorage.setItem(`scroll:${previousPath}`, String(window.scrollY));
    } catch { /* storage kan vol of geblokkeerd zijn; negeren */ }
  }

  const currentPath = getCurrentPath();
  const result = matchRoute(currentPath);

  if (result) {
    result.handler(result.params);
  } else if (notFoundHandler) {
    notFoundHandler();
  }

  previousPath = currentPath;
}

/* ----------------------------------------
   INITIALISATIE
   Start de router en luister naar hash changes
---------------------------------------- */
export function init() {
  window.addEventListener('hashchange', handleRoute);

  /* Handel de initiële route af */
  if (!window.location.hash) {
    window.location.hash = '#/';
  }
  handleRoute();
}
