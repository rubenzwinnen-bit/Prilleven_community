/* ============================================
   LEARNINGS DETAIL
   Toont één Learning-item met de juiste viewer
   (pdf / blog / video) + notities-sidebar links.
   Functies:
   - Lindje: auto-save laatste positie (per item),
     bij herladen resumeert de viewer waar je was.
   - Tekst-selectie → popup "Opslaan in notitie".
   - Video: "Bewaar tijdcode" knop bij actieve notitie.
============================================ */

import * as Router from '../router.js?v=2.4.1';
import { showToast } from '../utils.js?v=2.4.1';
import { sessionGet, sessionRefreshIfNeeded } from '../supabase.js?v=2.4.1';

let abort = null;
let item = null;
let notes = [];
let activeNoteId = null;
let bookmark = null;
let bookmarkSaveTimer = null;
let pdfDoc = null;

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

async function api(method, path, body) {
  const res = await fetch(`/api/learnings${path}`, {
    method,
    headers: await authHeaders(body ? { 'Content-Type': 'application/json' } : {}),
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
export function render(id) {
  return `
    <div class="learning-detail" data-id="${id}">
      <div class="learning-detail-top">
        <button class="btn btn-ghost btn-sm" id="ld-back">← Terug</button>
        <h1 class="learning-detail-title" id="ld-title">Laden...</h1>
      </div>
      <div class="learning-detail-body">
        <aside class="learning-notes" aria-label="Notities">
          <div class="learning-notes-header">
            <span>Mijn notities</span>
            <button class="btn btn-primary btn-xs" id="ld-new-note">+ Nieuw</button>
          </div>
          <ul class="learning-notes-list" id="ld-notes-list"></ul>
          <div class="learning-note-editor" id="ld-note-editor" hidden>
            <input class="auth-input" id="ld-note-title" type="text" maxlength="120" placeholder="Titel..." />
            <textarea class="auth-input" id="ld-note-body" rows="6" maxlength="20000" placeholder="Schrijf hier..."></textarea>
            <div id="ld-note-clips" class="learning-note-clips"></div>
            <div class="learning-note-actions">
              <button class="btn btn-ghost btn-xs" id="ld-note-delete">Verwijderen</button>
              <button class="btn btn-primary btn-xs" id="ld-note-save">Opslaan</button>
            </div>
            <div id="ld-clip-video-btn-wrap" hidden>
              <button class="btn btn-ghost btn-xs" id="ld-clip-time">⏱ Bewaar tijdcode</button>
            </div>
          </div>
        </aside>
        <section class="learning-viewer" id="ld-viewer">
          <div class="empty-state"><div class="empty-state-icon">⏳</div><h3>Laden...</h3></div>
        </section>
      </div>

      <!-- Floating "save selection" popup -->
      <div id="ld-sel-popup" class="learning-sel-popup hidden">
        <button class="btn btn-primary btn-xs" id="ld-sel-save">📌 Opslaan in notitie</button>
      </div>
    </div>
  `;
}

/* ----------------------------------------
   INIT
---------------------------------------- */
export async function init(id) {
  if (abort) abort.abort();
  abort = new AbortController();

  // Terug-knop
  document.getElementById('ld-back')?.addEventListener('click', () => {
    Router.navigate('learnings');
  }, { signal: abort.signal });

  // Data ophalen
  try {
    const [detail, noteData, bm] = await Promise.all([
      api('GET', `/${id}`),
      api('GET', `/${id}/notes`),
      api('GET', `/${id}/bookmark`).catch(() => ({ bookmark: null })),
    ]);
    // API: { learning: { ...velden, signed_url, is_favorite, bookmark } }
    item = detail.learning || detail;
    notes = noteData?.notes || [];
    // API: { bookmark: { position, updated_at } | null }
    bookmark = bm?.bookmark?.position || null;
  } catch (err) {
    document.getElementById('ld-viewer').innerHTML = `
      <div class="empty-state"><div class="empty-state-icon">⚠</div><h3>Fout bij laden</h3><p>${err.message}</p></div>`;
    return;
  }

  document.getElementById('ld-title').textContent = item.title;
  renderNotesList();
  setupNoteEditor();
  setupSelectionPopup();
  renderViewer();
}

/* ----------------------------------------
   VIEWER
---------------------------------------- */
function renderViewer() {
  const v = document.getElementById('ld-viewer');
  if (!v || !item) return;
  v.dataset.kind = item.kind;

  if (item.kind === 'blog') {
    v.innerHTML = `<article class="learning-blog" id="ld-blog">${item.body_html || ''}</article>`;
    // Resume scroll
    const scrollPx = bookmark?.scroll_px;
    if (scrollPx) {
      // Wacht tot DOM klaar is
      requestAnimationFrame(() => {
        v.scrollTop = scrollPx;
      });
    }
    v.addEventListener('scroll', () => scheduleBookmark({ scroll_px: Math.round(v.scrollTop) }), { signal: abort.signal });
    return;
  }

  if (item.kind === 'video') {
    const startSec = bookmark?.seconds || 0;
    v.innerHTML = `
      <video id="ld-video"
             controls
             controlsList="nodownload noplaybackrate"
             disablePictureInPicture
             oncontextmenu="return false"
             src="${item.signed_url}"
             style="width:100%; max-height:75vh; background:#000;">
        Je browser ondersteunt geen video-weergave.
      </video>`;
    const vid = document.getElementById('ld-video');
    vid.addEventListener('loadedmetadata', () => {
      if (startSec > 0 && startSec < (vid.duration || Infinity)) vid.currentTime = startSec;
    }, { signal: abort.signal });
    vid.addEventListener('timeupdate', () => {
      scheduleBookmark({ seconds: Math.round(vid.currentTime) });
    }, { signal: abort.signal });
    // Video → toon "Bewaar tijdcode" knop in editor
    toggleVideoClipButton(true);
    return;
  }

  if (item.kind === 'pdf') {
    v.innerHTML = `
      <div class="learning-pdf-toolbar">
        <button class="btn btn-ghost btn-xs" id="pdf-prev">◀</button>
        <span id="pdf-page-info">–</span>
        <button class="btn btn-ghost btn-xs" id="pdf-next">▶</button>
        <span class="learning-pdf-toolbar-sep"></span>
        <button class="btn btn-ghost btn-xs" id="pdf-zoom-out" title="Uitzoomen">−</button>
        <span id="pdf-zoom-info">100%</span>
        <button class="btn btn-ghost btn-xs" id="pdf-zoom-in" title="Inzoomen">+</button>
        <button class="btn btn-ghost btn-xs" id="pdf-zoom-reset" title="Auto-fit">⤢</button>
      </div>
      <div class="learning-pdf-canvas-wrap" id="pdf-canvas-wrap">
        <canvas id="pdf-canvas"></canvas>
        <div class="learning-pdf-textlayer" id="pdf-textlayer"></div>
      </div>`;
    loadPdf(item.signed_url, bookmark?.page_nr || 1);
    return;
  }

  v.innerHTML = `<div class="empty-state"><h3>Onbekend type</h3></div>`;
}

/* ----------------------------------------
   PDF VIEWER (PDF.js via CDN)
---------------------------------------- */
let pdfCurrentPage = 1;
let pdfLib = null;
let pdfZoom = null; // null = auto-fit; anders user-zoom factor (0.5 - 4)

async function loadPdfLib() {
  if (pdfLib) return pdfLib;
  // Dynamic ESM import via CDN
  const mod = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs');
  mod.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs';
  pdfLib = mod;
  return mod;
}

async function loadPdf(url, startPage) {
  try {
    const lib = await loadPdfLib();
    pdfDoc = await lib.getDocument(url).promise;
    pdfCurrentPage = Math.min(Math.max(startPage, 1), pdfDoc.numPages);
    document.getElementById('pdf-prev')?.addEventListener('click', () => changePage(-1), { signal: abort.signal });
    document.getElementById('pdf-next')?.addEventListener('click', () => changePage(+1), { signal: abort.signal });
    document.getElementById('pdf-zoom-in')?.addEventListener('click', () => changeZoom(+0.2), { signal: abort.signal });
    document.getElementById('pdf-zoom-out')?.addEventListener('click', () => changeZoom(-0.2), { signal: abort.signal });
    document.getElementById('pdf-zoom-reset')?.addEventListener('click', () => { pdfZoom = null; renderPdfPage(); }, { signal: abort.signal });
    await renderPdfPage();
  } catch (err) {
    document.getElementById('ld-viewer').innerHTML = `
      <div class="empty-state"><div class="empty-state-icon">⚠</div><h3>PDF kon niet geladen worden</h3><p>${err.message}</p></div>`;
  }
}

function changeZoom(delta) {
  if (!pdfDoc) return;
  // Vertrek vanaf huidige auto-fit als er nog geen user-zoom is.
  const current = pdfZoom ?? computeAutoFitScale();
  pdfZoom = Math.min(4, Math.max(0.5, current + delta));
  renderPdfPage();
}

function computeAutoFitScale() {
  const viewer = document.getElementById('ld-viewer');
  const containerWidth = Math.max(320, (viewer?.clientWidth || 800) - 32);
  // Default PDF-pagina is ongeveer 612pt (US Letter) of 595pt (A4) breed.
  // We gebruiken een vaste referentie zodat zoom-stappen voorspelbaar zijn.
  return Math.min(2, Math.max(0.8, containerWidth / 612));
}

async function changePage(delta) {
  if (!pdfDoc) return;
  const next = pdfCurrentPage + delta;
  if (next < 1 || next > pdfDoc.numPages) return;
  pdfCurrentPage = next;
  await renderPdfPage();
  scheduleBookmark({ page_nr: pdfCurrentPage });
}

async function renderPdfPage() {
  if (!pdfDoc) return;
  const page = await pdfDoc.getPage(pdfCurrentPage);
  const canvas = document.getElementById('pdf-canvas');
  const ctx = canvas.getContext('2d');
  // Bepaal de render-scale: user-zoom wint, anders auto-fit op de viewer.
  // We meten de viewer-container (parent) i.p.v. de wrap zelf (kip-en-ei
  // bij width:fit-content).
  const viewer = document.getElementById('ld-viewer');
  const containerWidth = Math.max(320, (viewer?.clientWidth || 800) - 32);
  const viewport0 = page.getViewport({ scale: 1 });
  const autoScale = Math.min(2, Math.max(0.8, containerWidth / viewport0.width));
  const scale = pdfZoom ?? autoScale;
  const viewport = page.getViewport({ scale });
  // Render op devicePixelRatio voor scherpe tekst op retina-schermen.
  // Canvas is intern groter dan de zichtbare CSS-pixels; PDF.js krijgt
  // een extra transform mee zodat alles op de juiste schaal getekend wordt.
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = viewport.width + 'px';
  canvas.style.height = viewport.height + 'px';
  const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null;
  await page.render({ canvasContext: ctx, viewport, transform }).promise;

  // Text layer voor selectie → "Opslaan in notitie".
  // We gebruiken PDF.js' officiële TextLayer-builder zodat font-scale,
  // kerning en transforms exact matchen met de canvas-render.
  const tl = document.getElementById('pdf-textlayer');
  if (tl && pdfLib) {
    tl.innerHTML = '';
    tl.style.width = viewport.width + 'px';
    tl.style.height = viewport.height + 'px';
    // PDF.js v4 vereist --scale-factor op de container voor correcte
    // font-size berekening; zonder dit zijn de tekst-spans niet te selecteren.
    tl.style.setProperty('--scale-factor', String(scale));
    try {
      const TextLayerCtor = pdfLib.TextLayer;
      if (TextLayerCtor) {
        const textLayer = new TextLayerCtor({
          textContentSource: page.streamTextContent({
            includeMarkedContent: true,
            disableNormalization: true,
          }),
          container: tl,
          viewport,
        });
        await textLayer.render();
      } else if (typeof pdfLib.renderTextLayer === 'function') {
        // Fallback voor oudere PDF.js-builds.
        await pdfLib.renderTextLayer({
          textContentSource: page.streamTextContent(),
          container: tl,
          viewport,
        }).promise;
      }
    } catch { /* text-layer is best-effort */ }
  }

  document.getElementById('pdf-page-info').textContent = `${pdfCurrentPage} / ${pdfDoc.numPages}`;
  const zoomInfo = document.getElementById('pdf-zoom-info');
  if (zoomInfo) zoomInfo.textContent = Math.round(scale * 100) + '%';
}

/* ----------------------------------------
   BOOKMARK (lindje) — debounced save
---------------------------------------- */
function scheduleBookmark(position) {
  if (!item) return;
  bookmark = { ...(bookmark || {}), ...position };
  if (bookmarkSaveTimer) clearTimeout(bookmarkSaveTimer);
  bookmarkSaveTimer = setTimeout(async () => {
    try { await api('PUT', `/${item.id}/bookmark`, { position: bookmark }); } catch {}
  }, 1500);
}

/* ----------------------------------------
   NOTES SIDEBAR
---------------------------------------- */
function renderNotesList() {
  const ul = document.getElementById('ld-notes-list');
  if (!ul) return;
  if (notes.length === 0) {
    ul.innerHTML = `<li class="learning-notes-empty">Nog geen notities.</li>`;
    return;
  }
  ul.innerHTML = notes.map(n => `
    <li class="learning-note-item ${n.id === activeNoteId ? 'is-active' : ''}" data-id="${n.id}">
      <span class="learning-note-item-title">${escapeHtml(n.title || 'Notitie')}</span>
    </li>
  `).join('');
}

function setupNoteEditor() {
  const list = document.getElementById('ld-notes-list');
  list?.addEventListener('click', (e) => {
    const li = e.target.closest('.learning-note-item');
    if (!li) return;
    activeNoteId = li.dataset.id;
    renderNotesList();
    renderNoteEditor();
  }, { signal: abort.signal });

  document.getElementById('ld-new-note')?.addEventListener('click', async () => {
    try {
      const out = await api('POST', `/${item.id}/notes`, { title: 'Nieuwe notitie', body: '' });
      notes.unshift(out.note);
      activeNoteId = out.note.id;
      renderNotesList();
      renderNoteEditor();
    } catch (err) {
      showToast('Fout: ' + err.message, 'error');
    }
  }, { signal: abort.signal });

  document.getElementById('ld-note-save')?.addEventListener('click', saveActiveNote, { signal: abort.signal });
  document.getElementById('ld-note-delete')?.addEventListener('click', deleteActiveNote, { signal: abort.signal });

  // Video tijdcode-knop
  document.getElementById('ld-clip-time')?.addEventListener('click', async () => {
    if (!activeNoteId) {
      showToast('Selecteer eerst een notitie.', 'info');
      return;
    }
    const vid = document.getElementById('ld-video');
    if (!vid) return;
    const seconds = Math.round(vid.currentTime);
    try {
      const out = await api('POST', `/notes/${activeNoteId}/clips`, {
        clip_type: 'timecode',
        seconds,
        body: null,
      });
      const note = notes.find(n => n.id === activeNoteId);
      if (note) {
        note.clips = note.clips || [];
        note.clips.push(out.clip);
      }
      renderNoteEditor();
      showToast(`Tijdcode ${formatSec(seconds)} opgeslagen`, 'success');
    } catch (err) {
      showToast('Fout: ' + err.message, 'error');
    }
  }, { signal: abort.signal });
}

function renderNoteEditor() {
  const ed = document.getElementById('ld-note-editor');
  const note = notes.find(n => n.id === activeNoteId);
  if (!note) { ed.hidden = true; return; }
  ed.hidden = false;
  document.getElementById('ld-note-title').value = note.title || '';
  document.getElementById('ld-note-body').value = note.body || '';
  renderClips(note);
}

function renderClips(note) {
  const wrap = document.getElementById('ld-note-clips');
  if (!wrap) return;
  const clips = note.clips || [];
  if (clips.length === 0) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `
    <div class="learning-note-clips-list">
      ${clips.map(c => `
        <div class="learning-note-clip" data-id="${c.id}">
          ${c.clip_type === 'timecode'
              ? `<button class="learning-note-clip-time" data-seconds="${c.seconds || 0}">⏱ ${formatSec(c.seconds || 0)}</button>`
              : `<blockquote>
                   ${c.page_nr ? `<button class="learning-note-clip-page" data-page="${c.page_nr}" title="Ga naar pagina ${c.page_nr}">p. ${c.page_nr}</button>` : ''}
                   "${escapeHtml((c.body || '').slice(0, 240))}${(c.body || '').length > 240 ? '…' : ''}"
                 </blockquote>`}
          <button class="learning-note-clip-remove" data-id="${c.id}" title="Verwijder">×</button>
        </div>
      `).join('')}
    </div>`;

  // Tijdcode-knoppen → spring naar moment in video
  wrap.querySelectorAll('.learning-note-clip-time').forEach(btn => {
    btn.addEventListener('click', () => {
      const sec = parseInt(btn.dataset.seconds, 10) || 0;
      const vid = document.getElementById('ld-video');
      if (vid) {
        vid.currentTime = sec;
        vid.play().catch(() => {});
      }
    }, { signal: abort.signal });
  });
  // Pagina-knoppen → spring naar pagina in PDF
  wrap.querySelectorAll('.learning-note-clip-page').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = parseInt(btn.dataset.page, 10) || 1;
      if (!pdfDoc) return;
      pdfCurrentPage = Math.min(Math.max(p, 1), pdfDoc.numPages);
      renderPdfPage();
      scheduleBookmark({ page_nr: pdfCurrentPage });
    }, { signal: abort.signal });
  });
  wrap.querySelectorAll('.learning-note-clip-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const clipId = btn.dataset.id;
      try {
        await api('DELETE', `/clips/${clipId}`);
        const note = notes.find(n => n.id === activeNoteId);
        if (note) note.clips = (note.clips || []).filter(c => c.id !== clipId);
        renderNoteEditor();
      } catch (err) {
        showToast('Fout: ' + err.message, 'error');
      }
    }, { signal: abort.signal });
  });
}

