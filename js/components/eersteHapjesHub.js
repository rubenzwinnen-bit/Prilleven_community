/* ============================================
   EERSTE HAPJES — HUB (geünificeerde modal)

   Eén modal die alles bundelt:
   - Fase 0: klaarheids-checklist (gate)
   - Fase 1: 1 warme maaltijd/dag
   - Fase 2: 2 warme maaltijden/dag

   Sub-tabs: Roadmap · Bouw nu · Logboek · Symptomen · Allergenen
   (Bouw nu is voorlopig placeholder, rest is werkend.)

   Public API:
     openEersteHapjesHub({ child })
============================================ */

import { escapeHtml, showToast } from '../utils.js?v=2.30.0';
import {
  loadEhState,
  patchEhState,
  loadEhDoses,
  createEhDose,
  buildAllergenContext,
} from '../eersteHapjesStateApi.js?v=2.30.0';
import {
  generateWeekPlan,
  generateFruitWeek,
} from '../eersteHapjesMealGenerator.js?v=2.30.0';
import { getRecipes } from '../store.js?v=2.30.0';
import * as Router from '../router.js?v=2.30.0';
import { ALLERGEN_FLOW } from '../content/eersteHapjes-allergen-flow.js?v=2.30.0';
import {
  getMealsForChild,
  getSymptomsForChild,
  deleteMealLog,
  deleteSymptom,
} from '../eersteHapjesApi.js?v=2.30.0';
import { openMealLogModal } from './mealLogModal.js?v=2.30.0';
import { openSymptomLogModal } from './symptomLogModal.js?v=2.30.0';
import { getSymptomMeta, isRedFlag } from '../content/eersteHapjes-symptoms.js?v=2.30.0';
import { renderEhChatBox, bindEhChatBox } from './ehChatBox.js?v=2.30.0';
import {
  CATEGORIES,
  INGREDIENTS,
  CATEGORY_ORDER,
  DIETARY_STYLES,
} from '../content/eersteHapjes-meal-ingredients.js?v=2.30.0';
import { ALLERGEN_COOLDOWN_DAYS } from '../content/eersteHapjes-allergen-flow.js?v=2.30.0';

const READINESS_SIGNALS = [
  { key: 'zitten',     label: 'Mijn kindje kan stabiel rechtop zitten (met lichte ondersteuning)' },
  { key: 'interesse',  label: 'Mijn kindje toont interesse in eten van anderen' },
  { key: 'tongreflex', label: 'De tongreflex (eten weer naar buiten duwen) is duidelijk verminderd' },
  { key: 'praktisch',  label: 'Ik ben praktisch klaar (kinderstoel, lepeltjes, slabbetjes)' },
  { key: 'geen-druk',  label: 'Ik voel geen prestatiedruk — we starten op ons eigen tempo' },
];

const SUB_TABS = [
  { key: 'roadmap',    label: '🗺️ Vandaag' },
  { key: 'week',       label: '📅 Weekschema' },
  { key: 'allergenen', label: '🥜 Allergenen' },
  { key: 'logboek',    label: '🍽️ Logboek' },
  { key: 'symptomen',  label: '📊 Symptomen' },
];

const PHASE_OPTIONS = [
  { phase: 0, mealsPerDay: 1, label: 'Fase 0 · Voorbereiden',     minAge: 0,  maxAge: 7,  ageHint: '< 7 mnd' },
  { phase: 1, mealsPerDay: 1, label: 'Fase 1 · 1 warme maaltijd', minAge: 6,  ageHint: 'vanaf 6 mnd' },
  { phase: 2, mealsPerDay: 1, label: 'Fase 2 · + fruit-maaltijd', minAge: 8,  ageHint: 'vanaf 8 mnd' },
  { phase: 3, mealsPerDay: 1, label: 'Fase 3 · + ontbijt',        minAge: 10, ageHint: 'vanaf 10 mnd' },
];

/** Bepaalt de start-fase voor een nieuw kindje op basis van leeftijd. */
function suggestStartPhase(ageMonths) {
  if (ageMonths < 7)  return 0;
  if (ageMonths < 8)  return 1;
  if (ageMonths < 10) return 2;
  return 3;
}

const MEAL_TYPE_LABEL = { ontbijt: 'Ontbijt', lunch: 'Lunch', diner: 'Diner', snack: 'Snack' };
const REACTION_EMOJI  = { positief: '😋', neutraal: '😐', afwijzing: '😖' };
const DAY_NAMES = ['Zo', 'Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za'];

/* ============================================
   Public entry-point

   Twee modes:
   - Inline: { child, target }           → mount in `target`, geen overlay, geen close-knop
   - Overlay (default): { child }        → fullscreen modal-overlay met close-knop
============================================ */
export async function openEersteHapjesHub({ child, target = null }) {
  if (!child?.id) throw new Error('openEersteHapjesHub: child.id ontbreekt');

  let host;
  const isInline = !!target;
  if (isInline) {
    target.innerHTML = `<div class="eh-hub-inline" data-overlay-inner></div>`;
    host = target;
  } else {
    host = createOverlay();
    document.body.appendChild(host);
    document.body.classList.add('modal-open');
  }

  const ctx = {
    child,
    state: null,
    doses: [],
    activeTab: 'roadmap',
    weekPlan: null,
    fruitWeek: null,        // lazy: gegenereerd voor fase 3
    breakfastWeek: null,    // lazy: gegenereerd voor fase 4 (uit recipes-tabel)
    meals: null,
    symptoms: null,
    selectedAllergen: null,
    pantry: null,
    pantrySuggestion: null,
    isInline,
  };

  setOverlayBody(host, renderLoading(ctx));

  try {
    const [state, doses] = await Promise.all([
      loadEhState(child.id),
      loadEhDoses(child.id),
    ]);
    ctx.state = state;
    ctx.doses = doses;

    const ageMonths = computeAgeMonths(ctx.child.birthdate);

    // Auto-skip fase 0 voor kindjes ≥ 7 mnd: readiness-checklist niet meer nodig.
    if (state.current_phase === 0 && ageMonths >= 7) {
      const suggested = suggestStartPhase(ageMonths);
      ctx.state = await patchEhState(child.id, {
        current_phase: suggested,
        phase_started_at: new Date().toISOString(),
      });
    }

    // Eerste-keer-onboarding wizard: voor kindjes ≥ 5 mnd waar de ouder
    // nog niet heeft aangegeven welke allergenen al geïntroduceerd zijn.
    if (ageMonths >= 5 && !ctx.state.allergen_state?.onboarding_completed) {
      const updated = await runAllergenInitWizard(host, ctx);
      if (updated) {
        // Reload state + doses na wizard
        const [s2, d2] = await Promise.all([
          loadEhState(child.id),
          loadEhDoses(child.id),
        ]);
        ctx.state = s2;
        ctx.doses = d2;
      }
    }

    if (ctx.state.current_phase >= 1) {
      await ensureMeals(ctx);
    }
  } catch (err) {
    console.error('[EersteHapjesHub] load failed', err);
    setOverlayBody(host, renderError(err.message, ctx));
    return;
  }

  render(host, ctx);
}

