/* ============================================
   ALLERGENEN — AGENDA (maand-overzicht, multi-kind)

   Toont per maand de historie (doses + symptomen) én een gepland
   schema per kindje, conform ALLERGEN_FLOW + 3 dagen cooldown.

   Mount-API:
     mountAllergenenAgenda(container, {
       children,    // [{id, name, birthdate, known_allergies}]
       dataByChild, // { [childId]: { doses: [], symptoms: [], ehState } }
       activeIds,   // optioneel: subset child-ids om te tonen
       onSelectDay, // optioneel: (isoDate, eventsForDay) => void
     })
============================================ */

import { escapeHtml, colorFromSeed, initialsFromName } from '../utils.js?v=2.5.4';
import { ALLERGEN_FLOW } from '../content/eersteHapjes-allergen-flow.js?v=2.5.4';

const COOLDOWN_DAYS = 3;
const TARGET_SUCCESSES = 3;

/* ============================================================
   Datum-helpers (UTC-day stable)
============================================================ */
function toUtcDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function parseIso(s) {
  return new Date(s + 'T00:00:00Z');
}
function isoDay(d) {
  return d.toISOString().slice(0, 10);
}
function addDays(d, n) {
  const c = new Date(d);
  c.setUTCDate(c.getUTCDate() + n);
  return c;
}
function startOfMonth(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function endOfMonth(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}
function ageMonthsAt(birthdate, atDate) {
  if (!birthdate) return 0;
  const b = parseIso(birthdate);
  let m = (atDate.getUTCFullYear() - b.getUTCFullYear()) * 12
        + (atDate.getUTCMonth() - b.getUTCMonth());
  if (atDate.getUTCDate() < b.getUTCDate()) m -= 1;
  return Math.max(0, m);
}
function dateAtAgeMonths(birthdate, months) {
  const b = parseIso(birthdate);
  return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + months, b.getUTCDate()));
}

const MONTH_LABELS = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december'];
const DAY_LABELS = ['ma','di','wo','do','vr','za','zo'];

/* ============================================================
   Planning-algoritme
   - Sorteer ALLERGEN_FLOW op order
   - Sla bekende allergieën over
   - Per allergeen: plan zoveel doses als nog nodig (3 - successen)
   - Tussen elke dose ≥ 3 dagen, ook over allergenen heen
   - Respecteer ageCondition.introFrom (verschuif cursor naar leeftijdsdatum)
============================================================ */
function buildPlanned(child, doses, knownAllergies, ehState, todayUtc) {
  if (ehState?.allergen_state?.paused) return [];

  const successByKey = {};
  let latest = null;
  for (const d of doses) {
    if (d.reaction === 'geen') {
      successByKey[d.allergen_key] = (successByKey[d.allergen_key] || 0) + 1;
    }
    const ds = parseIso(d.intro_date);
    if (!latest || ds > latest) latest = ds;
  }

  let cursor = todayUtc;
  if (latest) {
    const after = addDays(latest, COOLDOWN_DAYS);
    if (after > cursor) cursor = after;
  }

  const planned = [];
  const ordered = [...ALLERGEN_FLOW].sort((a, b) => a.order - b.order);

  for (const a of ordered) {
    if (knownAllergies.includes(a.key)) continue;
    let count = successByKey[a.key] || 0;
    let dose = count + 1; // volgende dose-nummer
    while (count < TARGET_SUCCESSES) {
      // Leeftijd-conditie: introFrom
      if (a.ageCondition.introFrom) {
        const ageAtCursor = ageMonthsAt(child.birthdate, cursor);
        if (ageAtCursor < a.ageCondition.introFrom) {
          const ageDate = dateAtAgeMonths(child.birthdate, a.ageCondition.introFrom);
          if (ageDate > cursor) cursor = ageDate;
        }
      }
      planned.push({
        type: 'plan',
        child_id: child.id,
        allergen_key: a.key,
        dose_number: dose,
        date: isoDay(cursor),
      });
      cursor = addDays(cursor, COOLDOWN_DAYS);
      count++;
      dose++;
    }
  }
  return planned;
}

