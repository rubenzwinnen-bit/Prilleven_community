/* ============================================
   COMMUNITY TIMELINE
   Render: composer (textarea + plaats-knop) + feed.
   Stap 3: alleen posts (geen replies/likes/categorie/foto).
============================================ */

import { showToast, escapeHtml } from '../utils.js?v=2.0.1';
import * as Api from '../communityApi.js?v=2.0.1';
import { ensureNickname, getCachedNickname, openNicknameModal, invalidateNicknameCache }
  from './nicknameModal.js?v=2.0.1';
import { renderPostCard } from './timelinePost.js?v=2.0.1';

const MAX_BODY = 4000;

export function render() {
  return `
    <section class="tl-wrap" id="tl-wrap">
      <div class="tl-main">
        <div class="tl-composer" id="tl-composer">
          <div class="tl-composer-head">
            <span class="tl-composer-title">Wat speelt er bij jou?</span>
            <span class="tl-composer-nick" id="tl-composer-nick"></span>
          </div>
          <textarea
            id="tl-composer-body"
            class="tl-composer-input"
            placeholder="Stel je vraag, deel een tip of een mijlpaal…"
            maxlength="${MAX_BODY}"
            rows="3"
          ></textarea>
          <div class="tl-composer-foot">
            <span class="tl-counter" id="tl-counter">0 / ${MAX_BODY}</span>
            <div class="tl-composer-actions">
              <button class="btn btn-outline btn-sm" id="tl-edit-nick" title="Wijzig nickname">Wijzig nickname</button>
              <button class="btn btn-primary" id="tl-submit">Plaats</button>
            </div>
          </div>
          <div id="tl-composer-error" class="auth-error hidden"></div>
        </div>

        <div class="tl-feed" id="tl-feed">
          <div class="tl-empty" id="tl-loading">Posts laden…</div>
        </div>
      </div>
    </section>
  `;
}

export async function init() {
  const root      = document.getElementById('tl-wrap');
  if (!root) return;

  const composer  = document.getElementById('tl-composer');
  const bodyEl    = document.getElementById('tl-composer-body');
  const counter   = document.getElementById('tl-counter');
  const errorEl   = document.getElementById('tl-composer-error');
  const submitBtn = document.getElementById('tl-submit');
  const editNick  = document.getElementById('tl-edit-nick');
  const nickEl    = document.getElementById('tl-composer-nick');
  const feedEl    = document.getElementById('tl-feed');

  /* ----- Nickname display ----- */
  const refreshNickDisplay = async () => {
    const { ok, data } = await Api.getMyProfile();
    const nick = ok ? data?.profile?.nickname : null;
    nickEl.textContent = nick ? 'als ' + nick : 'nickname instellen bij eerste post';
    editNick.style.display = nick ? '' : 'none';
  };
  refreshNickDisplay();

  /* ----- Composer interacties ----- */
  bodyEl.addEventListener('input', () => {
    counter.textContent = `${bodyEl.value.length} / ${MAX_BODY}`;
    errorEl.classList.add('hidden');
  });

  editNick.addEventListener('click', async () => {
    const current = getCachedNickname() || '';
    const chosen  = await openNicknameModal({ current });
    if (chosen) {
      invalidateNicknameCache();
      await refreshNickDisplay();
      showToast('Nickname bijgewerkt');
    }
  });

  const setError = (msg) => {
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
  };

  submitBtn.addEventListener('click', async () => {
    const text = bodyEl.value.trim();
    if (!text) {
      setError('Je bericht is leeg.');
      return;
    }

    submitBtn.disabled = true;
    const original = submitBtn.textContent;
    submitBtn.textContent = 'Plaatsen…';
    errorEl.classList.add('hidden');

    try {
      // Zorg dat we een nickname hebben
      const nick = await ensureNickname();
      if (!nick) {
        setError('Je hebt een nickname nodig om te kunnen posten.');
        return;
      }

      const { ok, data, error, status } = await Api.createPost({ body: text });
      if (!ok) {
        // Sommige fouten verdienen een specifieke melding
        if (status === 412) {
          setError('Stel eerst je nickname in.');
        } else {
          setError(error || 'Kon bericht niet plaatsen.');
        }
        return;
      }

      bodyEl.value = '';
      counter.textContent = `0 / ${MAX_BODY}`;
      prependPost(data.post);
      showToast('Geplaatst');
      await refreshNickDisplay();
    } catch (err) {
      setError(err.message || 'Er ging iets mis.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = original;
    }
  });

  /* ----- Feed laden ----- */
  await loadAndRenderFeed(feedEl);
}

async function loadAndRenderFeed(feedEl) {
  const { ok, data, error } = await Api.getPosts({ limit: 20 });
  if (!ok) {
    feedEl.innerHTML = `<div class="tl-empty tl-error">Kon feed niet laden: ${escapeHtml(error)}</div>`;
    return;
  }
  const posts = data.posts || [];
  if (posts.length === 0) {
    feedEl.innerHTML = `<div class="tl-empty">Nog geen berichten — wees de eerste!</div>`;
    return;
  }
  feedEl.innerHTML = posts.map(renderPostCard).join('');
}

function prependPost(post) {
  const feedEl = document.getElementById('tl-feed');
  if (!feedEl) return;
  // Als er een "lege" placeholder of error stond, vervang die volledig.
  const empty = feedEl.querySelector('.tl-empty');
  if (empty) feedEl.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.innerHTML = renderPostCard(post);
  const card = wrap.firstElementChild;
  // Niet-pinned posts gaan boven andere niet-pinned, maar onder pinned.
  if (post.is_pinned) {
    feedEl.prepend(card);
  } else {
    const firstNonPinned = feedEl.querySelector('.tl-post:not(.is-pinned)');
    if (firstNonPinned) feedEl.insertBefore(card, firstNonPinned);
    else feedEl.appendChild(card);
  }
}
