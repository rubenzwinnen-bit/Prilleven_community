/* ============================================
   COMMUNITY TIMELINE
   Render: composer (textarea + plaats-knop) + feed.
   Stap 4: voegt like + replies toe via event-delegation.
============================================ */

import { showToast, escapeHtml } from '../utils.js?v=2.0.1';
import * as Api from '../communityApi.js?v=2.0.1';
import { ensureNickname, getCachedNickname, openNicknameModal, invalidateNicknameCache }
  from './nicknameModal.js?v=2.0.1';
import { renderPostCard, renderReplyRow, CATEGORIES } from './timelinePost.js?v=2.0.1';

const MAX_BODY = 4000;
let currentCategory = null; // null = "Alle"

export function render() {
  const catOptions = CATEGORIES.map(c =>
    `<option value="${c.id}">${c.emoji} ${c.label}</option>`
  ).join('');

  const filterChips = [
    `<button type="button" class="tl-filter-chip is-active" data-cat="">Alle</button>`,
    ...CATEGORIES.map(c =>
      `<button type="button" class="tl-filter-chip" data-cat="${c.id}">${c.emoji} ${c.label}</button>`
    ),
  ].join('');

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
            <div class="tl-composer-left">
              <label for="tl-composer-cat" class="visually-hidden">Categorie</label>
              <select id="tl-composer-cat" class="tl-composer-cat">${catOptions}</select>
              <span class="tl-counter" id="tl-counter">0 / ${MAX_BODY}</span>
            </div>
            <div class="tl-composer-actions">
              <button class="btn btn-outline btn-sm" id="tl-edit-nick" title="Wijzig nickname">Wijzig nickname</button>
              <button class="btn btn-primary" id="tl-submit">Plaats</button>
            </div>
          </div>
          <div id="tl-composer-error" class="auth-error hidden"></div>
        </div>

        <div class="tl-filterbar" id="tl-filterbar" role="tablist" aria-label="Filter op categorie">
          ${filterChips}
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
  const catEl     = document.getElementById('tl-composer-cat');
  const filterBar = document.getElementById('tl-filterbar');

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

      const category = catEl?.value || 'algemeen';
      const { ok, data, error, status } = await Api.createPost({ body: text, category });
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
      if (catEl) catEl.value = 'algemeen';
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

  /* ----- Filterbalk ----- */
  filterBar?.addEventListener('click', async (e) => {
    const chip = e.target.closest('.tl-filter-chip');
    if (!chip) return;
    const newCat = chip.dataset.cat || null;
    if (newCat === currentCategory) return;
    currentCategory = newCat;
    filterBar.querySelectorAll('.tl-filter-chip').forEach(c =>
      c.classList.toggle('is-active', c === chip)
    );
    await loadAndRenderFeed(feedEl);
  });

  /* ----- Feed laden ----- */
  await loadAndRenderFeed(feedEl);

  /* ----- Event-delegation voor like / replies ----- */
  feedEl.addEventListener('click', onFeedClick);
  feedEl.addEventListener('submit', onFeedSubmit);
}

/* ============================================
   Event handlers (delegation)
============================================ */
async function onFeedClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const card = btn.closest('.tl-post');
  if (!card) return;
  const action = btn.dataset.action;

  if (action === 'like') {
    await handleLikeToggle(card, btn);
  } else if (action === 'toggle-replies') {
    await handleRepliesToggle(card, btn);
  }
}

async function onFeedSubmit(e) {
  if (!e.target.matches('[data-role="reply-form"]')) return;
  e.preventDefault();
  const card = e.target.closest('.tl-post');
  if (!card) return;
  await handleReplySubmit(card, e.target);
}

async function handleLikeToggle(card, btn) {
  // Nickname is niet vereist voor likes — alleen voor posts/replies.
  if (btn.disabled) return;
  btn.disabled = true;

  const postId = card.dataset.postId;
  const countEl = btn.querySelector('[data-role="like-count"]');
  const iconEl  = btn.querySelector('.tl-action-icon');
  const wasLiked = card.dataset.liked === '1';
  const oldCount = parseInt(countEl.textContent, 10) || 0;

  // Optimistic update
  setLikeUI(card, btn, iconEl, countEl, !wasLiked, oldCount + (wasLiked ? -1 : 1));

  const { ok, data, error } = await Api.toggleLike(postId);
  if (!ok) {
    // Rollback
    setLikeUI(card, btn, iconEl, countEl, wasLiked, oldCount);
    showToast(error || 'Kon like niet bijwerken', 'error');
    btn.disabled = false;
    return;
  }
  // Server is source of truth
  setLikeUI(card, btn, iconEl, countEl, !!data.liked, Number(data.count || 0));
  btn.disabled = false;
}

