/* ============================================
   CHAT-ROOMS COMPONENT
   Beheert de rooms-navigatie (rechts) en het in-app
   room/topic-detail-view (in midden-pane).
   Gebruikt /api/chat-rooms.
============================================ */

import * as Store from '../store.js?v=2.5.7';
import * as Api from '../chatRoomsApi.js?v=2.5.7';
import { formatRelativeTime } from '../utils.js?v=2.5.7';
import { renderAvatar, renderAuthorMeta } from '../profileRender.js?v=2.5.7';
import { sessionGet } from '../supabase.js?v=2.5.7';

// Edit-window verwijderd: eigen items zijn altijd bewerkbaar.

/* ---------------- State ---------------- */
const state = {
  rooms: [],
  activeSlug: null,    // null = timeline tonen, anders room of topic
  activeTopicId: null, // null = topic-lijst, anders topic-detail
  topics: [],
  currentRoom: null,
  currentTopic: null,
  replies: [],
  editingTopicId: null,  // inline edit-modus topic
  editingReplyId: null,  // inline edit-modus reply
  editingRoomIntro: false, // admin bewerkt room-intro
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

function isAdmin() {
  try { return !!Store.isAdmin(); } catch { return false; }
}

function withinEditWindow(_createdAt) {
  // Geen tijdslimiet meer — eigen items zijn altijd bewerkbaar.
  return true;
}

function avatarFor(row, sizeClass) {
  return renderAvatar(row, `tl-avatar ${sizeClass}`);
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
function renderRoomHeader(room, admin) {
  if (state.editingRoomIntro && admin) {
    return `
      <header class="chatroom-header chatroom-header--editing">
        <button class="chatroom-back" id="chatroom-back" type="button" aria-label="Terug naar rooms">←</button>
        <form class="chatroom-intro-edit-form" id="chatroom-intro-edit-form">
          <input class="chatroom-input" id="chatroom-intro-edit-title" type="text"
                 maxlength="80" required value="${escapeHtml(room.title)}" />
          <textarea class="chatroom-textarea" id="chatroom-intro-edit-desc"
                    rows="2" maxlength="500"
                    placeholder="Korte beschrijving van deze chatruimte">${escapeHtml(room.description || '')}</textarea>
          <div class="chatroom-intro-edit-actions">
            <button class="btn btn-secondary" type="button" data-action="cancel-intro-edit">Annuleer</button>
            <button class="btn btn-primary" type="submit">Opslaan</button>
          </div>
        </form>
      </header>
    `;
  }
  return `
    <header class="chatroom-header">
      <div class="chatroom-header-top">
        <button class="chatroom-back" id="chatroom-back" type="button" aria-label="Terug naar rooms">←</button>
        <h2 class="chatroom-title">${escapeHtml(room.title)}</h2>
        ${admin ? `<button class="chatroom-intro-edit-btn" data-action="edit-intro" type="button" title="Intro bewerken">Bewerken</button>` : ''}
      </div>
      ${room.description ? `<p class="chatroom-desc">${escapeHtml(room.description)}</p>` : ''}
    </header>
  `;
}

function renderRoomView() {
  const room = state.currentRoom;
  if (!room) return `<div class="chatroom-empty">Room niet gevonden.</div>`;
  const admin = isAdmin();

  const topicsHtml = state.topics.length === 0
    ? `<div class="chatroom-empty">Nog geen onderwerpen — start het eerste!</div>`
    : state.topics.map(t => `
        <article class="topic-card${t.is_pinned ? ' is-pinned' : ''}" data-topic-id="${t.id}">
          ${t.is_pinned ? `<span class="topic-pin" title="Vastgepind">📌</span>` : ''}
          <div class="topic-card-head">
            ${avatarFor(t, 'tl-avatar-sm')}
            <div class="topic-card-head-text">
              <h3 class="topic-title">${escapeHtml(t.title)}</h3>
              <p class="topic-meta">
                <span class="topic-author">${escapeHtml(t.nickname || 'Onbekend')}</span>
                ${t.author_is_admin ? '<span class="tl-admin-badge tl-admin-badge-sm" title="Administrator">Admin</span>' : ''}
                <span class="topic-sep">·</span>
                <span class="topic-date">${formatRelativeTime(t.created_at)}</span>
                <span class="topic-sep">·</span>
                <span class="topic-replies">${t.replies_count || 0} reacties</span>
              </p>
            </div>
          </div>
          <p class="topic-snippet">${escapeHtml((t.body || '').slice(0, 200))}${(t.body || '').length > 200 ? '…' : ''}</p>
        </article>
      `).join('');

  return `
    <div class="chatroom-view" data-room-slug="${escapeHtml(room.slug)}">
      ${renderRoomHeader(room, admin)}
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
function renderTopicBody(t, isOwn, canEdit) {
  if (state.editingTopicId === t.id) {
    return `
      <form class="topic-edit-form" id="topic-edit-form">
        <input class="chatroom-input" id="topic-edit-title" type="text"
               maxlength="120" required value="${escapeHtml(t.title)}" />
        <textarea class="chatroom-textarea" id="topic-edit-body"
                  rows="4" maxlength="4000" required>${escapeHtml(t.body)}</textarea>
        <div class="topic-edit-actions">
          <button class="btn btn-secondary" type="button" data-action="cancel-topic-edit">Annuleer</button>
          <button class="btn btn-primary" type="submit">Opslaan</button>
        </div>
      </form>
    `;
  }
  return `
    <p class="topic-body-text">${escapeHtml(t.body)}</p>
    ${isOwn && canEdit ? `
      <div class="topic-body-actions">
        <button class="topic-edit-btn" data-action="edit-topic" type="button">Bewerken</button>
      </div>
    ` : ''}
  `;
}

function renderReplyCard(r, me, admin) {
  const isOwn = r.user_id === me;
  const canDelete = admin || isOwn;
  const canEdit = isOwn && withinEditWindow(r.created_at);

  if (state.editingReplyId === r.id) {
    return `
      <article class="reply-card is-editing" data-reply-id="${r.id}">
        <div class="reply-row">
          ${avatarFor(r, 'tl-avatar-sm')}
          <form class="reply-edit-form" data-reply-edit-id="${r.id}">
            <textarea class="chatroom-textarea reply-edit-textarea"
                      rows="2" maxlength="2000" required>${escapeHtml(r.body)}</textarea>
            <div class="reply-edit-actions">
              <button class="btn btn-secondary" type="button" data-action="cancel-reply-edit">Annuleer</button>
              <button class="btn btn-primary" type="submit">Opslaan</button>
            </div>
          </form>
        </div>
      </article>
    `;
  }

  return `
    <article class="reply-card" data-reply-id="${r.id}">
      <div class="reply-row">
        ${avatarFor(r, 'tl-avatar-sm')}
        <div class="reply-bubble">
          <header class="reply-head">
            <span class="reply-author">${escapeHtml(r.nickname || 'Onbekend')}</span>
            ${r.author_is_admin ? '<span class="tl-admin-badge tl-admin-badge-sm" title="Administrator">Admin</span>' : ''}
            <span class="reply-date">${formatRelativeTime(r.created_at)}${r.edited_at ? ' · bewerkt' : ''}</span>
          </header>
          <p class="reply-body">${escapeHtml(r.body)}</p>
          <div class="reply-actions">
            ${canEdit ? `<button class="reply-edit" data-action="edit-reply" data-reply-id="${r.id}" type="button">Bewerken</button>` : ''}
            ${canDelete ? `<button class="reply-del" data-action="delete-reply" data-reply-id="${r.id}" type="button" title="Verwijderen">Verwijder</button>` : ''}
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderTopicView() {
  const t = state.currentTopic;
  if (!t) return `<div class="chatroom-empty">Topic niet gevonden.</div>`;
  const admin = isAdmin();
  const me = sessionGet()?.user_id || null;
  const isOwnTopic = !!me && t.user_id === me;
  const canEditTopic = isOwnTopic && withinEditWindow(t.created_at);
  const canDeleteTopic = admin || isOwnTopic;

  const repliesHtml = state.replies.length === 0
    ? `<div class="chatroom-empty">Nog geen reacties — wees de eerste!</div>`
    : state.replies.map(r => renderReplyCard(r, me, admin)).join('');

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
        <div class="topic-body-head">
          ${avatarFor(t, 'tl-avatar')}
          <p class="topic-meta">
            <span class="topic-author">${escapeHtml(t.nickname || 'Onbekend')}</span>
            ${t.author_is_admin ? '<span class="tl-admin-badge" title="Administrator">Admin</span>' : ''}
            <span class="topic-sep">·</span>
            <span class="topic-date">${formatRelativeTime(t.created_at)}${t.edited_at ? ' · bewerkt' : ''}</span>
          </p>
        </div>
        ${renderTopicBody(t, isOwnTopic, canEditTopic)}
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
  state.editingTopicId = null;
  state.editingReplyId = null;
  state.editingRoomIntro = false;
  // Reset actieve room highlight in nav
  document.querySelectorAll('.rooms-list-item').forEach(el => el.classList.remove('is-active'));
}

function highlightActiveRoom(slug) {
  document.querySelectorAll('.rooms-list-item').forEach(el => {
    el.classList.toggle('is-active', el.dataset.slug === slug);
  });
}

/* ---------------- Per-room cache (instant render van topics) ---------------- */
const ROOM_CACHE_PREFIX = 'pril_chatroom_v1_';
const ROOM_CACHE_TTL_MS = 2 * 60 * 1000; // 2 min — kort, alleen om koude functie-start te overbruggen.

function readRoomCache(slug) {
  try {
    const raw = localStorage.getItem(ROOM_CACHE_PREFIX + slug);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !obj.room) return null;
    if (Date.now() - (obj.t || 0) > ROOM_CACHE_TTL_MS) return null;
    return obj;
  } catch { return null; }
}
function writeRoomCache(slug, room, topics) {
  try {
    localStorage.setItem(
      ROOM_CACHE_PREFIX + slug,
      JSON.stringify({ room, topics: topics || [], t: Date.now() })
    );
  } catch {}
}

/* ---------------- Actions ---------------- */
async function openRoom(slug) {
  // Markeer onmiddellijk welke room we openen — anders blijft de UI op "Laden…" hangen
  // omdat de background-refresh-check (state.activeSlug !== slug) misloopt.
  state.activeSlug = slug;
  state.activeTopicId = null;
  state.currentTopic = null;
  state.replies = [];
  state.editingTopicId = null;
  state.editingReplyId = null;
  state.editingRoomIntro = false;

  // 1. Toon direct uit cache als die er is.
  const cached = readRoomCache(slug);
  if (cached) {
    state.currentRoom = cached.room;
    state.topics = cached.topics || [];
    showChatroom(renderRoomView());
    highlightActiveRoom(slug);
    bindRoomViewHandlers();
  } else {
    showChatroom(`<div class="chatroom-empty">Laden…</div>`);
    highlightActiveRoom(slug);
  }

  // 2. Refresh op de achtergrond.
  const { ok, data, error } = await Api.getRoom(slug);
  if (state.activeSlug !== slug) return; // gebruiker is intussen naar andere room

  if (!ok) {
    if (!cached) {
      showChatroom(`<div class="chatroom-empty">${escapeHtml(error || 'Kon room niet laden.')}</div>`);
    }
    return;
  }
  // Sla nieuwste versie op.
  writeRoomCache(slug, data.room, data.topics || []);

  // Alleen herrenderen als er echt iets veranderd is (of als er nog geen cache was).
  if (cached) {
    const sameRoom = JSON.stringify(cached.room) === JSON.stringify(data.room);
    const sameTopics = JSON.stringify(cached.topics || []) === JSON.stringify(data.topics || []);
    if (sameRoom && sameTopics) return;
  }

  state.currentRoom = data.room;
  state.topics = data.topics || [];
  showChatroom(renderRoomView());
  highlightActiveRoom(slug);
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
  state.editingTopicId = null;
  state.editingReplyId = null;
  if (state.currentTopic?.room_id && !state.currentRoom) {
    const found = state.rooms.find(r => r.id === state.currentTopic.room_id);
    if (found) state.currentRoom = found;
  }
  // Houd actieve highlight ook in topic-view
  if (state.currentRoom?.slug) highlightActiveRoom(state.currentRoom.slug);
  showChatroom(renderTopicView());
  bindTopicViewHandlers();
}

async function refreshTopics() {
  if (!state.activeSlug) return;
  const { ok, data } = await Api.getRoom(state.activeSlug);
  if (!ok) return;
  state.topics = data.topics || [];
  writeRoomCache(state.activeSlug, data.room, data.topics || []);
  showChatroom(renderRoomView());
  bindRoomViewHandlers();
}

function rerenderTopic() {
  showChatroom(renderTopicView());
  bindTopicViewHandlers();
}

/* ---------------- Handlers ---------------- */
function bindRoomViewHandlers() {
  const back = document.getElementById('chatroom-back');
  back?.addEventListener('click', () => showTimeline());

  /* --- Admin: room-intro bewerken --- */
  document.querySelector('[data-action="edit-intro"]')?.addEventListener('click', () => {
    state.editingRoomIntro = true;
    showChatroom(renderRoomView());
    bindRoomViewHandlers();
    document.getElementById('chatroom-intro-edit-title')?.focus();
  });
  document.querySelector('[data-action="cancel-intro-edit"]')?.addEventListener('click', () => {
    state.editingRoomIntro = false;
    showChatroom(renderRoomView());
    bindRoomViewHandlers();
  });
  const introForm = document.getElementById('chatroom-intro-edit-form');
  introForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('chatroom-intro-edit-title')?.value.trim();
    const desc  = document.getElementById('chatroom-intro-edit-desc')?.value.trim();
    if (!title || !state.currentRoom) return;
    const submitBtn = introForm.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    const { ok, data, error } = await Api.editRoom(state.currentRoom.slug, { title, description: desc });
    if (submitBtn) submitBtn.disabled = false;
    if (!ok) { alert(error || 'Bewerken mislukt.'); return; }
    state.currentRoom = { ...state.currentRoom, ...data.room };
    state.editingRoomIntro = false;
    // Cache + rooms-list bijwerken zodat de nieuwe titel in de zijbalk verschijnt.
    writeRoomCache(state.currentRoom.slug, state.currentRoom, state.topics || []);
    state.rooms = state.rooms.map(r => r.id === state.currentRoom.id ? { ...r, ...data.room } : r);
    writeRoomsCache(state.rooms);
    renderRoomsList(state.rooms);
    showChatroom(renderRoomView());
    bindRoomViewHandlers();
  });

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
    rerenderTopic();
  });

  const delBtn = document.getElementById('topic-del-btn');
  delBtn?.addEventListener('click', async () => {
    if (!confirm('Onderwerp verwijderen? Dit verwijdert ook alle reacties.')) return;
    const { ok, error } = await Api.deleteTopic(state.currentTopic.id);
    if (!ok) { alert(error || 'Verwijderen mislukt.'); return; }
    if (state.activeSlug) openRoom(state.activeSlug);
    else showTimeline();
  });

  /* --- Topic edit --- */
  document.querySelector('[data-action="edit-topic"]')?.addEventListener('click', () => {
    state.editingTopicId = state.currentTopic.id;
    rerenderTopic();
  });
  document.querySelector('[data-action="cancel-topic-edit"]')?.addEventListener('click', () => {
    state.editingTopicId = null;
    rerenderTopic();
  });
  const topicEditForm = document.getElementById('topic-edit-form');
  topicEditForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('topic-edit-title')?.value.trim();
    const body  = document.getElementById('topic-edit-body')?.value.trim();
    if (!title || !body) return;
    const submitBtn = topicEditForm.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    const { ok, data, error } = await Api.editTopic(state.currentTopic.id, { title, body });
    if (submitBtn) submitBtn.disabled = false;
    if (!ok) { alert(error || 'Bewerken mislukt.'); return; }
    state.currentTopic = data.topic;
    state.editingTopicId = null;
    rerenderTopic();
  });

  /* --- Reply form (nieuwe reactie) --- */
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

  /* --- Reply edit --- */
  document.querySelectorAll('[data-action="edit-reply"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.replyId;
      if (!id) return;
      state.editingReplyId = id;
      rerenderTopic();
    });
  });
  document.querySelectorAll('[data-action="cancel-reply-edit"]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.editingReplyId = null;
      rerenderTopic();
    });
  });
  document.querySelectorAll('.reply-edit-form').forEach(formEl => {
    formEl.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = formEl.dataset.replyEditId;
      const textarea = formEl.querySelector('.reply-edit-textarea');
      const text = textarea?.value.trim();
      if (!text || !id) return;
      const submitBtn = formEl.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      const { ok, data, error } = await Api.editReply(id, text);
      if (submitBtn) submitBtn.disabled = false;
      if (!ok) { alert(error || 'Bewerken mislukt.'); return; }
      // Vervang reply lokaal
      state.replies = state.replies.map(r => r.id === id ? data.reply : r);
      state.editingReplyId = null;
      rerenderTopic();
    });
  });

  /* --- Reply delete --- */
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