/* ============================================
   Allergen-init wizard
   Verschijnt bij eerste hub-open voor kindjes ≥ 5 mnd. Ouder vinkt aan welke
   allergenen al geïntroduceerd zijn. Voor elk aangevinkt allergeen: maak
   3× dose (dose_number 1/2/3, reaction='geen') zodat de flow ze als 'veilig'
   beschouwt. Zet allergen_state.onboarding_completed = true.
   Returns true als state gewijzigd is.
============================================ */
async function runAllergenInitWizard(host, ctx) {
  const childName = escapeHtml(ctx.child.name || 'je kindje');
  const overlay = document.createElement('div');
  overlay.className = 'eh-hub-overlay eh-wizard-overlay';
  overlay.innerHTML = `
    <div class="eh-hub-overlay-inner">
      <div class="eh-hub-modal">
        <div class="eh-hub-head">
          <div class="eh-hub-head-main">
            <h2>Welke allergenen kreeg ${childName} al?</h2>
            <div class="eh-hub-sub">Vink alles aan wat je al hebt geïntroduceerd (zonder reactie). Niet zeker? Laat leeg — dan zit het in de roadmap.</div>
          </div>
        </div>
        <div class="eh-hub-body">
          <div class="eh-wizard-list">
            ${ALLERGEN_FLOW.map((a) => `
              <label class="eh-wizard-row">
                <input type="checkbox" data-allergen-key="${escapeHtml(a.key)}">
                <span class="eh-wizard-ic">${a.icon}</span>
                <span class="eh-wizard-label">${escapeHtml(a.label)}</span>
              </label>
            `).join('')}
          </div>
          <div class="eh-wizard-actions">
            <button class="eh-hero-btn ghost" data-action="wizard-skip" type="button">Overslaan</button>
            <button class="eh-hero-btn primary" data-action="wizard-save" type="button">Bewaar</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');

  return new Promise((resolve) => {
    function close(updated) {
      document.body.classList.remove('modal-open');
      overlay.remove();
      resolve(updated);
    }

    overlay.querySelector('[data-action="wizard-skip"]').addEventListener('click', async () => {
      try {
        await patchEhState(ctx.child.id, {
          allergen_state: {
            ...(ctx.state.allergen_state || {}),
            onboarding_completed: true,
          },
        });
      } catch (_) { /* niet kritisch */ }
      close(true);
    });

    overlay.querySelector('[data-action="wizard-save"]').addEventListener('click', async () => {
      const checked = Array.from(overlay.querySelectorAll('input[data-allergen-key]:checked'))
        .map((el) => el.dataset.allergenKey);
      try {
        // Voor elk gecheckt allergeen: 3 dose-records (1/2/3, reaction='geen')
        for (const key of checked) {
          for (let dose = 1; dose <= 3; dose++) {
            try {
              await createEhDose({
                child_id: ctx.child.id,
                allergen_key: key,
                dose_number: dose,
                reaction: 'geen',
              });
            } catch (_) { /* dubbele dose → 409 → skip */ }
          }
        }
        // Markeer wizard als voltooid
        await patchEhState(ctx.child.id, {
          allergen_state: {
            ...(ctx.state.allergen_state || {}),
            onboarding_completed: true,
          },
        });
        showToast(checked.length > 0 ? `${checked.length} allergeen(en) gemarkeerd als geïntroduceerd.` : 'Voorkeur opgeslagen.', 'success');
      } catch (err) {
        console.error('[Wizard] save failed', err);
        showToast('Kon niet opslaan.', 'error');
      }
      close(true);
    });
  });
}

/* ============================================
   Render-router
============================================ */
function render(overlay, ctx) {
  ctx._currentHost = overlay;
  if (ctx.state.current_phase === 0) {
    setOverlayBody(overlay, renderPhase0(ctx, overlay));
    bindPhase0(overlay, ctx);
  } else {
    setOverlayBody(overlay, renderPhase1or2(ctx, overlay));
    bindPhase1or2(overlay, ctx);
  }
}

async function reloadAndRender(overlay, ctx) {
  try {
    const [state, doses] = await Promise.all([
      loadEhState(ctx.child.id),
      loadEhDoses(ctx.child.id),
    ]);
    ctx.state = state;
    ctx.doses = doses;
    ctx.weekPlan = null; // forceer regen op basis van nieuwe state
    render(overlay, ctx);
  } catch (err) {
    console.error('[EersteHapjesHub] reload failed', err);
  }
}

/* ============================================
   FASE 0 — Klaarheids-checklist
============================================ */
function renderPhase0(ctx, overlay) {
  const signals = ctx.state.readiness_check?.signals || [];
  const allChecked = READINESS_SIGNALS.every((s) => signals.includes(s.key));
  const childName = escapeHtml(ctx.child.name || 'je kindje');

  return `
    <div class="eh-hub-modal">
      ${renderHeader(ctx, `Is ${childName} klaar voor vaste voeding?`, '5 vinkjes — geen leeftijds-deadline')}
      <div class="eh-hub-body">
        <div class="eh-info-callout">
          <strong>Geen exact moment.</strong> Geen leeftijds-deadline — ${childName} bepaalt het tempo. Vink aan wat je herkent.
        </div>

        <div class="eh-check-card">
          <h3>Klaar voor vaste voeding?</h3>
          <p class="eh-desc">Alle 5 vakjes nodig om Fase 1 te starten.</p>
          ${READINESS_SIGNALS.map((s) => `
            <label class="eh-check-row ${signals.includes(s.key) ? 'checked' : ''}" data-signal="${s.key}">
              <span class="eh-box">${signals.includes(s.key) ? '✓' : ''}</span>
              <span class="eh-check-label">${escapeHtml(s.label)}</span>
            </label>
          `).join('')}
        </div>

        <div class="eh-gate-cta ${allChecked ? '' : 'locked'}">
          <span class="eh-lock-ic">${allChecked ? '🌱' : '🔒'}</span>
          <h4>${allChecked ? 'Klaar voor Fase 1' : 'Generator nog niet beschikbaar'}</h4>
          <p>${allChecked
            ? 'Start nu het traject — generator + roadmap worden actief.'
            : `Vink eerst alle 5 vakjes aan. ${signals.length} / 5 voltooid.`}</p>
          <button class="eh-start-btn" ${allChecked ? '' : 'disabled'} data-action="start-phase1">
            ${allChecked ? 'Start Fase 1 →' : `${signals.length} / 5 voltooid`}
          </button>
        </div>
      </div>
    </div>
  `;
}

function bindPhase0(overlay, ctx) {
  overlay.querySelectorAll('[data-signal]').forEach((row) => {
    row.addEventListener('click', async () => {
      const key = row.dataset.signal;
      const current = ctx.state.readiness_check?.signals || [];
      const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
      try {
        ctx.state = await patchEhState(ctx.child.id, { readiness_check: { signals: next } });
        render(overlay, ctx);
      } catch (err) {
        console.error('[EersteHapjesHub] toggle signal failed', err);
        showToast('Kon vinkje niet opslaan.', 'error');
      }
    });
  });

  overlay.querySelector('[data-action="start-phase1"]')?.addEventListener('click', async (e) => {
    if (e.currentTarget.disabled) return;
    try {
      ctx.state = await patchEhState(ctx.child.id, {
        current_phase: 1,
        phase_started_at: new Date().toISOString(),
      });
      showToast('Fase 1 gestart 🌱', 'success');
      render(overlay, ctx);
    } catch (err) {
      console.error('[EersteHapjesHub] start phase1 failed', err);
      showToast('Kon Fase 1 niet starten.', 'error');
    }
  });
}

/* ============================================
   FASE 1 / 2 — Hoofdview
============================================ */
function renderPhase1or2(ctx, overlay) {
  const childName = escapeHtml(ctx.child.name || 'je kindje');
  const phase = ctx.state.current_phase;
  const phaseLabel = (PHASE_OPTIONS.find((o) => o.phase === phase) || {}).label || `Fase ${phase}`;
  const subTitle = phaseLabel.replace(/^Fase \d+ · /, '');

  return `
    <div class="eh-hub-modal">
      ${renderHeader(ctx, `${childName}'s reis`, subTitle)}
      <div class="eh-hub-body">
        <div class="eh-sub-nav">
          ${SUB_TABS.map((t) => `
            <button class="eh-sub-tab ${ctx.activeTab === t.key ? 'active' : ''}" data-tab="${t.key}">
              ${t.label}
            </button>
          `).join('')}
        </div>
        <div class="eh-sub-content" data-sub-content>
          ${renderSubTab(ctx)}
        </div>
      </div>
    </div>
  `;
}

function renderSubTab(ctx) {
  switch (ctx.activeTab) {
    case 'roadmap':    return renderRoadmap(ctx);
    case 'week':       return renderWeek(ctx);
    case 'logboek':    return renderLogboek(ctx);
    case 'symptomen':  return renderSymptomen(ctx);
    case 'allergenen': return renderAllergenen(ctx);
    default:           return renderRoadmap(ctx);
  }
}

function bindPhase1or2(overlay, ctx) {
  overlay.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      ctx.activeTab = btn.dataset.tab;
      // Lazy-load tab-specifieke data
      // Roadmap heeft meals nodig voor tips-card + fase-2 prompt
      if ((ctx.activeTab === 'roadmap' || ctx.activeTab === 'logboek') && ctx.meals === null) {
        await ensureMeals(ctx);
      }
      if (ctx.activeTab === 'symptomen' && ctx.symptoms === null) {
        await ensureSymptoms(ctx);
      }
      render(overlay, ctx);
    });
  });

  // Phase-selector in header — werkt in alle sub-tabs
  overlay.querySelector('[data-action="change-phase"]')?.addEventListener('change', async (e) => {
    const newPhase = parseInt(e.target.value, 10);
    if (newPhase === ctx.state.current_phase) return;
    const opt = PHASE_OPTIONS.find((o) => o.phase === newPhase);
    if (!opt) return;
    const ageMonths = computeAgeMonths(ctx.child.birthdate);
    if (ageMonths < opt.minAge) {
      showToast(`Fase ${newPhase} is pas beschikbaar ${opt.ageHint}.`, 'info');
      e.target.value = String(ctx.state.current_phase);
      return;
    }
    try {
      ctx.state = await patchEhState(ctx.child.id, {
        current_phase: opt.phase,
        meals_per_day: opt.mealsPerDay,
        phase_started_at: new Date().toISOString(),
      });
      ctx.weekPlan = null;
      ctx.fruitWeek = null;
      ctx.breakfastWeek = null;
      showToast(`${opt.label} actief.`, 'success');
      render(overlay, ctx);
    } catch (err) {
      console.error('[Hub] change-phase failed', err);
      showToast('Kon fase niet wisselen.', 'error');
      e.target.value = String(ctx.state.current_phase);
    }
  });

  // Sub-tab specifieke binding
  switch (ctx.activeTab) {
    case 'roadmap':    bindRoadmap(overlay, ctx); break;
    case 'week':       bindWeek(overlay, ctx); break;
    case 'logboek':    bindLogboek(overlay, ctx); break;
    case 'symptomen':  bindSymptomen(overlay, ctx); break;
    case 'allergenen': bindAllergenen(overlay, ctx); break;
  }
}

/* ============================================
   Sub-tab: VANDAAG (voorheen "Roadmap")
   Alleen wat vandaag gegeten / geïntroduceerd wordt + tips + HapjesHeld.
   Volledig week-overzicht zit in de Weekschema-tab.
   Allergenen-progressie zit in de Allergenen-tab.
============================================ */
function renderRoadmap(ctx) {
  buildWeekPlanIfNeeded(ctx);
  const days = ctx.weekPlan.days;
  const today = days[0];
  const todayMeals = today.meals;
  const todayIntro = today.allergenIntro;

  if (ctx.state.current_phase >= 2) buildFruitWeekIfNeeded(ctx);
  if (ctx.state.current_phase >= 3) buildBreakfastWeekIfNeeded(ctx);

  return `
    ${renderPauseBanner(ctx)}
    ${renderPhase2Prompt(ctx)}
    ${renderPhase3Prompt(ctx)}
    ${renderTodayCard(ctx, todayMeals, todayIntro)}
    ${renderHapjesHeldEmbed(ctx)}
  `;
}

// (renderTipsCard / buildTips / handleTipAction blijven in code maar worden
// niet meer aangeroepen in Vandaag-tab — user-request 2026-05-11.)

/* === Vandaag-card: 1 tegel met alle slots + allergen-intro onderaan === */
function renderTodayCard(ctx, todayMeals, todayIntro) {
  const phase = ctx.state.current_phase;
  const slots = [];

  // Slot: ontbijt (fase 3)
  if (phase >= 3) {
    if (ctx.breakfastWeek === null) {
      slots.push({ icon: '🥣', label: 'Ontbijt', titleHtml: '<em class="eh-slot-loading">Laden…</em>' });
    } else if (ctx.breakfastWeek.length === 0) {
      slots.push({ icon: '🥣', label: 'Ontbijt', titleHtml: '<em class="eh-slot-empty">Geen ochtend-recepten — voeg toe via receptenboek</em>' });
    } else {
      const r = ctx.breakfastWeek[0];
      slots.push({
        icon: '🥣',
        label: 'Ontbijt',
        titleHtml: escapeHtml(r.name || 'Naamloos recept'),
        sub: r.cookingTime ? `${r.cookingTime} min bereiding` : '',
        kind: 'breakfast',
        recipeId: r.id,
      });
    }
  }

  // Slot(s): warme maaltijd
  todayMeals.forEach((m, i) => {
    const slotLabel = todayMeals.length === 2 ? (i === 0 ? 'Lunch' : 'Avondmaal') : 'Warme maaltijd';
    const slotIcon  = todayMeals.length === 2 ? (i === 0 ? '🌞' : '🌙') : '🍲';
    slots.push({
      icon: slotIcon,
      label: slotLabel,
      titleHtml: renderIngredientTitle(m.ingredients),
      sub: m.ratioLabel || '',
      kind: 'warm',
    });
  });

  // Slot: fruit (fase 2+)
  if (phase >= 2 && ctx.fruitWeek?.[0]) {
    const m = ctx.fruitWeek[0];
    slots.push({
      icon: '🍓',
      label: 'Fruit',
      titleHtml: renderFruitTitle(m.ingredients),
      sub: m.ratioLabel || '',
      kind: 'fruit',
    });
  }

  return `
    <div class="eh-today-card">
      <h3 class="eh-today-card-title">📅 Vandaag · ${formatDayLabel(0)}</h3>
      <div class="eh-today-slots">
        ${slots.map((s) => renderTodaySlot(s)).join('')}
      </div>
      ${todayIntro ? renderTodayIntroFooter(todayIntro) : ''}
    </div>
  `;
}

function renderTodaySlot(s) {
  const logBtn = s.kind
    ? `<button class="eh-today-slot-log" data-action="log-slot" data-slot-kind="${s.kind}"${s.recipeId ? ` data-recipe-id="${escapeHtml(s.recipeId)}"` : ''} type="button">✓ Log</button>`
    : '';
  return `
    <div class="eh-today-slot">
      <div class="eh-today-slot-meta">
        <span class="eh-today-slot-icon">${s.icon}</span>
        <span class="eh-today-slot-label">${escapeHtml(s.label)}</span>
      </div>
      <div class="eh-today-slot-body">
        <div class="eh-today-slot-title">${s.titleHtml}</div>
        ${s.sub ? `<div class="eh-today-slot-sub">${escapeHtml(s.sub)}</div>` : ''}
      </div>
      ${logBtn}
    </div>
  `;
}

function renderTodayIntroFooter(intro) {
  return `
    <div class="eh-today-card-footer">
      <div class="eh-allergen-callout in-card">
        <span class="eh-ac-ic">${intro.icon}</span>
        <div class="eh-ac-body">
          <div class="eh-ac-head">Vandaag ook introduceren</div>
          <div class="eh-ac-ttl">${escapeHtml(intro.label)} · dose ${intro.dose}/${intro.doseTarget}${intro.dose === intro.doseTarget ? ' (laatste!)' : ''}</div>
          <div class="eh-ac-desc">${escapeHtml(intro.suggestedFood || '')}${intro.note ? ` <em>${escapeHtml(intro.note)}</em>` : ''}</div>
          <div class="eh-ac-reactions">
            <span class="eh-ac-pill" data-reaction="geen"    data-key="${escapeHtml(intro.key)}" data-dose="${intro.dose}">✓ Geen reactie</span>
            <span class="eh-ac-pill" data-reaction="mild"    data-key="${escapeHtml(intro.key)}" data-dose="${intro.dose}">⚠ Milde reactie</span>
            <span class="eh-ac-pill danger" data-reaction="ernstig" data-key="${escapeHtml(intro.key)}" data-dose="${intro.dose}">🚨 Ernstige reactie</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function buildFruitWeekIfNeeded(ctx) {
  if (ctx.fruitWeek) return;
  ctx.fruitWeek = generateFruitWeek({
    avoidAllergens: ctx.state.allergen_state?.known_allergies || [],
    seed: `${ctx.child.id}:fruit:${ctx.state.current_week_seed || 'init'}`,
  });
}

function renderTodayFruit(ctx) {
  const meal = ctx.fruitWeek?.[0];
  if (!meal) return '';
  const ing = meal.ingredients;
  const ratio = meal.ratioLabel || '';
  return `
    <div class="eh-fruit-hero">
      <span class="eh-hero-badge">🍓 Fruit-maaltijd vandaag</span>
      <h3 class="eh-hero-title">${renderFruitTitle(ing)}</h3>
      <p class="eh-hero-ratio">${escapeHtml(ratio)}</p>
      ${renderFruitEmojiRow(ing)}
      ${meal.warnings.length ? renderFruitWarnings(meal.warnings) : ''}
      <div class="eh-hero-actions">
        <button class="eh-hero-btn primary" data-action="log-fruit-today">✓ Log fruit</button>
        <button class="eh-hero-btn ghost"   data-action="regen-fruit-week">🔄 Wissel</button>
      </div>
    </div>
  `;
}

function renderFruitTitle(ing) {
  const parts = [ing.fruit, ing.groen].filter(Boolean).map((x) => x.name);
  return escapeHtml(parts.join(' + '));
}

function renderFruitEmojiRow(ing) {
  const cells = [
    { it: ing.fruit, em: '🍓', cls: '' },
    { it: ing.groen, em: '🥬', cls: 'protein' },
    { it: ing.vet,   em: '🫒', cls: 'fat' },
  ];
  return `
    <div class="eh-meal-emojis">
      ${cells.filter((c) => c.it).map((c) => `
        <div class="eh-meal-cell ${c.cls}">
          <div class="eh-meal-em">${c.em}</div>
          <span class="eh-meal-nm">${escapeHtml(c.it.name)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderFruitWarnings(warnings) {
  return `
    <div class="eh-fruit-warnings">
      ${warnings.map((w) => `<span class="eh-fruit-warn">⚠ ${escapeHtml(w.ingredient)}${w.note ? ` — ${escapeHtml(w.note)}` : ''}</span>`).join('')}
    </div>
  `;
}

/* Fase 2-overgangsprompt — fase 1 → 2 (toevoeging fruit), vanaf ~8 mnd */
function renderPhase2Prompt(ctx) {
  if (ctx.state.current_phase !== 1) return '';
  if (!isReadyForPhase2(ctx)) return '';
  return `
    <div class="eh-phase2-prompt eh-phase3-prompt">
      <span class="eh-phase2-ic">🍓</span>
      <div class="eh-phase2-body">
        <h5>Klaar voor Fase 2?</h5>
        <p>${escapeHtml(ctx.child.name || 'Je kindje')} kan nu ook een fruit-maaltijd erbij (vanaf ~8 mnd).</p>
      </div>
      <button class="eh-phase2-btn" data-action="advance-phase2" type="button">Start Fase 2 →</button>
    </div>
  `;
}

/* Fase 3-overgangsprompt — fase 2 → 3 (toevoeging ontbijt), vanaf 10 mnd */
function renderPhase3Prompt(ctx) {
  if (ctx.state.current_phase !== 2) return '';
  if (!isReadyForPhase3(ctx)) return '';
  return `
    <div class="eh-phase2-prompt eh-phase4-prompt">
      <span class="eh-phase2-ic">🥣</span>
      <div class="eh-phase2-body">
        <h5>Klaar voor Fase 3?</h5>
        <p>${escapeHtml(ctx.child.name || 'Je kindje')} kan nu ook een ontbijt erbij — uit jouw recepten met "ochtend"-tag.</p>
      </div>
      <button class="eh-phase2-btn" data-action="advance-phase3" type="button">Start Fase 3 →</button>
    </div>
  `;
}

/* ============================================
   ONTBIJT (Fase 4)
   Selecteert recepten uit de recipes-tabel met meal_moments = "ochtend"
   en filtert op bekende allergieën.
============================================ */
async function buildBreakfastWeekIfNeeded(ctx) {
  if (ctx.breakfastWeek !== null) return;
  ctx.breakfastWeek = []; // markeer als "loading" zodat er niet 2× geladen wordt

  try {
    const allRecipes = await getRecipes().catch(() => []);
    const known = new Set((ctx.state.allergen_state?.known_allergies || []).map((k) => k.toLowerCase()));
    const ochtendRecipes = allRecipes.filter((r) => {
      const moments = r.mealMoments || r.meal_moments || [];
      if (!moments.includes('ochtend')) return false;
      const allergens = (r.allergens || []).map((a) => String(a).toLowerCase());
      return !allergens.some((a) => known.has(a));
    });

    if (ochtendRecipes.length === 0) {
      ctx.breakfastWeek = [];
      return;
    }

    // 7 dagen: deterministisch op basis van child_id + week-seed.
    // Sortering op stable hash zodat herhaling minimaliseert.
    const seedStr = `${ctx.child.id}:breakfast:${ctx.state.current_week_seed || 'init'}`;
    const seedNum = simpleHash(seedStr);
    const week = [];
    const used = new Set();
    for (let d = 0; d < 7; d++) {
      const candidates = ochtendRecipes.filter((r) => !used.has(r.id));
      const pool = candidates.length > 0 ? candidates : ochtendRecipes;
      const idx = (seedNum + d * 17) % pool.length;
      const recipe = pool[idx];
      if (candidates.length > 0) used.add(recipe.id);
      week.push(recipe);
    }
    ctx.breakfastWeek = week;

    // Re-render: data is gewijzigd na initial render
    if (ctx._currentHost) render(ctx._currentHost, ctx);
  } catch (err) {
    console.error('[Hub] breakfast load failed', err);
    ctx.breakfastWeek = [];
  }
}

function simpleHash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

function renderTodayBreakfast(ctx) {
  if (ctx.breakfastWeek === null || ctx.breakfastWeek.length === 0) {
    // Loading of geen ochtend-recepten beschikbaar
    if (ctx.breakfastWeek === null) {
      return `<div class="eh-breakfast-hero loading"><p>🥣 Ontbijt laden…</p></div>`;
    }
    return `
      <div class="eh-breakfast-hero empty">
        <span class="eh-hero-badge">🥣 Ontbijt vandaag</span>
        <p>Geen recepten met "ochtend"-tag gevonden${ (ctx.state.allergen_state?.known_allergies || []).length ? ' (na filter op bekende allergieën)' : '' }. Voeg recepten toe via de receptenboek.</p>
      </div>
    `;
  }
  const recipe = ctx.breakfastWeek[0];
  if (!recipe) return '';
  return `
    <div class="eh-breakfast-hero">
      <span class="eh-hero-badge">🥣 Ontbijt vandaag</span>
      <h3 class="eh-hero-title">${escapeHtml(recipe.name || 'Naamloos recept')}</h3>
      ${recipe.cookingTime ? `<p class="eh-hero-ratio">Bereidingstijd: ${recipe.cookingTime} min</p>` : ''}
      <div class="eh-hero-actions">
        <button class="eh-hero-btn primary" data-action="open-breakfast-recipe" data-recipe-id="${escapeHtml(recipe.id)}">📖 Bekijk recept</button>
        <button class="eh-hero-btn ghost"   data-action="regen-breakfast-week">🔄 Wissel</button>
      </div>
    </div>
  `;
}

function renderHapjesHeldEmbed(ctx) {
  return `
    <div class="eh-hh-wrap" data-eh-hh-wrap>
      ${renderEhChatBox(ctx.child)}
    </div>
  `;
}

/* Tips & herinneringen-card */
function renderTipsCard(ctx, summary) {
  const tips = buildTips(ctx, summary);
  if (tips.length === 0) return '';
  return `
    <div class="eh-tips-card">
      <h4>💡 Tips & herinneringen <small>· ${tips.length}</small></h4>
      <ul class="eh-tips-list">
        ${tips.map((t) => `
          <li>
            <button class="eh-tip-btn" data-tip-action="${escapeHtml(t.action)}" data-tip-key="${escapeHtml(t.key || '')}" type="button">
              <span class="eh-tip-em">${t.icon}</span>
              <span class="eh-tip-main">
                <span class="eh-tip-label">${escapeHtml(t.label)}</span>
                <span class="eh-tip-sub">${escapeHtml(t.sub)}</span>
              </span>
              <span class="eh-tip-arrow">›</span>
            </button>
          </li>
        `).join('')}
      </ul>
    </div>
  `;
}

function renderPauseBanner(ctx) {
  const a = ctx.state.allergen_state || {};
  if (!a.paused) return '';
  const key = a.paused_allergen;
  const reason = a.paused_reason || 'reactie';
  const flow = ALLERGEN_FLOW.find((x) => x.key === key);
  const label = flow ? flow.label : key;
  const escalate = reason === 'ernstig';
  return `
    <div class="eh-pause-banner ${escalate ? 'escalate' : ''}">
      <span class="eh-pause-ic">${escalate ? '🚨' : '⚠️'}</span>
      <div class="eh-pause-body">
        <h5>Allergeen-flow staat op pauze</h5>
        <p>Reactie op <strong>${escapeHtml(label)}</strong> (${escapeHtml(reason)}) — beslis hoe verder.</p>
        ${escalate ? `<p class="eh-pause-care">Bij twijfel of bij aanhoudende klachten: contacteer je arts of Kind &amp; Gezin.</p>` : ''}
        <div class="eh-pause-actions">
          <button class="eh-pause-btn primary" data-action="confirm-allergy" data-key="${escapeHtml(key)}">Markeer als allergie</button>
          <button class="eh-pause-btn ghost"   data-action="resume-flow">Probeer later opnieuw</button>
        </div>
      </div>
    </div>
  `;
}

function renderTodayHero(ctx, meal, intro, mealIdx = 0, totalMeals = 1) {
  const ing = meal.ingredients;
  const ratio = meal.ratioLabel || '';
  const childName = escapeHtml(ctx.child.name || 'je kindje');
  const slotLabel = totalMeals === 2
    ? (mealIdx === 0 ? '🌞 Lunch' : '🌙 Avond')
    : '🍲 Warme maaltijd';

  return `
    <div class="eh-next-hero">
      <span class="eh-hero-badge">${slotLabel} · ${formatDayLabel(0)}</span>
      <h3 class="eh-hero-title">${renderIngredientTitle(ing)}</h3>
      <p class="eh-hero-ratio">${escapeHtml(ratio)}</p>
      ${renderEmojiRow(ing)}
      ${intro ? renderTodayIntroBlock(intro, childName) : ''}
      <div class="eh-hero-actions">
        <button class="eh-hero-btn primary" data-action="log-meal-today">✓ Log maaltijd</button>
      </div>
    </div>
  `;
}

function renderTodayIntroBlock(intro, childName) {
  return `
    <div class="eh-allergen-callout">
      <span class="eh-ac-ic">${intro.icon}</span>
      <div class="eh-ac-body">
        <div class="eh-ac-head">Vandaag ook introduceren</div>
        <div class="eh-ac-ttl">${escapeHtml(intro.label)} · dose ${intro.dose}/${intro.doseTarget}${intro.dose === intro.doseTarget ? ' (laatste!)' : ''}</div>
        <div class="eh-ac-desc">${escapeHtml(intro.suggestedFood || '')}${intro.note ? ` <em>${escapeHtml(intro.note)}</em>` : ''}</div>
        <div class="eh-ac-reactions">
          <span class="eh-ac-pill" data-reaction="geen"    data-key="${escapeHtml(intro.key)}" data-dose="${intro.dose}">✓ Geen reactie</span>
          <span class="eh-ac-pill" data-reaction="mild"    data-key="${escapeHtml(intro.key)}" data-dose="${intro.dose}">⚠ Milde reactie</span>
          <span class="eh-ac-pill danger" data-reaction="ernstig" data-key="${escapeHtml(intro.key)}" data-dose="${intro.dose}">🚨 Ernstige reactie</span>
        </div>
      </div>
    </div>
  `;
}

function renderEmojiRow(ing) {
  const cells = [
    { it: ing.groen,     em: '🥦', cls: '' },
    { it: ing.kleurrijk, em: '🥕', cls: '' },
    { it: ing.knol,      em: '🥔', cls: '' },
    { it: ing.eiwit,     em: '🍗', cls: 'protein' },
    { it: ing.vet,       em: '🫒', cls: 'fat' },
  ];
  return `
    <div class="eh-meal-emojis">
      ${cells.filter((c) => c.it).map((c) => `
        <div class="eh-meal-cell ${c.cls}">
          <div class="eh-meal-em">${c.em}</div>
          <span class="eh-meal-nm">${escapeHtml(c.it.name)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderIngredientTitle(ing) {
  const parts = [ing.groen, ing.kleurrijk, ing.knol, ing.eiwit].filter(Boolean).map((x) => x.name);
  return escapeHtml(parts.join(' + '));
}

function renderAllergenTrack(summary, completedCount) {
  return `
    <div class="eh-allergen-track">
      <h4>🥜 Allergeen-introducties <small>· ${completedCount}/13 voltooid</small></h4>
      <div class="eh-all-grid">
        ${summary.map((a) => renderAllergenCell(a)).join('')}
      </div>
    </div>
  `;
}

function renderAllergenCell(a) {
  const cls = `eh-all-cell eh-all-cell-${a.status}`;
  const dose = renderDoseLabel(a);
  return `
    <button class="${cls}" data-allergen-detail="${escapeHtml(a.key)}" type="button">
      <div class="eh-all-ic">${a.icon}</div>
      <div class="eh-all-nm">${escapeHtml(a.label.replace(' (heel ei)', ''))}</div>
      <div class="eh-all-dose">${dose}</div>
    </button>
  `;
}

function renderDoseLabel(a) {
  if (a.status === 'veilig')      return `${a.successCount}/${a.target} ✓`;
  if (a.status === 'allergisch')  return 'allergie';
  if (a.status === 'paused')      return 'pauze';
  if (a.status === 'locked-age')  return `${a.ageCondition.introFrom}+ mnd`;
  if (a.status === 'in-progress') return `${a.successCount}/${a.target}`;
  return `0/${a.target}`;
}

function renderWeekPlan(ctx, days) {
  const knownAllergies = ctx.state.allergen_state?.known_allergies || [];
  const dietary = ctx.state.dietary || 'omnivoor';

  return `
    <div class="eh-week-section">
      <div class="eh-week-head">
        <h4>Deze week</h4>
        <button class="eh-week-regen" data-action="regen-week" type="button">🔄 Nieuwe week</button>
      </div>
      <div class="eh-week-filters">
        <label class="eh-dietary-pill">
          ${escapeHtml(dietaryEmoji(dietary))}
          <select data-action="change-dietary" class="eh-dietary-select">
            ${Object.values(DIETARY_STYLES).map((d) => `
              <option value="${d.key}" ${d.key === dietary ? 'selected' : ''}>${escapeHtml(d.label)}</option>
            `).join('')}
          </select>
        </label>
        ${knownAllergies.map((a) => `<span class="eh-filter-pill">🚫 ${escapeHtml(a)}</span>`).join('')}
      </div>
      ${days.map((d, i) => renderDayCard(d, i)).join('')}
    </div>
  `;
}

function renderDayCard(d, idx) {
  const meal = d.meals[0];
  const ing = meal.ingredients;
  const intro = d.allergenIntro;
  const isToday = idx === 0;
  const cls = `eh-day-card ${isToday ? 'today' : ''}`;
  return `
    <div class="${cls}">
      <div class="eh-day-pill">${formatDayLabel(idx)}</div>
      <div class="eh-day-info">
        <div class="eh-day-emojis">${dayEmojis(ing)}</div>
        <div class="eh-day-title">${renderIngredientTitle(ing)}</div>
        ${intro
          ? `<div class="eh-day-badge">${intro.icon} ${escapeHtml(intro.label)} ${intro.dose}/${intro.doseTarget}${intro.dose === intro.doseTarget ? ' (laatste)' : ''}</div>`
          : (isToday ? '' : `<div class="eh-day-sub">cooldown-dag</div>`)
        }
      </div>
      <div class="eh-day-actions">
        <button class="eh-day-swap" data-action="swap-day" data-day-idx="${idx}" aria-label="Wissel deze dag" type="button">↻</button>
      </div>
    </div>
  `;
}

function dayEmojis(ing) {
  return [ing.groen, ing.kleurrijk, ing.knol, ing.eiwit, ing.vet]
    .filter(Boolean)
    .map(() => '·')
    .join(' ');
}

function dietaryEmoji(d) {
  return { omnivoor: '🥩', pesco: '🐟', vegetarisch: '🥦', vegan: '🌱' }[d] || '🍽️';
}

function bindRoadmap(overlay, ctx) {
  // Reactie-pills op vandaag's intro
  overlay.querySelectorAll('[data-reaction]').forEach((pill) => {
    pill.addEventListener('click', async () => {
      const reaction = pill.dataset.reaction;
      const key = pill.dataset.key;
      const dose = parseInt(pill.dataset.dose, 10);
      await recordDoseAndRefresh(overlay, ctx, key, dose, reaction);
    });
  });

  // Pauze-banner acties
  overlay.querySelector('[data-action="confirm-allergy"]')?.addEventListener('click', async (e) => {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    if (!confirm(`Bevestig dat ${ctx.child.name || 'je kindje'} allergisch is voor "${key}". Het allergeen wordt aan het profiel toegevoegd en uit de roadmap gehouden.`)) return;
    try {
      const known = [...(ctx.state.allergen_state?.known_allergies || [])];
      if (!known.includes(key)) known.push(key);
      await patchEhState(ctx.child.id, {
        allergen_state: {
          ...(ctx.state.allergen_state || {}),
          known_allergies: known,
          paused: false,
          paused_reason: null,
          paused_allergen: null,
        },
      });
      showToast('Allergeen toegevoegd aan profiel.', 'success');
      await reloadAndRender(overlay, ctx);
    } catch (err) {
      console.error('[Hub] confirm allergy failed', err);
      showToast('Kon allergie niet opslaan.', 'error');
    }
  });

  overlay.querySelector('[data-action="resume-flow"]')?.addEventListener('click', async () => {
    try {
      await patchEhState(ctx.child.id, {
        allergen_state: {
          ...(ctx.state.allergen_state || {}),
          paused: false,
          paused_reason: null,
          paused_allergen: null,
        },
      });
      showToast('Flow hervat.', 'success');
      await reloadAndRender(overlay, ctx);
    } catch (err) {
      console.error('[Hub] resume failed', err);
    }
  });

  // Log-maaltijd-vandaag → opent bestaand mealLogModal
  overlay.querySelector('[data-action="log-meal-today"]')?.addEventListener('click', async () => {
    await openMealLogFromHub(ctx);
    await reloadAndRender(overlay, ctx);
  });

  // Per-slot log-knop op de Vandaag-card. Opent mealLogModal voor alle kinds.
  // Voor breakfast: navigeer naar receptdetail om recipe-info te zien.
  overlay.querySelectorAll('[data-action="log-slot"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const kind = btn.dataset.slotKind;
      if (kind === 'breakfast' && btn.dataset.recipeId) {
        Router.navigate(`recipe/${btn.dataset.recipeId}`);
        return;
      }
      await openMealLogFromHub(ctx);
      await reloadAndRender(overlay, ctx);
    });
  });

  // Nieuwe week genereren — nieuwe seed
  overlay.querySelectorAll('[data-action="regen-week"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const newSeed = `${ctx.child.id}:w${Date.now()}`;
      try {
        ctx.state = await patchEhState(ctx.child.id, { current_week_seed: newSeed });
        ctx.weekPlan = null;
        render(overlay, ctx);
      } catch (err) {
        console.error('[Hub] regen week failed', err);
      }
    });
  });

  // Klik op allergen-cel → switch naar Allergenen-tab met die allergeen open
  overlay.querySelectorAll('[data-allergen-detail]').forEach((btn) => {
    btn.addEventListener('click', () => {
      ctx.selectedAllergen = btn.dataset.allergenDetail;
      ctx.activeTab = 'allergenen';
      render(overlay, ctx);
    });
  });

  // Per-dag swap
  overlay.querySelectorAll('[data-action="swap-day"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.dayIdx, 10);
      swapDayMeal(overlay, ctx, idx);
    });
  });

  // Dietary-switcher
  overlay.querySelector('[data-action="change-dietary"]')?.addEventListener('change', async (e) => {
    const newDietary = e.target.value;
    if (newDietary === ctx.state.dietary) return;
    try {
      ctx.state = await patchEhState(ctx.child.id, { dietary: newDietary });
      ctx.weekPlan = null;
      render(overlay, ctx);
      showToast(`Dieet aangepast naar ${newDietary}.`, 'success');
    } catch (err) {
      console.error('[Hub] dietary change failed', err);
      showToast('Kon dieet niet aanpassen.', 'error');
    }
  });

  // Tip-acties
  overlay.querySelectorAll('[data-tip-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.tipAction;
      const key = btn.dataset.tipKey || null;
      handleTipAction(overlay, ctx, action, key);
    });
  });

  // HapjesHeld embed-binding
  const hhWrap = overlay.querySelector('[data-eh-hh-wrap]');
  if (hhWrap) bindEhChatBox(hhWrap, ctx.child);

  // Fase 2-overgang (fase 1 → 2 = + fruit)
  overlay.querySelector('[data-action="advance-phase2"]')?.addEventListener('click', async () => {
    if (!confirm(`Naar Fase 2 gaan? ${ctx.child.name} krijgt vanaf nu ook een dagelijkse fruit-maaltijd.`)) return;
    try {
      ctx.state = await patchEhState(ctx.child.id, {
        current_phase: 2,
        meals_per_day: 1,
        phase_started_at: new Date().toISOString(),
      });
      ctx.weekPlan = null;
      ctx.fruitWeek = null;
      showToast('Fase 2 gestart 🍓', 'success');
      render(overlay, ctx);
    } catch (err) {
      console.error('[Hub] phase2 failed', err);
      showToast('Kon Fase 2 niet starten.', 'error');
    }
  });

  // Fase 3-overgang (fase 2 → 3 = + ontbijt)
  overlay.querySelector('[data-action="advance-phase3"]')?.addEventListener('click', async () => {
    if (!confirm(`Naar Fase 3 gaan? ${ctx.child.name} krijgt vanaf nu ook een ontbijt-recept uit jouw recepten.`)) return;
    try {
      ctx.state = await patchEhState(ctx.child.id, {
        current_phase: 3,
        meals_per_day: 1,
        phase_started_at: new Date().toISOString(),
      });
      ctx.weekPlan = null;
      ctx.fruitWeek = null;
      ctx.breakfastWeek = null;
      showToast('Fase 3 gestart 🥣', 'success');
      render(overlay, ctx);
    } catch (err) {
      console.error('[Hub] phase3 failed', err);
      showToast('Kon Fase 3 niet starten.', 'error');
    }
  });
}

