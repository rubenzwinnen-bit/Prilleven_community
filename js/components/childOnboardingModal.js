/* ============================================
   EERSTE HAPJES — ONBOARDING MODAL
   3-staps wizard om een nieuw kindje toe te voegen:
     1. Naam
     2. Geboortedatum
     3. Structuurvoorkeur (optioneel)
   Returnt Promise<child|null> — child = aangemaakt rij,
   null = gebruiker annuleerde.
============================================ */

import { escapeHtml } from '../utils.js?v=2.29.0';
import { createChild } from '../eersteHapjesApi.js?v=2.29.0';

const TEXTURE_OPTIONS = [
  { value: 'puree',   label: 'Puree',   hint: 'Glad, zonder stukjes' },
  { value: 'stukjes', label: 'Stukjes', hint: 'Zachte stukjes om mee te oefenen' },
  { value: 'combi',   label: 'Combi',   hint: 'Mix van puree en stukjes' },
];

/**
 * Toon de onboarding-modal en wacht op resultaat.
 * @returns {Promise<object|null>} aangemaakte child-rij of null bij annuleren
 */
export function openChildOnboardingModal() {
  return new Promise((resolve) => {
    const today = new Date();
    const todayStr = isoDateString(today);
    const minDate = new Date(today);
    minDate.setFullYear(minDate.getFullYear() - 10);
    const minStr = isoDateString(minDate);

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay eh-onboarding-overlay';
    overlay.innerHTML = `
      <div class="modal eh-onboarding-modal">
        <div class="eh-onb-progress" data-step="1">
          <span class="eh-onb-dot active"></span>
          <span class="eh-onb-dot"></span>
          <span class="eh-onb-dot"></span>
        </div>

        <!-- STAP 1 — naam -->
        <div class="eh-onb-step" data-step="1">
          <h2>Hoe heet je kindje?</h2>
          <p class="eh-onb-desc">
            Alleen jij ziet deze naam. Je kunt later meerdere kindjes toevoegen.
          </p>
          <input
            type="text"
            id="eh-onb-name"
            class="auth-input"
            placeholder="bv. Jules"
            maxlength="50"
            autocomplete="off"
          >
          <div class="eh-onb-error hidden" data-error="1"></div>
          <div class="eh-onb-actions">
            <button class="btn btn-outline" data-action="cancel">Annuleren</button>
            <button class="btn btn-primary" data-action="next-1">Volgende</button>
          </div>
        </div>

        <!-- STAP 2 — geboortedatum -->
        <div class="eh-onb-step hidden" data-step="2">
          <h2>Wanneer is ${'${name}'} geboren?</h2>
          <p class="eh-onb-desc">
            Zo kunnen we de juiste dagsuggesties laten zien.
          </p>
          <input
            type="date"
            id="eh-onb-birthdate"
            class="auth-input"
            min="${minStr}"
            max="${todayStr}"
          >
          <div class="eh-onb-error hidden" data-error="2"></div>
          <div class="eh-onb-actions">
            <button class="btn btn-outline" data-action="back-2">Terug</button>
            <button class="btn btn-primary" data-action="next-2">Volgende</button>
          </div>
        </div>

        <!-- STAP 3 — structuur -->
        <div class="eh-onb-step hidden" data-step="3">
          <h2>Welke structuur past nu?</h2>
          <p class="eh-onb-desc">
            Je kunt dit altijd later wijzigen. Niet zeker? Sla over.
          </p>
          <div class="eh-onb-textures">
            ${TEXTURE_OPTIONS.map(opt => `
              <button class="eh-onb-texture" data-texture="${opt.value}">
                <span class="eh-onb-texture-label">${escapeHtml(opt.label)}</span>
                <span class="eh-onb-texture-hint">${escapeHtml(opt.hint)}</span>
              </button>
            `).join('')}
          </div>
          <div class="eh-onb-error hidden" data-error="3"></div>
          <div class="eh-onb-loading hidden" data-loading>Bezig met opslaan…</div>
          <div class="eh-onb-actions">
            <button class="btn btn-outline" data-action="back-3">Terug</button>
            <button class="eh-onb-link-btn" data-action="skip">Sla over</button>
            <button class="btn btn-primary" data-action="finish" disabled>Klaar</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // ----- state -----
    const state = { name: '', birthdate: '', texture: null };

    // ----- helpers -----
    const $ = (sel) => overlay.querySelector(sel);
    const showError = (step, msg) => {
      const el = overlay.querySelector(`[data-error="${step}"]`);
      el.textContent = msg;
      el.classList.remove('hidden');
    };
    const clearError = (step) => {
      overlay.querySelector(`[data-error="${step}"]`).classList.add('hidden');
    };
    const goStep = (n) => {
      overlay.querySelectorAll('.eh-onb-step').forEach(el => {
        el.classList.toggle('hidden', el.dataset.step !== String(n));
      });
      const dots = overlay.querySelectorAll('.eh-onb-dot');
      dots.forEach((d, i) => d.classList.toggle('active', i < n));
      overlay.querySelector('.eh-onb-progress').dataset.step = n;
      // Focus eerste input van die stap
      setTimeout(() => {
        const input = overlay.querySelector(
          `[data-step="${n}"] input, [data-step="${n}"] button.eh-onb-texture`,
        );
        if (input) input.focus();
      }, 50);
    };
    const close = (result) => {
      overlay.remove();
      resolve(result);
    };

    // ----- stap 1: naam -----
    const nameInput = $('#eh-onb-name');
    setTimeout(() => nameInput.focus(), 50);
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') overlay.querySelector('[data-action="next-1"]').click();
      if (e.key === 'Escape') close(null);
    });
    overlay.querySelector('[data-action="next-1"]').addEventListener('click', () => {
      const v = nameInput.value.trim().replace(/\s+/g, ' ');
      if (!v) return showError(1, 'Vul een naam in.');
      if (v.length > 50) return showError(1, 'Naam mag max. 50 tekens zijn.');
      clearError(1);
      state.name = v;
      // Vervang placeholder ${name} in titel stap 2
      const title = overlay.querySelector('[data-step="2"] h2');
      title.textContent = `Wanneer is ${v} geboren?`;
      goStep(2);
    });
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => close(null));

    // ----- stap 2: geboortedatum -----
    const dateInput = $('#eh-onb-birthdate');
    dateInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') overlay.querySelector('[data-action="next-2"]').click();
      if (e.key === 'Escape') close(null);
    });
    overlay.querySelector('[data-action="back-2"]').addEventListener('click', () => goStep(1));
    overlay.querySelector('[data-action="next-2"]').addEventListener('click', () => {
      const v = dateInput.value;
      if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        return showError(2, 'Kies een geldige datum.');
      }
      if (v > todayStr) return showError(2, 'De datum kan niet in de toekomst liggen.');
      if (v < minStr)   return showError(2, 'De datum mag max. 10 jaar terug liggen.');
      clearError(2);
      state.birthdate = v;
      goStep(3);
    });

    // ----- stap 3: structuur -----
    const textureBtns = overlay.querySelectorAll('.eh-onb-texture');
    const finishBtn = overlay.querySelector('[data-action="finish"]');
    textureBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        textureBtns.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        state.texture = btn.dataset.texture;
        finishBtn.disabled = false;
      });
    });
    overlay.querySelector('[data-action="back-3"]').addEventListener('click', () => goStep(2));

    const submit = async (withTexture) => {
      clearError(3);
      const loadingEl = overlay.querySelector('[data-loading]');
      loadingEl.classList.remove('hidden');
      overlay.querySelectorAll('.eh-onb-actions button').forEach(b => b.disabled = true);

      const { ok, data, error } = await createChild({
        name: state.name,
        birthdate: state.birthdate,
        texture_preference: withTexture ? state.texture : null,
      });

      if (!ok) {
        loadingEl.classList.add('hidden');
        overlay.querySelectorAll('.eh-onb-actions button').forEach(b => b.disabled = false);
        finishBtn.disabled = !state.texture; // herstel disabled-state
        return showError(3, error || 'Er ging iets mis.');
      }
      close(data.child);
    };

    finishBtn.addEventListener('click', () => submit(true));
    overlay.querySelector('[data-action="skip"]').addEventListener('click', () => submit(false));

    // ESC of klik op overlay-rand → annuleren (alleen als geen submit bezig)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape' && document.body.contains(overlay)) {
        document.removeEventListener('keydown', escHandler);
        close(null);
      }
    });
  });
}

function isoDateString(d) {
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
