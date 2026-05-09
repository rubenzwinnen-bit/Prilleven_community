/* ============================================
   EERSTE HAPJES — AGENDA / HISTORIEK (batch 4)
   Chronologisch overzicht van alle events voor één kindje:
   - meal_logs (eaten_at)
   - child_symptoms (occurred_at)
   - allergen_intro_logs (intro_date)
   Items worden gegroepeerd per dag (desc).

   Read-only lijst — bewerken gebeurt op de Vandaag-pagina of via
   de allergenen-tijdlijn. Detail-klik scrollt later eventueel naar
   de relevante card; voor v1 alleen weergave.
============================================ */

import { escapeHtml } from '../utils.js?v=2.21.0';
import {
  getMealsForChild,
  getSymptomsForChild,
  getAllergenIntros,
} from '../eersteHapjesApi.js?v=2.21.0';
import { getSymptomMeta } from '../content/eersteHapjes-symptoms.js?v=2.21.0';

const DEFAULT_DAYS = 90;

const MEAL_TYPE_LABEL = {
  ontbijt: 'Ontbijt',
  lunch:   'Lunch',
  diner:   'Diner',
  snack:   'Snack',
};

const REACTION_EMOJI_FALLBACK = {
  positief:  '+',
  neutraal:  '~',
  afwijzing: '-',
};

const INTRO_REACTION_LABEL = {
  geen:     'Geen reactie',
  mild:     'Mild',
  matig:    'Matig',
  heftig:   'Heftig',
  onbekend: 'Onbekend',
};

const RANGES = [
  { key: '7',  label: 'Week',  days: 7  },
  { key: '30', label: 'Maand', days: 30 },
  { key: '90', label: '3 maanden', days: 90 },
];

/**
 * Toon de agenda-modal voor één kindje.
 * @param {object} opts
 * @param {string} opts.childId
 * @param {string} opts.childName
 * @param {object} [opts.initialData] — pre-fetched 7d data uit eersteHapjes-state
 *   { meals, symptoms, intros } — zorgt dat week-view instant rendert.
 */
export function openAgendaModal({ childId, childName, initialData = null }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay eh-agenda-overlay';
    overlay.innerHTML = `
      <div class="modal eh-agenda-modal">
        <header class="eh-agenda-head">
          <h2>Agenda voor ${escapeHtml(childName || 'je kindje')}</h2>
          <div class="eh-agenda-ranges" data-ranges>
            ${RANGES.map((r, i) => `
              <button type="button" class="eh-agenda-range ${i === 0 ? 'selected' : ''}"
                      data-range="${r.key}">${escapeHtml(r.label)}</button>
            `).join('')}
          </div>
        </header>

        <div class="eh-agenda-filters">
          <label><input type="checkbox" data-filter="meal" checked> Maaltijden</label>
          <label><input type="checkbox" data-filter="symptom" checked> Symptomen</label>
          <label><input type="checkbox" data-filter="intro" checked> Allergeen-intro's</label>
        </div>

        <div class="eh-agenda-body" data-body>
          <div class="eh-agenda-loading">Laden…</div>
        </div>

        <footer class="eh-agenda-footer">
          <button class="btn btn-primary" data-action="close">Sluiten</button>
        </footer>
      </div>
    `;
    document.body.appendChild(overlay);

    const bodyEl = overlay.querySelector('[data-body]');
    // Cache per range (in dagen) → events-array. Wordt gevuld bij eerste fetch.
    const cachedByRange = {};
    let activeDays = 7; // default: week
    let allEvents = []; // gefilterd op activeDays + gesorteerd

    // Als initialData mee gegeven (uit eersteHapjes-state, dekt 7d): zet
    // direct in cache zodat week-view instant verschijnt.
    if (initialData) {
      cachedByRange[7] = buildEventsFromData(initialData, isoDateMinusDays(7));
    }

    initRange(7);

    async function initRange(days) {
      activeDays = days;
      // Markeer actieve range-knop
      overlay.querySelectorAll('[data-range]').forEach((btn) => {
        btn.classList.toggle('selected', btn.dataset.range === String(days));
      });

      if (cachedByRange[days]) {
        allEvents = cachedByRange[days];
        render();
        return;
      }

      bodyEl.innerHTML = `<div class="eh-agenda-loading">Laden…</div>`;
      const fromIso = isoDateMinusDays(days);
      const [mealsRes, sympRes, introsRes] = await Promise.all([
        getMealsForChild(childId, { from: fromIso }),
        getSymptomsForChild(childId, { from: fromIso }),
        getAllergenIntros(childId),
      ]);
      const data = {
        meals: mealsRes.ok ? (mealsRes.data?.meals || []) : [],
        symptoms: sympRes.ok ? (sympRes.data?.symptoms || []) : [],
        intros: introsRes.ok ? (introsRes.data?.intros || []) : [],
      };
      cachedByRange[days] = buildEventsFromData(data, fromIso);
      allEvents = cachedByRange[days];
      render();
    }

    function render() {
      const activeTypes = new Set(
        Array.from(overlay.querySelectorAll('[data-filter]:checked')).map((cb) => cb.dataset.filter)
      );
      const filtered = allEvents.filter((e) => activeTypes.has(e.type));
      if (filtered.length === 0) {
        bodyEl.innerHTML = `<div class="eh-agenda-empty">Nog niets gelogd voor de gekozen filter.</div>`;
        return;
      }

      // Groepeer per dag (YYYY-MM-DD)
      const groups = new Map();
      for (const e of filtered) {
        if (!groups.has(e.day)) groups.set(e.day, []);
        groups.get(e.day).push(e);
      }

      const today = isoDateMinusDays(0);
      const yesterday = isoDateMinusDays(1);

      bodyEl.innerHTML = Array.from(groups.entries()).map(([day, events]) => {
        let dayLabel;
        if (day === today) dayLabel = 'Vandaag';
        else if (day === yesterday) dayLabel = 'Gisteren';
        else dayLabel = formatDayLabel(day);

        return `
          <section class="eh-agenda-day">
            <h3 class="eh-agenda-day-label">${escapeHtml(dayLabel)}</h3>
            <ul class="eh-agenda-events">
              ${events.map((e) => renderEvent(e)).join('')}
            </ul>
          </section>
        `;
      }).join('');
    }

    overlay.querySelectorAll('[data-filter]').forEach((cb) => {
      cb.addEventListener('change', render);
    });
    overlay.querySelectorAll('[data-range]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const days = Number(btn.dataset.range);
        if (days !== activeDays) initRange(days);
      });
    });
    overlay.querySelector('[data-action="close"]').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape' && document.body.contains(overlay)) {
        document.removeEventListener('keydown', escHandler);
        close();
      }
    });

    function close() {
      overlay.remove();
      resolve();
    }
  });
}

