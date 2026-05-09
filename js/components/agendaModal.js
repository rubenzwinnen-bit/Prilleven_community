/* ============================================
   EERSTE HAPJES — AGENDA / KALENDER
   Kalender-overzicht van alle events voor één kindje:
   - meal_logs (eaten_at)
   - child_symptoms (occurred_at)
   - allergen_intro_logs (intro_date)

   Twee views:
   - Week: 7 kolommen ma-zo, events stapelend onder elke dag
   - Maand: 7×N grid, kleine cellen met gekleurde dots per type
     (max 3 zichtbaar, dan +N indicator). Klik op cel → week-view
     rond die dag.

   Navigatie: ◀ Vorige | <range-label> | Volgende ▶ + "Vandaag"-knop.
   Cursor wordt bewaard als anker; week/maand-view berekent zijn span
   t.o.v. die cursor.
============================================ */

import { escapeHtml } from '../utils.js?v=2.24.0';
import {
  getMealsForChild,
  getSymptomsForChild,
  getAllergenIntros,
} from '../eersteHapjesApi.js?v=2.24.0';
import { getSymptomMeta } from '../content/eersteHapjes-symptoms.js?v=2.24.0';

const FETCH_DAYS_BACK = 90;

const MEAL_TYPE_LABEL = {
  ontbijt: 'Ontbijt',
  lunch:   'Lunch',
  diner:   'Diner',
  snack:   'Snack',
};

const REACTION_FALLBACK = {
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

const WEEKDAY_SHORT = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
const WEEKDAY_LONG = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];
const MONTH_LONG = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

/**
 * @param {object} opts
 * @param {string} opts.childId
 * @param {string} opts.childName
 * @param {object} [opts.initialData] — pre-fetched 7d data uit eersteHapjes-state
 */
