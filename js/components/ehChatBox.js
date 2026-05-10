/* ============================================
   EERSTE HAPJES — embedded HapjesHeld chat (item C)
   Mini-chat per kindje, onderaan Vandaag-pagina.
   Slaat 1 conversatie per kindje op (localStorage map child_id → conv_id),
   zodat de RAG-bot context behoudt over sessies heen.
   "Volledig gesprek"-link gaat naar chat.html.
============================================ */

import { escapeHtml, showToast } from '../utils.js?v=2.26.0';
import { sessionRefreshIfNeeded } from '../supabase.js?v=2.26.0';

const LS_KEY = 'eh.chat.convByChild.v1';

function getConvMap() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {};
  } catch { return {}; }
}
function setConvForChild(childId, convId) {
  const m = getConvMap();
  m[childId] = convId;
  try { localStorage.setItem(LS_KEY, JSON.stringify(m)); } catch { /* quota */ }
}

/**
 * Render-string voor de chat-card. Rendert de leeg-staat — het bind-deel
 * vervangt content op basis van de laatste exchange in localStorage.
 */
export function renderEhChatBox(child) {
  return `
    <div class="eh-chat-card" data-eh-chat>
      <header class="eh-chat-head">
        <h3>Vraag aan HapjesHeld</h3>
        <a class="eh-chat-fulllink" href="chat.html" rel="noopener">Volledig gesprek →</a>
      </header>
      <div class="eh-chat-thread" data-eh-chat-thread>
        <div class="eh-chat-empty">Stel een vraag over ${escapeHtml(child?.name || 'je kindje')} — HapjesHeld kent z'n leeftijd, allergenen en gelogde maaltijden.</div>
      </div>
      <form class="eh-chat-form" data-eh-chat-form>
        <textarea class="eh-chat-input" data-eh-chat-input
                  rows="2"
                  maxlength="1000"
                  placeholder="Schrijf je vraag…"></textarea>
        <button class="btn btn-primary eh-chat-send" type="submit" data-eh-chat-send>Verstuur</button>
      </form>
    </div>
  `;
}

/**
 * Bind events op de chat-card binnen `root`.
 * @param {HTMLElement} root
 * @param {object} child — { id, name, ... }
 */
export function bindEhChatBox(root, child) {
  const card = root.querySelector('[data-eh-chat]');
  if (!card) return;
  const threadEl = card.querySelector('[data-eh-chat-thread]');
  const input = card.querySelector('[data-eh-chat-input]');
  const form = card.querySelector('[data-eh-chat-form]');
  const sendBtn = card.querySelector('[data-eh-chat-send]');

  let convId = getConvMap()[child.id] || null;
  let lastExchange = null; // { question, answer }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = (input.value || '').trim();
    if (!q) return;

    // Render user message + thinking-state
    lastExchange = { question: q, answer: null };
    renderThread();
    input.value = '';
    input.disabled = true;
    sendBtn.disabled = true;

    try {
      const session = await sessionRefreshIfNeeded();
      if (!session) {
        showToast('Niet ingelogd — log opnieuw in.', 'error');
        return;
      }
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + session.access_token,
        },
        body: JSON.stringify({
          question: q,
          conversation_id: convId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        lastExchange.answer = `_Fout: ${data.error || 'Er ging iets mis.'}_`;
        renderThread();
        return;
      }
      // Bewaar conversation_id voor volgende vraag
      if (data.conversation_id && data.conversation_id !== convId) {
        convId = data.conversation_id;
        setConvForChild(child.id, convId);
      }
      lastExchange.answer = data.answer || '';
      renderThread();
    } catch (err) {
      console.error('[eh-chat]', err);
      lastExchange.answer = '_Netwerkfout — probeer opnieuw._';
      renderThread();
    } finally {
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
    }
  });

  // Submit op Enter (Shift+Enter = nieuwe regel)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  function renderThread() {
    if (!lastExchange) {
      threadEl.innerHTML = `<div class="eh-chat-empty">Stel een vraag over ${escapeHtml(child?.name || 'je kindje')} — HapjesHeld kent z'n leeftijd, allergenen en gelogde maaltijden.</div>`;
      return;
    }
    const ans = lastExchange.answer == null
      ? `<div class="eh-chat-thinking">HapjesHeld denkt na…</div>`
      : `<div class="eh-chat-bubble eh-chat-bubble-bot">${formatAnswer(lastExchange.answer)}</div>`;
    threadEl.innerHTML = `
      <div class="eh-chat-bubble eh-chat-bubble-user">${escapeHtml(lastExchange.question)}</div>
      ${ans}
    `;
    // Scroll naar onder
    threadEl.scrollTop = threadEl.scrollHeight;
  }
}

// Hele simpele markdown→HTML — alleen *_em_*, **bold** en regelovergangen.
function formatAnswer(text) {
  const safe = escapeHtml(text);
  return safe
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}
