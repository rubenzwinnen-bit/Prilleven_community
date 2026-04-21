/* ============================================
   NAV COMPONENT
   Navigatiebalk met links naar alle secties.
   Markeert de actieve pagina visueel.
   Admin-items staan in een dropdown menu.
============================================ */

import * as Router from '../router.js';
import { isAdmin } from '../store.js';

/* ----------------------------------------
   NAVIGATIE ITEMS
   Gewone items voor alle gebruikers.
---------------------------------------- */
const NAV_ITEMS = [
  { path: 'recipes', label: 'Recepten' },
  { path: 'schedule', label: 'Weekschema' },
  { path: 'favorites', label: 'Favorieten' }
];

/* ----------------------------------------
   ADMIN ITEMS
   Alleen zichtbaar in het Admin dropdown
   menu voor admin-gebruikers.
---------------------------------------- */
const ADMIN_ITEMS = [
  { path: 'import', label: 'Recepten importeren' },
  { path: 'ingredient-icons', label: 'Iconen importeren' }
];

/* ----------------------------------------
   RENDER
   Genereer de navigatie HTML.
   Admin-items worden in een dropdown getoond.
---------------------------------------- */
export function render() {
  const current = Router.getCurrentPath().split('/')[0];
  const admin = isAdmin();

  const links = NAV_ITEMS.map(item => {
    const isActive = current === item.path ||
      (item.path === '' && current === '');
    return `<a class="nav-link ${isActive ? 'active' : ''}" data-path="${item.path}">${item.label}</a>`;
  }).join('');

  /* Admin dropdown (alleen voor admins) */
  let adminDropdown = '';
  if (admin) {
    const adminIsActive = ADMIN_ITEMS.some(item => current === item.path);
    const dropdownLinks = ADMIN_ITEMS.map(item => {
      const isActive = current === item.path;
      return `<a class="nav-dropdown-link ${isActive ? 'active' : ''}" data-path="${item.path}">${item.label}</a>`;
    }).join('');

    adminDropdown = `
      <div class="nav-dropdown-wrapper">
        <button class="nav-link nav-dropdown-toggle ${adminIsActive ? 'active' : ''}">
          Admin <span class="nav-dropdown-arrow">&#9662;</span>
        </button>
        <div class="nav-dropdown-menu">
          ${dropdownLinks}
        </div>
      </div>
    `;
  }

  return `<div class="nav-inner">${links}${adminDropdown}</div>`;
}

/* ----------------------------------------
   INIT
   Koppel klik-handlers aan de navigatielinks
   en het admin dropdown menu.
---------------------------------------- */
export function init() {
  const nav = document.getElementById('app-nav');

  /* Navigatie-link klik handler */
  nav.addEventListener('click', (e) => {
    /* Gewone nav-links */
    const link = e.target.closest('.nav-link:not(.nav-dropdown-toggle)');
    if (link) {
      e.preventDefault();
      const path = link.dataset.path;
      Router.navigate(path);
      closeAllDropdowns();
      return;
    }

    /* Dropdown links */
    const dropdownLink = e.target.closest('.nav-dropdown-link');
    if (dropdownLink) {
      e.preventDefault();
      const path = dropdownLink.dataset.path;
      Router.navigate(path);
      closeAllDropdowns();
      return;
    }

    /* Dropdown toggle */
    const toggle = e.target.closest('.nav-dropdown-toggle');
    if (toggle) {
      e.preventDefault();
      e.stopPropagation();
      const wrapper = toggle.closest('.nav-dropdown-wrapper');
      const isOpen = wrapper.classList.contains('open');
      closeAllDropdowns();
      if (!isOpen) wrapper.classList.add('open');
      return;
    }
  });

  /* Sluit dropdown bij klik buiten de nav */
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.nav-dropdown-wrapper')) {
      closeAllDropdowns();
    }
  });
}

/* ----------------------------------------
   SLUIT ALLE DROPDOWNS
---------------------------------------- */
function closeAllDropdowns() {
  document.querySelectorAll('.nav-dropdown-wrapper.open')
    .forEach(w => w.classList.remove('open'));
}

/* ----------------------------------------
   UPDATE ACTIEVE LINK
   Wordt aangeroepen bij elke navigatie
---------------------------------------- */
export function updateActive() {
  const nav = document.getElementById('app-nav');
  if (!nav) return;

  const current = Router.getCurrentPath().split('/')[0];

  /* Gewone nav-links */
  nav.querySelectorAll('.nav-link:not(.nav-dropdown-toggle)').forEach(link => {
    const linkPath = link.dataset.path;
    const isActive = linkPath === current ||
      (linkPath === '' && current === '');
    link.classList.toggle('active', isActive);
  });

  /* Dropdown links */
  let adminIsActive = false;
  nav.querySelectorAll('.nav-dropdown-link').forEach(link => {
    const linkPath = link.dataset.path;
    const isActive = linkPath === current;
    link.classList.toggle('active', isActive);
    if (isActive) adminIsActive = true;
  });

  /* Admin toggle knop actief markeren als een admin-pagina open is */
  const toggle = nav.querySelector('.nav-dropdown-toggle');
  if (toggle) {
    toggle.classList.toggle('active', adminIsActive);
  }
}
