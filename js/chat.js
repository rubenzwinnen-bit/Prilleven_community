// Chat frontend met sidebar-gebaseerde conversatie-management.
// Vereist een geldige Supabase sessie (gezet door de hoofdsite-login).

import { sessionGet, sessionRefreshIfNeeded, sessionClear } from './supabase.js';

// ---------- DOM refs ----------
const form = document.getElementById('form');
const input = document.getElementById('q');
const log = document.getElementById('log');
const sendBtn = document.getElementById('send');
const counter = document.getElementById('count');
const convList = document.getElementById('conv-list');
const btnNewChat = document.getElementById('btn-new-chat');
const headerEmail = document.getElementById('header-user-email');
const hamburger = document.getElementById('toggle-sidebar');
const sidebar = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const btnProfile = document.getElementById('btn-profile');
const btnMemory = document.getElementById('btn-memory');

// Memory-modal refs
const memoryModal = document.getElementById('memory-modal');
const memList = document.getElementById('mem-list');
const memClearAll = document.getElementById('mem-clear-all');
const memClose = document.getElementById('mem-close');

// Profiel-modal refs
const profileModal = document.getElementById('profile-modal');
const pfName = document.getElementById('pf-name');
const pfChildren = document.getElementById('pf-children');
const pfAddChild = document.getElementById('pf-add-child');
const pfDiet = document.getElementById('pf-diet');
const pfNotes = document.getElementById('pf-notes');
const pfMemory = document.getElementById('pf-memory');
const pfSave = document.getElementById('pf-save');
const pfCancel = document.getElementById('pf-cancel');

// ---------- State ----------
let currentConversationId = null;
let conversations = []; // {id, title, updated_at}

// ---------- Utilities ----------
function stripMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1$2');
}

