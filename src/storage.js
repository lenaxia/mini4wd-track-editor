/* Persistence — localStorage autosave + explicit server publishing.
 *
 * Owner model (worklog 0012): unpublished tracks are LOCAL ONLY — no
 * server writes. Publishing a track (name + POST /api/tracks) binds it,
 * and from then on every autosave mirrors to that row ("edit from
 * there"), retried with backoff on transient failure. A newer edit
 * abandons older retry chains. Server absent/failed sync is never an
 * error — the mirror is best-effort by design. */

import { serializeForSave, parseTrack } from './track.js';

const KEY = 'm4wd.autosave';
const PUB_KEY = 'm4wd.published';    /* {id, name} once published */
let autosaveTimer = null;
let syncTimer = null;
let syncGen = 0;   /* a newer edit's sync abandons older retry chains */

/* Retry ONLY on network failure / 5xx / 429 — permanent 4xx (static-only
 * server, validation, size caps) can never succeed and would just
 * multiply pointless PUTs. A superseded generation issues no further
 * requests at all. */
const RETRYABLE = (status) => status === 429 || status >= 500;

function readPub() {
  try {
    const raw = localStorage.getItem(PUB_KEY);
    const p = raw ? JSON.parse(raw) : null;
    return p && typeof p.id === 'string' && typeof p.name === 'string' ? p : null;
  } catch { return null; }
}

function writePub(p) {
  try { p ? localStorage.setItem(PUB_KEY, JSON.stringify(p)) : localStorage.removeItem(PUB_KEY); } catch (_) {}
}

/* The current publication binding, if any: {id, name}. */
export function publishedTrack() { return readPub(); }

/* Publish (or rename) the current track. Returns the created row or
 * null when the server is unreachable — the track stays local either
 * way and can be published later. */
export async function publishTrack(name, state) {
  const snapshot = {
    mode: state.mode, tool: state.tool, angle: state.angle,
    track: serializeForSave(state.sprites),
  };
  const prev = readPub();
  try {
    const res = await fetch(prev ? `/api/tracks/${prev.id}` : '/api/tracks', {
      method: prev ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data: snapshot }),
    });
    if (!res.ok) return null;
    const row = await res.json();
    writePub({ id: row.id, name: row.name });
    return row;
  } catch { return null; }
}

/* Drop the publication binding (New Track): further edits stay local. */
export function unpublishTrack() { writePub(null); }

/* Load a published row onto the canvas state: returns the parsed sprites
 * (caller applies them + the binding). */
export function spritesFromRow(row) { return parseTrack(row.data.track); }

function syncToServer(id, name, snapshot) {
  const gen = ++syncGen;
  const put = (attempt) => {
    /* superseded: no further requests are issued (an in-flight PUT cannot
     * be cancelled — the exposure window is one request duration) */
    if (gen !== syncGen) return;
    fetch(`/api/tracks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data: snapshot }),
    }).then((r) => {
      if (gen === syncGen && !r.ok && RETRYABLE(r.status) && attempt < 3)
        setTimeout(() => put(attempt + 1), 2000 * (attempt + 1));
    }).catch(() => {
      if (gen === syncGen && attempt < 3)
        setTimeout(() => put(attempt + 1), 2000 * (attempt + 1));
    });
  };
  put(0);
}

export function autosave(state) {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    let snapshot = null;
    try {
      snapshot = {
        mode: state.mode, tool: state.tool, angle: state.angle, track: serializeForSave(state.sprites),
      };
      localStorage.setItem(KEY, JSON.stringify(snapshot));
    } catch (_) { /* private mode etc. */ }
    /* mirror only PUBLISHED tracks; the debounce is independent */
    const pub = readPub();
    if (snapshot && pub) {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => syncToServer(pub.id, pub.name, snapshot), 1500);
    }
  }, 350);
}

/* Mutates state (mode/sprites/angle) from the saved autosave.
 * Returns true when a non-empty track was restored. */
export function restore(state) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (data.mode === 3 || data.mode === 5 || data.mode === 'rucdoc') state.mode = data.mode;
    if (data.track) {
      state.sprites = parseTrack(data.track);
      if (data.angle) state.angle = data.angle;
    }
    return state.sprites.length > 0;
  } catch (_) { return false; }
}
