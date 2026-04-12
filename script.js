/* ============================================
   SCRIPT.JS - HOOFD ENTRY POINT
   Initialiseert de applicatie:
   1. Detecteert recovery tokens (wachtwoord reset)
   2. Controleert/vraagt authenticatie
   3. Rendert header en navigatie
   4. Stelt de router in met alle pagina-routes
   5. Start de router
============================================ */

import * as Store from './js/store.js';
import {
  checkAllowedUser,
  checkCanSignUp,
  authSignUp,
  authSignIn,
  authResetPassword,
  authUpdatePassword,
  markUserRegistered,
} from './js/supabase.js';
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
import * as IngredientIcons from './js/components/ingredientIcons.js';

/* ============================================
   RECOVERY TOKEN DETECTIE
   Supabase stuurt: #access_token=xxx&type=recovery
   Onze router verwacht: #/pad
   Dit moet VOOR de router starten.
============================================ */
let recoveryToken = null;

function detectRecoveryToken() {
  const hash = window.location.hash;
  if (!hash || hash.startsWith('#/')) return;

  const params = new URLSearchParams(hash.substring(1));
  const type = params.get('type');
  const accessToken = params.get('access_token');

  if (type === 'recovery' && accessToken) {
    recoveryToken = accessToken;
    history.replaceState(null, '', window.location.pathname);
  }
}

/* ============================================
   APP INITIALISATIE
   Wordt uitgevoerd zodra de DOM geladen is
============================================ */
function initApp() {
  detectRecoveryToken();

  const user = Store.getCurrentUser();

  if (recoveryToken) {
    showAuthModal('reset');
  } else if (!user) {
    showAuthModal('login');
  } else {
    setupApp();
  }
}