function relativeTime(iso) {
  const d = new Date(iso);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'net';
  if (s < 3600) return `${Math.floor(s / 60)} min geleden`;
  if (s < 86400) return `${Math.floor(s / 3600)} u geleden`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d geleden`;
  return d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' });
}

function appendMsg(role, text, extra = '') {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  if (extra) {
    const small = document.createElement('small');
    small.textContent = extra;
    div.appendChild(small);
  }
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

function clearLog() {
  log.innerHTML = '';
}

function showWelcome() {
  clearLog();
  const welcome = document.createElement('div');
  welcome.className = 'msg bot';
  welcome.innerHTML = `Hallo! Ik ben HapjesHeld, de AI-assistent van Pril Leven. Je kan me vragen stellen over kindervoeding. Bijvoorbeeld:
  <br /><br />
  • <em>Wanneer mag mijn kindje starten met vast voedsel?</em><br />
  • <em>Hoe introduceer ik pindakaas bij 8 maanden?</em><br />
  • <em>Wat als mijn kindje de lepel wegduwt?</em>`;
  log.appendChild(welcome);
}

function closeMobileSidebar() {
  sidebar.classList.remove('open');
  sidebarBackdrop.classList.remove('visible');
}

// ---------- API helpers ----------
async function authedFetch(url, opts = {}) {
  const session = await sessionRefreshIfNeeded();
  if (!session) {
    sessionClear();
    window.location.href = '/';
    throw new Error('Geen geldige sessie');
  }
  const headers = {
    ...(opts.headers || {}),
    Authorization: 'Bearer ' + session.access_token,
  };
  if (opts.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401) {
    sessionClear();
    window.location.href = '/';
    throw new Error('Sessie verlopen');
  }
  return res;
}

async function fetchConversations() {
  const res = await authedFetch('/api/conversations');
  if (!res.ok) throw new Error('Kon gesprekken niet laden.');
  const data = await res.json();
  conversations = data.conversations || [];
  renderSidebar();
}

async function createNewConversation() {
  const res = await authedFetch('/api/conversations', { method: 'POST' });
  if (!res.ok) throw new Error('Kon geen nieuw gesprek maken.');
  const data = await res.json();
  // Refresh lijst + selecteer de nieuwe
  await fetchConversations();
  selectConversation(data.id);
}

async function loadConversation(id) {
  const res = await authedFetch('/api/conversations/' + encodeURIComponent(id));
  if (!res.ok) throw new Error('Kon gesprek niet laden.');
  const data = await res.json();
  currentConversationId = data.conversation.id;
  clearLog();
  if (!data.messages?.length) {
    showWelcome();
  } else {
    for (const m of data.messages) {
      const role = m.role === 'assistant' ? 'bot' : 'user';
      appendMsg(role, m.role === 'assistant' ? stripMarkdown(m.content) : m.content);
    }
  }
  highlightActive();
}

async function renameConversation(id, newTitle) {
  const res = await authedFetch('/api/conversations/' + encodeURIComponent(id), {
    method: 'PATCH',
    body: JSON.stringify({ title: newTitle }),
  });
  if (!res.ok) throw new Error('Hernoemen mislukt.');
}

async function deleteConversationCall(id) {
  const res = await authedFetch('/api/conversations/' + encodeURIComponent(id), {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 204) throw new Error('Verwijderen mislukt.');
}

// ---------- Sidebar rendering ----------
function renderSidebar() {
  if (!conversations.length) {
    convList.innerHTML = '<div class="conv-empty">Nog geen gesprekken.<br>Klik op "＋ Nieuw gesprek" om te starten.</div>';
    return;
  }
  convList.innerHTML = '';
  for (const c of conversations) {
    const div = document.createElement('div');
    div.className = 'conv-item';
    div.dataset.id = c.id;
    if (c.id === currentConversationId) div.classList.add('active');

    const titleEl = document.createElement('div');
    titleEl.className = 'conv-title';
    titleEl.textContent = c.title || 'Nieuw gesprek';
    titleEl.title = c.title || 'Nieuw gesprek';

    const actions = document.createElement('div');
    actions.className = 'conv-actions';

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.textContent = '✎';
    renameBtn.title = 'Hernoemen';
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startRename(titleEl, c);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = '🗑';
    deleteBtn.title = 'Verwijderen';
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Gesprek "${c.title || 'Nieuw gesprek'}" verwijderen?`)) return;
      try {
        await deleteConversationCall(c.id);
        if (c.id === currentConversationId) {
          currentConversationId = null;
          showWelcome();
        }
        await fetchConversations();
      } catch (err) {
        alert(err.message);
      }
    });

    actions.appendChild(renameBtn);
    actions.appendChild(deleteBtn);

    div.appendChild(titleEl);
    div.appendChild(actions);

    div.addEventListener('click', () => selectConversation(c.id));

    convList.appendChild(div);
  }
}

function highlightActive() {
  document.querySelectorAll('.conv-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === currentConversationId);
  });
}

function startRename(titleEl, conv) {
  titleEl.contentEditable = 'true';
  titleEl.focus();
  // Selecteer alle tekst
  const range = document.createRange();
  range.selectNodeContents(titleEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const finish = async (save) => {
    titleEl.contentEditable = 'false';
    const newTitle = titleEl.textContent.trim();
    if (!save || !newTitle || newTitle === (conv.title || 'Nieuw gesprek')) {
      titleEl.textContent = conv.title || 'Nieuw gesprek';
      return;
    }
    try {
      await renameConversation(conv.id, newTitle);
      conv.title = newTitle;
      titleEl.title = newTitle;
    } catch (err) {
      alert(err.message);
      titleEl.textContent = conv.title || 'Nieuw gesprek';
    }
  };
  const onBlur = () => finish(true);
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); titleEl.blur(); }
  };
  titleEl.addEventListener('blur', onBlur, { once: true });
  titleEl.addEventListener('keydown', onKey);
}

async function selectConversation(id) {
  try {
    await loadConversation(id);
    closeMobileSidebar();
  } catch (err) {
    alert(err.message);
  }
}

// ---------- Profile modal ----------
let currentProfile = null;

