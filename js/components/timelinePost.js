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

/** Render een avatar — foto als url aanwezig, anders gekleurde initialen-bol. */
function renderAvatar(url, color, initials, className) {
  if (url) {
    return `<span class="${className} has-photo"><img src="${escapeHtml(url)}" alt=""></span>`;
  }
  return `<span class="${className}" style="background:${color};">${escapeHtml(initials)}</span>`;
}

export function renderPostCard(post, currentUserId = null, isAdminUser = false) {
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
  const isOwn    = currentUserId && post.user_id === currentUserId;
  const canEdit  = isOwn && (Date.now() - new Date(post.created_at).getTime() < 15 * 60 * 1000);

  return `
    <article class="tl-post${pinned}" data-post-id="${escapeHtml(post.id)}" data-category="${escapeHtml(cat.id)}" data-likes="${likes}" data-replies="${replies}" data-liked="${liked ? '1' : '0'}">
      ${post.is_pinned ? '<div class="tl-pinned-tag">📌 Mededeling</div>' : ''}
      <header class="tl-post-head">
        ${renderAvatar(post.avatar_url, color, initials, 'tl-avatar')}
        <div class="tl-post-meta">
          <span class="tl-nickname">${escapeHtml(nickname)}</span>
          ${post.author_is_admin ? '<span class="tl-admin-badge" title="Administrator">Admin</span>' : ''}
          <span class="tl-meta-sep">·</span>
          <span class="tl-time">${escapeHtml(time)}${edited}</span>
        </div>
        <span class="tl-cat tl-cat--${escapeHtml(cat.id)}" title="Categorie">${cat.emoji} ${escapeHtml(cat.label)}</span>
        ${renderMenu({ isOwn, canEdit, type: 'post', isAdminUser, isPinned: post.is_pinned })}
      </header>
      <div class="tl-post-body" data-role="post-body">${body}</div>
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
 * Render een poll-blok.
 *
 * Single-vote (allow_multi=false):
 *   - Niet gestemd → knoppen
 *   - Gestemd → resultaat-bars; klik op je gekozen optie = unvote
 *
 * Multi-vote (allow_multi=true):
 *   - Altijd checkbox-stijl knoppen die je individueel kan toggelen
 *   - Toont meteen counts naast elke optie
 *
 * Gesloten polls: alleen resultaat-bars, niets klikbaar.
 *
 * Backwards-compat: oude payload met `my_vote` (int|null) wordt
 * automatisch geconverteerd naar `my_votes` array.
 */
export function renderPoll(poll) {
  if (!poll || !Array.isArray(poll.options)) return '';
  const total = Number(poll.total || 0);
  const myVotes = Array.isArray(poll.my_votes)
    ? poll.my_votes
    : (typeof poll.my_vote === 'number' ? [poll.my_vote] : []);
  const myVoteSet = new Set(myVotes);
  const closed = !!poll.closed;
  const allowMulti = !!poll.allow_multi;
  const hasVoted = myVotes.length > 0;
  const showResultsOnly = closed || (!allowMulti && hasVoted);

  const opts = poll.options.map((label, idx) => {
    const count = Number(poll.counts?.[idx] || 0);
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    const mine = myVoteSet.has(idx);

    if (showResultsOnly) {
      // Bij single-vote en niet-gesloten: klik op eigen keuze = unvote
      const clickable = !closed && !allowMulti && mine;
      const tag = clickable ? 'button' : 'div';
      const cls = `tl-poll-result${mine ? ' is-mine' : ''}${clickable ? ' is-clickable' : ''}`;
      const attrs = clickable
        ? ` type="button" data-action="vote-poll" data-option-idx="${idx}" data-vote-action="unvote" title="Klik om je stem terug te trekken"`
        : '';
      return `
        <${tag} class="${cls}"${attrs}>
          <div class="tl-poll-bar" style="width:${pct}%"></div>
          <div class="tl-poll-result-label">
            <span>${escapeHtml(label)}${mine ? ' ✓' : ''}</span>
            <span class="tl-poll-pct">${pct}%</span>
          </div>
        </${tag}>
      `;
    }

    // Knop-view: single (nog niet gestemd) of multi (altijd)
    const action = allowMulti ? 'toggle' : 'set';
    const checkedCls = mine ? ' is-checked' : '';
    return `
      <button type="button" class="tl-poll-vote-btn${checkedCls}" data-action="vote-poll" data-option-idx="${idx}" data-vote-action="${action}">
        ${allowMulti ? `<span class="tl-poll-checkbox">${mine ? '☑' : '☐'}</span>` : ''}
        <span class="tl-poll-vote-label">${escapeHtml(label)}</span>
        ${allowMulti && (count > 0 || mine) ? `<span class="tl-poll-vote-count">${count}</span>` : ''}
      </button>
    `;
  }).join('');

  const closeText = closed
    ? 'Gesloten'
    : `Sluit ${formatRelativeFuture(poll.closes_at)}`;
  const modeText = allowMulti ? ' · meerdere keuzes' : '';
  const totalText = `${total} stem${total === 1 ? '' : 'men'}`;

  return `
    <div class="tl-poll" data-role="poll" data-allow-multi="${allowMulti ? '1' : '0'}">
      <div class="tl-poll-question">${escapeHtml(poll.question)}</div>
      <div class="tl-poll-options-list">${opts}</div>
      <div class="tl-poll-meta">${totalText}${modeText} · ${closeText}</div>
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
export function renderReplyRow(reply, currentUserId = null, isAdminUser = false) {
  const nickname = reply.nickname || '(naamloos)';
  const initials = initialsFromName(nickname);
  const color    = colorFromSeed(reply.user_id);
  const time     = formatRelativeTime(reply.created_at);
  const edited   = reply.edited_at ? ' · bewerkt' : '';
  const body     = nl2br(escapeHtml(reply.body));
  const isOwn    = currentUserId && reply.user_id === currentUserId;
  const canEdit  = isOwn && (Date.now() - new Date(reply.created_at).getTime() < 15 * 60 * 1000);
  const likes    = Number(reply.likes_count || 0);
  const liked    = !!reply.liked_by_me;

  return `
    <div class="tl-reply" data-reply-id="${escapeHtml(reply.id)}" data-liked="${liked ? '1' : '0'}">
      ${renderAvatar(reply.avatar_url, color, initials, 'tl-avatar tl-avatar-sm')}
      <div class="tl-reply-bubble">
        <div class="tl-reply-meta">
          <span class="tl-nickname">${escapeHtml(nickname)}</span>
          ${reply.author_is_admin ? '<span class="tl-admin-badge tl-admin-badge-sm" title="Administrator">Admin</span>' : ''}
          <span class="tl-meta-sep">·</span>
          <span class="tl-time">${escapeHtml(time)}${edited}</span>
          ${renderMenu({ isOwn, canEdit, type: 'reply', isAdminUser })}
        </div>
        <div class="tl-reply-body" data-role="reply-body">${body}</div>
        <div class="tl-reply-foot-actions">
          <button type="button" class="tl-action tl-action-sm tl-like ${liked ? 'is-liked' : ''}" data-action="like-reply" aria-label="Like">
            <span class="tl-action-icon">${liked ? '❤' : '♡'}</span>
            <span class="tl-action-count" data-role="reply-like-count">${likes}</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Render een "..." menu-knop met dropdown. Inhoud:
 * - eigen item: Bewerken (binnen 15 min) + Verwijderen
 * - andermans item: Rapporteren
 * - admin krijgt extra "Pin" / "Unpin" + admin "Verwijderen" (op posts)
 */
function renderMenu({ isOwn, canEdit, type, isAdminUser = false, isPinned = false }) {
  const items = [];
  if (isOwn) {
    if (canEdit) items.push(`<button type="button" class="tl-menu-item" data-action="edit-${type}">Bewerken</button>`);
    items.push(`<button type="button" class="tl-menu-item tl-menu-danger" data-action="delete-${type}">Verwijderen</button>`);
  } else {
    items.push(`<button type="button" class="tl-menu-item" data-action="report-${type}">Rapporteren</button>`);
  }
  if (isAdminUser && type === 'post') {
    items.push(
      isPinned
        ? `<button type="button" class="tl-menu-item tl-menu-admin" data-action="unpin-post">📌 Losmaken</button>`
        : `<button type="button" class="tl-menu-item tl-menu-admin" data-action="pin-post">📌 Vastpinnen</button>`
    );
    if (!isOwn) {
      items.push(`<button type="button" class="tl-menu-item tl-menu-danger tl-menu-admin" data-action="admin-delete-post">Verwijderen (admin)</button>`);
    }
  }
  if (isAdminUser && type === 'reply' && !isOwn) {
    items.push(`<button type="button" class="tl-menu-item tl-menu-danger tl-menu-admin" data-action="admin-delete-reply">Verwijderen (admin)</button>`);
  }
  if (items.length === 0) return '';
  return `
    <div class="tl-menu" data-role="menu">
      <button type="button" class="tl-menu-toggle" data-action="toggle-menu" aria-label="Acties" aria-expanded="false">⋯</button>
      <div class="tl-menu-dropdown hidden" data-role="menu-dropdown">${items.join('')}</div>
    </div>
  `;
}