/* ============================================
   Sub-tab: ALLERGENEN
============================================ */
function renderAllergenen(ctx) {
  const ageMonths = computeAgeMonths(ctx.child.birthdate);
  const summary = buildAllergenSummary(ctx.doses, ctx.state, ageMonths);
  const sel = ctx.selectedAllergen
    ? summary.find((s) => s.key === ctx.selectedAllergen)
    : null;

  return `
    ${renderPauseBanner(ctx)}
    <div class="eh-allergen-track">
      <h4>🥜 13 allergenen — vaste introductie-flow</h4>
      <div class="eh-all-grid">
        ${summary.map((a) => renderAllergenCell(a)).join('')}
      </div>
    </div>
    ${sel ? renderAllergenDetail(sel) : `
      <p class="eh-meta">Klik op een allergeen voor details + dose-historiek.</p>
    `}
  `;
}

function renderAllergenDetail(a) {
  const target = a.target;
  const doses = (a.doses || []).slice().sort((x, y) => (x.dose_number - y.dose_number));
  const nextDose = Math.min(target, a.successCount + 1);
  const reachedTarget = a.successCount >= target;

  return `
    <div class="eh-allergen-detail">
      <h4>${a.icon} ${escapeHtml(a.label)}</h4>
      <p class="eh-detail-desc">${escapeHtml(a.suggestedFood || '')}</p>
      ${a.note ? `<p class="eh-detail-note"><em>${escapeHtml(a.note)}</em></p>` : ''}

      <div class="eh-dose-progress">
        ${[1, 2, 3].map((n) => {
          const d = doses.find((x) => x.dose_number === n);
          const cls = d
            ? (d.reaction === 'geen' ? 'done' : 'reaction')
            : (n === nextDose && !reachedTarget && a.status !== 'allergisch' ? 'next' : 'pending');
          const label = d
            ? (d.reaction === 'geen' ? '✓' : reactionEmoji(d.reaction))
            : n;
          return `<div class="eh-dose-pip ${cls}" title="Dose ${n}">${label}</div>`;
        }).join('')}
      </div>

      ${a.status === 'allergisch'
        ? `<p class="eh-detail-status allergic">Gemarkeerd als allergie — niet meer in de flow.</p>`
        : reachedTarget
          ? `<p class="eh-detail-status safe">✓ Veilig — 3/3 succesvol geïntroduceerd.</p>`
          : a.status === 'paused'
            ? `<p class="eh-detail-status paused">Flow gepauzeerd op dit allergeen — los op via banner bovenaan.</p>`
            : a.status === 'locked-age'
              ? `<p class="eh-detail-status locked">Pas vanaf ${a.ageCondition.introFrom} maanden te introduceren.</p>`
              : `
                <div class="eh-detail-record">
                  <p>Markeer dose ${nextDose}/${target} na introductie:</p>
                  <div class="eh-detail-pills">
                    <button class="eh-detail-pill"  data-record-key="${escapeHtml(a.key)}" data-record-dose="${nextDose}" data-record-reaction="geen">✓ Geen reactie</button>
                    <button class="eh-detail-pill"  data-record-key="${escapeHtml(a.key)}" data-record-dose="${nextDose}" data-record-reaction="mild">⚠ Mild</button>
                    <button class="eh-detail-pill danger" data-record-key="${escapeHtml(a.key)}" data-record-dose="${nextDose}" data-record-reaction="ernstig">🚨 Ernstig</button>
                  </div>
                </div>
              `}

      ${doses.length > 0 ? `
        <h5 class="eh-detail-history-h">Geschiedenis</h5>
        <ul class="eh-detail-history">
          ${doses.map((d) => `
            <li>
              <span class="eh-dose-num">Dose ${d.dose_number}</span>
              <span class="eh-dose-date">${formatDate(d.intro_date)}</span>
              <span class="eh-dose-reaction eh-dose-reaction-${d.reaction}">${reactionLabel(d.reaction)}</span>
            </li>
          `).join('')}
        </ul>
      ` : ''}
    </div>
  `;
}

