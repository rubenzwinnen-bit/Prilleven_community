/* ============================================
   TIMELINE POST — render één postkaart.
   Stap 3: alleen weergave (avatar, nickname, tijd,
   body, pinned-rand). Replies/likes/edit/etc komen later.
============================================ */

import {
  escapeHtml,
  formatRelativeTime,
  colorFromSeed,
  initialsFromName,
  nl2br,
} from '../utils.js?v=2.0.1';

export function renderPostCard(post) {
  const nickname = post.nickname || '(naamloos)';
  const initials = initialsFromName(nickname);
  const color    = colorFromSeed(post.user_id);
  const time     = formatRelativeTime(post.created_at);
  const edited   = post.edited_at ? ' · bewerkt' : '';
  const pinned   = post.is_pinned ? ' is-pinned' : '';
  const body     = nl2br(escapeHtml(post.body));

  return `
    <article class="tl-post${pinned}" data-post-id="${escapeHtml(post.id)}">
      ${post.is_pinned ? '<div class="tl-pinned-tag">📌 Mededeling</div>' : ''}
      <header class="tl-post-head">
        <span class="tl-avatar" style="background:${color};">${escapeHtml(initials)}</span>
        <div class="tl-post-meta">
          <span class="tl-nickname">${escapeHtml(nickname)}</span>
          <span class="tl-meta-sep">·</span>
          <span class="tl-time">${escapeHtml(time)}${edited}</span>
        </div>
      </header>
      <div class="tl-post-body">${body}</div>
    </article>
  `;
}
