/* ============================================
   HEADER COMPONENT
   Toont de app-titel en huidige gebruikersnaam.
   De gebruiker kan op zijn naam klikken om die
   te wijzigen.
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
        &#127859; Receptenboek
      </div>
      <div class="header-user">
        <span>Ingelogd als:</span>
        <span class="user-name" id="header-user-name" title="Klik om naam te wijzigen">${user || 'Gast'}</span>
      </div>
    </div>
  `;
}

/* ----------------------------------------
   INIT
   Koppel event listeners aan de header
---------------------------------------- */
export function init() {
  const nameEl = document.getElementById('header-user-name');
  if (nameEl) {
    nameEl.addEventListener('click', () => {
      const newName = prompt('Voer je nieuwe naam in:', Store.getCurrentUser());
      if (newName && newName.trim()) {
        Store.setCurrentUser(newName.trim());
        nameEl.textContent = newName.trim();
      }
    });
  }
}
