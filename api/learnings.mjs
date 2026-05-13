// Catch-all router voor alle /api/learnings/* endpoints.
// Wordt door Vercel als ÉÉN serverless function geteld i.p.v. één per pad.
//
// Vercel routet hier naartoe via een rewrite in vercel.json:
//   /api/learnings/(.*) → /api/learnings
//
// Routes:
//   GET    /api/learnings                       — lijst (filter: ?kind=, ?favorites=1)
//   GET    /api/learnings/:id                   — detail + signed URL (pdf/video)
//   POST   /api/learnings                       — admin: create
//   PATCH  /api/learnings/:id                   — admin: update
//   DELETE /api/learnings/:id                   — admin: delete
//   POST   /api/learnings/upload-url            — admin: signed upload-URL voor pdf/video/thumb
//
//   POST   /api/learnings/:id/favorite          — toggle favoriet
//
//   GET    /api/learnings/:id/bookmark          — last position (lindje)
//   PUT    /api/learnings/:id/bookmark          — save position
//
//   GET    /api/learnings/:id/notes             — lijst notities voor item
//   POST   /api/learnings/:id/notes             — nieuwe notitie
//   PATCH  /api/learnings/notes/:noteId         — title/body wijzigen
//   DELETE /api/learnings/notes/:noteId         — verwijderen
//
//   POST   /api/learnings/notes/:noteId/clips   — clip toevoegen (text/timecode)
//   DELETE /api/learnings/clips/:clipId         — clip verwijderen

import { requireAuth, requireAdmin, AuthError } from './_lib/auth.mjs';
import { supabase } from './_lib/clients.mjs';

const SIGNED_URL_TTL = 60 * 10; // 10 minuten

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s));
}

function parseBody(req) {
  try {
    return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return null;
  }
}

/* ----------------------------------------
   Route-matching
---------------------------------------- */
function matchRoute(req) {
  // Vercel catch-all conventie: req.query.path bevat segmenten na /api/learnings/.
  // Wanneer pad exact /api/learnings is, is path undefined of leeg.
  const raw = req.query?.path;
  const segments = Array.isArray(raw) ? raw : (typeof raw === 'string' && raw ? raw.split('/') : []);
  const method = req.method;

  // /api/learnings
  if (segments.length === 0) {
    if (method === 'GET')  return { route: 'list', params: {} };
    if (method === 'POST') return { route: 'create', params: {} };
  }

  // /api/learnings/upload-url
  if (segments.length === 1 && segments[0] === 'upload-url' && method === 'POST') {
    return { route: 'upload-url', params: {} };
  }

  // /api/learnings/notes/:noteId
  if (segments.length === 2 && segments[0] === 'notes' && isUuid(segments[1])) {
    if (method === 'PATCH')  return { route: 'note-update', params: { noteId: segments[1] } };
    if (method === 'DELETE') return { route: 'note-delete', params: { noteId: segments[1] } };
  }

  // /api/learnings/notes/:noteId/clips
  if (segments.length === 3 && segments[0] === 'notes' && isUuid(segments[1]) && segments[2] === 'clips') {
    if (method === 'POST') return { route: 'clip-add', params: { noteId: segments[1] } };
  }

  // /api/learnings/clips/:clipId
  if (segments.length === 2 && segments[0] === 'clips' && isUuid(segments[1])) {
    if (method === 'DELETE') return { route: 'clip-delete', params: { clipId: segments[1] } };
  }

  // /api/learnings/:id
  if (segments.length === 1 && isUuid(segments[0])) {
    if (method === 'GET')    return { route: 'get',    params: { id: segments[0] } };
    if (method === 'PATCH')  return { route: 'update', params: { id: segments[0] } };
    if (method === 'DELETE') return { route: 'delete', params: { id: segments[0] } };
  }

  // /api/learnings/:id/favorite
  if (segments.length === 2 && isUuid(segments[0]) && segments[1] === 'favorite') {
    if (method === 'POST') return { route: 'favorite-toggle', params: { id: segments[0] } };
  }

  // /api/learnings/:id/bookmark
  if (segments.length === 2 && isUuid(segments[0]) && segments[1] === 'bookmark') {
    if (method === 'GET') return { route: 'bookmark-get',  params: { id: segments[0] } };
    if (method === 'PUT') return { route: 'bookmark-save', params: { id: segments[0] } };
  }

  // /api/learnings/:id/notes
  if (segments.length === 2 && isUuid(segments[0]) && segments[1] === 'notes') {
    if (method === 'GET')  return { route: 'note-list',   params: { id: segments[0] } };
    if (method === 'POST') return { route: 'note-create', params: { id: segments[0] } };
  }

  return null;
}

