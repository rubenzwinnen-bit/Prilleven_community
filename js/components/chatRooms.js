/* ============================================
   CHAT-ROOMS COMPONENT
   Beheert de rooms-navigatie (rechts) en het in-app
   room/topic-detail-view (in midden-pane).
   Gebruikt /api/chat-rooms.
============================================ */

import * as Store from '../store.js?v=2.4.2';
import * as Api from '../chatRoomsApi.js?v=2.4.2';

/* ---------------- State ---------------- */
const state = {
  rooms: [],
  activeSlug: null,    // null = timeline tonen, anders room of topic
  activeTopicId: null, // null = topic-lijst, anders topic-detail
  topics: [],
  currentRoom: null,
  currentTopic: null,
  replies: [],
};

/* ---------------- Utils ---------------- */
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const opts = sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
  return d.toLocaleString('nl-BE', opts);
}

function isAdmin() {
  try { return !!Store.isAdmin(); } catch { return false; }
}

/* ---------------- Render: Rooms-nav (rechter kolom) ---------------- */
export function renderNav() {
  return `
    <aside class="rooms-pane" data-pane="rooms" aria-label="Chatruimtes">
      <div class="rooms-pane-header">
        <h2 class="rooms-pane-title">Chatruimtes</h2>
      </div>
      <div class="rooms-pane-body" id="rooms-pane-body">
        <button class="rooms-back-timeline" id="rooms-back-timeline" type="button">
          Tijdlijn
        </button>
        <ul class="rooms-list" id="rooms-list">
          <li class="rooms-loading">Laden…</li>
        </ul>
      </div>
    </aside>
  `;
}

/* ---------------- Render: Room-view (in midden-pane, vervangt timeline) ---------------- */
function renderRoomView() {
  const room = state.currentRoom;
  if (!room) return `<div class="chatroom-empty">Room niet gevonden.</div>`;

  const topicsHtml = state.topics.length === 0
    ? `<div class="chatroom-empty">Nog geen onderwerpen — start het eerste!</div>`
    : state.topics.map(t => `
        <article class="topic-card${t.is_pinned ? ' is-pinned' : ''}" data-topic-id="${t.id}">
          ${t.is_pinned ? `<span class="topic-pin" title="Vastgepind">📌</span>` : ''}
          <h3 class="topic-title">${escapeHtml(t.title)}</h3>
          <p class="topic-meta">
            <span class="topic-author">${escapeHtml(t.nickname || 'Onbekend')}</span>
            <span class="topic-sep">·</span>
            <span class="topic-date">${fmtDate(t.created_at)}</span>
            <span class="topic-sep">·</span>
            <span class="topic-replies">${t.replies_count || 0} reacties</span>
          </p>
          <p class="topic-snippet">${escapeHtml((t.body || '').slice(0, 200))}${(t.body || '').length > 200 ? '…' : ''}</p>
        </article>
      `).join('');

  return `
    <div class="chatroom-view" data-room-slug="${escapeHtml(room.slug)}">
      <header class="chatroom-header">
        <button class="chatroom-back" id="chatroom-back" type="button" aria-label="Terug naar rooms">←</button>
        <div class="chatroom-header-text">
          <h2 class="chatroom-title">${escapeHtml(room.title)}</h2>
          ${room.description ? `<p class="chatroom-desc">${escapeHtml(room.description)}</p>` : ''}
        </div>
      </header>
      <form class="chatroom-new-topic" id="chatroom-new-topic">
        <input class="chatroom-input" id="chatroom-new-title" type="text"
               placeholder="Titel van je onderwerp" maxlength="120" required />
        <textarea class="chatroom-textarea" id="chatroom-new-body"
                  placeholder="Wat wil je vragen of delen?" maxlength="4000" rows="3" required></textarea>
        <div class="chatroom-new-foot">
          <button class="btn btn-primary" type="submit">Plaats onderwerp</button>
        </div>
      </form>
      <div class="topic-list" id="topic-list">${topicsHtml}</div>
    </div>
  `;
}