function reactionEmoji(r) { return { geen: '✓', mild: '⚠', ernstig: '🚨' }[r] || '?'; }
function reactionLabel(r) { return { geen: 'Geen reactie', mild: 'Mild', ernstig: 'Ernstig' }[r] || r; }

function bindAllergenen(overlay, ctx) {
  // Klik op cel → selecteer
  overlay.querySelectorAll('[data-allergen-detail]').forEach((btn) => {
    btn.addEventListener('click', () => {
      ctx.selectedAllergen = btn.dataset.allergenDetail;
      render(overlay, ctx);
    });
  });

  // Pauze-banner acties (zelfde handlers als roadmap-tab)
  overlay.querySelector('[data-action="confirm-allergy"]')?.addEventListener('click', async (e) => {
    const key = e.currentTarget.dataset.key;
    if (!confirm(`Bevestig allergie voor "${key}".`)) return;
    const known = [...(ctx.state.allergen_state?.known_allergies || [])];
    if (!known.includes(key)) known.push(key);
    await patchEhState(ctx.child.id, {
      allergen_state: { ...(ctx.state.allergen_state || {}), known_allergies: known, paused: false, paused_reason: null, paused_allergen: null },
    });
    showToast('Allergeen toegevoegd aan profiel.', 'success');
    await reloadAndRender(overlay, ctx);
  });
  overlay.querySelector('[data-action="resume-flow"]')?.addEventListener('click', async () => {
    await patchEhState(ctx.child.id, {
      allergen_state: { ...(ctx.state.allergen_state || {}), paused: false, paused_reason: null, paused_allergen: null },
    });
    await reloadAndRender(overlay, ctx);
  });

  // Reactie-pills in detail
  overlay.querySelectorAll('[data-record-reaction]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.recordKey;
      const dose = parseInt(btn.dataset.recordDose, 10);
      const reaction = btn.dataset.recordReaction;
      await recordDoseAndRefresh(overlay, ctx, key, dose, reaction);
    });
  });
}

