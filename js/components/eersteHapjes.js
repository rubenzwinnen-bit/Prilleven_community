/* ============================================
   EERSTE HAPJES — landingspagina (sterk vereenvoudigd)
   Alle vroegere losse cards (Maaltijden / Symptomen / Allergenen / Agenda /
   Fasen / Risk-foods) zijn opgegaan in de geünificeerde Hub-modal:
     js/components/eersteHapjesHub.js

   Deze pagina toont:
   - Kindje-switcher
   - De Eerste Hapjes Hub inline gemount (voor het actieve kindje)

   `loadActiveChild()` + `getActiveChildSnapshot()` blijven geëxporteerd —
   recipeList / recipeDetail gebruiken die voor cross-cutting context.
============================================ */

import { escapeHtml, colorFromSeed, initialsFromName, showToast } from '../utils.js?v=2.27.0';
import { getMyChildren } from '../eersteHapjesApi.js?v=2.27.0';
import { openChildOnboardingModal } from './childOnboardingModal.js?v=2.27.0';
import { openEersteHapjesHub } from './eersteHapjesHub.js?v=2.27.0';

let state = {
  loaded: false,
  children: [],
  activeId: null,
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

/** Sync-access tot het huidige actieve kindje. */
export function getActiveChildSnapshot() {
  return state.children.find((c) => c.id === state.activeId) || null;
}

/** Async fallback: laad children als nog niet geladen, kies jongste niet-gearchiveerde. */
export async function loadActiveChild() {
  if (state.children.length === 0) {
    const { ok, data } = await getMyChildren();
    if (!ok) return null;
    state.children = data?.children || [];
  }
  if (!state.activeId || !state.children.find((c) => c.id === state.activeId)) {
    const sorted = state.children
      .filter((c) => !c.archived_at)
      .sort((a, b) => new Date(b.birthdate) - new Date(a.birthdate));
    state.activeId = sorted[0]?.id || null;
  }
  return getActiveChildSnapshot();
}

export async function init() {
  const root = document.getElementById('eh-root');
  if (!root) return;
  await loadChildren();
  renderApp(root);
}

async function loadChildren() {
  const { ok, data, error } = await getMyChildren();
  state.loaded = true;
  if (!ok) {
    state.children = [];
    state.activeId = null;
    state._error = error;
    return;
  }
  state.children = data.children || [];
  if (!state.activeId || !state.children.find((c) => c.id === state.activeId)) {
    const firstActive = state.children.find((c) => !c.archived_at);
    state.activeId = firstActive?.id || null;
  }
}

function renderApp(root) {
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
    root.innerHTML = `
      <div class="eh-page-inner">
        <div class="eh-welcome">
          <h2 class="eh-welcome-title">Welkom bij Eerste Hapjes</h2>
          <p class="eh-welcome-sub">
            Voeg eerst een kindje toe via je profiel. Klik op je avatar rechtsboven →
            <strong>Mijn profiel</strong>.
          </p>
          <button class="btn btn-primary" id="eh-open-profile">Open Mijn profiel</button>
        </div>
      </div>
    `;
    document.getElementById('eh-open-profile')?.addEventListener('click', () => {
      document.getElementById('header-avatar-btn')?.click();
    });
    return;
  }

  const active = state.children.find((c) => c.id === state.activeId) || state.children[0];
  state.activeId = active.id;

  root.innerHTML = `
    <div class="eh-page-inner">
      ${renderSwitcher(state.children, active)}
      <div data-eh-hub-mount></div>
    </div>
  `;
  bindSwitcher(root);
  // Mount de hub inline (geen overlay, geen close-knop)
  const mount = root.querySelector('[data-eh-hub-mount]');
  if (mount) openEersteHapjesHub({ child: active, target: mount });
}

function renderSwitcher(children, active) {
  const chips = children.map((c) => {
    const isActive = c.id === active.id;
    const color = colorFromSeed(c.id);
    const initials = initialsFromName(c.name);
    return `
      <button class="eh-child-chip ${isActive ? 'active' : ''}" data-child-id="${c.id}" type="button">
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

function bindSwitcher(root) {
  root.querySelectorAll('.eh-child-chip[data-child-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.childId;
      if (id === state.activeId) return;
      state.activeId = id;
      renderApp(root);
    });
  });
  root.querySelector('[data-action="add-child"]')?.addEventListener('click', () => openOnboarding(root));
}

async function openOnboarding(root) {
  const child = await openChildOnboardingModal();
  if (!child) return;
  showToast(`${child.name} is toegevoegd.`, 'success');
  state.children = [child, ...state.children];
  state.activeId = child.id;
  renderApp(root);
}

