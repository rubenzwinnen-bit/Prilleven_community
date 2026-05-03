/* ============================================
   TIMELINE POST — render één postkaart.
   Stap 5: voegt categorie-chip toe.
============================================ */

import {
  escapeHtml,
  formatRelativeTime,
  colorFromSeed,
  initialsFromName,
  nl2br,
} from '../utils.js?v=2.0.1';

/* Categorie-labels (zelfde lijst als in api/_lib/community.mjs ALLOWED_CATEGORIES). */
export const CATEGORIES = [
  { id: 'algemeen', label: 'Algemeen', emoji: '💬' },
  { id: 'vraag',    label: 'Vraag',    emoji: '❓' },
  { id: 'tip',      label: 'Tip',      emoji: '💡' },
  { id: 'mijlpaal', label: 'Mijlpaal', emoji: '⭐' },
  { id: 'voeding',  label: 'Voeding',  emoji: '🥕' },
  { id: 'slapen',   label: 'Slapen',   emoji: '😴' },
];

export function categoryMeta(id) {
  return CATEGORIES.find(c => c.id === id) || CATEGORIES[0];
}

export function renderPostCard(post) {
  const nickname = post.nickname || '(naamloos)';
  const initials = initialsFromName(nickname);
  const color    = colorFromSeed(post.user_id);
  const time     = formatRelativeTime(post.created_at);
  const edited   = post.edited_at ? ' · bewerkt' : '';
  const pinned   = post.is_pinned ? ' is-pinned' : '';
  const body     = nl2br(escapeHtml(post.body));
  const cat      = categoryMeta(post.category);

  const likes    = Number(post.likes_count || 0);
  const replies  = Number(post.replies_count || 0);
  const liked    = !!post.liked_by_me;

  return `
    <article class="tl-post${pinned}" data-post-id="${escapeHtml(post.id)}" data-category="${escapeHtml(cat.id)}" data-likes="${likes}" data-replies="${replies}" data-liked="${liked ? '1' : '0'}">
      ${post.is_pinned ? '<div class="tl-pinned-tag">📌 Mededeling</div>' : ''}
      <header class="tl-post-head">
        <span class="tl-avatar" style="background:${color};">${escapeHtml(initials)}</span>
        <div class="tl-post-meta">
          <span class="tl-nickname">${escapeHtml(nickname)}</span>
          <span class="tl-meta-sep">·</span>
          <span class="tl-time">${escapeHtml(time)}${edited}</span>
        </div>
        <span class="tl-cat tl-cat--${escapeHtml(cat.id)}" title="Categorie">${cat.emoji} ${escapeHtml(cat.label)}</span>
      </header>
      <div class="tl-post-body">${body}</div>
      ${post.image_url ? `
        <a class="tl-post-image-link" href="${escapeHtml(post.image_url)}" target="_blank" rel="noopener" title="Open in nieuw tabblad">
          <img class="tl-post-image" src="${escapeHtml(post.image_url)}" alt="Bijgevoegde foto" loading="lazy">
        </a>
      ` : ''}
      ${post.poll ? renderPoll(post.poll) : ''}
      <footer class="tl-post-actions">
        <button type="button" class="tl-action tl-like ${liked ? 'is-liked' : ''}" data-action="like" aria-label="Like">
          <span class="tl-action-icon">${liked ? '❤' : '♡'}</span>
          <span class="tl-action-count" data-role="like-count">${likes}</span>
        </button>
        <button type="button" class="tl-action tl-replies-toggle" data-action="toggle-replies" aria-expanded="false">
          <span class="tl-action-icon">💬</span>
          <span class="tl-action-count" data-role="reply-count">${replies}</span>
          <span class="tl-action-label">reactie${replies === 1 ? '' : 's'}</span>
        </button>
      </footer>
      <div class="tl-replies hidden" data-role="replies-container">
        <div class="tl-replies-list" data-role="replies-list"></div>
        <form class="tl-reply-form" data-role="reply-form" autocomplete="off">
          <textarea class="tl-reply-input" placeholder="Schrijf een reactie…" maxlength="2000" rows="2"></textarea>
          <div class="tl-reply-foot">
            <span class="tl-reply-error auth-error hidden" data-role="reply-error"></span>
            <button type="submit" class="btn btn-primary btn-sm">Verstuur</button>
          </div>
        </form>
      </div>
    </article>
  `;
}

/**
 * Render een poll-blok. Toont stem-knoppen tot user heeft gestemd of poll
 * gesloten is, daarna resultaat-bars met percentage.
 */
export function renderPoll(poll) {
  if (!poll || !Array.isArray(poll.options)) return '';
  const total = Number(poll.total || 0);
  const myVote = poll.my_vote;
  const closed = !!poll.closed;
  const showResults = closed || myVote !== null;

  const opts = poll.options.map((label, idx) => {
    const count = Number(poll.counts?.[idx] || 0);
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    const mine = myVote === idx ? ' is-mine' : '';

    if (showResults) {
      return `
        <div class="tl-poll-result${mine}">
          <div class="tl-poll-bar" style="width:${pct}%"></div>
          <div class="tl-poll-result-label">
            <span>${escapeHtml(label)}${mine ? ' ✓' : ''}</span>
            <span class="tl-poll-pct">${pct}%</span>
          </div>
        </div>
      `;
    }
    return `
      <button type="button" class="tl-poll-vote-btn" data-action="vote-poll" data-option-idx="${idx}">
        ${escapeHtml(label)}
      </button>
    `;
  }).join('');

  const closeText = closed
    ? 'Gesloten'
    : `Sluit ${formatRelativeFuture(poll.closes_at)}`;

  return `
    <div class="tl-poll" data-role="poll">
      <div class="tl-poll-question">${escapeHtml(poll.question)}</div>
      <div class="tl-poll-options-list">${opts}</div>
      <div class="tl-poll-meta">${total} stem${total === 1 ? '' : 'men'} · ${closeText}</div>
    </div>
  `;
}

function formatRelativeFuture(isoString) {
  if (!isoString) return '';
  const ms = new Date(isoString).getTime() - Date.now();
  if (ms <= 0) return 'binnenkort';
  const sec = Math.floor(ms / 1000);
  if (sec < 3600)         return `over ${Math.max(1, Math.floor(sec / 60))} min`;
  if (sec < 86400)        return `over ${Math.floor(sec / 3600)} u`;
  return `over ${Math.floor(sec / 86400)} d`;
}

/** Render één reply-rij. Gebruikt door timeline.js bij expand of nieuwe reply. */
export function renderReplyRow(reply) {
  const nickname = reply.nickname || '(naamloos)';
  const initials = initialsFromName(nickname);
  const color    = colorFromSeed(reply.user_id);
  const time     = formatRelativeTime(reply.created_at);
  const edited   = reply.edited_at ? ' · bewerkt' : '';
  const body     = nl2br(escapeHtml(reply.body));

  return `
    <div class="tl-reply" data-reply-id="${escapeHtml(reply.id)}">
      <span class="tl-avatar tl-avatar-sm" style="background:${color};">${escapeHtml(initials)}</span>
      <div class="tl-reply-bubble">
        <div class="tl-reply-meta">
          <span class="tl-nickname">${escapeHtml(nickname)}</span>
          <span class="tl-meta-sep">·</span>
          <span class="tl-time">${escapeHtml(time)}${edited}</span>
        </div>
        <div class="tl-reply-body">${body}</div>
      </div>
    </div>
  `;
}