/* ============================================
   Sub-tab: LOGBOEK (meal_logs lijst)
============================================ */
function renderLogboek(ctx) {
  const meals = ctx.meals || [];
  if (meals.length === 0) {
    return `
      <div class="eh-empty-card">
        <p>Nog geen maaltijden gelogd. Log er één via de roadmap of de + knop hieronder.</p>
        <button class="eh-hero-btn primary" data-action="log-meal-new" type="button">+ Log maaltijd</button>
      </div>
    `;
  }
  // Groeperen per datum
  const groups = {};
  for (const m of meals) {
    const d = m.eaten_at.slice(0, 10);
    if (!groups[d]) groups[d] = [];
    groups[d].push(m);
  }
  const dates = Object.keys(groups).sort().reverse();

  return `
    <div class="eh-logbook">
      <button class="eh-hero-btn primary" data-action="log-meal-new" type="button">+ Log maaltijd</button>
      ${dates.map((d) => `
        <div class="eh-log-day">
          <h5>${formatDate(d)}</h5>
          <ul class="eh-log-list">
            ${groups[d].map((m) => renderMealRow(m)).join('')}
          </ul>
        </div>
      `).join('')}
    </div>
  `;
}

function renderMealRow(m) {
  const time = new Date(m.eaten_at).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
  const typeLabel = MEAL_TYPE_LABEL[m.meal_type] || m.meal_type;
  const reactionEm = m.reaction ? REACTION_EMOJI[m.reaction] || '' : '';
  return `
    <li class="eh-log-row" data-meal-id="${m.id}">
      <div class="eh-log-row-main">
        <div class="eh-log-row-top">
          <span class="eh-log-time">${escapeHtml(time)}</span>
          <span class="eh-log-type">${escapeHtml(typeLabel)}</span>
          ${reactionEm ? `<span class="eh-log-em">${reactionEm}</span>` : ''}
        </div>
        <div class="eh-log-row-body">${escapeHtml(m.food_text)}${m.amount ? ` <span class="eh-log-meta">· ${escapeHtml(m.amount)}</span>` : ''}</div>
        ${m.notes ? `<div class="eh-log-notes">${escapeHtml(m.notes)}</div>` : ''}
      </div>
      <button class="eh-log-del" data-action="delete-meal" data-id="${m.id}" aria-label="Verwijder">×</button>
    </li>
  `;
}