/* ============================================================
   Events bundelen per dag voor een set kindjes
============================================================ */
function collectEvents(children, dataByChild, activeSet) {
  const eventsByDay = new Map();
  const push = (day, ev) => {
    if (!eventsByDay.has(day)) eventsByDay.set(day, []);
    eventsByDay.get(day).push(ev);
  };
  const today = toUtcDay(new Date());

  for (const child of children) {
    if (activeSet && !activeSet.has(child.id)) continue;
    const bundle = dataByChild[child.id] || {};
    const doses = bundle.doses || [];
    const symptoms = bundle.symptoms || [];
    const ehState = bundle.ehState || null;
    const knownAllergies = ehState?.allergen_state?.known_allergies || child.known_allergies || [];

    for (const d of doses) {
      push(d.intro_date, {
        type: 'dose',
        child_id: child.id,
        allergen_key: d.allergen_key,
        dose_number: d.dose_number,
        reaction: d.reaction,
        notes: d.notes,
        id: d.id,
      });
    }
    for (const s of symptoms) {
      const day = (s.occurred_at || '').slice(0, 10);
      if (!day) continue;
      push(day, {
        type: 'symptom',
        child_id: child.id,
        symptom_type: s.symptom_type,
        severity: s.severity,
        notes: s.notes,
        id: s.id,
      });
    }

    const planned = buildPlanned(child, doses, knownAllergies, ehState, today);
    for (const p of planned) push(p.date, p);
  }

  return eventsByDay;
}