function renderChildRow(child = {}, index = 0) {
  const row = document.createElement('div');
  row.className = 'child-row';
  const allergiesStr = Array.isArray(child.allergies) ? child.allergies.join(', ') : '';
  row.innerHTML = `
    <div class="row-top">
      <input type="text" class="pf-child-name" placeholder="Naam (bv. Lou)" maxlength="50" value="${(child.name || '').replace(/"/g, '&quot;')}" />
      <input type="date" class="pf-child-birth" value="${child.birthdate || ''}" />
    </div>
    <input type="text" class="pf-child-allergies" maxlength="300" placeholder="Allergieën (komma-gescheiden, bv. pinda, melk)" value="${allergiesStr.replace(/"/g, '&quot;')}" style="margin-top:.5rem;" />
    <textarea class="pf-child-notes" maxlength="200" placeholder="Notities over dit kind (bv. eczeem, weigert groene groenten)">${(child.notes || '')}</textarea>
    <button class="btn-remove" type="button">× verwijderen</button>
  `;
  row.querySelector('.btn-remove').addEventListener('click', () => row.remove());
  return row;
}

function openProfileModal() {
  // Reset fields
  pfName.value = currentProfile?.display_name || '';
  pfChildren.innerHTML = '';
  const children = currentProfile?.children?.length ? currentProfile.children : [{}];
  for (const c of children) pfChildren.appendChild(renderChildRow(c));
  // Dieet checkboxes
  const dietSet = new Set(currentProfile?.diet || []);
  pfDiet.querySelectorAll('label').forEach(l => {
    const input = l.querySelector('input');
    input.checked = dietSet.has(input.value);
    l.classList.toggle('checked', input.checked);
  });
  pfNotes.value = currentProfile?.notes || '';
  pfMemory.checked = currentProfile?.memory_enabled !== false;

  profileModal.classList.add('visible');
}

function closeProfileModal() {
  profileModal.classList.remove('visible');
}

function collectProfileFromModal() {
  const children = Array.from(pfChildren.querySelectorAll('.child-row')).map(row => ({
    name: row.querySelector('.pf-child-name').value.trim(),
    birthdate: row.querySelector('.pf-child-birth').value || null,
    notes: row.querySelector('.pf-child-notes').value.trim(),
    allergies: row.querySelector('.pf-child-allergies').value
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean),
  })).filter(c => c.name || c.birthdate);

  const diet = Array.from(pfDiet.querySelectorAll('input:checked')).map(i => i.value);

  return {
    display_name: pfName.value.trim(),
    children,
    diet,
    notes: pfNotes.value.trim(),
    memory_enabled: pfMemory.checked,
  };
}

async function saveProfile() {
  const body = collectProfileFromModal();
  pfSave.disabled = true;
  pfSave.textContent = 'Opslaan…';
  try {
    const res = await authedFetch('/api/profile', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Opslaan mislukt.');
    }
    const data = await res.json();
    currentProfile = data.profile;
    closeProfileModal();
  } catch (err) {
    alert(err.message);
  } finally {
    pfSave.disabled = false;
    pfSave.textContent = 'Opslaan';
  }
}

async function loadProfile() {
  try {
    const res = await authedFetch('/api/profile');
    if (!res.ok) return null;
    const data = await res.json();
    currentProfile = data.profile;
    return currentProfile;
  } catch (err) {
    console.error('loadProfile:', err);
    return null;
  }
}

// Event handlers profile modal
pfAddChild.addEventListener('click', () => {
  pfChildren.appendChild(renderChildRow());
});
pfCancel.addEventListener('click', closeProfileModal);
pfSave.addEventListener('click', saveProfile);
pfDiet.addEventListener('change', (e) => {
  if (e.target.matches('input[type="checkbox"]')) {
    e.target.closest('label').classList.toggle('checked', e.target.checked);
  }
});
btnProfile.addEventListener('click', openProfileModal);
profileModal.addEventListener('click', (e) => {
  if (e.target === profileModal) closeProfileModal();
});

// ---------- GDPR: data-export + account-verwijdering ----------
const pfExport = document.getElementById('pf-export');
const pfDelete = document.getElementById('pf-delete');

