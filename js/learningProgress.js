/* ============================================
   MIJN LEERTRAJECT — lokale frontend-preview
   Alleen de bewuste afrondstatus staat lokaal.
   'Bezig' blijft afgeleid van bestaande bookmarks.
============================================ */

import * as Store from './store.js?v=4.0.32';

const STORAGE_PREFIX = 'prilleven_learning_progress_';

function storageKey() {
  const user = String(Store.getCurrentUser() || 'anoniem').trim().toLowerCase();
  return `${STORAGE_PREFIX}${user}`;
}

function readCompletionMap() {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey()) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeCompletionMap(map) {
  localStorage.setItem(storageKey(), JSON.stringify(map));
}

export function isLearningCompleted(learningId) {
  return Boolean(readCompletionMap()[learningId]?.completed_at);
}

export function setLearningCompleted(learningId, completed) {
  if (!learningId) return false;
  const map = readCompletionMap();
  if (completed) {
    map[learningId] = { completed_at: new Date().toISOString() };
  } else {
    delete map[learningId];
  }
  writeCompletionMap(map);
  return completed;
}

export function getLearningStatus(learning) {
  if (isLearningCompleted(learning?.id)) {
    return { key: 'completed', label: 'Afgerond' };
  }
  if (learning?.bookmark?.position && Object.keys(learning.bookmark.position).length > 0) {
    return { key: 'active', label: 'Bezig' };
  }
  return { key: 'new', label: 'Nieuw' };
}