/* ============================================
   HANDLER
============================================ */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  const match = matchRoute(req);
  if (!match) return json(res, 404, { error: 'Not found' });

  // Alle routes vereisen authentication.
  let auth;
  try {
    auth = await requireAuth(req);
  } catch (e) {
    if (e instanceof AuthError) return json(res, e.status, { error: e.message });
    throw e;
  }

  try {
    switch (match.route) {
      case 'list':              return await listLearnings(req, res, auth);
      case 'get':                return await getLearning(req, res, auth, match.params.id);
      case 'create':             return await createLearning(req, res, auth);
      case 'update':             return await updateLearning(req, res, auth, match.params.id);
      case 'delete':             return await deleteLearning(req, res, auth, match.params.id);
      case 'upload-url':         return await uploadUrl(req, res, auth);

      case 'favorite-toggle':    return await toggleFavorite(req, res, auth, match.params.id);

      case 'bookmark-get':       return await getBookmark(req, res, auth, match.params.id);
      case 'bookmark-save':      return await saveBookmark(req, res, auth, match.params.id);

      case 'note-list':          return await listNotes(req, res, auth, match.params.id);
      case 'note-create':        return await createNote(req, res, auth, match.params.id);
      case 'note-update':        return await updateNote(req, res, auth, match.params.noteId);
      case 'note-delete':        return await deleteNote(req, res, auth, match.params.noteId);

      case 'clip-add':           return await addClip(req, res, auth, match.params.noteId);
      case 'clip-delete':        return await deleteClip(req, res, auth, match.params.clipId);
    }
    return json(res, 404, { error: 'Route niet gevonden' });
  } catch (err) {
    if (err instanceof AuthError) return json(res, err.status, { error: err.message });
    console.error('[learnings]', err);
    return json(res, 500, { error: err.message || 'Er ging iets mis.' });
  }
}

/* ============================================
   LIST + GET
============================================ */
async function listLearnings(req, res, auth) {
  const kind = req.query?.kind || null;          // 'pdf' | 'blog' | 'video'
  const favoritesOnly = String(req.query?.favorites || '') === '1';

  let learnings;
  if (favoritesOnly) {
    // Join via favorites — alleen items waar deze user een favoriet heeft.
    const { data: favs, error: fErr } = await supabase
      .from('user_learning_favorites')
      .select('learning_id')
      .eq('user_id', auth.userId);
    if (fErr) throw fErr;
    const ids = (favs || []).map(f => f.learning_id);
    if (ids.length === 0) return json(res, 200, { learnings: [] });

    let q = supabase
      .from('learnings')
      .select('id, kind, title, description, thumbnail_url, duration_sec, tags, created_at')
      .eq('is_published', true)
      .in('id', ids)
      .order('created_at', { ascending: false });
    if (kind) q = q.eq('kind', kind);
    const { data, error } = await q;
    if (error) throw error;
    learnings = data || [];
  } else {
    let q = supabase
      .from('learnings')
      .select('id, kind, title, description, thumbnail_url, duration_sec, tags, created_at')
      .eq('is_published', true)
      .order('created_at', { ascending: false });
    if (kind) q = q.eq('kind', kind);
    const { data, error } = await q;
    if (error) throw error;
    learnings = data || [];
  }

  // Markeer welke favoriet zijn voor deze user (1 extra query).
  const { data: favs } = await supabase
    .from('user_learning_favorites')
    .select('learning_id')
    .eq('user_id', auth.userId);
  const favSet = new Set((favs || []).map(f => f.learning_id));
  for (const l of learnings) l.is_favorite = favSet.has(l.id);

  return json(res, 200, { learnings });
}

