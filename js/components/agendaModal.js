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

import { escapeHtml } from '../utils.js?v=2.16.0';
import {
  getMealsForChild,
  getSymptomsForChild,
  getAllergenIntros,
} from '../eersteHapjesApi.js?v=2.16.0';
import { getSymptomMeta } from '../content/eersteHapjes-symptoms.js?v=2.16.0';

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

/**
 * Toon de agenda-modal voor één kindje.
 * @param {object} opts
 * @param {string} opts.childId
 * @param {string} opts.childName
 */
export function openAgendaModal({ childId, childName }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay eh-agenda-overlay';
    overlay.innerHTML = `
      <div class="modal eh-agenda-modal">
        <header class="eh-agenda-head">
          <h2>Agenda voor ${escapeHtml(childName || 'je kindje')}</h2>
          <p class="eh-agenda-sub">Alle gelogde maaltijden, symptomen en allergeen-intro's van de afgelopen ${DEFAULT_DAYS} dagen.</p>
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
    let allEvents = []; // gevuld na initial load

    init();

    async function init() {
      const fromIso = isoDateMinusDays(DEFAULT_DAYS);
      const [mealsRes, sympRes, introsRes] = await Promise.all([
        getMealsForChild(childId, { from: fromIso }),
        getSymptomsForChild(childId, { from: fromIso }),
        getAllergenIntros(childId),
      ]);

      const meals = mealsRes.ok ? (mealsRes.data?.meals || []) : [];
      const symps = sympRes.ok ? (sympRes.data?.symptoms || []) : [];
      const intros = introsRes.ok ? (introsRes.data?.intros || []) : [];

      allEvents = [
        ...meals.map(toMealEvent),
        ...symps.map(toSymptomEvent),
        ...intros.map(toIntroEvent).filter((e) => e && e.tsMs >= new Date(fromIso).getTime()),
      ].filter(Boolean).sort((a, b) => b.tsMs - a.tsMs);

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