/* ---------------- Render: Topic-view (in midden-pane) ---------------- */
function renderTopicView() {
  const t = state.currentTopic;
  if (!t) return `<div class="chatroom-empty">Topic niet gevonden.</div>`;
  const admin = isAdmin();
  const me = Store.getCurrentUser()?.id;

  const repliesHtml = state.replies.length === 0
    ? `<div class="chatroom-empty">Nog geen reacties — wees de eerste!</div>`
    : state.replies.map(r => {
        const canDelete = admin || r.user_id === me;
        return `
          <article class="reply-card" data-reply-id="${r.id}">
            <header class="reply-head">
              <span class="reply-author">${escapeHtml(r.nickname || 'Onbekend')}</span>
              <span class="reply-date">${fmtDate(r.created_at)}${r.edited_at ? ' · bewerkt' : ''}</span>
              ${canDelete ? `<button class="reply-del" data-action="delete-reply" data-reply-id="${r.id}" title="Verwijderen">×</button>` : ''}
            </header>
            <p class="reply-body">${escapeHtml(r.body)}</p>
          </article>
        `;
      }).join('');

  const canDeleteTopic = admin || t.user_id === me;

  return `
    <div class="topic-view" data-topic-id="${t.id}">
      <header class="topic-detail-header">
        <button class="chatroom-back" id="topic-back" type="button" aria-label="Terug naar room">←</button>
        <div class="topic-detail-header-text">
          ${t.is_pinned ? `<span class="topic-pin">📌</span>` : ''}
          <h2 class="topic-detail-title">${escapeHtml(t.title)}</h2>
        </div>
        <div class="topic-detail-actions">
          ${admin ? `<button class="topic-pin-btn" id="topic-pin-btn" type="button">${t.is_pinned ? 'Unpin' : 'Pin'}</button>` : ''}
          ${canDeleteTopic ? `<button class="topic-del-btn" id="topic-del-btn" type="button">Verwijder</button>` : ''}
        </div>
      </header>
      <article class="topic-body-card">
        <p class="topic-meta">
          <span class="topic-author">${escapeHtml(t.nickname || 'Onbekend')}</span>
          <span class="topic-sep">·</span>
          <span class="topic-date">${fmtDate(t.created_at)}${t.edited_at ? ' · bewerkt' : ''}</span>
        </p>
        <p class="topic-body-text">${escapeHtml(t.body)}</p>
      </article>
      <div class="reply-list" id="reply-list">${repliesHtml}</div>
      <form class="reply-form" id="reply-form">
        <textarea class="chatroom-textarea" id="reply-body" rows="2"
                  placeholder="Schrijf een reactie…" maxlength="2000" required></textarea>
        <button class="btn btn-primary" type="submit">Reageer</button>
      </form>
    </div>
  `;
}

/* ---------------- DOM swap ---------------- */
function getMiddlePane() {
  return document.querySelector('.home-pane--timeline');
}
function getTimelineInner() {
  return document.getElementById('home-timeline-inner');
}
function getChatroomMount() {
  return document.getElementById('home-chatroom-mount');
}

function showChatroom(html) {
  const mid = getMiddlePane();
  if (!mid) return;
  mid.dataset.view = 'chatroom';
  const mount = getChatroomMount();
  if (mount) mount.innerHTML = html;
}
function showTimeline() {
  const mid = getMiddlePane();
  if (!mid) return;
  mid.dataset.view = 'timeline';
  const mount = getChatroomMount();
  if (mount) mount.innerHTML = '';
  state.activeSlug = null;
  state.activeTopicId = null;
  state.currentRoom = null;
  state.currentTopic = null;
  // Reset actieve room highlight in nav
  document.querySelectorAll('.rooms-list-item').forEach(el => el.classList.remove('is-active'));
}

/* ---------------- Actions ---------------- */
async function openRoom(slug) {
  const mount = getChatroomMount();
  if (mount) mount.innerHTML = `<div class="chatroom-empty">Laden…</div>`;
  showChatroom(mount?.innerHTML || '');
  const { ok, data, error } = await Api.getRoom(slug);
  if (!ok) {
    showChatroom(`<div class="chatroom-empty">${escapeHtml(error || 'Kon room niet laden.')}</div>`);
    return;
  }
  state.activeSlug = slug;
  state.activeTopicId = null;
  state.currentRoom = data.room;
  state.currentTopic = null;
  state.topics = data.topics || [];
  state.replies = [];
  showChatroom(renderRoomView());
  // Highlight in nav
  document.querySelectorAll('.rooms-list-item').forEach(el => {
    el.classList.toggle('is-active', el.dataset.slug === slug);
  });
  bindRoomViewHandlers();
}

async function openTopic(id) {
  const mount = getChatroomMount();
  if (mount) mount.innerHTML = `<div class="chatroom-empty">Laden…</div>`;
  const { ok, data, error } = await Api.getTopic(id);
  if (!ok) {
    showChatroom(`<div class="chatroom-empty">${escapeHtml(error || 'Kon topic niet laden.')}</div>`);
    return;
  }
  state.activeTopicId = id;
  state.currentTopic = data.topic;
  state.replies = data.replies || [];
  // Zorg dat de room ook actief is in nav
  if (state.currentTopic?.room_id && !state.currentRoom) {
    // Indien direct geopend: room ophalen via /rooms-lijst
    const found = state.rooms.find(r => r.id === state.currentTopic.room_id);
    if (found) state.currentRoom = found;
  }
  showChatroom(renderTopicView());
  bindTopicViewHandlers();
}

