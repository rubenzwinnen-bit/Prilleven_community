/* ============================================
   NAV COMPONENT
   Navigatiebalk met links naar alle secties.
   Markeert de actieve pagina visueel.
============================================ */

import * as Router from '../router.js';
import { isAdmin } from '../store.js';

/* ----------------------------------------
   NAVIGATIE ITEMS
   Elk item heeft een pad en label.
   adminOnly: alleen zichtbaar voor admins.
---------------------------------------- */
const NAV_ITEMS = [
  { path: '', label: 'Recepten' },
  { path: 'import', label: 'Importeren', adminOnly: true },
  { path: 'schedule', label: 'Weekschema' },
  { path: 'favorites', label: 'Favorieten' }
];

/* ----------------------------------------
   RENDER
   Genereer de navigatie HTML
---------------------------------------- */
export function render() {
  const current = Router.getCurrentPath().split('/')[0];
  const admin = isAdmin();

  const links = NAV_ITEMS
    .filter(item => !item.adminOnly || admin)
    .map(item => {
      const isActive = current === item.path ||
        (item.path === '' && current === '');
      return `<a class="nav-link ${isActive ? 'active' : ''}" data-path="${item.path}">${item.label}</a>`;
    }).join('');

  return `<div class="nav-inner">${links}</div>`;
}

/* ----------------------------------------
   INIT
   Koppel klik-handlers aan de navigatielinks
---------------------------------------- */
export function init() {
  const nav = document.getElementById('app-nav');
  nav.addEventListener('click', (e) => {
    const link = e.target.closest('.nav-link');
    if (!link) return;

    e.preventDefault();
    const path = link.dataset.path;
    Router.navigate(path);
  });
}

/* ----------------------------------------
   UPDATE ACTIEVE LINK
   Wordt aangeroepen bij elke navigatie
---------------------------------------- */
export function updateActive() {
  const nav = document.getElementById('app-nav');
  if (!nav) return;

  const current = Router.getCurrentPath().split('/')[0];
  nav.querySelectorAll('.nav-link').forEach(link => {
    const linkPath = link.dataset.path;
    const isActive = linkPath === current ||
      (linkPath === '' && current === '');
    link.classList.toggle('active', isActive);
  });
}
