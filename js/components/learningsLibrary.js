/* ============================================
   LEARNINGS LIBRARY
   Overzicht van alle Learning-items (pdf, blog,
   video) met zoeken, filteren op kind, favorieten-
   toggle en (admin) "Nieuw item" knop met upload-modal.
============================================ */

import * as Store from '../store.js?v=2.3.1';
import * as Router from '../router.js?v=2.3.1';
import { showToast, confirm } from '../utils.js?v=2.3.1';
import { sessionGet, sessionRefreshIfNeeded } from '../supabase.js?v=2.3.1';

let cachedItems = [];
let cachedFavIds = new Set();
let listAbort = null;

const KIND_LABEL = { pdf: 'PDF', blog: 'Blog', video: 'Video' };
const KIND_ICON  = { pdf: '📄', blog: '📝', video: '🎬' };

/* ----------------------------------------
   API HELPERS
---------------------------------------- */
async function authHeaders(extra = {}) {
  await sessionRefreshIfNeeded();
  const s = sessionGet();
  return {
    ...(s?.access_token ? { 'Authorization': 'Bearer ' + s.access_token } : {}),
    ...extra,
  };
}

async function apiGet(path) {
  const res = await fetch(`/api/learnings${path}`, { headers: await authHeaders() });
  if (!res.ok) {
    let msg = `Fout ${res.status}`;
    try { const j = await res.json(); if (j?.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

async function apiSend(method, path, body) {
  const res = await fetch(`/api/learnings${path}`, {
    method,
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `Fout ${res.status}`;
    try { const j = await res.json(); if (j?.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

/* ----------------------------------------
   RENDER (skeleton)
---------------------------------------- */
export function render() {
  return `
    <div class="learnings-page">
      <header class="learnings-header">
        <div class="learnings-header-inner">
          <h1 class="learnings-title">Learnings</h1>
          <p class="learnings-subtitle">Documenten, blogs en videos van Pril Leven.</p>
        </div>
      </header>

      <div class="toolbar learnings-toolbar">
        <div class="toolbar-left">
          <div class="search-bar">
            <input type="text" id="learnings-search" placeholder="Zoek learnings..." />
          </div>
          <select class="filter-select" id="learnings-filter-kind">
            <option value="">Alle types</option>
            <option value="pdf">PDF</option>
            <option value="blog">Blog</option>
            <option value="video">Video</option>
          </select>
          <button class="btn btn-ghost btn-sm" id="learnings-filter-fav" data-active="0" title="Toon enkel favorieten">
            ♡ Favorieten
          </button>
        </div>
        <div class="toolbar-right" id="learnings-toolbar-admin"></div>
      </div>

      <div id="learnings-grid" class="learnings-grid">
        <div class="empty-state" style="grid-column: 1 / -1">
          <div class="empty-state-icon">⏳</div>
          <h3>Learnings laden...</h3>
        </div>
      </div>
    </div>

    <!-- Admin upload modal -->
    <div id="learning-upload-modal" class="modal-overlay hidden">
      <div class="modal learning-upload-modal">
        <button class="modal-close" id="lu-close" aria-label="Sluiten">×</button>
        <h2>Nieuw learning-item</h2>

        <label class="auth-label">Type</label>
        <select id="lu-kind" class="auth-input">
          <option value="pdf">PDF document</option>
          <option value="blog">Blog (tekst)</option>
          <option value="video">Video (MP4)</option>
        </select>

        <label class="auth-label">Titel</label>
        <input id="lu-title" class="auth-input" type="text" maxlength="200" placeholder="Titel..." />

        <label class="auth-label">Korte beschrijving (optioneel)</label>
        <textarea id="lu-desc" class="auth-input" rows="2" maxlength="1000"></textarea>

        <div id="lu-file-row">
          <label class="auth-label" id="lu-file-label">Bestand</label>
          <input id="lu-file" class="auth-input" type="file" />
        </div>

        <div id="lu-blog-row" class="hidden">
          <label class="auth-label">Blog-inhoud (HTML toegestaan)</label>
          <textarea id="lu-body" class="auth-input" rows="10" maxlength="200000"></textarea>
        </div>

        <label class="auth-label">Thumbnail (optioneel, jpg/png)</label>
        <input id="lu-thumb" class="auth-input" type="file" accept="image/*" />

        <div id="lu-progress" class="learnings-progress hidden">
          <div class="learnings-progress-bar"><div id="lu-progress-fill"></div></div>
          <span id="lu-progress-text">0%</span>
        </div>

        <div id="lu-error" class="auth-error hidden"></div>

        <div class="modal-actions">
          <button class="btn btn-ghost" id="lu-cancel">Annuleren</button>
          <button class="btn btn-primary" id="lu-save">Opslaan</button>
        </div>
      </div>
    </div>
  `;
}

/* ----------------------------------------
   INIT
---------------------------------------- */
export async function init() {
  if (listAbort) listAbort.abort();
  listAbort = new AbortController();

  await reload();

  // Admin-toolbar
  if (Store.isAdmin()) {
    const right = document.getElementById('learnings-toolbar-admin');
    if (right) {
      right.innerHTML = `
        <button class="btn btn-primary btn-sm" id="btn-new-learning">+ Nieuw item</button>
      `;
    }
  }

  const root = document.getElementById('app-content');

  // Zoek/filter listeners
  document.getElementById('learnings-search')?.addEventListener('input', renderGrid, { signal: listAbort.signal });
  document.getElementById('learnings-filter-kind')?.addEventListener('change', renderGrid, { signal: listAbort.signal });
  document.getElementById('learnings-filter-fav')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    btn.dataset.active = btn.dataset.active === '1' ? '0' : '1';
    btn.classList.toggle('btn-primary', btn.dataset.active === '1');
    btn.classList.toggle('btn-ghost', btn.dataset.active !== '1');
    renderGrid();
  }, { signal: listAbort.signal });

  // Klikken in grid
  root.addEventListener('click', async (e) => {
    const fav = e.target.closest('.learning-card-fav');
    if (fav) {
      e.stopPropagation();
      if (fav.dataset.busy === '1') return;
      fav.dataset.busy = '1';
      try {
        const id = fav.dataset.id;
        const out = await apiSend('POST', `/${id}/favorite`);
        if (out?.favorited) cachedFavIds.add(id);
        else cachedFavIds.delete(id);
        fav.classList.toggle('active', out?.favorited);
        fav.innerHTML = out?.favorited ? '❤️' : '♡';
      } catch (err) {
        showToast('Fout: ' + err.message, 'error');
      } finally {
        delete fav.dataset.busy;
      }
      return;
    }

    const del = e.target.closest('.learning-card-delete');
    if (del) {
      e.stopPropagation();
      const id = del.dataset.id;
      const title = del.dataset.title || 'dit item';
      const ok = await confirm(`Weet je zeker dat je "${title}" wilt verwijderen?`);
      if (!ok) return;
      try {
        await apiSend('DELETE', `/${id}`);
        showToast('Verwijderd', 'info');
        await reload();
      } catch (err) {
        showToast('Fout: ' + err.message, 'error');
      }
      return;
    }

    const card = e.target.closest('.learning-card');
    if (card) {
      const id = card.dataset.id;
      Router.navigate('learnings/' + id);
      return;
    }

    if (e.target.closest('#btn-new-learning')) {
      openUploadModal();
      return;
    }
  }, { signal: listAbort.signal });

  setupUploadModal();
}

/* ----------------------------------------
   RELOAD DATA
---------------------------------------- */
async function reload() {
  try {
    const data = await apiGet('');
    cachedItems = data.items || [];
    cachedFavIds = new Set(data.favorites || []);
    renderGrid();
  } catch (err) {
    const grid = document.getElementById('learnings-grid');
    if (grid) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1">
          <div class="empty-state-icon">⚠</div>
          <h3>Fout bij laden</h3>
          <p>${err.message}</p>
        </div>`;
    }
  }
}

/* ----------------------------------------
   RENDER GRID
---------------------------------------- */
function renderGrid() {
  const grid = document.getElementById('learnings-grid');
  if (!grid) return;

  const searchVal = (document.getElementById('learnings-search')?.value || '').toLowerCase();
  const kindVal = document.getElementById('learnings-filter-kind')?.value || '';
  const favOnly = document.getElementById('learnings-filter-fav')?.dataset.active === '1';
  const admin = Store.isAdmin();

  const filtered = cachedItems.filter(it => {
    if (kindVal && it.kind !== kindVal) return false;
    if (favOnly && !cachedFavIds.has(it.id)) return false;
    if (searchVal) {
      const hay = `${it.title || ''} ${it.description || ''} ${(it.tags || []).join(' ')}`.toLowerCase();
      if (!hay.includes(searchVal)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1">
        <div class="empty-state-icon">📚</div>
        <h3>Nog niets om te tonen</h3>
        <p>${admin ? 'Voeg je eerste learning toe via "+ Nieuw item".' : 'Er zijn nog geen learnings beschikbaar.'}</p>
      </div>`;
    return;
  }

  grid.innerHTML = filtered.map(it => {
    const isFav = cachedFavIds.has(it.id);
    const thumb = it.thumbnail_url
      ? `<img class="learning-card-thumb" src="${escapeHtml(it.thumbnail_url)}" alt="" loading="lazy" />`
      : `<div class="learning-card-thumb learning-card-thumb--placeholder">${KIND_ICON[it.kind] || '📚'}</div>`;
    return `
      <article class="learning-card" data-id="${it.id}">
        ${thumb}
        <button class="learning-card-fav ${isFav ? 'active' : ''}" data-id="${it.id}" title="${isFav ? 'Verwijder uit favorieten' : 'Voeg toe aan favorieten'}">
          ${isFav ? '❤️' : '♡'}
        </button>
        <div class="learning-card-body">
          <span class="learning-card-kind learning-card-kind--${it.kind}">${KIND_LABEL[it.kind] || it.kind}</span>
          <h3 class="learning-card-title">${escapeHtml(it.title)}</h3>
          ${it.description ? `<p class="learning-card-desc">${escapeHtml(it.description)}</p>` : ''}
        </div>
        ${admin ? `
          <button class="learning-card-delete" data-id="${it.id}" data-title="${escapeHtml(it.title)}" title="Verwijderen">🗑</button>
        ` : ''}
      </article>
    `;
  }).join('');
}

/* ----------------------------------------
   ADMIN UPLOAD MODAL
---------------------------------------- */
function openUploadModal() {
  const m = document.getElementById('learning-upload-modal');
  if (!m) return;
  m.classList.remove('hidden');
  // Reset
  document.getElementById('lu-kind').value = 'pdf';
  document.getElementById('lu-title').value = '';
  document.getElementById('lu-desc').value = '';
  document.getElementById('lu-body').value = '';
  document.getElementById('lu-file').value = '';
  document.getElementById('lu-thumb').value = '';
  document.getElementById('lu-error').classList.add('hidden');
  document.getElementById('lu-progress').classList.add('hidden');
  syncKindUI('pdf');
}

function closeUploadModal() {
  document.getElementById('learning-upload-modal')?.classList.add('hidden');
}

function syncKindUI(kind) {
  const fileRow = document.getElementById('lu-file-row');
  const blogRow = document.getElementById('lu-blog-row');
  const fileInput = document.getElementById('lu-file');
  const label = document.getElementById('lu-file-label');
  if (kind === 'blog') {
    fileRow.classList.add('hidden');
    blogRow.classList.remove('hidden');
  } else {
    fileRow.classList.remove('hidden');
    blogRow.classList.add('hidden');
    if (kind === 'pdf') {
      fileInput.accept = 'application/pdf';
      label.textContent = 'PDF-bestand';
    } else {
      fileInput.accept = 'video/mp4,video/webm';
      label.textContent = 'Video-bestand (MP4 of WebM)';
    }
  }
}

function setupUploadModal() {
  const kindSel = document.getElementById('lu-kind');
  kindSel?.addEventListener('change', () => syncKindUI(kindSel.value), { signal: listAbort.signal });

  document.getElementById('lu-close')?.addEventListener('click', closeUploadModal, { signal: listAbort.signal });
  document.getElementById('lu-cancel')?.addEventListener('click', closeUploadModal, { signal: listAbort.signal });

  document.getElementById('lu-save')?.addEventListener('click', handleUpload, { signal: listAbort.signal });
}

async function uploadToSignedUrl(signedUrl, file, onProgress) {
  // Supabase signed upload-URL gebruikt PUT met x-upsert header niet vereist;
  // gewoon file als body.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', signedUrl);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload mislukt (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Netwerkfout bij uploaden'));
    xhr.send(file);
  });
}

async function handleUpload() {
  const errEl = document.getElementById('lu-error');
  errEl.classList.add('hidden');

  const kind = document.getElementById('lu-kind').value;
  const title = document.getElementById('lu-title').value.trim();
  const description = document.getElementById('lu-desc').value.trim();
  const file = document.getElementById('lu-file').files[0];
  const thumb = document.getElementById('lu-thumb').files[0];
  const body = document.getElementById('lu-body').value.trim();

  if (!title) return showErr('Titel is verplicht.');
  if (kind === 'blog' && !body) return showErr('Blog-inhoud is verplicht.');
  if ((kind === 'pdf' || kind === 'video') && !file) return showErr('Kies een bestand.');

  const saveBtn = document.getElementById('lu-save');
  saveBtn.disabled = true;
  const progressBox = document.getElementById('lu-progress');
  const progressFill = document.getElementById('lu-progress-fill');
  const progressText = document.getElementById('lu-progress-text');
  progressBox.classList.remove('hidden');
  progressFill.style.width = '0%';
  progressText.textContent = '0%';

  try {
    let storagePath = null;
    let thumbnailUrl = null;

    // 1) Eventuele thumbnail uploaden
    if (thumb) {
      const tu = await apiSend('POST', '/upload-url', {
        kind: 'thumb',
        filename: thumb.name,
        contentType: thumb.type,
      });
      await uploadToSignedUrl(tu.signed_url, thumb);
      thumbnailUrl = tu.public_url;
    }

    // 2) Hoofdbestand (pdf/video) uploaden
    if (kind === 'pdf' || kind === 'video') {
      const uu = await apiSend('POST', '/upload-url', {
        kind,
        filename: file.name,
        contentType: file.type,
      });
      await uploadToSignedUrl(uu.signed_url, file, (pct) => {
        const v = Math.round(pct * 100);
        progressFill.style.width = v + '%';
        progressText.textContent = v + '%';
      });
      storagePath = uu.path;
    }

    // 3) DB-record aanmaken
    const payload = { kind, title, description: description || null };
    if (kind === 'blog') payload.body_html = body;
    if (storagePath) payload.storage_path = storagePath;
    if (thumbnailUrl) payload.thumbnail_url = thumbnailUrl;

    await apiSend('POST', '', payload);
    showToast('Toegevoegd aan Learnings', 'success');
    closeUploadModal();
    await reload();
  } catch (err) {
    showErr(err.message || 'Onbekende fout.');
  } finally {
    saveBtn.disabled = false;
  }

  function showErr(m) {
    errEl.textContent = m;
    errEl.classList.remove('hidden');
    saveBtn.disabled = false;
    progressBox.classList.add('hidden');
  }
}

/* ----------------------------------------
   UTILS
---------------------------------------- */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
