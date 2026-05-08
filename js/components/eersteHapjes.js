/* ============================================
   EERSTE HAPJES TRAJECT
   SPA-pagina met onboarding + Vandaag-skeleton.
   Brok B — onboarding & kindje-switcher.
   Volgende stappen (logging, allergenen, symptomen,
   recept-filter, content) komen in latere brokken.
============================================ */

import { escapeHtml, colorFromSeed, initialsFromName, showToast } from '../utils.js?v=2.3.0';
import { getMyChildren } from '../eersteHapjesApi.js?v=2.3.0';
import { openChildOnboardingModal } from './childOnboardingModal.js?v=2.3.0';

// Module-state — onthoudt actief kindje binnen één SPA-bezoek.
let state = {
  loaded: false,
  children: [],
  activeId: null,
};

const TEXTURE_LABEL = {
  puree:   'Puree',
  stukjes: 'Stukjes',
  combi:   'Combi',
};

export function render() {
  return `
    <div class="eh-page" id="eh-root">
      <div class="eh-loading-shell">
        <div class="eh-loading-spinner" aria-hidden="true"></div>
        <p>Even een momentje…</p>
      </div>
    </div>
  `;
}

export async function init() {
  const root = document.getElementById('eh-root');
  if (!root) return;

  await loadChildren();
  await renderApp(root);
}

async function loadChildren() {
  const { ok, data, error } = await getMyChildren();
  if (!ok) {
    state.loaded = true;
    state.children = [];
    state.activeId = null;
    state._error = error;
    return;
  }
  state.loaded = true;
  state.children = data.children || [];
  // Behoud actieve selectie indien nog aanwezig, anders neem eerste actieve.
  if (!state.activeId || !state.children.find(c => c.id === state.activeId)) {
    const firstActive = state.children.find(c => !c.archived_at);
    state.activeId = firstActive?.id || null;
  }
}

async function renderApp(root) {
  if (state._error) {
    root.innerHTML = `
      <div class="eh-page-inner">
        <div class="empty-state">
          <h3>Er ging iets mis</h3>
          <p>${escapeHtml(state._error)}</p>
        </div>
      </div>
    `;
    return;
  }

  if (state.children.length === 0) {
    // Eerste keer — direct onboarding-modal openen
    root.innerHTML = `
      <div class="eh-page-inner">
        <div class="eh-welcome">
          <div class="eh-welcome-icon">🥄</div>
          <h2 class="eh-welcome-title">Welkom bij Eerste Hapjes</h2>
          <p class="eh-welcome-sub">Voeg je eerste kindje toe om te starten.</p>
          <button class="btn btn-primary" id="eh-start-onboarding">Toevoegen</button>
        </div>
      </div>
    `;
    const btn = document.getElementById('eh-start-onboarding');
    btn.addEventListener('click', () => openOnboarding(root));
    // Open meteen automatisch
    openOnboarding(root);
    return;
  }

  // Eén of meerdere kindjes → render switcher + Vandaag-skeleton
  const active = state.children.find(c => c.id === state.activeId)
              || state.children[0];

  root.innerHTML = `
    <div class="eh-page-inner">
      ${renderSwitcher(state.children, active)}
      ${renderToday(active)}
    </div>
  `;

  bindSwitcher(root);
}

function renderSwitcher(children, active) {
  const chips = children.map(c => {
    const isActive = c.id === active.id;
    const color = colorFromSeed(c.id);
    const initials = initialsFromName(c.name);
    return `
      <button
        class="eh-child-chip ${isActive ? 'active' : ''}"
        data-child-id="${c.id}"
        type="button"
      >
        <span class="eh-child-avatar" style="background:${color};">${escapeHtml(initials)}</span>
        <span class="eh-child-name">${escapeHtml(c.name)}</span>
      </button>
    `;
  }).join('');

  return `
    <div class="eh-switcher">
      <div class="eh-switcher-chips">
        ${chips}
        <button class="eh-child-chip eh-child-chip-add" data-action="add-child" type="button">
          <span class="eh-child-avatar eh-child-avatar-add">+</span>
          <span class="eh-child-name">Kindje toevoegen</span>
        </button>
      </div>
    </div>
  `;
}

function renderToday(child) {
  const ageLabel = formatAge(child.birthdate);
  const texture = child.texture_preference
    ? TEXTURE_LABEL[child.texture_preference]
    : null;

  return `
    <section class="eh-today">
      <header class="eh-today-header">
        <h1 class="eh-today-title">Vandaag met ${escapeHtml(child.name)}</h1>
        <p class="eh-today-meta">
          ${escapeHtml(ageLabel)}${texture ? ` · structuur: ${escapeHtml(texture)}` : ''}
        </p>
      </header>

      <div class="eh-today-grid">
        <div class="eh-today-card eh-today-card-soon">
          <h3>Maaltijden vandaag</h3>
          <p>Hier komt straks je dagoverzicht: wat je kindje vandaag al gegeten heeft, en suggesties voor wat nog kan.</p>
          <span class="eh-today-pill">Binnenkort</span>
        </div>

        <div class="eh-today-card eh-today-card-soon">
          <h3>Allergenen</h3>
          <p>Houd bij welke allergenen al geprobeerd zijn en hoe ${escapeHtml(child.name)} reageerde.</p>
          <span class="eh-today-pill">Binnenkort</span>
        </div>

        <div class="eh-today-card eh-today-card-soon">
          <h3>Volgende stap</h3>
          <p>Korte uitleg per fase, op het moment dat het relevant wordt.</p>
          <span class="eh-today-pill">Binnenkort</span>
        </div>
      </div>
    </section>
  `;
}

function bindSwitcher(root) {
  // Kindje wisselen
  root.querySelectorAll('.eh-child-chip[data-child-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.childId;
      if (id === state.activeId) return;
      state.activeId = id;
      renderApp(root);
    });
  });
  // Kindje toevoegen
  const addBtn = root.querySelector('[data-action="add-child"]');
  if (addBtn) addBtn.addEventListener('click', () => openOnboarding(root));
}

async function openOnboarding(root) {
  const child = await openChildOnboardingModal();
  if (!child) {
    // Geannuleerd — als er nog geen kindjes zijn, blijft het welkomscherm staan.
    return;
  }
  showToast(`${child.name} is toegevoegd.`, 'success');
  state.children = [child, ...state.children];
  state.activeId = child.id;
  await renderApp(root);
}

/**
 * Geef een korte leeftijdsweergave: '3 weken', '5 maanden', '1 jaar 2 mnd', etc.
 */
function formatAge(birthdateIso) {
  if (!birthdateIso) return '';
  const today = new Date();
  const bd = new Date(birthdateIso + 'T00:00:00');
  const diffMs = today - bd;
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (days < 14)  return `${days} ${days === 1 ? 'dag' : 'dagen'}`;
  if (days < 60)  return `${Math.floor(days / 7)} weken`;

  // Maanden via kalender (preciezer dan delen door 30.4)
  let months = (today.getFullYear() - bd.getFullYear()) * 12
             + (today.getMonth() - bd.getMonth());
  if (today.getDate() < bd.getDate()) months -= 1;
  if (months < 12) return `${months} ${months === 1 ? 'maand' : 'maanden'}`;

  const years = Math.floor(months / 12);
  const rest  = months % 12;
  if (rest === 0) return `${years} ${years === 1 ? 'jaar' : 'jaar'}`;
  return `${years} jaar ${rest} mnd`;
}