async function getLearning(req, res, auth, id) {
  const { data: learning, error } = await supabase
    .from('learnings')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!learning || !learning.is_published) return json(res, 404, { error: 'Niet gevonden.' });

  // Signed URL voor pdf / video.
  let signedUrl = null;
  if (learning.kind === 'pdf' || learning.kind === 'video') {
    const bucket = learning.kind === 'pdf' ? 'learnings-pdf' : 'learnings-video';
    const { data: signed, error: sErr } = await supabase
      .storage
      .from(bucket)
      .createSignedUrl(learning.storage_path, SIGNED_URL_TTL);
    if (sErr) {
      console.error('[learnings.getLearning signed-url]', sErr);
      return json(res, 500, { error: 'Kon bestand-URL niet ophalen.' });
    }
    signedUrl = signed?.signedUrl || null;
  }

  // Favoriet + bookmark in 1 keer mee terugsturen.
  const [{ data: favRow }, { data: bmRow }] = await Promise.all([
    supabase.from('user_learning_favorites')
      .select('learning_id').eq('user_id', auth.userId).eq('learning_id', id).maybeSingle(),
    supabase.from('user_learning_bookmarks')
      .select('position, updated_at').eq('user_id', auth.userId).eq('learning_id', id).maybeSingle(),
  ]);

  return json(res, 200, {
    learning: {
      ...learning,
      signed_url: signedUrl,
      is_favorite: !!favRow,
      bookmark: bmRow ? { position: bmRow.position, updated_at: bmRow.updated_at } : null,
    },
  });
}

/* ============================================
   CREATE / UPDATE / DELETE  (admin)
============================================ */
async function createLearning(req, res, auth) {
  // Admin-check
  try { await requireAdmin(req); } catch (e) {
    if (e instanceof AuthError) return json(res, e.status, { error: e.message });
    throw e;
  }
  const body = parseBody(req);
  if (!body) return json(res, 400, { error: 'Ongeldige body.' });

  const kind = body.kind;
  if (!['pdf','blog','video'].includes(kind)) return json(res, 400, { error: 'kind moet pdf/blog/video zijn.' });
  const title = String(body.title || '').trim();
  if (!title || title.length > 200) return json(res, 400, { error: 'title verplicht (1-200 chars).' });
  const description = body.description ? String(body.description).slice(0, 1000) : null;
  const thumbnail_url = body.thumbnail_url ? String(body.thumbnail_url) : null;
  const tags = Array.isArray(body.tags) ? body.tags.map(t => String(t).slice(0, 40)).slice(0, 20) : [];

  let storage_path = null;
  let body_html = null;
  let duration_sec = null;

  if (kind === 'blog') {
    body_html = String(body.body_html || '').trim();
    if (!body_html) return json(res, 400, { error: 'body_html verplicht voor blog.' });
    if (body_html.length > 200000) return json(res, 400, { error: 'body_html te groot (max 200000 chars).' });
  } else {
    storage_path = String(body.storage_path || '').trim();
    if (!storage_path) return json(res, 400, { error: 'storage_path verplicht voor pdf/video.' });
    if (kind === 'video' && body.duration_sec != null) {
      duration_sec = Math.max(0, Math.floor(Number(body.duration_sec)));
    }
  }

  const { data, error } = await supabase
    .from('learnings')
    .insert({
      kind, title, description, thumbnail_url,
      storage_path, body_html, duration_sec,
      tags, created_by: auth.userId, is_published: true,
    })
    .select('id, kind, title, created_at')
    .single();
  if (error) return json(res, 500, { error: error.message });

  return json(res, 201, { learning: data });
}

async function updateLearning(req, res, auth, id) {
  try { await requireAdmin(req); } catch (e) {
    if (e instanceof AuthError) return json(res, e.status, { error: e.message });
    throw e;
  }
  const body = parseBody(req);
  if (!body) return json(res, 400, { error: 'Ongeldige body.' });
  const patch = {};
  if (body.title != null)         patch.title = String(body.title).slice(0, 200);
  if (body.description !== undefined) patch.description = body.description ? String(body.description).slice(0, 1000) : null;
  if (body.thumbnail_url !== undefined) patch.thumbnail_url = body.thumbnail_url || null;
  if (body.body_html !== undefined) patch.body_html = body.body_html ? String(body.body_html).slice(0, 200000) : null;
  if (body.tags && Array.isArray(body.tags)) patch.tags = body.tags.map(t => String(t).slice(0, 40)).slice(0, 20);
  if (body.is_published != null) patch.is_published = !!body.is_published;

  if (Object.keys(patch).length === 0) return json(res, 400, { error: 'Geen wijzigingen.' });

  const { data, error } = await supabase
    .from('learnings').update(patch).eq('id', id)
    .select('id, kind, title, is_published').single();
  if (error) return json(res, 500, { error: error.message });
  return json(res, 200, { learning: data });
}

