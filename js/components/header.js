/* ============================================
   HEADER COMPONENT
   Toont de app-titel, het e-mailadres van de
   ingelogde gebruiker en een uitlogknop.
============================================ */

import * as Store from '../store.js';

/* ----------------------------------------
   RENDER
   Genereer de header HTML
---------------------------------------- */
export function render() {
  const user = Store.getCurrentUser();
  return `
    <div class="header-inner">
      <div class="header-title">
        &#127807; Community Pril leven
      </div>
      <div class="header-user">
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
      localStorage.removeItem('receptenboek_user');
      Store.clearCache();
      location.reload();
    });
  }
}
