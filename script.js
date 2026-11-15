/* ============================================
   SCRIPT.JS - HOOFD ENTRY POINT
   Initialiseert de applicatie:
   1. Detecteert recovery tokens (wachtwoord reset)
   2. Controleert/vraagt authenticatie
   3. Rendert header en navigatie
   4. Stelt de router in met alle pagina-routes
   5. Start de router
============================================ */

import * as Store from './js/store.js?v=4.0.34';
import {
  checkAllowedUser,
  checkCanSignUp,
  authSignUp,
  authSignIn,
  authResetPassword,
  authUpdatePassword,
  markUserRegistered,
  sessionSet,
  sessionClear,
  fetchSubscriptionStatus,
  subscriptionAccessMessage,
  invalidateSubscriptionCache,
  getRememberedSubscription,
  forgetRememberedSubscription,
} from './js/supabase.js?v=4.0.34';
import * as Router from './js/router.js?v=4.0.34';
import * as Header from './js/components/header.js?v=4.0.34';
import * as Nav from './js/components/nav.js?v=4.0.34';
import * as Home from './js/components/home.js?v=4.0.34';

/* ============================================
   LAZY ROUTE-MODULES
   Elke pagina wordt pas opgehaald wanneer de route
   voor het eerst bezocht wordt. Dat scheelt ~380 KB
   JavaScript op de eerste render; wie enkel de hub
   bekijkt, laadt niet ook het allergenenpad en profiel.
   De browser cachet de module na de eerste keer, dus
   een tweede bezoek aan dezelfde route is direct.
============================================ */
const lazy = {
  RecipeList: () => import('./js/components/recipeList.js?v=4.0.34'),
  RecipeDetail: () => import('./js/components/recipeDetail.js?v=4.0.34'),
  ImportRecipes: () => import('./js/components/importRecipes.js?v=4.0.34'),
  WeekSchedule: () => import('./js/components/weekSchedule.js?v=4.0.34'),
  Favorites: () => import('./js/components/favorites.js?v=4.0.34'),
  ShoppingList: () => import('./js/components/shoppingList.js?v=4.0.34'),
  RecipeForm: () => import('./js/components/recipeForm.js?v=4.0.34'),
  IngredientIcons: () => import('./js/components/ingredientIcons.js?v=4.0.34'),
  LearningsLibrary: () => import('./js/components/learningsLibrary.js?v=4.0.34'),
  LearningsDetail: () => import('./js/components/learningsDetail.js?v=4.0.34'),
  Profiel: () => import('./js/components/profiel.js?v=4.0.34'),
  Allergenen: () => import('./js/components/allergenen.js?v=4.0.34'),
  Aanraders: () => import('./js/components/aanraders.js?v=4.0.34'),
};

/* ----------------------------------------
   AANRADERS-STYLESHEET
   Stond vroeger in index.html en laadde dus op elke pagina mee,
   terwijl alleen de aanraders-route hem nodig heeft. We voegen hem
   nu eenmalig toe bij het eerste bezoek en wachten tot hij binnen is,
   zodat de pagina niet even ongestyled flitst.
---------------------------------------- */
let _aanradersCss = null;
function loadAanradersCss() {
  if (_aanradersCss) return _aanradersCss;
  _aanradersCss = new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'aanraders.css?v=3.4.4';
    /* Ook bij een fout doorgaan: liever ongestyled dan een blanco pagina. */
    link.onload = resolve;
    link.onerror = resolve;
    document.head.appendChild(link);
  });
  return _aanradersCss;
}

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
async function initApp() {
  detectRecoveryToken();

  const user = Store.getCurrentUser();

  if (recoveryToken) {
    showAuthModal('reset');
    return;
  }
  if (!user) {
    showAuthModal('login');
    return;
  }

  /* Was de vorige statuscheck van deze gebruiker geslaagd, en niet te
     lang geleden? Dan tonen we de app meteen en verifieren we op de
     achtergrond. Dat scheelt een blokkerende netwerkcall van ~400ms
     (meer bij een cold start) waarin het scherm leeg bleef.

     Is er geen bruikbare herinnering (eerste bezoek, ander account,
     of de vorige check zei 'niet actief'), dan wachten we zoals
     voorheen op het serverantwoord voordat er iets zichtbaar wordt. */
  const remembered = getRememberedSubscription(user);

  if (remembered) {
    Store.setAdminStatusFromCache(remembered.isAdmin);
    setupApp();
    verifySubscriptionInBackground(user);
  } else {
    const status = await fetchSubscriptionStatus(user);
    if (!status.active) {
      showSubscriptionExpiredScreen(status);
      return;
    }
    // Pre-load admin status zodat Store.isAdmin() synchroon werkt
    await Store.refreshAdminStatus();
    setupApp();
  }

  // Periodiek checken of subscription nog actief is (elke 2 min).
  // Detecteert live-cancellation zonder dat gebruiker moet refreshen.
  startSubscriptionPoll();
}