function bindLogboek(overlay, ctx) {
  overlay.querySelector('[data-action="log-meal-new"]')?.addEventListener('click', async () => {
    await openMealLogFromHub(ctx);
    ctx.meals = null;
    await ensureMeals(ctx);
    render(overlay, ctx);
  });
  overlay.querySelectorAll('[data-action="delete-meal"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Maaltijd verwijderen?')) return;
      const { ok } = await deleteMealLog(btn.dataset.id);
      if (!ok) return showToast('Verwijderen mislukt.', 'error');
      showToast('Verwijderd.', 'success');
      ctx.meals = null;
      await ensureMeals(ctx);
      render(overlay, ctx);
    });
  });
}

/* ============================================
   Sub-tab: SYMPTOMEN
============================================ */
function renderSymptomen(ctx) {
  const symps = ctx.symptoms || [];
  if (symps.length === 0) {
    return `
      <div class="eh-empty-card">
        <p>Geen symptomen gelogd in de afgelopen 30 dagen.</p>
        <button class="eh-hero-btn primary" data-action="log-symptom-new" type="button">+ Log symptoom</button>
      </div>
    `;
  }
  return `
    <div class="eh-symps">
      <button class="eh-hero-btn primary" data-action="log-symptom-new" type="button">+ Log symptoom</button>
      <ul class="eh-log-list">
        ${symps.map((s) => renderSymptomRow(s)).join('')}
      </ul>
    </div>
  `;
}

function renderSymptomRow(s) {
  const when = new Date(s.occurred_at).toLocaleString('nl-BE', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const meta = getSymptomMeta(s.symptom_type);
  const label = meta?.label || s.symptom_type;
  const flagged = isRedFlag(s.symptom_type, s.severity);
  return `
    <li class="eh-log-row ${flagged ? 'redflag' : ''}" data-symptom-id="${s.id}">
      <div class="eh-log-row-main">
        <div class="eh-log-row-top">
          <span class="eh-log-time">${escapeHtml(when)}</span>
          <span class="eh-log-type">${escapeHtml(label)}</span>
          <span class="eh-log-sev eh-log-sev-${s.severity}">${escapeHtml(s.severity)}</span>
          ${flagged ? '<span class="eh-log-flag">⚠</span>' : ''}
        </div>
        ${s.notes ? `<div class="eh-log-notes">${escapeHtml(s.notes)}</div>` : ''}
      </div>
      <button class="eh-log-del" data-action="delete-symptom" data-id="${s.id}" aria-label="Verwijder">×</button>
    </li>
  `;
}

function bindSymptomen(overlay, ctx) {
  overlay.querySelector('[data-action="log-symptom-new"]')?.addEventListener('click', async () => {
    const result = await openSymptomLogModal({ childId: ctx.child.id, childName: ctx.child.name });
    if (result?.symptom) {
      showToast('Symptoom opgeslagen.', 'success');
      ctx.symptoms = null;
      await ensureSymptoms(ctx);
      render(overlay, ctx);
    }
  });
  overlay.querySelectorAll('[data-action="delete-symptom"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Symptoom verwijderen?')) return;
      const { ok } = await deleteSymptom(btn.dataset.id);
      if (!ok) return showToast('Verwijderen mislukt.', 'error');
      showToast('Verwijderd.', 'success');
      ctx.symptoms = null;
      await ensureSymptoms(ctx);
      render(overlay, ctx);
    });
  });
}

/* ============================================
   Sub-tab: WEEKSCHEMA
   Volledig 7-daags overzicht met ALLE maaltijden per dag op basis van fase:
   - Fase 1: 1 warme
   - Fase 2: 2 warme (lunch + avond)
   - Fase 3: 2 warme + fruit-maaltijd
   - Fase 4: 2 warme + fruit + ontbijt
============================================ */
function renderWeek(ctx) {
  buildWeekPlanIfNeeded(ctx);
  if (ctx.state.current_phase >= 2) buildFruitWeekIfNeeded(ctx);
  if (ctx.state.current_phase >= 3) buildBreakfastWeekIfNeeded(ctx);

  const phase = ctx.state.current_phase;
  const days = ctx.weekPlan.days;
  const knownAllergies = ctx.state.allergen_state?.known_allergies || [];
  const dietary = ctx.state.dietary || 'omnivoor';

  return `
    <div class="eh-week-section">
      <div class="eh-week-head">
        <h4>Volledig weekschema</h4>
        <button class="eh-week-regen" data-action="regen-all-weeks" type="button">🔄 Genereer hele week</button>
      </div>
      <div class="eh-week-filters">
        <label class="eh-dietary-pill">
          ${escapeHtml(dietaryEmoji(dietary))}
          <select data-action="change-dietary" class="eh-dietary-select">
            ${Object.values(DIETARY_STYLES).map((d) => `
              <option value="${d.key}" ${d.key === dietary ? 'selected' : ''}>${escapeHtml(d.label)}</option>
            `).join('')}
          </select>
        </label>
        ${knownAllergies.map((a) => `<span class="eh-filter-pill">🚫 ${escapeHtml(a)}</span>`).join('')}
      </div>

      ${days.map((d, i) => renderWeekDay(ctx, d, i, phase)).join('')}
    </div>
  `;
}

function renderWeekDay(ctx, d, idx, phase) {
  const isToday = idx === 0;
  const fruitMeal = phase >= 2 ? ctx.fruitWeek?.[idx] : null;
  const breakfastRecipe = phase >= 3 ? ctx.breakfastWeek?.[idx] : null;

  return `
    <div class="eh-week-day ${isToday ? 'today' : ''}">
      <div class="eh-week-day-head">
        <span class="eh-day-pill">${formatDayLabel(idx)}</span>
        ${d.allergenIntro ? `<span class="eh-day-badge">${d.allergenIntro.icon} ${escapeHtml(d.allergenIntro.label)} ${d.allergenIntro.dose}/${d.allergenIntro.doseTarget}${d.allergenIntro.dose === d.allergenIntro.doseTarget ? ' (laatste)' : ''}</span>` : ''}
      </div>
      <div class="eh-week-day-rows">
        ${phase >= 3 ? renderWeekRow('🥣', 'Ontbijt', breakfastRecipe?.name || '— geen recept —', 'breakfast') : ''}
        ${d.meals.map((m, mi) => {
          const slot = d.meals.length === 2 ? (mi === 0 ? '🌞 Lunch' : '🌙 Avond') : '🍲 Warm';
          return renderWeekRow('🍲', slot, renderIngredientTitle(m.ingredients), 'warm', idx, mi);
        }).join('')}
        ${phase >= 2 && fruitMeal ? renderWeekRow('🍓', 'Fruit', renderFruitTitle(fruitMeal.ingredients), 'fruit', idx) : ''}
      </div>
    </div>
  `;
}

function renderWeekRow(icon, slotLabel, title, type, dayIdx, mealIdx) {
  let actions = '';
  if (type === 'warm') {
    actions = `
      <button class="eh-day-swap" data-action="swap-day" data-day-idx="${dayIdx}" data-meal-idx="${mealIdx ?? 0}" aria-label="Wissel automatisch" title="Wissel automatisch" type="button">↻</button>
      <button class="eh-day-edit" data-action="edit-warm-day" data-day-idx="${dayIdx}" data-meal-idx="${mealIdx ?? 0}" aria-label="Handmatig kiezen" title="Handmatig kiezen" type="button">✎</button>
    `;
  } else if (type === 'fruit') {
    actions = `<button class="eh-day-swap" data-action="swap-fruit-day" data-day-idx="${dayIdx}" aria-label="Wissel" type="button">↻</button>`;
  }
  return `
    <div class="eh-week-row">
      <div class="eh-week-row-slot">${icon} <span>${escapeHtml(slotLabel)}</span></div>
      <div class="eh-week-row-title">${title}</div>
      <div class="eh-week-row-actions">${actions}</div>
    </div>
  `;
}

/* ============================================
   "Wijzig handmatig"-modal: pantry-builder + suggestie + vervang.
   Vervangt de oude "Bouw nu"-tab. Wordt opgeroepen vanuit Weekschema-tab
   per warm-meal slot.
============================================ */
function openBouwOverlay({ ctx, dayIdx, mealIdx, parentHost }) {
  const dietary = ctx.state.dietary || 'omnivoor';
  const knownAllergies = new Set(ctx.state.allergen_state?.known_allergies || []);
  const localPantry = makeEmptyPantry();
  let suggestion = null;

  const ov = document.createElement('div');
  ov.className = 'eh-hub-overlay';
  ov.innerHTML = `<div class="eh-hub-overlay-inner" data-overlay-inner></div>`;
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  document.body.appendChild(ov);
  document.body.classList.add('modal-open');

  function close() {
    document.body.classList.remove('modal-open');
    ov.remove();
  }

  function rerender() {
    const slotLabel = ctx.weekPlan.days[dayIdx].meals.length === 2
      ? (mealIdx === 0 ? 'Lunch' : 'Avondmaal')
      : 'Warme maaltijd';
    const dayLabel = formatDayLabel(dayIdx);
    const inner = ov.querySelector('[data-overlay-inner]');
    inner.innerHTML = `
      <div class="eh-hub-modal">
        <div class="eh-hub-head">
          <div class="eh-hub-head-main">
            <h2>${escapeHtml(slotLabel)} · ${escapeHtml(dayLabel)}</h2>
            <div class="eh-hub-sub">Kies wat je in huis hebt — wij stellen een maaltijd voor.</div>
          </div>
          <button class="eh-close" data-action="close" aria-label="Sluiten">×</button>
        </div>
        <div class="eh-hub-body">
          <div class="eh-bouw">
            ${CATEGORY_ORDER.map((c) => renderPantrySection(c, localPantry[c], dietary, knownAllergies)).join('')}
            <div class="eh-bouw-actions">
              <button class="eh-hero-btn primary" data-action="bouw-suggest" type="button">🍲 Stel maaltijd voor</button>
              <button class="eh-hero-btn ghost"   data-action="bouw-clear" type="button">Wissen</button>
            </div>
            ${suggestion ? renderBouwSuggestion(suggestion) : ''}
            ${suggestion && !(suggestion.missing || []).length ? `
              <button class="eh-hero-btn primary eh-bouw-replace-btn" data-action="bouw-replace" type="button">
                ✓ Vervang ${escapeHtml(slotLabel)} ${escapeHtml(dayLabel)}
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
    bindLocal();
  }

  function bindLocal() {
    const inner = ov.querySelector('[data-overlay-inner]');
    inner.querySelectorAll('[data-action="close"]').forEach((b) => b.addEventListener('click', close));

    inner.querySelectorAll('[data-pantry-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cat = btn.dataset.pantryCat;
        const key = btn.dataset.pantryKey;
        if (localPantry[cat].has(key)) localPantry[cat].delete(key);
        else localPantry[cat].add(key);
        btn.classList.toggle('selected');
      });
    });

    inner.querySelector('[data-action="bouw-suggest"]')?.addEventListener('click', () => {
      const excludeKeys = [];
      for (const c of CATEGORY_ORDER) {
        for (const it of (INGREDIENTS[c] || [])) {
          if (!localPantry[c].has(it.key)) excludeKeys.push(it.key);
        }
      }
      const result = generateWeekPlan({
        dietary,
        avoidAllergens: ctx.state.allergen_state?.known_allergies || [],
        daysCount: 1,
        mealsPerDay: 1,
        excludeKeys,
        seed: `${ctx.child.id}:bouw:${Date.now()}`,
      });
      suggestion = result.days[0]?.meals[0] || null;
      rerender();
    });

    inner.querySelector('[data-action="bouw-clear"]')?.addEventListener('click', () => {
      for (const c of CATEGORY_ORDER) localPantry[c].clear();
      suggestion = null;
      rerender();
    });

    inner.querySelector('[data-action="bouw-replace"]')?.addEventListener('click', () => {
      if (!suggestion) return;
      ctx.weekPlan.days[dayIdx].meals[mealIdx] = suggestion;
      showToast('Maaltijd vervangen.', 'success');
      close();
      // Re-render parent (weekschema)
      render(parentHost, ctx);
    });
  }

  rerender();
}

