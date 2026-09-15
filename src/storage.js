/* Persistence — localStorage autosave + restore, mirrored to the server
 * (PUT /api/tracks/:id) when one is reachable. localStorage stays the
 * source of truth for boot; the server copy survives browser clears and
 * feeds the searchable library (GET /api/tracks). Server absent/failed
 * sync is never an error — the mirror is best-effort by design. */

import { serializeForSave, parseTrack } from './track.js';

const KEY = 'm4wd.autosave';
const ID_KEY = 'm4wd.trackId';
let autosaveTimer = null;
let syncTimer = null;

function trackId() {
  let id = null;
  try { id = localStorage.getItem(ID_KEY); } catch (_) {}
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : `t${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try { localStorage.setItem(ID_KEY, id); } catch (_) {}
  }
  return id;
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
    /* best-effort server mirror, debounced independently */
    if (snapshot) {
      clearTimeout(syncTimer);
      const id = trackId();
      syncTimer = setTimeout(() => {
        fetch(`/api/tracks/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Untitled', data: snapshot }),
        }).catch(() => {});
      }, 1500);
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