async function deleteLearning(req, res, auth, id) {
  try { await requireAdmin(req); } catch (e) {
    if (e instanceof AuthError) return json(res, e.status, { error: e.message });
    throw e;
  }
  // Eerst het item ophalen om storage_path te kennen.
  const { data: row } = await supabase
    .from('learnings').select('kind, storage_path').eq('id', id).maybeSingle();

  // Storage-asset (best effort) verwijderen.
  if (row?.storage_path && (row.kind === 'pdf' || row.kind === 'video')) {
    const bucket = row.kind === 'pdf' ? 'learnings-pdf' : 'learnings-video';
    await supabase.storage.from(bucket).remove([row.storage_path]).catch(() => {});
  }

  const { error } = await supabase.from('learnings').delete().eq('id', id);
  if (error) return json(res, 500, { error: error.message });
  return json(res, 200, { ok: true });
}

/* ============================================
   ADMIN: signed upload-URL
============================================ */
async function uploadUrl(req, res, auth) {
  try { await requireAdmin(req); } catch (e) {
    if (e instanceof AuthError) return json(res, e.status, { error: e.message });
    throw e;
  }
  const body = parseBody(req);
  if (!body) return json(res, 400, { error: 'Ongeldige body.' });

  const kind = body.kind;                        // 'pdf' | 'video' | 'thumb'
  const filename = String(body.filename || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  if (!filename) return json(res, 400, { error: 'filename verplicht.' });

  let bucket;
  if (kind === 'pdf')   bucket = 'learnings-pdf';
  else if (kind === 'video') bucket = 'learnings-video';
  else if (kind === 'thumb') bucket = 'learnings-thumb';
  else return json(res, 400, { error: 'kind moet pdf/video/thumb zijn.' });

  const path = `${Date.now()}-${filename}`;
  const { data, error } = await supabase
    .storage.from(bucket).createSignedUploadUrl(path);
  if (error) return json(res, 500, { error: error.message });

  // Voor thumbnails (publieke bucket) ook meteen de public-URL meesturen,
  // zodat de frontend deze direct kan opslaan in `learnings.thumbnail_url`.
  let public_url = null;
  if (kind === 'thumb') {
    const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
    public_url = pub?.publicUrl || null;
  }

  return json(res, 200, {
    bucket,
    path,
    token: data.token,
    signed_url: data.signedUrl,
    public_url,
  });
}

/* ============================================
   FAVORITES
============================================ */
async function toggleFavorite(req, res, auth, id) {
  // Bestaat 'm al?
  const { data: existing } = await supabase
    .from('user_learning_favorites')
    .select('learning_id')
    .eq('user_id', auth.userId).eq('learning_id', id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('user_learning_favorites')
      .delete()
      .eq('user_id', auth.userId).eq('learning_id', id);
    if (error) return json(res, 500, { error: error.message });
    return json(res, 200, { is_favorite: false });
  }

  const { error } = await supabase
    .from('user_learning_favorites')
    .insert({ user_id: auth.userId, learning_id: id });
  if (error) return json(res, 500, { error: error.message });
  return json(res, 200, { is_favorite: true });
}

/* ============================================
   BOOKMARKS (lindje)
============================================ */
async function getBookmark(req, res, auth, id) {
  const { data, error } = await supabase
    .from('user_learning_bookmarks')
    .select('position, updated_at')
    .eq('user_id', auth.userId).eq('learning_id', id)
    .maybeSingle();
  if (error) return json(res, 500, { error: error.message });
  return json(res, 200, { bookmark: data || null });
}

async function saveBookmark(req, res, auth, id) {
  const body = parseBody(req);
  if (!body || typeof body.position !== 'object') {
    return json(res, 400, { error: 'position (object) verplicht.' });
  }
  const { error } = await supabase
    .from('user_learning_bookmarks')
    .upsert({
      user_id: auth.userId,
      learning_id: id,
      position: body.position,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,learning_id' });
  if (error) return json(res, 500, { error: error.message });
  return json(res, 200, { ok: true });
}

/* ============================================
   NOTES
============================================ */
async function listNotes(req, res, auth, learningId) {
  const { data: notes, error: nErr } = await supabase
    .from('user_learning_notes')
    .select('id, title, body, created_at, updated_at')
    .eq('user_id', auth.userId).eq('learning_id', learningId)
    .order('updated_at', { ascending: false });
  if (nErr) return json(res, 500, { error: nErr.message });

  const ids = (notes || []).map(n => n.id);
  let clipsByNote = {};
  if (ids.length > 0) {
    const { data: clips, error: cErr } = await supabase
      .from('user_learning_note_clips')
      .select('id, note_id, clip_type, body, seconds, page_nr, position, created_at')
      .in('note_id', ids)
      .order('position', { ascending: true });
    if (cErr) return json(res, 500, { error: cErr.message });
    for (const c of clips || []) {
      (clipsByNote[c.note_id] ||= []).push(c);
    }
  }
  const result = (notes || []).map(n => ({ ...n, clips: clipsByNote[n.id] || [] }));
  return json(res, 200, { notes: result });
}

async function createNote(req, res, auth, learningId) {
  const body = parseBody(req) || {};
  const title = (body.title ? String(body.title) : 'Notitie').slice(0, 120) || 'Notitie';
  const bodyText = body.body ? String(body.body).slice(0, 20000) : '';

  const { data, error } = await supabase
    .from('user_learning_notes')
    .insert({ user_id: auth.userId, learning_id: learningId, title, body: bodyText })
    .select('id, title, body, created_at, updated_at')
    .single();
  if (error) return json(res, 500, { error: error.message });
  return json(res, 201, { note: { ...data, clips: [] } });
}

async function updateNote(req, res, auth, noteId) {
  const body = parseBody(req) || {};
  const patch = {};
  if (body.title != null) patch.title = String(body.title).slice(0, 120) || 'Notitie';
  if (body.body  != null) patch.body  = String(body.body).slice(0, 20000);
  if (Object.keys(patch).length === 0) return json(res, 400, { error: 'Geen wijzigingen.' });

  const { data, error } = await supabase
    .from('user_learning_notes')
    .update(patch)
    .eq('id', noteId).eq('user_id', auth.userId)
    .select('id, title, body, created_at, updated_at')
    .maybeSingle();
  if (error) return json(res, 500, { error: error.message });
  if (!data) return json(res, 404, { error: 'Notitie niet gevonden.' });
  return json(res, 200, { note: data });
}

async function deleteNote(req, res, auth, noteId) {
  const { error } = await supabase
    .from('user_learning_notes')
    .delete()
    .eq('id', noteId).eq('user_id', auth.userId);
  if (error) return json(res, 500, { error: error.message });
  return json(res, 200, { ok: true });
}

/* ============================================
   CLIPS
============================================ */
async function addClip(req, res, auth, noteId) {
  const body = parseBody(req) || {};
  const clip_type = body.clip_type;
  if (!['text','timecode'].includes(clip_type)) {
    return json(res, 400, { error: 'clip_type moet text/timecode zijn.' });
  }

  // Note moet van deze user zijn.
  const { data: note } = await supabase
    .from('user_learning_notes')
    .select('id, user_id').eq('id', noteId).maybeSingle();
  if (!note || note.user_id !== auth.userId) {
    return json(res, 404, { error: 'Notitie niet gevonden.' });
  }

  // Volgende position bepalen.
  const { data: maxRow } = await supabase
    .from('user_learning_note_clips')
    .select('position').eq('note_id', noteId)
    .order('position', { ascending: false }).limit(1).maybeSingle();
  const nextPos = ((maxRow?.position ?? -1) + 1);

  const insertRow = {
    note_id: noteId,
    user_id: auth.userId,
    clip_type,
    body: body.body ? String(body.body).slice(0, 4000) : null,
    seconds: body.seconds != null ? Number(body.seconds) : null,
    page_nr: body.page_nr != null ? Math.max(1, Math.floor(Number(body.page_nr))) : null,
    position: nextPos,
  };

  if (clip_type === 'text' && !insertRow.body) {
    return json(res, 400, { error: 'body verplicht voor text-clip.' });
  }
  if (clip_type === 'timecode' && insertRow.seconds == null) {
    return json(res, 400, { error: 'seconds verplicht voor timecode-clip.' });
  }

  const { data, error } = await supabase
    .from('user_learning_note_clips')
    .insert(insertRow)
    .select('id, note_id, clip_type, body, seconds, page_nr, position, created_at')
    .single();
  if (error) return json(res, 500, { error: error.message });

  // touch parent note updated_at
  await supabase.from('user_learning_notes')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', noteId).eq('user_id', auth.userId);

  return json(res, 201, { clip: data });
}

async function deleteClip(req, res, auth, clipId) {
  const { error } = await supabase
    .from('user_learning_note_clips')
    .delete()
    .eq('id', clipId).eq('user_id', auth.userId);
  if (error) return json(res, 500, { error: error.message });
  return json(res, 200, { ok: true });
}