function bindWeek(overlay, ctx) {
  // Hele week opnieuw genereren (warm + fruit + ontbijt)
  overlay.querySelector('[data-action="regen-all-weeks"]')?.addEventListener('click', async () => {
    const newSeed = `${ctx.child.id}:w${Date.now()}`;
    try {
      ctx.state = await patchEhState(ctx.child.id, { current_week_seed: newSeed });
      ctx.weekPlan = null;
      ctx.fruitWeek = null;
      ctx.breakfastWeek = null;
      render(overlay, ctx);
    } catch (err) {
      console.error('[Hub] regen all weeks failed', err);
      showToast('Kon nieuwe week niet genereren.', 'error');
    }
  });

  // Per warm-meal automatisch wisselen
  overlay.querySelectorAll('[data-action="swap-day"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.dayIdx, 10);
      swapDayMeal(overlay, ctx, idx);
    });
  });

  // Per warm-meal handmatig kiezen (opent bouw-overlay)
  overlay.querySelectorAll('[data-action="edit-warm-day"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dayIdx = parseInt(btn.dataset.dayIdx, 10);
      const mealIdx = parseInt(btn.dataset.mealIdx, 10) || 0;
      openBouwOverlay({ ctx, dayIdx, mealIdx, parentHost: overlay });
    });
  });

  // Per fruit-meal swap
  overlay.querySelectorAll('[data-action="swap-fruit-day"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.dayIdx, 10);
      swapFruitDay(overlay, ctx, idx);
    });
  });

  // Dietary-switcher
  overlay.querySelector('[data-action="change-dietary"]')?.addEventListener('change', async (e) => {
    const newDietary = e.target.value;
    if (newDietary === ctx.state.dietary) return;
    try {
      ctx.state = await patchEhState(ctx.child.id, { dietary: newDietary });
      ctx.weekPlan = null;
      ctx.fruitWeek = null;
      render(overlay, ctx);
      showToast(`Dieet aangepast naar ${newDietary}.`, 'success');
    } catch (err) {
      showToast('Kon dieet niet aanpassen.', 'error');
    }
  });
}

function swapFruitDay(overlay, ctx, dayIdx) {
  if (!ctx.fruitWeek) return;
  // Hergenereer 1 fruit-meal met aparte sub-seed
  // (niet aan generateFruitMeal gekoppeld → inline via week-builder met excludes)
  const used = ctx.fruitWeek
    .filter((_, i) => i !== dayIdx)
    .flatMap((m) => [m.ingredients.fruit?.key, m.ingredients.groen?.key])
    .filter(Boolean);
  // Lazy import om circulair te vermijden
  import('../eersteHapjesMealGenerator.js?v=2.30.0').then((mod) => {
    const newMeal = mod.generateFruitMeal({
      avoidAllergens: ctx.state.allergen_state?.known_allergies || [],
      excludeKeys: used,
      seed: `${ctx.child.id}:fruit-swap:${dayIdx}:${Date.now()}`,
    });
    ctx.fruitWeek[dayIdx] = newMeal;
    render(overlay, ctx);
  });
}


/* ============================================
   Sub-tab: BOUW NU
   Pantry-modus: ouder selecteert wat in huis is, generator bouwt
   1-3 maaltijden uit alleen die ingrediënten.
============================================ */
function renderBouw(ctx) {
  if (!ctx.pantry) ctx.pantry = makeEmptyPantry();

  // Filter ingrediënten per categorie volgens huidig dieet + bekende allergieën
  const dietary = ctx.state.dietary || 'omnivoor';
  const knownAllergies = new Set(ctx.state.allergen_state?.known_allergies || []);

  return `
    <div class="eh-bouw">
      <div class="eh-bouw-intro">
        <p>Vink aan wat je in huis hebt. Wij stellen een maaltijd voor die past bij ${escapeHtml(ctx.child.name || 'je kindje')}'s dieet (${escapeHtml(dietary)}) en allergeen-profiel.</p>
      </div>

      ${CATEGORY_ORDER.map((catKey) => renderPantrySection(catKey, ctx.pantry[catKey], dietary, knownAllergies)).join('')}

      <div class="eh-bouw-actions">
        <button class="eh-hero-btn primary" data-action="bouw-suggest" type="button">🍲 Stel maaltijd voor</button>
        <button class="eh-hero-btn ghost" data-action="bouw-clear" type="button">Wissen</button>
      </div>

      ${ctx.pantrySuggestion ? renderBouwSuggestion(ctx.pantrySuggestion) : ''}
    </div>
  `;
}

function renderPantrySection(catKey, selectedSet, dietary, knownAllergies) {
  const cat = CATEGORIES[catKey];
  const items = (INGREDIENTS[catKey] || []).filter((it) => {
    if (Array.isArray(it.dietary) && !it.dietary.includes(dietary)) return false;
    if (catKey === 'vlees_vis' && (dietary === 'vegetarisch' || dietary === 'vegan')) return false;
    if (it.allergens && it.allergens.some((a) => knownAllergies.has(a))) return false;
    return true;
  });
  if (items.length === 0) return '';

  return `
    <div class="eh-pantry-section">
      <h5>${cat.icon} ${escapeHtml(cat.label)}</h5>
      <div class="eh-pantry-chips">
        ${items.map((it) => `
          <button
            class="eh-pantry-chip ${selectedSet.has(it.key) ? 'selected' : ''}"
            data-pantry-cat="${catKey}"
            data-pantry-key="${escapeHtml(it.key)}"
            type="button">
            ${escapeHtml(it.name)}
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

function renderBouwSuggestion(meal) {
  const ing = meal.ingredients;
  const ratio = meal.ratioLabel || '';
  const warnings = meal.warnings || [];
  const missing = meal.missing || [];

  if (missing.length > 0) {
    return `
      <div class="eh-bouw-suggestion warn">
        <h4>Onvoldoende ingrediënten</h4>
        <p>Je hebt nog niet uit elke categorie iets aangevinkt: <strong>${escapeHtml(missing.join(', '))}</strong>.</p>
        <p class="eh-meta">Tip: vink uit elke categorie minstens 1 item aan.</p>
      </div>
    `;
  }

  return `
    <div class="eh-bouw-suggestion">
      <h4>🍲 Voorgestelde maaltijd</h4>
      <div class="eh-bouw-title">${renderIngredientTitle(ing)}</div>
      <p class="eh-bouw-ratio">${escapeHtml(ratio)}</p>
      ${renderEmojiRow(ing).replace('eh-meal-emojis', 'eh-meal-emojis bouw')}
      ${warnings.length > 0 ? `
        <div class="eh-bouw-warnings">
          ${warnings.map((w) => `<div class="eh-bouw-warn">⚠ ${escapeHtml(w.ingredient)}${w.note ? ` — ${escapeHtml(w.note)}` : ''}</div>`).join('')}
        </div>
      ` : ''}
      <button class="eh-hero-btn primary" data-action="bouw-log" type="button">✓ Naar logboek</button>
    </div>
  `;
}

function bindBouw(overlay, ctx) {
  // Pantry-chip toggle
  overlay.querySelectorAll('[data-pantry-key]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.pantryCat;
      const key = btn.dataset.pantryKey;
      if (!ctx.pantry[cat]) ctx.pantry[cat] = new Set();
      if (ctx.pantry[cat].has(key)) ctx.pantry[cat].delete(key);
      else ctx.pantry[cat].add(key);
      btn.classList.toggle('selected');
    });
  });

  overlay.querySelector('[data-action="bouw-suggest"]')?.addEventListener('click', () => {
    runBouwSuggestion(overlay, ctx);
  });

  overlay.querySelector('[data-action="bouw-clear"]')?.addEventListener('click', () => {
    ctx.pantry = makeEmptyPantry();
    ctx.pantrySuggestion = null;
    render(overlay, ctx);
  });

  overlay.querySelector('[data-action="bouw-log"]')?.addEventListener('click', async () => {
    if (!ctx.pantrySuggestion) return;
    // Voor v1: opent mealLogModal; ouder vult zelf in op basis van suggestie hierboven.
    await openMealLogFromHub(ctx);
    ctx.meals = null;
    await reloadAndRender(overlay, ctx);
  });
}

function makeEmptyPantry() {
  const out = {};
  for (const cat of CATEGORY_ORDER) out[cat] = new Set();
  return out;
}

function runBouwSuggestion(overlay, ctx) {
  // Build excludeKeys = alle ingrediënten NIET in pantry
  const excludeKeys = [];
  for (const cat of CATEGORY_ORDER) {
    const have = ctx.pantry[cat] || new Set();
    for (const it of (INGREDIENTS[cat] || [])) {
      if (!have.has(it.key)) excludeKeys.push(it.key);
    }
  }

  const result = generateWeekPlan({
    dietary: ctx.state.dietary,
    avoidAllergens: ctx.state.allergen_state?.known_allergies || [],
    daysCount: 1,
    mealsPerDay: 1,
    excludeKeys,
    seed: `${ctx.child.id}:bouw:${Date.now()}`,
  });

  ctx.pantrySuggestion = result.days[0]?.meals[0] || null;
  render(overlay, ctx);
}

/* ============================================
   Helpers — week-plan + dose recording
============================================ */
function buildWeekPlanIfNeeded(ctx) {
  if (ctx.weekPlan) return;
  const ageMonths = computeAgeMonths(ctx.child.birthdate);
  const allergenContext = buildAllergenContext(ctx.doses, ctx.state, ageMonths);
  ctx.weekPlan = generateWeekPlan({
    dietary: ctx.state.dietary,
    avoidAllergens: ctx.state.allergen_state?.known_allergies || [],
    daysCount: 7,
    mealsPerDay: ctx.state.meals_per_day,
    seed: ctx.state.current_week_seed || `${ctx.child.id}:init`,
    allergenContext,
  });
}

async function recordDoseAndRefresh(overlay, ctx, key, dose, reaction) {
  try {
    await createEhDose({
      child_id: ctx.child.id,
      allergen_key: key,
      dose_number: dose,
      reaction,
    });

    // Bij niet-geen → flow pauzeren
    if (reaction === 'mild' || reaction === 'ernstig') {
      await patchEhState(ctx.child.id, {
        allergen_state: {
          ...(ctx.state.allergen_state || {}),
          paused: true,
          paused_reason: reaction,
          paused_allergen: key,
        },
      });
      showToast(reaction === 'ernstig'
        ? 'Reactie genoteerd — flow gepauzeerd. Overweeg contact met een zorgverlener.'
        : 'Reactie genoteerd — flow gepauzeerd.', reaction === 'ernstig' ? 'error' : 'info');
    } else {
      showToast(`Dose ${dose} succesvol genoteerd ✓`, 'success');
    }

    await reloadAndRender(overlay, ctx);
  } catch (err) {
    console.error('[Hub] record dose failed', err);
    showToast(err.message || 'Kon dose niet opslaan.', 'error');
  }
}

