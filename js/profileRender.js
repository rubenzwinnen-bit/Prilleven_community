/* ============================================
   PROFILE-RENDER — gedeelde helpers voor avatar +
   nickname + admin-badge. Gebruikt door timelinePost,
   chatRooms, en andere community-views zodat de
   profiel-weergave overal exact gelijk is.

   Eén "user-achtig" object met:
   - user_id        (uuid, voor seed-kleur)
   - nickname       (string)
   - avatar_url     (signed URL of null)
   - author_is_admin (boolean, optioneel)
============================================ */

import {
  escapeHtml,
  colorFromSeed,
  initialsFromName,
  formatRelativeTime,
} from './utils.js?v=2.5.6';

/* ---------------- Avatar ---------------- */
/**
 * Render avatar — foto als url aanwezig, anders gekleurde initiaal-bol.
 * @param {{user_id?:string, nickname?:string, avatar_url?:string|null}} user
 * @param {string} sizeClass  bv. 'tl-avatar' of 'tl-avatar tl-avatar-sm'
 */
export function renderAvatar(user, sizeClass = 'tl-avatar') {
  const name = user?.nickname || '(naamloos)';
  if (user?.avatar_url) {
    return `<span class="${sizeClass} has-photo"><img src="${escapeHtml(user.avatar_url)}" alt=""></span>`;
  }
  const color = colorFromSeed(user?.user_id || name);
  const initials = initialsFromName(name);
  return `<span class="${sizeClass}" style="background:${color};">${escapeHtml(initials)}</span>`;
}

/* ---------------- Auteur-meta (naam + admin + tijd) ---------------- */
/**
 * Render auteur-regel: nickname + optioneel admin-badge + tijdstip.
 * @param {{nickname?:string, author_is_admin?:boolean, created_at?:string, edited_at?:string|null}} user
 * @param {{ smallBadge?: boolean }} [opts]
 */
export function renderAuthorMeta(user, opts = {}) {
  const nickname = user?.nickname || '(naamloos)';
  const time = user?.created_at ? formatRelativeTime(user.created_at) : '';
  const edited = user?.edited_at ? ' · bewerkt' : '';
  const badgeCls = opts.smallBadge
    ? 'tl-admin-badge tl-admin-badge-sm'
    : 'tl-admin-badge';
  return `
    <span class="tl-nickname">${escapeHtml(nickname)}</span>
    ${user?.author_is_admin ? `<span class="${badgeCls}" title="Administrator">Admin</span>` : ''}
    ${time ? `<span class="tl-meta-sep">·</span><span class="tl-time">${escapeHtml(time)}${edited}</span>` : ''}
  `;
}