/* ============================================
   Event mapping
============================================ */
function buildEventsFromData(data, fromIso) {
  const fromMs = new Date(fromIso).getTime();
  return [
    ...(data.meals || []).map(toMealEvent),
    ...(data.symptoms || []).map(toSymptomEvent),
    ...(data.intros || []).map(toIntroEvent).filter((e) => e && e.tsMs >= fromMs),
  ].filter(Boolean).sort((a, b) => b.tsMs - a.tsMs);
}

function toMealEvent(m) {
  if (!m.eaten_at) return null;
  const ts = new Date(m.eaten_at);
  if (Number.isNaN(ts.getTime())) return null;
  const typeLbl = MEAL_TYPE_LABEL[m.meal_type] || m.meal_type || 'Maaltijd';
  const food = m.food_text || m.recipe_name || (m.recipe_id ? 'Recept' : '—');
  const reactionPart = m.reaction ? ` (${REACTION_EMOJI_FALLBACK[m.reaction] || m.reaction})` : '';
  return {
    type: 'meal',
    tsMs: ts.getTime(),
    day: toDayIso(ts),
    time: formatTime(ts),
    badge: 'Maaltijd',
    label: `${typeLbl}: ${food}${reactionPart}`,
    sub: m.notes || (m.amount ? `Hoeveelheid: ${m.amount}` : ''),
  };
}

function toSymptomEvent(s) {
  if (!s.occurred_at) return null;
  const ts = new Date(s.occurred_at);
  if (Number.isNaN(ts.getTime())) return null;
  const meta = getSymptomMeta(s.symptom_type);
  const label = meta?.label || s.symptom_type || 'Symptoom';
  const severity = s.severity ? ` · ${s.severity}` : '';
  return {
    type: 'symptom',
    tsMs: ts.getTime(),
    day: toDayIso(ts),
    time: formatTime(ts),
    badge: 'Symptoom',
    label: `${label}${severity}`,
    sub: s.notes || '',
    severe: s.severity === 'matig' || s.severity === 'heftig',
  };
}

function toIntroEvent(i) {
  if (!i.intro_date) return null;
  // intro_date is een DATE (geen tijd) — gebruik 12:00 UTC als sortering
  const ts = new Date(i.intro_date + 'T12:00:00Z');
  if (Number.isNaN(ts.getTime())) return null;
  const reactionLbl = INTRO_REACTION_LABEL[i.reaction] || i.reaction || 'Geen reactie';
  return {
    type: 'intro',
    tsMs: ts.getTime(),
    day: i.intro_date,
    time: '',
    badge: 'Allergeen',
    label: `${capitalize(i.allergen_key)}: ${reactionLbl}`,
    sub: i.notes || '',
    severe: i.reaction === 'matig' || i.reaction === 'heftig',
  };
}

function renderEvent(e) {
  return `
    <li class="eh-agenda-event ${e.type === 'symptom' || e.type === 'intro' ? 'has-badge-' + e.type : ''} ${e.severe ? 'is-severe' : ''}">
      <span class="eh-agenda-time">${escapeHtml(e.time || '—')}</span>
      <span class="eh-agenda-badge eh-agenda-badge-${escapeHtml(e.type)}">${escapeHtml(e.badge)}</span>
      <span class="eh-agenda-label">${escapeHtml(e.label)}</span>
      ${e.sub ? `<span class="eh-agenda-sub">${escapeHtml(e.sub)}</span>` : ''}
    </li>
  `;
}

/* ============================================
   Date helpers
============================================ */
function toDayIso(d) {
  return d.toISOString().slice(0, 10);
}
function formatTime(d) {
  return d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
}
function formatDayLabel(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
function isoDateMinusDays(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.toISOString();
}
function capitalize(s) {
  if (!s) return '';
  return s[0].toUpperCase() + s.slice(1);
}