async function openMealLogFromHub(ctx) {
  const known = ctx.state.allergen_state?.known_allergies || [];
  const childAllergens = known.map((k) => ({ allergen_key: k, status: 'vermijden' }));
  const todayMeals = (ctx.meals || []).filter((m) => m.eaten_at.slice(0, 10) === todayIso());
  const meal = await openMealLogModal({
    childId: ctx.child.id,
    childName: ctx.child.name,
    childBirthdate: ctx.child.birthdate,
    childAllergens,
    todayMeals,
  });
  if (meal) showToast('Maaltijd opgeslagen.', 'success');
  // Caller doet de refresh
}

async function ensureMeals(ctx) {
  const fromIso = new Date(Date.now() - 30 * 86400000).toISOString();
  const res = await getMealsForChild(ctx.child.id, { from: fromIso });
  ctx.meals = res.ok ? (res.data?.meals || []) : [];
}

async function ensureSymptoms(ctx) {
  const fromIso = new Date(Date.now() - 30 * 86400000).toISOString();
  const res = await getSymptomsForChild(ctx.child.id, { from: fromIso });
  ctx.symptoms = res.ok ? (res.data?.symptoms || []) : [];
}

/* ============================================
   Helpers — afgeleide allergen-state
============================================ */
function buildAllergenSummary(doses, state, ageMonths) {
  const dosesByKey = {};
  for (const d of doses) {
    if (!dosesByKey[d.allergen_key]) dosesByKey[d.allergen_key] = [];
    dosesByKey[d.allergen_key].push(d);
  }
  const known = new Set(state.allergen_state?.known_allergies || []);
  const paused = !!state.allergen_state?.paused;
  const pausedKey = state.allergen_state?.paused_allergen || null;

  return ALLERGEN_FLOW.map((a) => {
    const ds = dosesByKey[a.key] || [];
    const successCount = ds.filter((d) => d.reaction === 'geen').length;
    const isComplete = successCount >= (a.repeatTarget || 3);
    const isAllergic = known.has(a.key);
    const isLockedAge = a.ageCondition.introFrom && ageMonths < a.ageCondition.introFrom;
    const isPaused = paused && pausedKey === a.key;

    let status;
    if (isAllergic)        status = 'allergisch';
    else if (isComplete)   status = 'veilig';
    else if (isPaused)     status = 'paused';
    else if (isLockedAge)  status = 'locked-age';
    else if (successCount > 0) status = 'in-progress';
    else                   status = 'wacht';

    return {
      ...a,
      status,
      doses: ds,
      successCount,
      target: a.repeatTarget || 3,
    };
  });
}

/* ============================================
   Render helpers (modal-shell)
============================================ */
function renderHeader(ctx, title, _subtitle) {
  const closeBtn = ctx?.isInline
    ? ''
    : `<button class="eh-close" data-action="close" aria-label="Sluiten">×</button>`;
  return `
    <div class="eh-hub-head">
      <div class="eh-hub-head-main">
        <h2>${escapeHtml(title)}</h2>
        ${ctx?.state ? renderPhaseSelector(ctx) : ''}
      </div>
      ${closeBtn}
    </div>
  `;
}

function renderPhaseSelector(ctx) {
  const cur = ctx.state.current_phase;
  const ageMonths = computeAgeMonths(ctx.child.birthdate);
  // Filter: opties die niet bij de leeftijd horen worden uitgesloten.
  // - minAge: ouder moet ouder dan deze leeftijd zijn om de fase te kiezen
  // - maxAge: optie verdwijnt als kindje deze leeftijd voorbij is (bv. fase 0 niet meer voor > 7 mnd)
  const visible = PHASE_OPTIONS.filter((o) => {
    if (o.maxAge !== undefined && ageMonths >= o.maxAge) return false;
    return true;
  });
  return `
    <label class="eh-phase-pill" title="Wissel van fase — vooruit of achteruit">
      <span>📍</span>
      <select data-action="change-phase" class="eh-phase-select">
        ${visible.map((o) => {
          const allowed = ageMonths >= o.minAge;
          const labelSuffix = allowed ? '' : ` (${o.ageHint})`;
          return `<option value="${o.phase}" ${o.phase === cur ? 'selected' : ''} ${allowed ? '' : 'disabled'}>${escapeHtml(o.label + labelSuffix)}</option>`;
        }).join('')}
      </select>
    </label>
  `;
}

function renderLoading(_ctx) {
  return `<div class="eh-hub-modal"><div class="eh-hub-body"><p class="eh-meta">Laden…</p></div></div>`;
}

function renderError(msg, _ctx) {
  return `
    <div class="eh-hub-modal">
      <div class="eh-hub-body">
        <p class="eh-meta" style="color:var(--color-danger)">Er ging iets mis: ${escapeHtml(msg)}</p>
      </div>
    </div>
  `;
}

function setOverlayBody(overlay, html) {
  const inner = overlay.querySelector('[data-overlay-inner]');
  inner.innerHTML = html;
  inner.querySelectorAll('[data-action="close"]').forEach((btn) => {
    btn.addEventListener('click', () => closeOverlay(overlay));
  });
}

function createOverlay() {
  const ov = document.createElement('div');
  ov.className = 'eh-hub-overlay';
  ov.innerHTML = `<div class="eh-hub-overlay-inner" data-overlay-inner></div>`;
  ov.addEventListener('click', (e) => { if (e.target === ov) closeOverlay(ov); });
  return ov;
}

function closeOverlay(overlay) {
  document.body.classList.remove('modal-open');
  overlay.remove();
}

/* ============================================
   Helpers — tips, fase-2, swap-day
============================================ */

/**
 * Genereer een lijstje aan tips voor de roadmap-tab.
 * Elk tip heeft: { icon, label, sub, action, key? }
 */
function buildTips(ctx, summary) {
  const tips = [];
  const a = ctx.state.allergen_state || {};
  const isPaused = !!a.paused;

  // 1. Volgende intro-dose klaar (in-progress + cooldown verstreken)
  if (!isPaused) {
    const inProgress = summary.find((s) => s.status === 'in-progress');
    if (inProgress) {
      const lastDose = (inProgress.doses || [])
        .map((d) => d.intro_date)
        .filter(Boolean)
        .sort()
        .pop();
      const days = lastDose ? daysBetween(lastDose, todayIso()) : Infinity;
      if (days >= ALLERGEN_COOLDOWN_DAYS) {
        tips.push({
          icon: inProgress.icon,
          label: `Tijd voor volgende dose: ${inProgress.label}`,
          sub: `${inProgress.successCount}/${inProgress.target} · ${days} dagen sinds vorige`,
          action: 'open-allergen',
          key: inProgress.key,
        });
      }
    }
  }

  // 2. Logboek rustig — geen logs in 5 dagen
  if (Array.isArray(ctx.meals)) {
    const lastMeal = ctx.meals[0];
    if (!lastMeal) {
      tips.push({
        icon: '🍽️',
        label: 'Nog geen maaltijd gelogd',
        sub: 'Logboek is leeg — log de eerste maaltijd om patronen te zien',
        action: 'open-logboek',
      });
    } else {
      const days = daysBetween(lastMeal.eaten_at.slice(0, 10), todayIso());
      if (days >= 5) {
        tips.push({
          icon: '🍽️',
          label: 'Logboek is rustig',
          sub: `${days} dagen sinds laatste log — hoe gaat het?`,
          action: 'open-logboek',
        });
      }
    }
  }

  // 3. Klaar voor Fase 2? — alleen tonen als prompt nog niet bovenaan staat
  // (de prompt zelf staat al bovenaan; hier is de tip overbodig)

  return tips;
}

function handleTipAction(overlay, ctx, action, key) {
  if (action === 'open-allergen') {
    ctx.selectedAllergen = key;
    ctx.activeTab = 'allergenen';
    render(overlay, ctx);
  } else if (action === 'open-logboek') {
    ctx.activeTab = 'logboek';
    if (ctx.meals === null) ensureMeals(ctx).then(() => render(overlay, ctx));
    else render(overlay, ctx);
  }
}

/**
 * Heuristiek voor fase-2-prompt (fase 1 → 2 = fruit):
 * - Fase 1 actief
 * - Leeftijd ≥ 8 maanden
 * - Minstens 5 unieke meal-log-dagen in laatste 14 dagen
 */
function isReadyForPhase2(ctx) {
  if (ctx.state.current_phase !== 1) return false;
  const ageMonths = computeAgeMonths(ctx.child.birthdate);
  if (ageMonths < 8) return false;
  if (ctx.meals === null) return false;
  const cutoff = new Date(Date.now() - 14 * 86400000).toISOString();
  const recent = (ctx.meals || []).filter((m) => m.eaten_at >= cutoff);
  const uniqueDays = new Set(recent.map((m) => m.eaten_at.slice(0, 10)));
  return uniqueDays.size >= 5;
}

/**
 * Heuristiek voor fase-3-prompt (fase 2 → 3 = ontbijt):
 * - Fase 2 actief
 * - Leeftijd ≥ 10 maanden
 */
function isReadyForPhase3(ctx) {
  if (ctx.state.current_phase !== 2) return false;
  const ageMonths = computeAgeMonths(ctx.child.birthdate);
  return ageMonths >= 10;
}

/** Vervang 1 dag in de week-plan met een nieuwe gegenereerde maaltijd. */
function swapDayMeal(overlay, ctx, dayIndex) {
  buildWeekPlanIfNeeded(ctx);
  if (!ctx.weekPlan?.days?.[dayIndex]) return;
  const subSeed = `${ctx.state.current_week_seed || ctx.child.id}:swap${dayIndex}:${Date.now()}`;
  const single = generateWeekPlan({
    dietary: ctx.state.dietary,
    avoidAllergens: ctx.state.allergen_state?.known_allergies || [],
    daysCount: 1,
    mealsPerDay: ctx.state.meals_per_day,
    seed: subSeed,
  });
  const newMeal = single.days[0]?.meals[0];
  if (newMeal) {
    ctx.weekPlan.days[dayIndex].meals[0] = newMeal;
    render(overlay, ctx);
  }
}

function daysBetween(isoA, isoB) {
  const a = new Date(isoA + 'T00:00:00Z').getTime();
  const b = new Date(isoB + 'T00:00:00Z').getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
}

/* ============================================
   Date / format helpers
============================================ */
function computeAgeMonths(birthdate) {
  if (!birthdate) return 6;
  const b = new Date(birthdate);
  const now = new Date();
  return Math.max(0, (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth()));
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDayLabel(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  if (offset === 0) return 'Vandaag';
  if (offset === 1) return 'Morgen';
  return `${DAY_NAMES[d.getDay()]} · ${d.getDate()}`;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  return d.toLocaleDateString('nl-BE', { weekday: 'short', day: '2-digit', month: 'short' });
}