/* ============================================
   AUTH MODAL CONTROLLER
   Beheert tab-wisseling en alle vier auth views:
   login, signup, forgot, reset
============================================ */
function showAuthModal(initialView = 'login') {
  const modal = document.getElementById('user-modal');
  modal.classList.remove('hidden');

  /* --- View elementen --- */
  const views = {
    login:  document.getElementById('auth-login'),
    signup: document.getElementById('auth-signup'),
    forgot: document.getElementById('auth-forgot'),
    reset:  document.getElementById('auth-reset'),
  };

  /* --- Tab elementen --- */
  const tabs = modal.querySelectorAll('.auth-tab');
  const tabBar = document.getElementById('auth-tabs');

  /* ----------------------------------------
     VIEW WISSELEN
  ---------------------------------------- */
  function showView(name) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    views[name].classList.remove('hidden');

    if (name === 'login' || name === 'signup') {
      tabBar.classList.remove('hidden');
      tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    } else {
      tabBar.classList.add('hidden');
    }

    const firstInput = views[name].querySelector('input');
    if (firstInput) firstInput.focus();

    modal.querySelectorAll('.auth-error, .auth-success').forEach(el => {
      el.classList.add('hidden');
      el.textContent = '';
    });
    modal.querySelectorAll('.auth-loading').forEach(el => el.classList.add('hidden'));
  }

  /* --- Tab click handlers --- */
  tabs.forEach(tab => {
    tab.addEventListener('click', () => showView(tab.dataset.tab));
  });

  /* --- Link handlers --- */
  document.getElementById('show-forgot').addEventListener('click', (e) => {
    e.preventDefault();
    showView('forgot');
  });
  document.getElementById('show-login-from-forgot').addEventListener('click', (e) => {
    e.preventDefault();
    showView('login');
  });

  /* ----------------------------------------
     HELPERS
  ---------------------------------------- */
  function showError(viewName, message) {
    const el = views[viewName].querySelector('.auth-error');
    el.textContent = message;
    el.classList.remove('hidden');
  }

  function setLoading(viewName, isLoading) {
    const loadingEl = views[viewName].querySelector('.auth-loading');
    const submitBtn = views[viewName].querySelector('button[id$="-submit"]');
    const inputs = views[viewName].querySelectorAll('input');

    if (isLoading) {
      loadingEl.classList.remove('hidden');
      submitBtn.disabled = true;
      inputs.forEach(i => i.disabled = true);
    } else {
      loadingEl.classList.add('hidden');
      submitBtn.disabled = false;
      inputs.forEach(i => i.disabled = false);
    }
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function completeLogin(email) {
    Store.setCurrentUser(email);
    modal.classList.add('hidden');
    setupApp();
  }

  /* ============================================
     LOGIN HANDLER
  ============================================ */
  async function handleLogin() {
    const email = document.getElementById('login-email').value.trim().toLowerCase();
    const password = document.getElementById('login-password').value;

    if (!isValidEmail(email)) {
      showError('login', 'Voer een geldig e-mailadres in.');
      return;
    }
    if (!password) {
      showError('login', 'Voer je wachtwoord in.');
      return;
    }

    setLoading('login', true);
    views.login.querySelector('.auth-error').classList.add('hidden');

    try {
      await authSignIn(email, password);
      completeLogin(email);
    } catch (err) {
      let message = 'Inloggen mislukt. Controleer je gegevens.';
      if (err.message.includes('Invalid login credentials')) {
        message = 'Onjuist e-mailadres of wachtwoord.';
      } else if (err.message.includes('Email not confirmed')) {
        message = 'Je e-mailadres is nog niet bevestigd.';
      }
      showError('login', message);
    } finally {
      setLoading('login', false);
    }
  }

  document.getElementById('login-submit').addEventListener('click', handleLogin);
  document.getElementById('login-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLogin();
  });

  /* ============================================
     SIGNUP HANDLER
  ============================================ */
  async function handleSignUp() {
    const email = document.getElementById('signup-email').value.trim().toLowerCase();
    const password = document.getElementById('signup-password').value;
    const passwordConfirm = document.getElementById('signup-password-confirm').value;

    if (!isValidEmail(email)) {
      showError('signup', 'Voer een geldig e-mailadres in.');
      return;
    }
    if (password.length < 6) {
      showError('signup', 'Wachtwoord moet minimaal 6 tekens bevatten.');
      return;
    }
    if (password !== passwordConfirm) {
      showError('signup', 'Wachtwoorden komen niet overeen.');
      return;
    }

    setLoading('signup', true);
    views.signup.querySelector('.auth-error').classList.add('hidden');

    try {
      /* Stap 1: Controleer of email mag registreren */
      const canSignUp = await checkCanSignUp(email);
      if (!canSignUp) {
        const exists = await checkAllowedUser(email);
        if (exists) {
          showError('signup', 'Dit e-mailadres heeft al een account. Gebruik "Inloggen" om in te loggen.');
        } else {
          showError('signup', 'Dit e-mailadres is niet geregistreerd. Heb je al betaald? Neem contact op als je denkt dat dit een fout is.');
        }
        return;
      }

      /* Stap 2: Maak Supabase Auth account */
      await authSignUp(email, password);

      /* Stap 3: Markeer als geregistreerd */
      await markUserRegistered(email);

      /* Stap 4: Auto-login na registratie */
      await authSignIn(email, password);
      completeLogin(email);

    } catch (err) {
      let message = 'Registratie mislukt. Probeer het opnieuw.';
      if (err.message.includes('already been registered') || err.message.includes('already registered')) {
        message = 'Dit e-mailadres heeft al een account. Gebruik "Inloggen".';
      } else if (err.message.includes('Email not confirmed')) {
        message = 'Je e-mailadres moet eerst bevestigd worden. Controleer je inbox.';
      }
      showError('signup', message);
    } finally {
      setLoading('signup', false);
    }
  }

  document.getElementById('signup-submit').addEventListener('click', handleSignUp);
  document.getElementById('signup-password-confirm').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSignUp();
  });

  /* ============================================
     FORGOT PASSWORD HANDLER
  ============================================ */
  async function handleForgot() {
    const email = document.getElementById('forgot-email').value.trim().toLowerCase();

    if (!isValidEmail(email)) {
      showError('forgot', 'Voer een geldig e-mailadres in.');
      return;
    }

    setLoading('forgot', true);
    views.forgot.querySelector('.auth-error').classList.add('hidden');

    try {
      await authResetPassword(email);
    } catch (err) {
      /* Toon altijd succes voor privacy (verberg of email bestaat) */
    } finally {
      setLoading('forgot', false);
      const successEl = document.getElementById('forgot-success');
      successEl.textContent = 'Als dit e-mailadres bij ons bekend is, ontvang je binnen enkele minuten een link om je wachtwoord te resetten.';
      successEl.classList.remove('hidden');
    }
  }

  document.getElementById('forgot-submit').addEventListener('click', handleForgot);
  document.getElementById('forgot-email').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleForgot();
  });

  /* ============================================
     RESET PASSWORD HANDLER
     (verschijnt alleen via recovery link uit email)
  ============================================ */
  async function handleReset() {
    const password = document.getElementById('reset-password').value;
    const passwordConfirm = document.getElementById('reset-password-confirm').value;

    if (password.length < 6) {
      showError('reset', 'Wachtwoord moet minimaal 6 tekens bevatten.');
      return;
    }
    if (password !== passwordConfirm) {
      showError('reset', 'Wachtwoorden komen niet overeen.');
      return;
    }

    setLoading('reset', true);
    views.reset.querySelector('.auth-error').classList.add('hidden');

    try {
      const result = await authUpdatePassword(recoveryToken, password);
      const email = result.email;
      await authSignIn(email, password);
      completeLogin(email);
    } catch (err) {
      let message = 'Wachtwoord wijzigen mislukt. De link is mogelijk verlopen.';
      if (err.message.includes('expired') || err.message.includes('invalid')) {
        message = 'De reset link is verlopen. Vraag een nieuwe aan via "Wachtwoord vergeten?".';
      }
      showError('reset', message);
    } finally {
      setLoading('reset', false);
    }
  }

  document.getElementById('reset-submit').addEventListener('click', handleReset);
  document.getElementById('reset-password-confirm').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleReset();
  });

  /* --- Toon de juiste view --- */
  showView(initialView);
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

  /* --- Ingrediënt iconen beheer --- */
  Router.on('ingredient-icons', async () => {
    await renderPage(IngredientIcons.render(), IngredientIcons.init);
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