export function openAgendaModal({ childId, childName, initialData = null }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay eh-agenda-overlay';
    overlay.innerHTML = `
      <div class="modal eh-agenda-modal">
        <header class="eh-agenda-head">
          <h2>Agenda voor ${escapeHtml(childName || 'je kindje')}</h2>
          <div class="eh-agenda-views" data-views>
            <button type="button" class="eh-agenda-view selected" data-view="week">Week</button>
            <button type="button" class="eh-agenda-view" data-view="month">Maand</button>
          </div>
        </header>

        <div class="eh-agenda-nav">
          <button class="eh-agenda-nav-btn" data-nav="prev" aria-label="Vorige">◀</button>
          <span class="eh-agenda-nav-label" data-nav-label>—</span>
          <button class="eh-agenda-nav-btn" data-nav="next" aria-label="Volgende">▶</button>
          <button class="eh-agenda-today-btn" data-nav="today" type="button">Vandaag</button>
        </div>

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
    const navLabelEl = overlay.querySelector('[data-nav-label]');

    let view = 'week';            // 'week' | 'month'
    let cursor = startOfDay(new Date()); // anker — zit altijd binnen huidige range
    let allEvents = [];           // gefetcht 1× bij open (laatste 90d)
    let dataReady = false;

    // Initial fetch — 1 keer voor heel het modal-leven
    initialFetch();

    async function initialFetch() {
      // initialData is meestal "afgelopen 7d" — niet genoeg voor maand-view,
      // dus altijd full fetch doen. Initial-data alleen tonen als snel-startweergave
      // tot de rest binnen is.
      if (initialData) {
        allEvents = buildEventsFromData(initialData);
        render();
      }
      const fromIso = isoDateMinusDays(FETCH_DAYS_BACK);
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
      allEvents = buildEventsFromData(data);
      dataReady = true;
      render();
    }

    function render() {
      // Update nav-label en views-toggle
      navLabelEl.textContent = formatRangeLabel(view, cursor);
      overlay.querySelectorAll('[data-view]').forEach((btn) => {
        btn.classList.toggle('selected', btn.dataset.view === view);
      });

      const activeTypes = new Set(
        Array.from(overlay.querySelectorAll('[data-filter]:checked')).map((cb) => cb.dataset.filter)
      );
      const filteredEvents = allEvents.filter((e) => activeTypes.has(e.type));

      if (view === 'week') {
        bodyEl.innerHTML = renderWeek(cursor, filteredEvents);
        bindWeekHandlers();
      } else {
        bodyEl.innerHTML = renderMonth(cursor, filteredEvents);
        bindMonthHandlers();
      }
    }

    function bindWeekHandlers() {
      // Klik op een event — voor v2 alleen toon/no-op
      // (uitbreidbaar naar dag-detail of edit)
    }

    function bindMonthHandlers() {
      bodyEl.querySelectorAll('[data-day]').forEach((cell) => {
        cell.addEventListener('click', () => {
          const day = cell.dataset.day; // YYYY-MM-DD
          if (!day) return;
          cursor = startOfDay(new Date(day + 'T12:00:00Z'));
          view = 'week';
          render();
        });
      });
    }

    // Filters
    overlay.querySelectorAll('[data-filter]').forEach((cb) => {
      cb.addEventListener('change', render);
    });

    // View-toggle
    overlay.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.view;
        if (v && v !== view) {
          view = v;
          render();
        }
      });
    });

    // Navigatie
    overlay.querySelector('[data-nav="prev"]').addEventListener('click', () => {
      cursor = view === 'week' ? addDays(cursor, -7) : addMonths(cursor, -1);
      render();
    });
    overlay.querySelector('[data-nav="next"]').addEventListener('click', () => {
      cursor = view === 'week' ? addDays(cursor, 7) : addMonths(cursor, 1);
      render();
    });
    overlay.querySelector('[data-nav="today"]').addEventListener('click', () => {
      cursor = startOfDay(new Date());
      render();
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
   Render helpers — week
============================================ */
function renderWeek(cursor, events) {
  const weekStart = startOfWeek(cursor); // maandag
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    days.push(d);
  }
  const today = toDayIso(new Date());

  // Events groeperen per dag-iso
  const byDay = new Map();
  for (const e of events) {
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day).push(e);
  }

  return `
    <div class="eh-cal eh-cal-week">
      ${days.map((d) => {
        const iso = toDayIso(d);
        const isToday = iso === today;
        const dayEvents = byDay.get(iso) || [];
        return `
          <div class="eh-cal-day ${isToday ? 'is-today' : ''}">
            <div class="eh-cal-day-head">
              <span class="eh-cal-day-name">${WEEKDAY_SHORT[i7(d)]}</span>
              <span class="eh-cal-day-num">${d.getDate()}</span>
            </div>
            <div class="eh-cal-day-events">
              ${dayEvents.length === 0
                ? `<span class="eh-cal-day-empty">·</span>`
                : dayEvents.map(renderWeekEvent).join('')
              }
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderWeekEvent(e) {
  const sub = e.sub ? ` · ${e.sub}` : '';
  const time = e.time ? `<span class="eh-cal-event-time">${escapeHtml(e.time)}</span>` : '';
  const title = `${e.label}${sub}`;
  return `
    <div class="eh-cal-event eh-cal-event-${escapeHtml(e.type)} ${e.severe ? 'is-severe' : ''}" title="${escapeHtml(title)}">
      ${time}
      <span class="eh-cal-event-label">${escapeHtml(e.label)}</span>
    </div>
  `;
}

/* ============================================
   Render helpers — month
============================================ */
function renderMonth(cursor, events) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  // Grid start: maandag van de week waar dag-1 in valt
  const gridStart = startOfWeek(first);
  // Grid end: zondag van de week waar laatste dag in valt
  const gridEnd = endOfWeek(last);
  const today = toDayIso(new Date());

  // Events groeperen per dag-iso, dan per type
  const byDay = new Map();
  for (const e of events) {
    if (!byDay.has(e.day)) byDay.set(e.day, { meal: 0, symptom: 0, intro: 0, severe: false });
    const bucket = byDay.get(e.day);
    if (bucket[e.type] !== undefined) bucket[e.type] += 1;
    if (e.severe) bucket.severe = true;
  }

  const cells = [];
  let d = gridStart;
  while (d <= gridEnd) {
    const iso = toDayIso(d);
    const inMonth = d.getMonth() === cursor.getMonth();
    const isToday = iso === today;
    const counts = byDay.get(iso);
    cells.push({ date: d, iso, inMonth, isToday, counts });
    d = addDays(d, 1);
  }

  return `
    <div class="eh-cal eh-cal-month">
      <div class="eh-cal-month-head">
        ${WEEKDAY_SHORT.map((w) => `<span class="eh-cal-month-day">${w}</span>`).join('')}
      </div>
      <div class="eh-cal-month-grid">
        ${cells.map((c) => renderMonthCell(c)).join('')}
      </div>
    </div>
  `;
}

function renderMonthCell({ date, iso, inMonth, isToday, counts }) {
  const dotsHtml = counts ? renderDots(counts) : '';
  return `
    <button type="button"
            class="eh-cal-cell ${inMonth ? '' : 'is-out'} ${isToday ? 'is-today' : ''} ${counts?.severe ? 'is-severe' : ''}"
            data-day="${iso}">
      <span class="eh-cal-cell-num">${date.getDate()}</span>
      ${dotsHtml}
    </button>
  `;
}

function renderDots(counts) {
  // Max 3 dots zichtbaar; meer = +N badge
  const dotItems = [];
  if (counts.meal > 0) dotItems.push({ type: 'meal', n: counts.meal });
  if (counts.symptom > 0) dotItems.push({ type: 'symptom', n: counts.symptom });
  if (counts.intro > 0) dotItems.push({ type: 'intro', n: counts.intro });

  // Toon één dot per actieve type (max 3, want er zijn maar 3 types).
  // Zou er ooit een 4e type komen, dan +N badge.
  const visible = dotItems.slice(0, 3);
  const overflow = dotItems.length - visible.length;
  return `
    <span class="eh-cal-cell-dots">
      ${visible.map((d) => `<span class="eh-cal-dot eh-cal-dot-${d.type}" title="${d.n} ${d.type}"></span>`).join('')}
      ${overflow > 0 ? `<span class="eh-cal-cell-more">+${overflow}</span>` : ''}
    </span>
  `;
}

/* ============================================
   Event mapping
============================================ */
function buildEventsFromData(data) {
  return [
    ...(data.meals || []).map(toMealEvent),
    ...(data.symptoms || []).map(toSymptomEvent),
    ...(data.intros || []).map(toIntroEvent),
  ].filter(Boolean).sort((a, b) => a.tsMs - b.tsMs);
}

function toMealEvent(m) {
  if (!m.eaten_at) return null;
  const ts = new Date(m.eaten_at);
  if (Number.isNaN(ts.getTime())) return null;
  const typeLbl = MEAL_TYPE_LABEL[m.meal_type] || m.meal_type || 'Maaltijd';
  const food = m.food_text || m.recipe_name || (m.recipe_id ? 'Recept' : '—');
  const reactionPart = m.reaction ? ` (${REACTION_FALLBACK[m.reaction] || m.reaction})` : '';
  return {
    type: 'meal',
    tsMs: ts.getTime(),
    day: toDayIso(ts),
    time: formatTime(ts),
    label: `${typeLbl}: ${food}${reactionPart}`,
    sub: m.notes || (m.amount ? m.amount : ''),
  };
}

function toSymptomEvent(s) {
  if (!s.occurred_at) return null;
  const ts = new Date(s.occurred_at);
  if (Number.isNaN(ts.getTime())) return null;
  const meta = getSymptomMeta(s.symptom_type);
  const label = meta?.label || s.symptom_type || 'Symptoom';
  return {
    type: 'symptom',
    tsMs: ts.getTime(),
    day: toDayIso(ts),
    time: formatTime(ts),
    label: `${label}${s.severity ? ' · ' + s.severity : ''}`,
    sub: s.notes || '',
    severe: s.severity === 'matig' || s.severity === 'heftig',
  };
}

function toIntroEvent(i) {
  if (!i.intro_date) return null;
  const ts = new Date(i.intro_date + 'T12:00:00Z');
  if (Number.isNaN(ts.getTime())) return null;
  const reactionLbl = INTRO_REACTION_LABEL[i.reaction] || i.reaction || 'Geen reactie';
  return {
    type: 'intro',
    tsMs: ts.getTime(),
    day: i.intro_date,
    time: '',
    label: `${capitalize(i.allergen_key)}: ${reactionLbl}`,
    sub: i.notes || '',
    severe: i.reaction === 'matig' || i.reaction === 'heftig',
  };
}

/* ============================================
   Date helpers
============================================ */
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfWeek(d) {
  // Maandag = start
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7; // 0=ma, 6=zo
  x.setDate(x.getDate() - dow);
  return x;
}
function endOfWeek(d) {
  const s = startOfWeek(d);
  return addDays(s, 6);
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function addMonths(d, n) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}
function i7(d) {
  // 0=ma, 6=zo
  return (d.getDay() + 6) % 7;
}
function toDayIso(d) {
  // Lokale tijdzone — vermijd UTC-shift bug bij midnight
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function formatTime(d) {
  return d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
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

function formatRangeLabel(view, cursor) {
  if (view === 'week') {
    const start = startOfWeek(cursor);
    const end = addDays(start, 6);
    if (start.getMonth() === end.getMonth()) {
      return `${start.getDate()} – ${end.getDate()} ${MONTH_LONG[end.getMonth()]} ${end.getFullYear()}`;
    }
    return `${start.getDate()} ${MONTH_LONG[start.getMonth()].slice(0, 3)} – ${end.getDate()} ${MONTH_LONG[end.getMonth()].slice(0, 3)} ${end.getFullYear()}`;
  }
  return `${capitalize(MONTH_LONG[cursor.getMonth()])} ${cursor.getFullYear()}`;
}