async function saveActiveNote() {
  const note = notes.find(n => n.id === activeNoteId);
  if (!note) return;
  const title = document.getElementById('ld-note-title').value.trim() || 'Notitie';
  const body = document.getElementById('ld-note-body').value;
  try {
    const out = await api('PATCH', `/notes/${note.id}`, { title, body });
    Object.assign(note, out.note);
    renderNotesList();
    showToast('Opgeslagen', 'success');
  } catch (err) {
    showToast('Fout: ' + err.message, 'error');
  }
}

async function deleteActiveNote() {
  const note = notes.find(n => n.id === activeNoteId);
  if (!note) return;
  if (!window.confirm(`Notitie "${note.title}" verwijderen?`)) return;
  try {
    await api('DELETE', `/notes/${note.id}`);
    notes = notes.filter(n => n.id !== note.id);
    activeNoteId = notes[0]?.id || null;
    renderNotesList();
    renderNoteEditor();
  } catch (err) {
    showToast('Fout: ' + err.message, 'error');
  }
}

function toggleVideoClipButton(show) {
  const wrap = document.getElementById('ld-clip-video-btn-wrap');
  if (wrap) wrap.hidden = !show;
}

/* ----------------------------------------
   TEXT SELECTION POPUP
   Toon "Opslaan in notitie" bij selectie in
   blog of pdf-textlayer.
---------------------------------------- */
function setupSelectionPopup() {
  const popup = document.getElementById('ld-sel-popup');
  if (!popup) return;

  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() || '';
    if (!text || text.length < 3) { popup.classList.add('hidden'); return; }
    const node = sel.anchorNode;
    if (!node) { popup.classList.add('hidden'); return; }
    const viewer = document.getElementById('ld-viewer');
    if (!viewer?.contains(node)) { popup.classList.add('hidden'); return; }

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) { popup.classList.add('hidden'); return; }
    popup.style.top = (window.scrollY + rect.top - 44) + 'px';
    popup.style.left = (window.scrollX + rect.left + rect.width / 2 - 90) + 'px';
    popup.classList.remove('hidden');
  }, { signal: abort.signal });

  document.getElementById('ld-sel-save')?.addEventListener('click', async () => {
    const text = window.getSelection()?.toString().trim() || '';
    if (!text) return;
    if (!activeNoteId) {
      // Maak automatisch nieuwe notitie als er geen actieve is
      try {
        const out = await api('POST', `/${item.id}/notes`, { title: 'Notitie', body: '' });
        notes.unshift(out.note);
        activeNoteId = out.note.id;
        renderNotesList();
        renderNoteEditor();
      } catch (err) {
        showToast('Fout: ' + err.message, 'error'); return;
      }
    }
    try {
      const out = await api('POST', `/notes/${activeNoteId}/clips`, {
        clip_type: 'text',
        body: text.slice(0, 4000),
        page_nr: item.kind === 'pdf' ? pdfCurrentPage : null,
      });
      const note = notes.find(n => n.id === activeNoteId);
      if (note) {
        note.clips = note.clips || [];
        note.clips.push(out.clip);
      }
      renderNoteEditor();
      popup.classList.add('hidden');
      window.getSelection()?.removeAllRanges();
      showToast('Selectie opgeslagen in notitie', 'success');
    } catch (err) {
      showToast('Fout: ' + err.message, 'error');
    }
  }, { signal: abort.signal });
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

function formatSec(s) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}
