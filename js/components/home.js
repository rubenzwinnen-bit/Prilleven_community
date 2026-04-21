/* ============================================
   HOME COMPONENT
   Landingspagina na login. Toont een hub met 3
   grote tegels: Receptenboek/Weekschema, HapjesHeld
   (chatbot) en Admin (alleen voor admins).
============================================ */

import * as Store from '../store.js';
import * as Router from '../router.js';

export function render() {
  const user = Store.getCurrentUser() || '';
  const firstName = user.split('@')[0];
  const admin = Store.isAdmin();

  const tiles = [
    {
      id: 'recipes',
      icon: '🍽️',
      title: 'Receptenboek & Weekschema',
      desc: 'Bekijk recepten, bouw je weekschema op en beheer je favorieten en boodschappenlijst.',
      href: '#/recipes',
      accent: 'terracotta',
    },
    {
      id: 'chat',
      icon: '🌿',
      title: 'HapjesHeld',
      desc: 'Je persoonlijke AI-assistent voor al je vragen over kindervoeding. Onthoudt je gezin en leert je beter kennen.',
      href: '/chat.html',
      accent: 'sage',
    },
  ];

  if (admin) {
    tiles.push({
      id: 'admin',
      icon: '📊',
      title: 'Admin dashboard',
      desc: 'Overzicht van gebruikers, chat-activiteit, kosten en abonnement-events. Alleen voor administrators.',
      href: '/admin-chat.html',
      accent: 'dark',
    });
  }

  const tileCards = tiles.map(t => `
    <a class="home-tile home-tile--${t.accent}" href="${t.href}">
      <div class="home-tile-body">
        <h3 class="home-tile-title">${t.title}</h3>
        <p class="home-tile-desc">${t.desc}</p>
      </div>
      <div class="home-tile-arrow">→</div>
    </a>
  `).join('');

  return `
    <div class="home-hub">
      <div class="home-welcome">
        <h1 class="home-welcome-title">Welkom terug</h1>
      </div>
      <div class="home-tiles">
        ${tileCards}
      </div>
    </div>
  `;
}

export function init() {
  // Interne (Router) links onderscheppen zodat ze met Router.navigate werken
  // i.p.v. volledige page-reload via href="#/..."
  const hub = document.querySelector('.home-hub');
  if (!hub) return;
  hub.addEventListener('click', (e) => {
    const link = e.target.closest('a.home-tile');
    if (!link) return;
    const href = link.getAttribute('href');
    if (href && href.startsWith('#/')) {
      e.preventDefault();
      Router.navigate(href.slice(2));
    }
    // Externe paden (/chat.html, /admin-chat.html) volgen normale browser-navigatie
  });
}
