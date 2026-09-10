/* Persistence — localStorage autosave + restore. */

import { serialize, parseTrack } from './track.js';

const KEY = 'm4wd.autosave';
let autosaveTimer = null;

export function autosave(state) {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        mode: state.mode, tool: state.tool, angle: state.angle, track: serialize(state.sprites),
      }));
    } catch (_) { /* private mode etc. */ }
  }, 350);
}

/* Mutates state (mode/sprites/angle) from the saved autosave.
 * Returns true when a non-empty track was restored. */
export function restore(state) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (data.mode === 3 || data.mode === 5) state.mode = data.mode;
    if (data.track) {
      state.sprites = parseTrack(data.track);
      if (data.angle) state.angle = data.angle;
    }
    return state.sprites.length > 0;
  } catch (_) { return false; }
}
