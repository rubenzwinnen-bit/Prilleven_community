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
   Wordt aangeroepen bij elke hash-verandering
---------------------------------------- */
function handleRoute() {
  const currentPath = getCurrentPath();
  const result = matchRoute(currentPath);

  if (result) {
    result.handler(result.params);
  } else if (notFoundHandler) {
    notFoundHandler();
  }
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
