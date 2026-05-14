/* ============================================
   HOME COMPONENT
   Landingspagina na login. Drie-pane layout:
   - Desktop: Functies (links) | Timeline of Room (midden) | Rooms-nav (rechts)
   - Mobile: één pane tegelijk, sticky bottom-tabs onderaan om te switchen
============================================ */

import * as Store from '../store.js?v=2.4.2';
import * as Router from '../router.js?v=2.4.2';
import * as Timeline from './timeline.js?v=2.4.2';
import * as ChatRooms from './chatRooms.js?v=2.4.2';

const ACTIVE_PANE_KEY = 'home:active-pane';

function getInitialPane() {
  // Default = timeline (community-first). Op mobile onthouden we de laatste
  // keuze in localStorage. Geldige waarden: timeline | functies | rooms.
  try {
    const stored = localStorage.getItem(ACTIVE_PANE_KEY);
    if (stored === 'functies' || stored === 'rooms') return stored;
    return 'timeline';
  } catch {
    return 'timeline';
  }
}

export function render() {
  const admin = Store.isAdmin();

  const tiles = [
    {
      id: 'recipes',
      title: 'Receptenboek & Weekschema',
      desc: 'Recepten, weekschema, favorieten & boodschappenlijst.',
      href: '#/recipes',
      accent: 'terracotta',
      hoverImg: '/fotos/receptenboek-weekschema.jpeg',
    },
    {
      id: 'chat',
      title: 'HapjesHeld 2.0',
      desc: 'AI-assistent voor al je vragen over kindervoeding.',
      href: '/chat.html',
      accent: 'sage',
      hoverImg: '/fotos/HapjesHeld_2.png',
    },
    {
      id: 'learnings',
      title: 'Learnings',
      desc: 'Documenten, blogs en videos om door te lezen of bekijken.',
      href: '#/learnings',
      accent: 'sage-deep',
      hoverImg: '/fotos/learnings.png',
    },
  ];

  if (admin) {
    tiles.push({
      id: 'admin',
      title: 'Admin dashboard',
      desc: 'Gebruikers, kosten, abonnement-events.',
      href: '/admin-chat.html',
      accent: 'dark',
      hoverImg: '/fotos/matrix.jpg',
    });
  }

  const tileCards = tiles.map(t => `
    <a class="home-tile home-tile--${t.accent}" href="${t.href}">
      ${t.hoverImg ? `<img class="home-tile-hover-img" src="${t.hoverImg}" alt="" loading="lazy" />` : ''}
      <div class="home-tile-body">
        <h3 class="home-tile-title">${t.title}</h3>
        <p class="home-tile-desc">${t.desc}</p>
      </div>
      <div class="home-tile-arrow">→</div>
    </a>
  `).join('');

  const initialPane = getInitialPane();

  return `
    <div class="home-hub home-hub--tri" data-active-pane="${initialPane}">
      <section class="home-pane home-pane--functies" data-pane="functies" aria-label="Functies">
        <div class="home-pane-header">
          <h2 class="home-pane-title">Functies</h2>
        </div>
        <div class="home-tiles">
          ${tileCards}
        </div>
      </section>
      <section class="home-pane home-pane--timeline" data-pane="timeline" data-view="timeline" aria-label="Timeline">
        <div id="home-timeline-inner">
          ${Timeline.render()}
        </div>
        <div id="home-chatroom-mount"></div>
      </section>
      ${ChatRooms.renderNav()}
    </div>
    <nav class="home-bottom-nav" role="tablist" aria-label="Landingspagina-secties">
      <button class="home-bottom-nav-tab" data-pane="timeline" role="tab" aria-selected="${initialPane === 'timeline'}">
        <span class="home-bottom-nav-icon" aria-hidden="true">💬</span>
        <span class="home-bottom-nav-label">Timeline</span>
      </button>
      <button class="home-bottom-nav-tab" data-pane="rooms" role="tab" aria-selected="${initialPane === 'rooms'}">
        <span class="home-bottom-nav-icon" aria-hidden="true">🗨️</span>
        <span class="home-bottom-nav-label">Rooms</span>
      </button>
      <button class="home-bottom-nav-tab" data-pane="functies" role="tab" aria-selected="${initialPane === 'functies'}">
        <span class="home-bottom-nav-icon" aria-hidden="true">⊞</span>
        <span class="home-bottom-nav-label">Functies</span>
      </button>
    </nav>
  `;
}

function setActivePane(pane) {
  const hub = document.querySelector('.home-hub');
  if (!hub) return;
  hub.dataset.activePane = pane;
  // Tab-states syncen
  document.querySelectorAll('.home-bottom-nav-tab').forEach(btn => {
    const isActive = btn.dataset.pane === pane;
    btn.setAttribute('aria-selected', String(isActive));
    btn.classList.toggle('is-active', isActive);
  });
  // Onthouden voor volgende bezoek (mobile-only relevant)
  try { localStorage.setItem(ACTIVE_PANE_KEY, pane); } catch {}
}

export function init() {
  const hub = document.querySelector('.home-hub');
  if (!hub) return;

  // Tegels: tegelclick → router (hashed) of normale navigatie (page)
  hub.addEventListener('click', (e) => {
    const link = e.target.closest('a.home-tile');
    if (!link) return;
    const href = link.getAttribute('href');
    if (href && href.startsWith('#/')) {
      e.preventDefault();
      Router.navigate(href.slice(2));
    }
  });

  // Bottom-nav tabs: pane-switch (mobile primair, maar werkt overal als de
  // user de window verkleint).
  document.querySelectorAll('.home-bottom-nav-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const pane = btn.dataset.pane;
      if (pane) setActivePane(pane);
    });
  });

  // Initiële tab-staat reflecteren op buttons (active class voor styling).
  const initial = hub.dataset.activePane || 'timeline';
  document.querySelectorAll('.home-bottom-nav-tab').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.pane === initial);
  });

  // Timeline init (events + feed laden).
  Timeline.init();
  // Chatrooms-nav init (laadt rooms-lijst).
  ChatRooms.init();
}