/* ============================================
   ACHTERGROND-VERIFICATIE VAN HET ABONNEMENT
   Draait nadat de app al zichtbaar is. Zegt de server
   'niet actief', dan schuift het verlopen-scherm er alsnog
   overheen — dat is een overlay over de volledige pagina.
   Klopte de onthouden admin-status niet, dan hertekenen we
   de nav (die is het enige dat op isAdmin() steunt).
============================================ */
async function verifySubscriptionInBackground(email) {
  const status = await fetchSubscriptionStatus(email);

  if (!status.active) {
    showSubscriptionExpiredScreen(status);
    return;
  }

  const adminVoor = Store.isAdmin();
  await Store.refreshAdminStatus();
  if (Store.isAdmin() !== adminVoor) {
    const navEl = document.getElementById('app-nav');
    /* Alleen de HTML verversen, niet Nav.init() opnieuw draaien:
       die hangt listeners aan document en zou ze verdubbelen. */
    if (navEl) {
      navEl.innerHTML = Nav.render();
      Nav.updateActive();
    }
  }
}

let subPollTimer = null;
function startSubscriptionPoll() {
  if (subPollTimer) clearInterval(subPollTimer);
  subPollTimer = setInterval(async () => {
    const email = Store.getCurrentUser();
    if (!email) return;
    invalidateSubscriptionCache(email);
    const status = await fetchSubscriptionStatus(email);
    if (!status.active && !document.getElementById('sub-expired-overlay')) {
      clearInterval(subPollTimer);
      subPollTimer = null;
      showSubscriptionExpiredScreen(status);
    }
  }, 60 * 1000); // elke minuut
}

