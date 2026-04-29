/* ============================================
   HEADER COMPONENT
   Toont de app-titel, het e-mailadres van de
   ingelogde gebruiker en een uitlogknop.
============================================ */

import * as Store from '../store.js?v=2.0.1';
import { sessionClear, invalidateSubscriptionCache } from '../supabase.js?v=2.0.1';

/* ----------------------------------------
   RENDER
   Genereer de header HTML
---------------------------------------- */
export function render() {
  const user = Store.getCurrentUser();
  return `
    <div class="header-inner">
      <a class="header-title" href="#/" id="header-home-link" title="Naar het hub">
        <img src="/pril-leven-logo.png" alt="" class="header-logo" />
        <span>Community Pril leven</span>
      </a>
      <div class="header-user">
        <a href="#/" class="header-home-btn" id="header-home-btn" title="Naar het hub" aria-label="Naar het hub">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5 12 3l9 6.5V21a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1V9.5Z"/></svg>
        </a>
        <span class="user-name" id="header-user-name">${user || 'Gast'}</span>
        <button class="btn-logout" id="header-logout-btn" title="Uitloggen">Uitloggen</button>
      </div>
    </div>
  `;
}

/* ----------------------------------------
   INIT
   Koppel event listeners aan de header
---------------------------------------- */
export function init() {
  const logoutBtn = document.getElementById('header-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      const email = Store.getCurrentUser();
      localStorage.removeItem('receptenboek_user');
      sessionClear();
      if (email) invalidateSubscriptionCache(email);
      Store.clearAdminCache();
      Store.clearCache();
      location.reload();
    });
  }
}