pfExport?.addEventListener('click', async () => {
  pfExport.disabled = true;
  const original = pfExport.textContent;
  pfExport.textContent = 'Downloaden…';
  try {
    const session = await sessionRefreshIfNeeded();
    if (!session) { window.location.href = '/'; return; }
    const res = await fetch('/api/me', {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + session.access_token },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Download mislukt.');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pril-leven-export-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(err.message);
  } finally {
    pfExport.disabled = false;
    pfExport.textContent = original;
  }
});

pfDelete?.addEventListener('click', async () => {
  const confirm1 = confirm(
    'Ben je zeker dat je je account wilt verwijderen?\n\n' +
    'Dit wist ONMIDDELLIJK en PERMANENT:\n' +
    '• Je profiel (kinderen, dieet, allergieën)\n' +
    '• Al je gesprekken met HapjesHeld\n' +
    '• Het persoonlijke geheugen\n' +
    '• Je login-account\n\n' +
    'Dit kan niet ongedaan gemaakt worden.'
  );
  if (!confirm1) return;
  const confirm2 = prompt('Typ "VERWIJDER" in hoofdletters om te bevestigen:');
  if (confirm2 !== 'VERWIJDER') {
    alert('Verwijdering geannuleerd.');
    return;
  }

  pfDelete.disabled = true;
  pfDelete.textContent = 'Verwijderen…';
  try {
    const session = await sessionRefreshIfNeeded();
    if (!session) { window.location.href = '/'; return; }
    const res = await fetch('/api/me', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + session.access_token },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 207) {
      throw new Error(data.error || 'Verwijderen mislukt.');
    }
    sessionClear();
    localStorage.removeItem('receptenboek_user');
    alert(data.message || 'Je data is verwijderd. Je wordt uitgelogd.');
    window.location.href = '/';
  } catch (err) {
    alert(err.message);
    pfDelete.disabled = false;
    pfDelete.textContent = '🗑 Verwijder mijn account';
  }
});

// ---------- Memory modal ----------
function relTime(iso) {
  const d = new Date(iso);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'net';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} u`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d`;
  return d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderMemoryList(memories) {
  if (!memories || memories.length === 0) {
    memList.innerHTML = '<div class="mem-empty">Nog geen geheugen. Naarmate je meer gesprekken voert, leert HapjesHeld je gezin beter kennen.</div>';
    return;
  }
  memList.innerHTML = '';
  for (const m of memories) {
    const row = document.createElement('div');
    row.className = 'mem-item';
    row.dataset.id = m.id;
    const lastUsed = m.last_used_at ? `laatst gebruikt ${relTime(m.last_used_at)} geleden` : 'nog niet gebruikt';
    row.innerHTML = `
      <span class="badge imp-${m.importance}">${m.importance}</span>
      <div class="mem-text">
        ${m.content.replace(/</g, '&lt;')}
        <div class="mem-meta">Opgeslagen ${relTime(m.created_at)} geleden · ${lastUsed}</div>
      </div>
      <button class="mem-delete" type="button" title="Verwijderen">✕</button>
    `;
    row.querySelector('.mem-delete').addEventListener('click', async () => {
      if (!confirm('Dit feit uit het geheugen verwijderen?')) return;
      try {
        const res = await authedFetch('/api/memory/' + encodeURIComponent(m.id), { method: 'DELETE' });
        if (!res.ok && res.status !== 204) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Verwijderen mislukt.');
        }
        row.remove();
        if (memList.querySelectorAll('.mem-item').length === 0) {
          renderMemoryList([]);
        }
      } catch (err) {
        alert(err.message);
      }
    });
    memList.appendChild(row);
  }
}

async function openMemoryModal() {
  memoryModal.classList.add('visible');
  memList.innerHTML = '<div class="mem-empty">Geheugen laden…</div>';
  try {
    const res = await authedFetch('/api/memory');
    if (!res.ok) throw new Error('Kon geheugen niet laden.');
    const data = await res.json();
    renderMemoryList(data.memories);
  } catch (err) {
    memList.innerHTML = `<div class="mem-empty" style="color:var(--color-danger);">${err.message}</div>`;
  }
}