/* ============================================
   ABONNEMENT-VERLOPEN SCHERM
   Toont een volledig-scherm bericht als het
   lidmaatschap niet meer actief is.
============================================ */
function showSubscriptionExpiredScreen(status) {
  const message = subscriptionAccessMessage(status);
  const overlay = document.createElement('div');
  overlay.id = 'sub-expired-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0;
    background: var(--color-bg, #faf8f5);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    font-family: 'Poppins', sans-serif;
  `;
  overlay.innerHTML = `
    <div style="max-width: 480px; text-align: center;">
      <div style="font-size: 3rem; margin-bottom: 1rem;">🌿</div>
      <h1 style="color: var(--color-primary, #C98966); margin-bottom: 1rem;">Je lidmaatschap is verlopen</h1>
      <p style="color: var(--color-dark-light, #3d3d3d); line-height: 1.6; margin-bottom: 2rem;">${message}</p>
      <a href="https://prillenbe.plugandpay.com/checkout/pril-leven-community" target="_blank" rel="noopener" style="
        display: inline-block;
        padding: .85rem 1.75rem;
        background: var(--color-primary, #C98966);
        color: white;
        text-decoration: none;
        border-radius: 12px;
        font-weight: 600;
        margin-right: .5rem;
        margin-bottom: .5rem;
      ">Lid worden van de community</a>
      <button id="sub-refresh-btn" style="
        padding: .85rem 1.75rem;
        background: #4F7D6C;
        color: white;
        border: none;
        border-radius: 12px;
        font-family: inherit;
        font-weight: 600;
        cursor: pointer;
        margin-right: .5rem;
        margin-bottom: .5rem;
      ">Net betaald? Check opnieuw</button>
      <button id="sub-logout-btn" style="
        padding: .85rem 1.75rem;
        background: transparent;
        color: var(--color-dark, #171717);
        border: 1px solid var(--color-gray-light, #c5c5c5);
        border-radius: 12px;
        font-family: inherit;
        font-weight: 500;
        cursor: pointer;
        margin-bottom: .5rem;
      ">Uitloggen</button>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('sub-logout-btn').addEventListener('click', () => {
    const email = Store.getCurrentUser();
    localStorage.removeItem('receptenboek_user');
    sessionClear();
    if (email) invalidateSubscriptionCache(email);
    forgetRememberedSubscription();
    Store.clearCache();
    location.reload();
  });
  document.getElementById('sub-refresh-btn').addEventListener('click', async () => {
    const email = Store.getCurrentUser();
    const btn = document.getElementById('sub-refresh-btn');
    btn.disabled = true;
    btn.textContent = 'Even checken…';
    // Invalideer client-side cache zodat we écht opnieuw de server bevragen
    if (email) invalidateSubscriptionCache(email);
    const fresh = await fetchSubscriptionStatus(email);
    if (fresh.active) {
      overlay.remove();
      await Store.refreshAdminStatus();
      setupApp();
    } else {
      btn.disabled = false;
      btn.textContent = 'Nog niet gewijzigd — probeer opnieuw';
    }
  });
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

  /* Vermoedelijke tikfout in het maildomein ("gmial.com" → "gmail.com"), of null.
     Spiegel van vermoedelijkeTikfout() in api/_lib/email-typo.mjs (de webhook
     mailt het team bij een tikfout in Plug&Pay); lijst en drempels gelijk houden. */
  const BEKENDE_MAILDOMEINEN = [
    'gmail.com', 'googlemail.com',
    'hotmail.com', 'hotmail.be', 'hotmail.nl', 'hotmail.fr',
    'outlook.com', 'outlook.be', 'outlook.nl',
    'live.com', 'live.be', 'live.nl', 'msn.com',
    'icloud.com', 'me.com', 'mac.com',
    'yahoo.com', 'yahoo.fr',
    'telenet.be', 'skynet.be', 'proximus.be', 'scarlet.be',
    'kpnmail.nl', 'ziggo.nl', 'planet.nl', 'home.nl',
  ];

  function domeinAfstand(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
      }
    }
    return d[a.length][b.length];
  }

  function vermoedelijkeTikfout(email) {
    const [lokaal, domein] = String(email || '').toLowerCase().trim().split('@');
    if (!lokaal || !domein || BEKENDE_MAILDOMEINEN.includes(domein)) return null;
    const max = domein.length <= 8 ? 1 : 2;
    let beste = null;
    for (const kandidaat of BEKENDE_MAILDOMEINEN) {
      const a = domeinAfstand(domein, kandidaat);
      if (a <= max && (!beste || a < beste.a)) beste = { kandidaat, a };
    }
    return beste ? `${lokaal}@${beste.kandidaat}` : null;
  }

  /* "Niet bekend" bij registreren: bij een vermoedelijke tikfout een klikbare
     verbetering, anders de hint dat het adres bij het betalen fout kan zijn. */
  function showSignupUnknown(email) {
    const el = views.signup.querySelector('.auth-error');
    const suggestie = vermoedelijkeTikfout(email);
    el.textContent = '';
    if (suggestie) {
      el.append('Dit e-mailadres is niet bij ons bekend. Bedoel je ');
      const knop = document.createElement('button');
      knop.type = 'button';
      knop.className = 'auth-typo-suggestie';
      knop.textContent = suggestie;
      knop.addEventListener('click', () => {
        document.getElementById('signup-email').value = suggestie;
        el.classList.add('hidden');
        document.getElementById('signup-password').focus();
      });
      el.append(knop, '?');
    } else {
      el.textContent = 'Dit e-mailadres is niet bij ons bekend. Gebruik het adres waarmee je betaald hebt. Denk je dat er bij het betalen een tikfout in je adres is geslopen? Mail ons via hallo@prilleven.be.';
    }
    el.classList.remove('hidden');
  }

  async function completeLogin(email) {
    Store.setCurrentUser(email);
    // Subscription check — als niet actief, toon expired-scherm i.p.v. app
    const status = await fetchSubscriptionStatus(email);
    modal.classList.add('hidden');
    if (!status.active) {
      showSubscriptionExpiredScreen(status);
      return;
    }
    // Pre-load admin status zodat Store.isAdmin() synchroon werkt
    await Store.refreshAdminStatus();
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
      const authData = await authSignIn(email, password);
      sessionSet(authData);
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
          showSignupUnknown(email);
        }
        return;
      }

      /* Stap 2: Maak Supabase Auth account */
      await authSignUp(email, password);

      /* Stap 3: Markeer als geregistreerd */
      await markUserRegistered(email);

      /* Stap 4: Auto-login na registratie */
      const authData = await authSignIn(email, password);
      sessionSet(authData);
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
      const authData = await authSignIn(email, password);
      sessionSet(authData);
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
    // Verberg nav op de landingspagina (hub heeft eigen tegels)
    const isHub = Router.getCurrentPath() === '';
    document.body.classList.toggle('is-hub', isHub);
    // Verberg nav ook op de Learnings-pagina's (eigen header, geen recepten-tabs)
    const isLearnings = Router.getCurrentPath().split('/')[0] === 'learnings';
    document.body.classList.toggle('is-learnings', isLearnings);
    // Verberg nav op de profielpagina
    const isProfiel = Router.getCurrentPath() === 'profiel';
    document.body.classList.toggle('is-profiel', isProfiel);
    // Verberg nav op de allergenen-pagina
    const isAllergenen = Router.getCurrentPath() === 'allergenen';
    document.body.classList.toggle('is-allergenen', isAllergenen);
    // Verberg nav op de aanraders-pagina's (eigen opbouw, geen recepten-tabs)
    const isAanraders = Router.getCurrentPath().split('/')[0] === 'aanraders';
    document.body.classList.toggle('is-aanraders', isAanraders);
    if (initFn) await initFn();

    /* Scroll-positie herstellen als we terugkomen op een eerder bezochte
       route; anders naar bovenaan scrollen (nieuwe pagina). */
    const currentPath = Router.getCurrentPath();
    const savedKey = `scroll:${currentPath}`;
    const saved = sessionStorage.getItem(savedKey);
    if (saved !== null) {
      sessionStorage.removeItem(savedKey);
      const y = parseInt(saved, 10);
      window.scrollTo(0, isNaN(y) ? 0 : y);
    } else {
      window.scrollTo(0, 0);
    }
  }

  /* --- Hub: landingspagina met tegels --- */
  Router.on('', async () => {
    await renderPage(Home.render(), Home.init);
  });

  /* --- Recepten overzicht --- */
  Router.on('recipes', async () => {
    const M = await lazy.RecipeList();
    await renderPage(M.render(), M.init);
  });

  /* --- Recept bewerken --- */
  Router.on('edit/:id', async (params) => {
    const M = await lazy.RecipeForm();
    await renderPage(
      M.render(params.id),
      () => M.init(params.id)
    );
  });

  /* --- Nieuw recept toevoegen (manueel, admin) --- */
  Router.on('new-recipe', async () => {
    const M = await lazy.RecipeForm();
    await renderPage(M.render(), () => M.init());
  });

  /* --- Recept detail --- */
  Router.on('recipe/:id', async (params) => {
    const M = await lazy.RecipeDetail();
    await renderPage(
      M.render(params.id),
      () => M.init(params.id)
    );
  });

  /* --- Recepten importeren --- */
  Router.on('import', async () => {
    const M = await lazy.ImportRecipes();
    await renderPage(M.render(), M.init);
  });

  /* --- Ingrediënt iconen beheer --- */
  Router.on('ingredient-icons', async () => {
    const M = await lazy.IngredientIcons();
    await renderPage(M.render(), M.init);
  });

  /* --- Weekschema generator --- */
  Router.on('schedule', async () => {
    const M = await lazy.WeekSchedule();
    await renderPage(M.render(), M.init);
  });

  /* --- Favorieten --- */
  Router.on('favorites', async () => {
    const M = await lazy.Favorites();
    await renderPage(M.render(), M.init);
  });

  /* --- Boodschappenlijst voor een weekschema --- */
  Router.on('shopping/:id', async (params) => {
    const M = await lazy.ShoppingList();
    await renderPage(
      M.render(params.id),
      () => M.init(params.id)
    );
  });

  /* --- Learnings: overzicht --- */
  Router.on('learnings', async () => {
    const M = await lazy.LearningsLibrary();
    await renderPage(M.render(), M.init);
  });

  /* --- Learnings: detail --- */
  Router.on('learnings/:id', async (params) => {
    const M = await lazy.LearningsDetail();
    await renderPage(
      M.render(params.id),
      () => M.init(params.id)
    );
  });

  /* --- Profiel --- */
  Router.on('profiel', async () => {
    const M = await lazy.Profiel();
    await renderPage(M.render(), M.init);
  });

  /* --- Allergenen introduceren --- */
  Router.on('allergenen', async () => {
    const M = await lazy.Allergenen();
    await renderPage(M.render(), M.init);
  });

  /* --- Aanraders: overzicht, categorie, product ---
     Dezelfde inhoud als de publieke pagina /aanraders, maar binnen de app
     zodat de gebruiker de community niet verlaat. De HTML komt van de
     server (fragment-modus), dus er is maar één renderer. */
  Router.on('aanraders', async () => {
    const [M] = await Promise.all([lazy.Aanraders(), loadAanradersCss()]);
    await renderPage(M.render(), () => M.init('overzicht'));
  });

  Router.on('aanraders/c/:slug', async (params) => {
    const [M] = await Promise.all([lazy.Aanraders(), loadAanradersCss()]);
    await renderPage(M.render(), () => M.init('categorie', params.slug));
  });

  Router.on('aanraders/p/:slug', async (params) => {
    const [M] = await Promise.all([lazy.Aanraders(), loadAanradersCss()]);
    await renderPage(M.render(), () => M.init('product', params.slug));
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
