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
const MINE_KEY = 'm4wd.mine';        /* ids this browser published/forked/edited (worklog 0020) */
const TRIP_KEY = 'm4wd.trip';        /* raw `name#phrase` byline, remembered (worklog 0023) */
const TRIPCODE_KEY = 'm4wd.tripcode'; /* this browser's hash code, echoed by the server on signed saves */
const MINE_CAP = 500;
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

/* Mine list (worklog 0017): ids this browser published, forked, or
 * edited — the identity-free "Mine" filter. Best-effort like every
 * other local write; capped, newest first. */
export function mineIds() {
  try {
    const raw = localStorage.getItem(MINE_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}

function rememberMine(id) {
  if (!id) return;
  try {
    const ids = [id, ...mineIds().filter((x) => x !== id)].slice(0, MINE_CAP);
    localStorage.setItem(MINE_KEY, JSON.stringify(ids));
  } catch (_) { /* private mode etc. */ }
}

export function isMine(id) { return mineIds().includes(id); }

/* ---------- tripcode byline (worklog 0023) ----------
 * The phrase lives only in this browser; the server stores its hash.
 * myTripCode() is the hash the server echoed on our last signed save —
 * the client never hashes (the salt is server-side). */
export function rememberedTrip() {
  try { return localStorage.getItem(TRIP_KEY) || null; } catch { return null; }
}
export function saveTrip(raw) {
  try { raw ? localStorage.setItem(TRIP_KEY, raw) : localStorage.removeItem(TRIP_KEY); } catch (_) {}
}
export function myTripCode() {
  try { return localStorage.getItem(TRIPCODE_KEY) || null; } catch { return null; }
}
function noteMyCode(hash) {
  try { hash ? localStorage.setItem(TRIPCODE_KEY, hash) : localStorage.removeItem(TRIPCODE_KEY); } catch (_) {}
}
/* A published row is locked-to-someone-else when it carries a tripcode
 * hash that isn't this browser's. Used to steer saves into copies. */
export function lockedToOther(pub) {
  return !!(pub && pub.author_trip && pub.author_trip !== myTripCode());
}

/* Publish (or rename) the current track. Returns the created row or
 * null when the server is unreachable — the track stays local either
 * way and can be published later. */
export async function publishTrack(name, state, trip = rememberedTrip()) {
  const snapshot = {
    mode: state.mode, tool: state.tool, angle: state.angle,
    track: serializeForSave(state.sprites),
  };
  const prev = readPub();
  if (lockedToOther(prev)) return null;   /* the caller must fork, not overwrite */
  try {
    const res = await fetch(prev ? `/api/tracks/${prev.id}` : '/api/tracks', {
      method: prev ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data: snapshot, ...(trip ? { trip } : {}) }),
    });
    if (!res.ok) return null;
    const row = await res.json();
    if (trip && row.author_trip) noteMyCode(row.author_trip);
    writePub({ id: row.id, name: row.name, author_trip: row.author_trip ?? null });
    rememberMine(row.id);
    return row;
  } catch { return null; }
}

/* "Save as my own copy" (worklog 0017): fork a row into a new track
 * this browser owns. Copies the row's data as-is — the one-tap gallery
 * action — or the current canvas when state is given. Only a canvas
 * fork rebinds (the canvas IS that track now); a gallery row-copy must
 * not touch the binding — the canvas holds something else and autosave
 * would overwrite the fresh copy with it. Returns the new row, or null
 * (server unreachable / parent gone). */
/* Result shape for the write helpers: { ok, row?, status? } — `null`
 * only for a network failure. Callers can tell "gone" (404: parent
 * deleted, version pruned) from "unreachable" and say so. */
export async function forkTrack(row, state, { trip = rememberedTrip(), name: nameOverride } = {}) {
  let data, name = row.name;
  if (state) {
    data = { mode: state.mode, tool: state.tool, angle: state.angle, track: serializeForSave(state.sprites) };
  } else if (row.data) {
    data = row.data;   /* a full row was handed in */
  } else {
    /* gallery list rows are metadata-only — pull the body once */
    try {
      const res = await fetch(`/api/tracks/${row.id}`);
      if (!res.ok) return { ok: false, status: res.status };
      const full = await res.json();
      data = full.data;
      name = full.name;
    } catch { return null; }
  }
  try {
    const res = await fetch('/api/tracks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nameOverride || name, parent_id: row.id, data, ...(trip ? { trip } : {}) }),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const fresh = await res.json();
    if (trip && fresh.author_trip) noteMyCode(fresh.author_trip);
    if (state) writePub({ id: fresh.id, name: fresh.name, author_trip: fresh.author_trip ?? null });
    rememberMine(fresh.id);
    return { ok: true, row: fresh };
  } catch { return null; }
}

/* Version history (worklog 0020). history() never throws; both return
 * null / { ok: false, status } when the server answers badly. */
export async function fetchHistory(id) {
  try {
    const res = await fetch(`/api/tracks/${id}/history`);
    if (!res.ok) return null;
    return (await res.json()).items || [];
  } catch { return null; }
}

/* The restore response is the upsert result — meta-only, uniform across
 * drivers — so the full row is refetched before it reaches the canvas. */
export async function restoreRevision(id, seq) {
  try {
    const res = await fetch(`/api/tracks/${id}/history/${seq}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rememberedTrip() ? { trip: rememberedTrip() } : {}),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const full = await fetch(`/api/tracks/${id}`);
    if (!full.ok) return { ok: false, status: full.status };
    rememberMine(id);
    return { ok: true, row: await full.json() };
  } catch { return null; }
}

/* Adopt an existing published row (library load): binds {id, name}.
 * Never throws — private-mode storage failures just skip the binding.
 * Loading ≠ editing: the id only enters the Mine list once a save of
 * it actually lands (syncToServer/restore below). */
export function bindPublished(row) { writePub({ id: row.id, name: row.name, author_trip: row.author_trip ?? null }); }

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
      body: JSON.stringify({ name, data: snapshot, ...(rememberedTrip() ? { trip: rememberedTrip() } : {}) }),
    }).then((r) => {
      if (gen === syncGen && r.ok) {
        rememberMine(id);   /* a save landed: it's mine now */
        /* the shared-track note must hide the moment this happens, not
         * at the next unrelated refresh — tell the DOM layer */
        try { globalThis.dispatchEvent(new CustomEvent('m4wd:saved', { detail: id })); } catch (_) {}
      }
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
    /* mirror only PUBLISHED tracks; the debounce is independent.
     * A track locked to someone else is never mirrored — edits there
     * fork on save instead (worklog 0023). */
    const pub = readPub();
    if (snapshot && pub && !lockedToOther(pub)) {
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