function closeMemoryModal() {
  memoryModal.classList.remove('visible');
}

memClose.addEventListener('click', closeMemoryModal);
memClearAll.addEventListener('click', async () => {
  if (!confirm('Alle geheugen wissen? Dit kan niet ongedaan gemaakt worden. Je profiel en gesprekken blijven wel bewaard.')) return;
  try {
    const res = await authedFetch('/api/memory', { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Wissen mislukt.');
    }
    renderMemoryList([]);
  } catch (err) {
    alert(err.message);
  }
});
btnMemory?.addEventListener('click', openMemoryModal);
memoryModal?.addEventListener('click', (e) => {
  if (e.target === memoryModal) closeMemoryModal();
});

// ---------- Chat submit ----------
input.addEventListener('input', () => {
  counter.textContent = input.value.length;
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    form.requestSubmit();
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const question = input.value.trim();
  if (question.length < 3) return;

  appendMsg('user', question);
  input.value = '';
  counter.textContent = '0';
  sendBtn.disabled = true;
  sendBtn.textContent = 'Even zoeken...';

  try {
    const res = await authedFetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ question, conversation_id: currentConversationId }),
    });
    const data = await res.json();

    if (!res.ok) {
      appendMsg('err', data.error || 'Onbekende fout.');
    } else {
      const meta = [
        data.cached ? '✓ uit cache' : null,
        data.sources?.length ? `${data.sources.length} bron${data.sources.length > 1 ? 'nen' : ''}` : null,
        data.topScore ? `relevantie ${(data.topScore * 100).toFixed(0)}%` : null,
      ].filter(Boolean).join(' · ');
      appendMsg('bot', stripMarkdown(data.answer), meta);

      // Als dit het eerste bericht was (nieuwe conversatie), update state
      const wasNew = currentConversationId !== data.conversation_id;
      currentConversationId = data.conversation_id;

      if (wasNew || conversations.length === 0) {
        await fetchConversations();
      } else {
        // Simpele heruitlijning: huidige naar boven
        const idx = conversations.findIndex(c => c.id === currentConversationId);
        if (idx > 0) {
          const [c] = conversations.splice(idx, 1);
          c.updated_at = new Date().toISOString();
          conversations.unshift(c);
          renderSidebar();
        } else {
          // Misschien is titel net gegenereerd — refetch na korte delay
          setTimeout(fetchConversations, 1500);
        }
      }
    }
  } catch (err) {
    appendMsg('err', 'Netwerkfout. Is de server bereikbaar?');
    console.error(err);
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = 'Stuur';
    input.focus();
  }
});

// ---------- Init ----------
btnNewChat.addEventListener('click', async () => {
  try {
    await createNewConversation();
    closeMobileSidebar();
  } catch (err) {
    alert(err.message);
  }
});

hamburger?.addEventListener('click', () => {
  sidebar.classList.toggle('open');
  sidebarBackdrop.classList.toggle('visible');
});
sidebarBackdrop?.addEventListener('click', closeMobileSidebar);

async function init() {
  const session = await sessionRefreshIfNeeded();
  if (!session) {
    sessionClear();
    window.location.href = '/';
    return;
  }
  if (headerEmail && session.email) {
    headerEmail.textContent = session.email;
    headerEmail.classList.add('visible');
  }

  try {
    // Parallel: profiel + conversaties laden
    await Promise.all([loadProfile(), fetchConversations()]);

    if (conversations.length > 0) {
      await loadConversation(conversations[0].id);
    } else {
      showWelcome();
    }

    // Eerste bezoek zonder profiel → modal
    if (!currentProfile) {
      openProfileModal();
    }
  } catch (err) {
    console.error('Init error:', err);
    appendMsg('err', 'Kon de chat niet laden. Probeer de pagina te verversen.');
  }
}

init();
