/* ============================================
   COMMUNITY TIMELINE
   Render: composer (textarea + plaats-knop) + feed.
   Stap 4: voegt like + replies toe via event-delegation.
============================================ */

import { showToast, escapeHtml, processImageForUpload, confirm as confirmDialog, nl2br, formatRelativeTime } from '../utils.js?v=2.9.0';
import * as Api from '../communityApi.js?v=2.9.0';
import { sessionGet } from '../supabase.js?v=2.9.0';
import * as Store from '../store.js?v=2.9.0';
import { ensureNickname, getCachedNickname, invalidateNicknameCache }
  from './nicknameModal.js?v=2.9.0';
import { openProfileModal } from './profileModal.js?v=2.9.0';
import { renderPostCard, renderReplyRow, renderPoll, renderChatroomTopicCard } from './timelinePost.js?v=2.9.0';

function currentUserId() {
  return sessionGet()?.user_id || null;
}
function isAdminUser() {
  return Store.isAdmin();
}

const MAX_BODY = 4000;

export function render() {
  const admin = Store.isAdmin();
  return `
    <section class="tl-wrap" id="tl-wrap">
      <div class="tl-main">
        ${admin ? `
        <div class="tl-composer" id="tl-composer">
          <div class="tl-composer-head">
            <span class="tl-composer-title">Wat speelt er bij jou?</span>
            <div class="tl-composer-head-right">
              <span class="tl-composer-nick" id="tl-composer-nick"></span>
            </div>
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
              <button type="button" class="tl-composer-photo" id="tl-photo-btn" title="Foto toevoegen">📷</button>
              <input type="file" id="tl-photo-input" accept="image/*" class="visually-hidden">
              <button type="button" class="tl-composer-photo" id="tl-poll-toggle" title="Poll toevoegen">📊</button>
              <span class="tl-counter" id="tl-counter">0 / ${MAX_BODY}</span>
            </div>
            <div class="tl-composer-actions">
              <button class="btn btn-outline btn-sm" id="tl-edit-nick" title="Wijzig nickname">Wijzig nickname</button>
              <button class="btn btn-primary" id="tl-submit">Plaats</button>
            </div>
          </div>
          <div class="tl-photo-preview hidden" id="tl-photo-preview">
            <img id="tl-photo-preview-img" alt="Voorbeeld">
            <button type="button" class="tl-photo-remove" id="tl-photo-remove" title="Foto verwijderen">×</button>
          </div>
          <div class="tl-poll-builder hidden" id="tl-poll-builder">
            <div class="tl-poll-builder-head">
              <strong>Poll</strong>
              <button type="button" class="tl-poll-remove" id="tl-poll-remove" title="Poll verwijderen">×</button>
            </div>
            <input type="text" id="tl-poll-question" class="tl-poll-input" placeholder="Stel je vraag…" maxlength="200">
            <div class="tl-poll-options" id="tl-poll-options">
              <input type="text" class="tl-poll-input tl-poll-option" placeholder="Optie 1" maxlength="80">
              <input type="text" class="tl-poll-input tl-poll-option" placeholder="Optie 2" maxlength="80">
            </div>
            <button type="button" class="btn btn-outline btn-sm" id="tl-poll-add-option">+ Optie toevoegen</button>
            <label class="tl-poll-multi-label">
              <input type="checkbox" id="tl-poll-allow-multi">
              <span>Meerdere antwoorden mogelijk</span>
            </label>
            <div class="tl-poll-hint">Sluit automatisch na 7 dagen · 2-4 opties · klik je stem opnieuw aan om hem terug te trekken</div>
          </div>
          <div id="tl-composer-error" class="auth-error hidden"></div>
        </div>
        ` : ''}

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

  const feedEl    = document.getElementById('tl-feed');

  /* ----- Composer (alleen voor admins) ----- */
  const bodyEl    = document.getElementById('tl-composer-body');
  if (bodyEl) {
    const counter   = document.getElementById('tl-counter');
    const errorEl   = document.getElementById('tl-composer-error');
    const submitBtn = document.getElementById('tl-submit');
    const editNick  = document.getElementById('tl-edit-nick');
    const nickEl    = document.getElementById('tl-composer-nick');
    const photoBtn    = document.getElementById('tl-photo-btn');
    const photoInput  = document.getElementById('tl-photo-input');
    const photoPrev   = document.getElementById('tl-photo-preview');
    const photoPrevImg= document.getElementById('tl-photo-preview-img');
    const photoRemove = document.getElementById('tl-photo-remove');

    let pendingImage = null;

    const clearPhoto = () => {
      if (pendingImage?.previewUrl) URL.revokeObjectURL(pendingImage.previewUrl);
      pendingImage = null;
      photoInput.value = '';
      photoPrev.classList.add('hidden');
      photoPrevImg.removeAttribute('src');
    };

    photoBtn?.addEventListener('click', () => photoInput.click());
    photoRemove?.addEventListener('click', clearPhoto);

    /* ----- Poll builder ----- */
    const pollToggle    = document.getElementById('tl-poll-toggle');
    const pollBuilder   = document.getElementById('tl-poll-builder');
    const pollRemove    = document.getElementById('tl-poll-remove');
    const pollQuestion  = document.getElementById('tl-poll-question');
    const pollOptionsEl = document.getElementById('tl-poll-options');
    const pollAddBtn    = document.getElementById('tl-poll-add-option');

    const updatePollAddBtn = () => {
      const count = pollOptionsEl.querySelectorAll('.tl-poll-option').length;
      pollAddBtn.disabled = count >= 4;
    };

    const addPollOption = () => {
      const count = pollOptionsEl.querySelectorAll('.tl-poll-option').length;
      if (count >= 4) return;
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'tl-poll-input tl-poll-option';
      inp.placeholder = `Optie ${count + 1}`;
      inp.maxLength = 80;
      pollOptionsEl.appendChild(inp);
      inp.focus();
      updatePollAddBtn();
    };

    const clearPoll = () => {
      pollBuilder.classList.add('hidden');
      pollQuestion.value = '';
      pollOptionsEl.innerHTML = `
        <input type="text" class="tl-poll-input tl-poll-option" placeholder="Optie 1" maxlength="80">
        <input type="text" class="tl-poll-input tl-poll-option" placeholder="Optie 2" maxlength="80">
      `;
      const multiCb = document.getElementById('tl-poll-allow-multi');
      if (multiCb) multiCb.checked = false;
      updatePollAddBtn();
    };

    const isPollOpen = () => !pollBuilder.classList.contains('hidden');

    const collectPoll = () => {
      if (!isPollOpen()) return null;
      const question = pollQuestion.value.trim();
      const options = Array.from(pollOptionsEl.querySelectorAll('.tl-poll-option'))
        .map(i => i.value.trim())
        .filter(Boolean);
      const allow_multi = !!document.getElementById('tl-poll-allow-multi')?.checked;
      if (!question || options.length < 2) {
        throw new Error('Vul de poll-vraag en minstens 2 opties in.');
      }
      return { question, options, allow_multi };
    };

    pollToggle?.addEventListener('click', () => {
      if (isPollOpen()) {
        clearPoll();
      } else {
        pollBuilder.classList.remove('hidden');
        setTimeout(() => pollQuestion.focus(), 0);
      }
    });
    pollRemove?.addEventListener('click', clearPoll);
    pollAddBtn?.addEventListener('click', addPollOption);

    photoInput?.addEventListener('change', async () => {
      const file = photoInput.files?.[0];
      if (!file) return;
      photoBtn.disabled = true;
      try {
        const { blob } = await processImageForUpload(file);
        if (pendingImage?.previewUrl) URL.revokeObjectURL(pendingImage.previewUrl);
        const previewUrl = URL.createObjectURL(blob);
        pendingImage = { blob, previewUrl };
        photoPrevImg.src = previewUrl;
        photoPrev.classList.remove('hidden');
      } catch (err) {
        showToast(err.message || 'Kon foto niet verwerken.', 'error');
        clearPhoto();
      } finally {
        photoBtn.disabled = false;
      }
    });

    /* ----- Nickname display ----- */
    const refreshNickDisplay = async () => {
      const { ok, data } = await Api.getMyProfile();
      const nick = ok ? data?.profile?.nickname : null;
      nickEl.textContent = nick ? 'als ' + nick : 'nickname instellen bij eerste post';
      editNick.style.display = nick ? '' : 'none';
    };
    refreshNickDisplay();

    bodyEl.addEventListener('input', () => {
      counter.textContent = `${bodyEl.value.length} / ${MAX_BODY}`;
      errorEl.classList.add('hidden');
    });

    editNick.addEventListener('click', async () => {
      const updated = await openProfileModal();
      if (updated) {
        invalidateNicknameCache();
        await refreshNickDisplay();
        document.dispatchEvent(new CustomEvent('community:profile-updated', { detail: updated }));
        showToast('Profiel bijgewerkt');
      }
    });

    document.addEventListener('community:profile-updated', () => {
      invalidateNicknameCache();
      refreshNickDisplay();
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
        const nick = await ensureNickname();
        if (!nick) {
          setError('Je hebt een nickname nodig om te kunnen posten.');
          return;
        }

        let pollData = null;
        try {
          pollData = collectPoll();
        } catch (err) {
          setError(err.message);
          return;
        }

        let image_path = null;
        if (pendingImage?.blob) {
          submitBtn.textContent = 'Foto uploaden…';
          const urlRes = await Api.getUploadUrl();
          if (!urlRes.ok) {
            setError(urlRes.error || 'Kon upload-URL niet ophalen.');
            return;
          }
          const upRes = await Api.uploadToStorage(urlRes.data.uploadUrl, pendingImage.blob);
          if (!upRes.ok) {
            setError(upRes.error || 'Foto-upload mislukt.');
            return;
          }
          image_path = urlRes.data.path;
        }

        submitBtn.textContent = 'Plaatsen…';
        const { ok, data, error, status } = await Api.createPost({ body: text, category: 'algemeen', image_path, poll: pollData });
        if (!ok) {
          if (status === 412) {
            setError('Stel eerst je nickname in.');
          } else {
            setError(error || 'Kon bericht niet plaatsen.');
          }
          return;
        }

        bodyEl.value = '';
        counter.textContent = `0 / ${MAX_BODY}`;
        clearPhoto();
        clearPoll();
        prependPost(data.post);
        const newCard = document.querySelector(
          `.tl-post[data-post-id="${CSS.escape(data.post.id)}"]`
        );
        newCard?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        showToast('Geplaatst');
        await refreshNickDisplay();
      } catch (err) {
        setError(err.message || 'Er ging iets mis.');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = original;
      }
    });
  } // einde admin-only composer

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
  } else if (action === 'vote-poll') {
    await handlePollVote(card, btn);
  } else if (action === 'toggle-menu') {
    handleToggleMenu(btn);
  } else if (action === 'edit-post') {
    closeAllMenus();
    enterEditMode(card, 'post');
  } else if (action === 'delete-post') {
    closeAllMenus();
    await handleDeletePost(card);
  } else if (action === 'report-post') {
    closeAllMenus();
    await handleReport('post', card.dataset.postId);
  } else if (action === 'block-post') {
    closeAllMenus();
    await handleBlock(card);
  } else if (action === 'edit-reply') {
    closeAllMenus();
    enterEditMode(btn.closest('.tl-reply'), 'reply');
  } else if (action === 'delete-reply') {
    closeAllMenus();
    await handleDeleteReply(card, btn.closest('.tl-reply'));
  } else if (action === 'report-reply') {
    closeAllMenus();
    await handleReport('reply', btn.closest('.tl-reply').dataset.replyId);
  } else if (action === 'block-reply') {
    closeAllMenus();
    await handleBlock(btn.closest('.tl-reply'));
  } else if (action === 'pin-post' || action === 'unpin-post') {
    closeAllMenus();
    await handleTogglePin(card, action === 'pin-post');
  } else if (action === 'admin-delete-post') {
    closeAllMenus();
    await handleAdminDeletePost(card);
  } else if (action === 'admin-delete-reply') {
    closeAllMenus();
    await handleAdminDeleteReply(card, btn.closest('.tl-reply'));
  } else if (action === 'like-reply') {
    await handleReplyLikeToggle(btn.closest('.tl-reply'), btn);
  } else if (action === 'open-chatroom-topic') {
    // Navigeer naar topic in chatruimte (via custom event → chatRooms.js luistert)
    const topicId  = btn.dataset.topicId;
    const roomSlug = btn.dataset.roomSlug;
    document.dispatchEvent(new CustomEvent('chatroom:open-topic', { detail: { topicId, roomSlug } }));
  } else if (action === 'open-chatroom-source') {
    // Klik op de badge → navigeer naar de room zelf
    const roomSlug = btn.dataset.roomSlug;
    if (roomSlug) document.dispatchEvent(new CustomEvent('chatroom:open-room', { detail: { roomSlug } }));
  }
}

async function handleReplyLikeToggle(replyEl, btn) {
  if (btn.disabled) return;
  btn.disabled = true;
  const replyId = replyEl.dataset.replyId;
  const countEl = btn.querySelector('[data-role="reply-like-count"]');
  const iconEl  = btn.querySelector('.tl-action-icon');
  const wasLiked = replyEl.dataset.liked === '1';
  const oldCount = parseInt(countEl.textContent, 10) || 0;

  setReplyLikeUI(replyEl, btn, iconEl, countEl, !wasLiked, oldCount + (wasLiked ? -1 : 1));

  const { ok, data, error } = await Api.toggleReplyLike(replyId);
  if (!ok) {
    setReplyLikeUI(replyEl, btn, iconEl, countEl, wasLiked, oldCount);
    showToast(error || 'Kon like niet bijwerken', 'error');
    btn.disabled = false;
    return;
  }
  setReplyLikeUI(replyEl, btn, iconEl, countEl, !!data.liked, Number(data.count || 0));
  btn.disabled = false;
}

function setReplyLikeUI(replyEl, btn, iconEl, countEl, liked, count) {
  replyEl.dataset.liked = liked ? '1' : '0';
  btn.classList.toggle('is-liked', liked);
  iconEl.textContent = liked ? '❤' : '♡';
  countEl.textContent = String(count);
}

/* ----- Admin: pin / unpin ----- */
async function handleTogglePin(card, wantPinned) {
  const { ok, data, error } = await Api.togglePin(card.dataset.postId, wantPinned);
  if (!ok) {
    showToast(error || 'Kon pin niet wijzigen', 'error');
    return;
  }
  showToast(data.is_pinned ? 'Vastgepind' : 'Losgemaakt');
  // Re-render de hele feed zodat pin-volgorde klopt
  await loadAndRenderFeed(document.getElementById('tl-feed'));
}

async function handleAdminDeletePost(card) {
  const ok = await confirmDialog('Verwijderen als admin? Dit kan niet ongedaan worden gemaakt.');
  if (!ok) return;
  const { ok: success, error } = await Api.deletePost(card.dataset.postId);
  if (!success) { showToast(error || 'Kon niet verwijderen', 'error'); return; }
  card.remove();
  showToast('Verwijderd');
}

async function handleAdminDeleteReply(card, replyEl) {
  const ok = await confirmDialog('Verwijderen als admin?');
  if (!ok) return;
  const { ok: success, error } = await Api.deleteReply(replyEl.dataset.replyId);
  if (!success) { showToast(error || 'Kon niet verwijderen', 'error'); return; }
  replyEl.remove();
  bumpReplyCount(card, -1);
  showToast('Verwijderd');
}


/* ----- Menu (popover) ----- */
function handleToggleMenu(btn) {
  const menu = btn.closest('[data-role="menu"]');
  const dropdown = menu.querySelector('[data-role="menu-dropdown"]');
  const wasOpen = !dropdown.classList.contains('hidden');
  closeAllMenus();
  if (!wasOpen) {
    dropdown.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
  }
}

function closeAllMenus() {
  document.querySelectorAll('[data-role="menu-dropdown"]').forEach(d => d.classList.add('hidden'));
  document.querySelectorAll('[data-action="toggle-menu"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
}

// Klikken buiten een menu sluit alle menus.
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-role="menu"]')) closeAllMenus();
});

/* ----- Edit-modus (inline) ----- */
function enterEditMode(container, type) {
  const bodyEl = container.querySelector(`[data-role="${type}-body"]`);
  if (!bodyEl) return;
  const original = bodyEl.textContent.trim();
  const maxLen = type === 'post' ? 4000 : 2000;
  const editorHtml = `
    <div class="tl-edit-form" data-role="edit-form">
      <textarea class="tl-edit-input" maxlength="${maxLen}" rows="3">${escapeHtml(original)}</textarea>
      <div class="tl-edit-actions">
        <span class="tl-edit-error auth-error hidden" data-role="edit-error"></span>
        <button type="button" class="btn btn-outline btn-sm" data-action="cancel-edit">Annuleren</button>
        <button type="button" class="btn btn-primary btn-sm" data-action="save-edit-${type}">Opslaan</button>
      </div>
    </div>
  `;
  // Onthoud originele body zodat cancel kan terugzetten
  bodyEl.dataset.originalHtml = bodyEl.innerHTML;
  bodyEl.innerHTML = editorHtml;
  const ta = bodyEl.querySelector('.tl-edit-input');
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

function exitEditMode(container, type, newBody = null) {
  const bodyEl = container.querySelector(`[data-role="${type}-body"]`);
  if (!bodyEl) return;
  if (newBody !== null) {
    bodyEl.innerHTML = nl2br(escapeHtml(newBody));
    // Update "bewerkt" suffix in meta
    const time = container.querySelector('.tl-time');
    if (time && !time.textContent.includes('bewerkt')) {
      time.textContent += ' · bewerkt';
    }
  } else if (bodyEl.dataset.originalHtml) {
    bodyEl.innerHTML = bodyEl.dataset.originalHtml;
  }
  delete bodyEl.dataset.originalHtml;
}

// Extra delegation voor edit-form acties (cancel + save)
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'cancel-edit') {
    const card = btn.closest('.tl-post') || btn.closest('.tl-reply');
    const type = btn.closest('.tl-post') ? 'post' : 'reply';
    if (card) exitEditMode(card, type);
  } else if (action === 'save-edit-post') {
    const card = btn.closest('.tl-post');
    if (card) await handleSaveEdit(card, 'post');
  } else if (action === 'save-edit-reply') {
    const reply = btn.closest('.tl-reply');
    if (reply) await handleSaveEdit(reply, 'reply');
  }
});

async function handleSaveEdit(container, type) {
  const ta = container.querySelector('.tl-edit-input');
  const errorEl = container.querySelector('[data-role="edit-error"]');
  const saveBtn = container.querySelector(`[data-action="save-edit-${type}"]`);
  const text = ta.value.trim();
  errorEl.classList.add('hidden');
  if (!text) {
    errorEl.textContent = 'Mag niet leeg zijn.';
    errorEl.classList.remove('hidden');
    return;
  }
  saveBtn.disabled = true;
  const id = type === 'post' ? container.dataset.postId : container.dataset.replyId;
  const fn = type === 'post' ? Api.editPost : Api.editReply;
  const { ok, data, error } = await fn(id, text);
  saveBtn.disabled = false;
  if (!ok) {
    errorEl.textContent = error || 'Kon niet opslaan.';
    errorEl.classList.remove('hidden');
    return;
  }
  const newBody = type === 'post' ? data.post.body : data.reply.body;
  exitEditMode(container, type, newBody);
  showToast('Bijgewerkt');
}

/* ----- Delete ----- */
async function handleDeletePost(card) {
  const ok = await confirmDialog('Weet je zeker dat je dit bericht wilt verwijderen?');
  if (!ok) return;
  const { ok: success, error } = await Api.deletePost(card.dataset.postId);
  if (!success) {
    showToast(error || 'Kon niet verwijderen', 'error');
    return;
  }
  card.remove();
  showToast('Bericht verwijderd');
}

async function handleDeleteReply(card, replyEl) {
  const ok = await confirmDialog('Weet je zeker dat je deze reactie wilt verwijderen?');
  if (!ok) return;
  const { ok: success, error } = await Api.deleteReply(replyEl.dataset.replyId);
  if (!success) {
    showToast(error || 'Kon niet verwijderen', 'error');
    return;
  }
  replyEl.remove();
  bumpReplyCount(card, -1);
  showToast('Reactie verwijderd');
}

/* ----- Rapporteer ----- */
async function handleReport(targetType, targetId) {
  const reason = await openReportModal();
  if (reason === null) return; // user annuleerde
  const { ok, error } = await Api.reportTarget({
    target_type: targetType,
    target_id: targetId,
    reason: reason || null,
  });
  if (!ok) {
    showToast(error || 'Kon niet rapporteren', 'error');
    return;
  }
  showToast('Bedankt — gerapporteerd aan een admin.');
}

function openReportModal() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal nickname-modal">
        <h2>Rapporteren</h2>
        <p class="nickname-modal-desc">
          Een admin krijgt deze melding te zien. Geef optioneel kort aan wat
          er aan schort (max 500 tekens).
        </p>
        <textarea id="tl-report-reason" class="tl-reply-input" rows="3" maxlength="500" placeholder="Reden (optioneel)…"></textarea>
        <div class="nickname-actions">
          <button class="btn btn-outline" data-action="report-cancel">Annuleren</button>
          <button class="btn btn-danger" data-action="report-confirm">Verstuur</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.querySelector('[data-action="report-cancel"]').addEventListener('click', () => close(null));
    overlay.querySelector('[data-action="report-confirm"]').addEventListener('click', () => {
      const reason = overlay.querySelector('#tl-report-reason').value.trim();
      close(reason);
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
  });
}

/* ----- Blokkeren (App Store Guideline 1.2) ----- */
async function handleBlock(el) {
  const userId = el?.dataset?.userId;
  if (!userId) return;
  const nick = el.dataset.nick || 'deze gebruiker';
  const ok = await confirmDialog(
    `Wil je ${nick} blokkeren? Je ziet hun berichten en reacties dan niet meer. Ze worden hier niet van op de hoogte gebracht.`
  );
  if (!ok) return;
  const res = await Api.blockUser(userId);
  if (!res.ok) {
    showToast(res.error || 'Kon niet blokkeren', 'error');
    return;
  }
  // Verwijder al hun zichtbare content uit de feed (UUID = selector-veilig).
  document.querySelectorAll('[data-user-id="' + userId + '"]').forEach(n => n.remove());
  showToast('Gebruiker geblokkeerd.');
}

async function handlePollVote(card, btn) {
  if (btn.disabled) return;
  const action = btn.dataset.voteAction || 'set';
  const optionIdx = action === 'unvote' ? -1 : parseInt(btn.dataset.optionIdx, 10);
  if (action !== 'unvote' && Number.isNaN(optionIdx)) return;

  // Disable alle vote-knoppen tijdens request
  const allBtns = card.querySelectorAll('[data-action="vote-poll"]');
  allBtns.forEach(b => b.disabled = true);

  const { ok, data, error } = await Api.votePoll(card.dataset.postId, optionIdx, action);
  if (!ok || !data?.poll) {
    allBtns.forEach(b => b.disabled = false);
    showToast(error || 'Kon stem niet registreren', 'error');
    return;
  }

  // Vervang het hele poll-blok met de nieuwe view
  const pollEl = card.querySelector('[data-role="poll"]');
  if (pollEl) {
    const tmp = document.createElement('div');
    tmp.innerHTML = renderPoll(data.poll);
    pollEl.replaceWith(tmp.firstElementChild);
  }
  const total = (data.poll.my_votes || []).length;
  showToast(action === 'unvote' || total === 0 ? 'Stem teruggetrokken' : 'Stem geregistreerd');
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
    const me = currentUserId();
    const admin = isAdminUser();
    list.innerHTML = replies.map(r => renderReplyRow(r, me, admin)).join('');
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
  list.insertAdjacentHTML('beforeend', renderReplyRow(data.reply, currentUserId(), isAdminUser()));
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
  feedEl.innerHTML = posts.map(p =>
    p.source_type === 'chatroom'
      ? renderChatroomTopicCard(p)
      : renderPostCard(p, currentUserId(), isAdminUser())
  ).join('');
}

function prependPost(post) {
  const feedEl = document.getElementById('tl-feed');
  if (!feedEl) return;

  // Als er een "lege" placeholder of error stond, vervang die volledig.
  const empty = feedEl.querySelector('.tl-empty');
  if (empty) feedEl.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.innerHTML = renderPostCard(post, currentUserId(), isAdminUser());
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