async function refreshTopics() {
  if (!state.activeSlug) return;
  const { ok, data } = await Api.getRoom(state.activeSlug);
  if (!ok) return;
  state.topics = data.topics || [];
  showChatroom(renderRoomView());
  bindRoomViewHandlers();
}

/* ---------------- Handlers ---------------- */
function bindRoomViewHandlers() {
  const back = document.getElementById('chatroom-back');
  back?.addEventListener('click', () => showTimeline());

  const form = document.getElementById('chatroom-new-topic');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('chatroom-new-title')?.value.trim();
    const body  = document.getElementById('chatroom-new-body')?.value.trim();
    if (!title || !body || !state.activeSlug) return;
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    const { ok, error } = await Api.createTopic(state.activeSlug, { title, body });
    if (submitBtn) submitBtn.disabled = false;
    if (!ok) {
      alert(error || 'Kon onderwerp niet plaatsen.');
      return;
    }
    document.getElementById('chatroom-new-title').value = '';
    document.getElementById('chatroom-new-body').value = '';
    await refreshTopics();
  });

  document.querySelectorAll('.topic-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.topicId;
      if (id) openTopic(id);
    });
  });
}

function bindTopicViewHandlers() {
  const back = document.getElementById('topic-back');
  back?.addEventListener('click', () => {
    if (state.activeSlug) openRoom(state.activeSlug);
    else showTimeline();
  });

  const pinBtn = document.getElementById('topic-pin-btn');
  pinBtn?.addEventListener('click', async () => {
    const t = state.currentTopic;
    if (!t) return;
    const { ok, data, error } = await Api.pinTopic(t.id, !t.is_pinned);
    if (!ok) { alert(error || 'Pinnen mislukt.'); return; }
    state.currentTopic = { ...t, is_pinned: data.is_pinned };
    showChatroom(renderTopicView());
    bindTopicViewHandlers();
  });

  const delBtn = document.getElementById('topic-del-btn');
  delBtn?.addEventListener('click', async () => {
    if (!confirm('Onderwerp verwijderen? Dit verwijdert ook alle reacties.')) return;
    const { ok, error } = await Api.deleteTopic(state.currentTopic.id);
    if (!ok) { alert(error || 'Verwijderen mislukt.'); return; }
    if (state.activeSlug) openRoom(state.activeSlug);
    else showTimeline();
  });

  const form = document.getElementById('reply-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = document.getElementById('reply-body')?.value.trim();
    if (!text || !state.currentTopic) return;
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    const { ok, error } = await Api.createReply(state.currentTopic.id, text);
    if (submitBtn) submitBtn.disabled = false;
    if (!ok) { alert(error || 'Kon reactie niet plaatsen.'); return; }
    document.getElementById('reply-body').value = '';
    await openTopic(state.currentTopic.id);
  });

  document.querySelectorAll('[data-action="delete-reply"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.replyId;
      if (!id) return;
      if (!confirm('Reactie verwijderen?')) return;
      const { ok, error } = await Api.deleteReply(id);
      if (!ok) { alert(error || 'Verwijderen mislukt.'); return; }
      await openTopic(state.currentTopic.id);
    });
  });
}

/* ---------------- Public init (nav) ---------------- */
export async function init() {
  const navBtn = document.getElementById('rooms-back-timeline');
  navBtn?.addEventListener('click', () => showTimeline());

  const list = document.getElementById('rooms-list');
  if (!list) return;

  const { ok, data, error } = await Api.listRooms();
  if (!ok) {
    list.innerHTML = `<li class="rooms-error">${escapeHtml(error || 'Kon rooms niet laden.')}</li>`;
    return;
  }
  state.rooms = data.rooms || [];
  list.innerHTML = state.rooms.map(r => `
    <li class="rooms-list-item" data-slug="${escapeHtml(r.slug)}">
      <button class="rooms-list-btn" type="button">
        <span class="rooms-list-title">${escapeHtml(r.title)}</span>
        ${r.description ? `<span class="rooms-list-desc">${escapeHtml(r.description)}</span>` : ''}
      </button>
    </li>
  `).join('');

  list.querySelectorAll('.rooms-list-item').forEach(li => {
    li.addEventListener('click', () => {
      const slug = li.dataset.slug;
      if (slug) openRoom(slug);
    });
  });
}
