/* ============================================
   SCRIPT.JS - HOOFD ENTRY POINT
   Initialiseert de applicatie:
   1. Controleert/vraagt gebruikersnaam
   2. Rendert header en navigatie
   3. Stelt de router in met alle pagina-routes
   4. Start de router
============================================ */

import * as Store from './js/store.js';
import * as Router from './js/router.js';
import * as Header from './js/components/header.js';
import * as Nav from './js/components/nav.js';
import * as RecipeList from './js/components/recipeList.js';
import * as RecipeDetail from './js/components/recipeDetail.js';
import * as ImportRecipes from './js/components/importRecipes.js';
import * as WeekSchedule from './js/components/weekSchedule.js';
import * as Favorites from './js/components/favorites.js';
import * as ShoppingList from './js/components/shoppingList.js';
import * as RecipeForm from './js/components/recipeForm.js';

/* ============================================
   APP INITIALISATIE
   Wordt uitgevoerd zodra de DOM geladen is
============================================ */
function initApp() {
  /* ----------------------------------------
     STAP 1: Gebruikersnaam controleren
     Als er nog geen naam is ingesteld, toon modal
  ---------------------------------------- */
  const user = Store.getCurrentUser();
  if (!user) {
    showUserModal();
  } else {
    setupApp();
  }
}

/* ----------------------------------------
   GEBRUIKERSNAAM MODAL
   Toont een invoerveld bij eerste bezoek
---------------------------------------- */
function showUserModal() {
  const modal = document.getElementById('user-modal');
  const input = document.getElementById('user-name-input');
  const submitBtn = document.getElementById('user-name-submit');

  modal.classList.remove('hidden');
  input.focus();

  function handleSubmit() {
    const name = input.value.trim();
    if (name) {
      Store.setCurrentUser(name);
      modal.classList.add('hidden');
      setupApp();
    }
  }

  submitBtn.addEventListener('click', handleSubmit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSubmit();
  });
}

/* ----------------------------------------
   APP OPZETTEN
   Rendert de vaste componenten en start de router
---------------------------------------- */
function setupApp() {
  /* ----------------------------------------
     STAP 2: Header en Navigatie renderen
  ---------------------------------------- */
  const headerEl = document.getElementById('app-header');
  headerEl.innerHTML = Header.render();
  Header.init();

  const navEl = document.getElementById('app-nav');
  navEl.innerHTML = Nav.render();
  Nav.init();

  /* ----------------------------------------
     STAP 3: Routes registreren
     Elke route koppelt een URL-pad aan een component
  ---------------------------------------- */
  const content = document.getElementById('app-content');

  /** Helper: render een pagina en initialiseer de component
      Async omdat init-functies nu data van Supabase ophalen. */
  async function renderPage(html, initFn) {
    content.innerHTML = html;
    Nav.updateActive();
    if (initFn) await initFn();
    window.scrollTo(0, 0);
  }

  /* --- Recepten overzicht (homepagina) --- */
  Router.on('', async () => {
    await renderPage(RecipeList.render(), RecipeList.init);
  });

  /* --- Recept bewerken --- */
  Router.on('edit/:id', async (params) => {
    await renderPage(
      RecipeForm.render(params.id),
      () => RecipeForm.init(params.id)
    );
  });

  /* --- Recept detail --- */
  Router.on('recipe/:id', async (params) => {
    await renderPage(
      RecipeDetail.render(params.id),
      () => RecipeDetail.init(params.id)
    );
  });

  /* --- Recepten importeren --- */
  Router.on('import', async () => {
    await renderPage(ImportRecipes.render(), ImportRecipes.init);
  });

  /* --- Weekschema generator --- */
  Router.on('schedule', async () => {
    await renderPage(WeekSchedule.render(), WeekSchedule.init);
  });

  /* --- Favorieten --- */
  Router.on('favorites', async () => {
    await renderPage(Favorites.render(), Favorites.init);
  });

  /* --- Boodschappenlijst voor een weekschema --- */
  Router.on('shopping/:id', async (params) => {
    await renderPage(
      ShoppingList.render(params.id),
      () => ShoppingList.init(params.id)
    );
  });

  /* --- 404 pagina --- */
  Router.onNotFound(() => {
    renderPage(`
      <div class="empty-state">
        <div class="empty-state-icon">&#128533;</div>
        <h3>Pagina niet gevonden</h3>
        <p>De pagina die je zoekt bestaat niet.</p>
        <button class="btn btn-primary" onclick="location.hash='#/'">Naar homepagina</button>
      </div>
    `);
  });

  /* ----------------------------------------
     STAP 4: Router starten
  ---------------------------------------- */
  Router.init();
}

/* ============================================
   START DE APP
   Wacht tot de DOM volledig geladen is
============================================ */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