/* ---------------- Rooms-cache (instant render na inloggen) ---------------- */
const ROOMS_CACHE_KEY = 'pril_chatrooms_list_v1';
const ROOMS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

function readRoomsCache() {
  try {
    const raw = localStorage.getItem(ROOMS_CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !Array.isArray(obj.rooms)) return null;
    if (Date.now() - (obj.t || 0) > ROOMS_CACHE_TTL_MS) return null;
    return obj.rooms;
  } catch { return null; }
}
function writeRoomsCache(rooms) {
  try {
    localStorage.setItem(ROOMS_CACHE_KEY, JSON.stringify({ rooms, t: Date.now() }));
  } catch {}
}
function renderRoomsList(rooms) {
  const list = document.getElementById('rooms-list');
  if (!list) return;
  list.innerHTML = rooms.map(r => `
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
  if (state.activeSlug) highlightActiveRoom(state.activeSlug);
}

/* ---------------- Public init (nav) ---------------- */
export async function init() {
  const navBtn = document.getElementById('rooms-back-timeline');
  navBtn?.addEventListener('click', () => showTimeline());

  const list = document.getElementById('rooms-list');
  if (!list) return;

  // 1. Toon direct uit cache (instant) als die er is.
  const cached = readRoomsCache();
  if (cached && cached.length) {
    state.rooms = cached;
    renderRoomsList(cached);
  }

  // 2. Refresh in background.
  const { ok, data, error } = await Api.listRooms();
  if (!ok) {
    if (!cached || !cached.length) {
      list.innerHTML = `<li class="rooms-error">${escapeHtml(error || 'Kon rooms niet laden.')}</li>`;
    }
    return;
  }
  const fresh = data.rooms || [];
  writeRoomsCache(fresh);
  // Alleen herrenderen als de data echt veranderd is — anders flikkering vermijden.
  if (JSON.stringify(state.rooms) !== JSON.stringify(fresh)) {
    state.rooms = fresh;
    renderRoomsList(fresh);
  }
}