/* ============================================================
   Render
============================================================ */
export function mountAllergenenAgenda(container, opts) {
  if (!container) return;
  const state = {
    children: opts.children || [],
    dataByChild: opts.dataByChild || {},
    activeIds: new Set(opts.activeIds || (opts.children || []).map(c => c.id)),
    cursorMonth: startOfMonth(toUtcDay(new Date())),
    selectedDay: null,
    onSelectDay: typeof opts.onSelectDay === 'function' ? opts.onSelectDay : null,
  };

  function render() {
    const eventsByDay = collectEvents(state.children, state.dataByChild, state.activeIds);
    container.innerHTML = `
      <div class="agenda-allergen">
        ${renderToolbar()}
        ${renderMonthNav()}
        ${renderGrid(eventsByDay)}
        ${renderDetail(eventsByDay)}
      </div>
    `;
    bind(eventsByDay);
  }

  function renderToolbar() {
    const chips = state.children.map(c => {
      const color = colorFromSeed(c.id);
      const isActive = state.activeIds.has(c.id);
      const initials = initialsFromName(c.name);
      return `
        <button class="agenda-chip ${isActive ? 'active' : ''}" data-child-id="${c.id}" type="button"
                title="${escapeHtml(c.name)}">
          <span class="agenda-chip-dot" style="background:${color};">${escapeHtml(initials)}</span>
          <span class="agenda-chip-name">${escapeHtml(c.name)}</span>
        </button>
      `;
    }).join('');
    return `<div class="agenda-toolbar">${chips}</div>`;
  }

  function renderMonthNav() {
    const label = `${MONTH_LABELS[state.cursorMonth.getUTCMonth()]} ${state.cursorMonth.getUTCFullYear()}`;
    return `
      <div class="agenda-monthnav">
        <button type="button" class="btn btn-outline btn-sm" data-action="prev">‹</button>
        <h3 class="agenda-monthnav-label">${escapeHtml(label)}</h3>
        <button type="button" class="btn btn-outline btn-sm" data-action="next">›</button>
        <button type="button" class="btn btn-outline btn-sm" data-action="today">Vandaag</button>
      </div>
    `;
  }

  function renderGrid(eventsByDay) {
    const first = startOfMonth(state.cursorMonth);
    const last = endOfMonth(state.cursorMonth);
    // ma=0, zo=6
    const jsDow = first.getUTCDay(); // 0=zo … 6=za
    const leading = (jsDow + 6) % 7;
    const totalCells = Math.ceil((leading + last.getUTCDate()) / 7) * 7;
    const todayIso = isoDay(toUtcDay(new Date()));

    const cells = [];
    for (let i = 0; i < totalCells; i++) {
      const dayDate = addDays(first, i - leading);
      const inMonth = dayDate.getUTCMonth() === first.getUTCMonth();
      const iso = isoDay(dayDate);
      const dayEvents = eventsByDay.get(iso) || [];
      const dots = renderDots(dayEvents);
      const isToday = iso === todayIso;
      const isSelected = iso === state.selectedDay;
      cells.push(`
        <button type="button"
                class="agenda-cell ${inMonth ? '' : 'agenda-cell--out'} ${isToday ? 'agenda-cell--today' : ''} ${isSelected ? 'agenda-cell--selected' : ''}"
                data-day="${iso}">
          <span class="agenda-cell-day">${dayDate.getUTCDate()}</span>
          <span class="agenda-cell-dots">${dots}</span>
        </button>
      `);
    }

    return `
      <div class="agenda-grid">
        <div class="agenda-grid-head">
          ${DAY_LABELS.map(l => `<div class="agenda-grid-dow">${l}</div>`).join('')}
        </div>
        <div class="agenda-grid-body">
          ${cells.join('')}
        </div>
      </div>
    `;
  }

  function renderDots(events) {
    if (!events.length) return '';
    const grouped = {};
    for (const e of events) {
      const k = e.child_id + '|' + e.type + '|' + (e.reaction || e.severity || '');
      grouped[k] = grouped[k] || { ...e, count: 0 };
      grouped[k].count++;
    }
    const items = Object.values(grouped).slice(0, 4).map(e => {
      const color = colorFromSeed(e.child_id);
      let cls = 'agenda-dot';
      if (e.type === 'dose') {
        cls += ' agenda-dot--dose';
        if (e.reaction === 'mild') cls += ' agenda-dot--mild';
        if (e.reaction === 'ernstig') cls += ' agenda-dot--ernstig';
      } else if (e.type === 'symptom') {
        cls += ' agenda-dot--symptom';
        if (e.severity === 'heftig') cls += ' agenda-dot--ernstig';
        if (e.severity === 'matig')  cls += ' agenda-dot--mild';
      } else if (e.type === 'plan') {
        cls += ' agenda-dot--plan';
      }
      return `<span class="${cls}" style="--c:${color};"></span>`;
    }).join('');
    const more = events.length > 4 ? `<span class="agenda-dot-more">+${events.length - 4}</span>` : '';
    return items + more;
  }

  function renderDetail(eventsByDay) {
    if (!state.selectedDay) {
      return `<div class="agenda-detail agenda-detail--empty">Klik op een dag om de events te zien.</div>`;
    }
    const list = eventsByDay.get(state.selectedDay) || [];
    if (!list.length) {
      return `
        <div class="agenda-detail">
          <h4>${escapeHtml(formatDayLong(state.selectedDay))}</h4>
          <p>Geen activiteit op deze dag.</p>
        </div>
      `;
    }
    const sorted = [...list].sort((a, b) => orderType(a) - orderType(b));
    return `
      <div class="agenda-detail">
        <h4>${escapeHtml(formatDayLong(state.selectedDay))}</h4>
        <ul class="agenda-detail-list">
          ${sorted.map(e => renderEventLine(e)).join('')}
        </ul>
      </div>
    `;
  }

  function renderEventLine(e) {
    const child = state.children.find(c => c.id === e.child_id);
    const color = colorFromSeed(e.child_id);
    const name = escapeHtml(child?.name || '');
    if (e.type === 'dose') {
      const a = ALLERGEN_FLOW.find(x => x.key === e.allergen_key);
      const reactClass = e.reaction === 'ernstig' ? 'is-ernstig'
                       : e.reaction === 'mild' ? 'is-mild' : 'is-geen';
      const warn = (e.reaction === 'ernstig')
        ? `<span class="agenda-arts-warn">⚠️ Raadpleeg een arts.</span>` : '';
      return `
        <li class="agenda-event agenda-event--dose ${reactClass}">
          <span class="agenda-event-who" style="background:${color};">${escapeHtml(initialsFromName(name))}</span>
          <span class="agenda-event-body">
            <strong>${escapeHtml(a?.label || e.allergen_key)}</strong> · dose ${e.dose_number} · reactie: ${escapeHtml(e.reaction)}
            ${e.notes ? `<small>${escapeHtml(e.notes)}</small>` : ''}
            ${warn}
          </span>
        </li>
      `;
    }
    if (e.type === 'symptom') {
      const warn = (e.severity === 'heftig')
        ? `<span class="agenda-arts-warn">⚠️ Raadpleeg een arts.</span>` : '';
      return `
        <li class="agenda-event agenda-event--symptom">
          <span class="agenda-event-who" style="background:${color};">${escapeHtml(initialsFromName(name))}</span>
          <span class="agenda-event-body">
            <strong>Symptoom — ${escapeHtml(e.symptom_type)}</strong> · ernst: ${escapeHtml(e.severity)}
            ${e.notes ? `<small>${escapeHtml(e.notes)}</small>` : ''}
            ${warn}
          </span>
        </li>
      `;
    }
    // plan
    const a = ALLERGEN_FLOW.find(x => x.key === e.allergen_key);
    return `
      <li class="agenda-event agenda-event--plan">
        <span class="agenda-event-who" style="background:${color};">${escapeHtml(initialsFromName(name))}</span>
        <span class="agenda-event-body">
          <em>Gepland</em> · ${escapeHtml(a?.label || e.allergen_key)} · dose ${e.dose_number}
        </span>
      </li>
    `;
  }

  function orderType(e) {
    return e.type === 'dose' ? 0 : e.type === 'symptom' ? 1 : 2;
  }

  function formatDayLong(iso) {
    const d = parseIso(iso);
    return `${DAY_LABELS[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()} ${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }

  function bind(eventsByDay) {
    container.querySelectorAll('[data-child-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.childId;
        if (state.activeIds.has(id)) state.activeIds.delete(id);
        else state.activeIds.add(id);
        render();
      });
    });
    container.querySelector('[data-action="prev"]')?.addEventListener('click', () => {
      state.cursorMonth = new Date(Date.UTC(state.cursorMonth.getUTCFullYear(), state.cursorMonth.getUTCMonth() - 1, 1));
      render();
    });
    container.querySelector('[data-action="next"]')?.addEventListener('click', () => {
      state.cursorMonth = new Date(Date.UTC(state.cursorMonth.getUTCFullYear(), state.cursorMonth.getUTCMonth() + 1, 1));
      render();
    });
    container.querySelector('[data-action="today"]')?.addEventListener('click', () => {
      state.cursorMonth = startOfMonth(toUtcDay(new Date()));
      state.selectedDay = isoDay(toUtcDay(new Date()));
      render();
    });
    container.querySelectorAll('.agenda-cell[data-day]').forEach(cell => {
      cell.addEventListener('click', () => {
        state.selectedDay = cell.dataset.day;
        const events = eventsByDay.get(state.selectedDay) || [];
        if (state.onSelectDay) state.onSelectDay(state.selectedDay, events);
        render();
      });
    });
  }

  render();

  return {
    refresh(newData) {
      if (newData?.dataByChild) state.dataByChild = newData.dataByChild;
      if (newData?.children) state.children = newData.children;
      render();
    },
  };
}