function setLikeUI(card, btn, iconEl, countEl, liked, count) {
  card.dataset.liked = liked ? '1' : '0';
  btn.classList.toggle('is-liked', liked);
  iconEl.textContent = liked ? '❤' : '♡';
  countEl.textContent = String(count);
}

async function handleRepliesToggle(card, btn) {
  const container = card.querySelector('[data-role="replies-container"]');
  const list      = card.querySelector('[data-role="replies-list"]');
  const expanded  = !container.classList.contains('hidden');

  if (expanded) {
    container.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
    return;
  }

  // Open + lazy-load eenmalig
  container.classList.remove('hidden');
  btn.setAttribute('aria-expanded', 'true');

  if (list.dataset.loaded === '1') return;

  list.innerHTML = '<div class="tl-empty tl-replies-loading">Reacties laden…</div>';
  const { ok, data, error } = await Api.getReplies(card.dataset.postId);
  if (!ok) {
    list.innerHTML = `<div class="tl-empty tl-error">Kon reacties niet laden: ${escapeHtml(error)}</div>`;
    return;
  }
  const replies = data.replies || [];
  list.dataset.loaded = '1';
  if (replies.length === 0) {
    list.innerHTML = '<div class="tl-replies-empty">Nog geen reacties — wees de eerste!</div>';
  } else {
    list.innerHTML = replies.map(renderReplyRow).join('');
  }
}

async function handleReplySubmit(card, form) {
  const textarea = form.querySelector('.tl-reply-input');
  const errorEl  = form.querySelector('[data-role="reply-error"]');
  const submitBtn = form.querySelector('button[type="submit"]');
  const text = textarea.value.trim();

  errorEl.classList.add('hidden');

  if (!text) {
    errorEl.textContent = 'Reactie is leeg.';
    errorEl.classList.remove('hidden');
    return;
  }

  // Vereist nickname
  const nick = await ensureNickname();
  if (!nick) {
    errorEl.textContent = 'Je hebt een nickname nodig om te kunnen reageren.';
    errorEl.classList.remove('hidden');
    return;
  }

  submitBtn.disabled = true;
  const original = submitBtn.textContent;
  submitBtn.textContent = 'Versturen…';

  const { ok, data, error, status } = await Api.createReply(card.dataset.postId, text);
  submitBtn.disabled = false;
  submitBtn.textContent = original;

  if (!ok) {
    errorEl.textContent = status === 412
      ? 'Stel eerst je nickname in.'
      : (error || 'Kon reactie niet plaatsen.');
    errorEl.classList.remove('hidden');
    return;
  }

  // Voeg toe aan list, leeg textarea, update teller
  const list = card.querySelector('[data-role="replies-list"]');
  const empty = list.querySelector('.tl-replies-empty, .tl-empty');
  if (empty) list.innerHTML = '';
  list.insertAdjacentHTML('beforeend', renderReplyRow(data.reply));
  list.dataset.loaded = '1';

  textarea.value = '';
  bumpReplyCount(card, +1);
  showToast('Reactie geplaatst');
}

function bumpReplyCount(card, delta) {
  const countEl = card.querySelector('[data-role="reply-count"]');
  const labelEl = card.querySelector('.tl-replies-toggle .tl-action-label');
  const next = Math.max(0, (parseInt(countEl.textContent, 10) || 0) + delta);
  countEl.textContent = String(next);
  if (labelEl) labelEl.textContent = 'reactie' + (next === 1 ? '' : 's');
  card.dataset.replies = String(next);
}

async function loadAndRenderFeed(feedEl) {
  feedEl.innerHTML = `<div class="tl-empty">Posts laden…</div>`;
  const { ok, data, error } = await Api.getPosts({ limit: 20, category: currentCategory });
  if (!ok) {
    feedEl.innerHTML = `<div class="tl-empty tl-error">Kon feed niet laden: ${escapeHtml(error)}</div>`;
    return;
  }
  const posts = data.posts || [];
  if (posts.length === 0) {
    const msg = currentCategory
      ? `Nog geen berichten in deze categorie.`
      : `Nog geen berichten — wees de eerste!`;
    feedEl.innerHTML = `<div class="tl-empty">${escapeHtml(msg)}</div>`;
    return;
  }
  feedEl.innerHTML = posts.map(renderPostCard).join('');
}

function prependPost(post) {
  const feedEl = document.getElementById('tl-feed');
  if (!feedEl) return;

  // Als de actieve filter deze categorie uitsluit: niets renderen
  // (de toast bevestigt dat de post is geplaatst).
  if (currentCategory && post.category !== currentCategory) return;

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
