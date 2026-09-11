/* Store — the single model. All mutations go through actions (discrete
 * changes, auto-persisted) or update/updateLight (transient gestures).
 * Subscribers (render, ui) are notified on every change. DOM-free: the
 * store is unit-testable under plain node. */

import { PIECES, PALETTE, TOOLS } from './pieces.js';
import { rot, centerOf, snapPiece, groupSnap, worldFromScreen, clampScale, computeFit } from './geometry.js';
import * as storage from './storage.js';

export const state = {
  mode: 3,
  tool: 'Pan',          // piece name, or one of TOOLS (Pan is the default tool)
  angle: 0,
  sprites: [],           // placed pieces: {name,x,y,a,c}
  selection: new Set(),  // pieces selected with the Move tool
  view: { x: 0, y: 0, scale: 0.62 },
  history: [],
};

const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }

function notify() { for (const fn of subs) fn(); }

/* Discrete change: notify + autosave. */
function emit() { notify(); storage.autosave(state); }

/* Transient change (drag/pan/pinch frames): notify only. */
export function updateLight(mut) { mut(state); notify(); }

/* Discrete mutation via function (rare — prefer named actions). */
export function update(mut) { mut(state); emit(); }

/* ---------- history ---------- */

export function snapshot() { return JSON.stringify(state.sprites); }

export function pushSnapshot(snap) {
  state.history.push(snap);
  if (state.history.length > 80) state.history.shift();
}

export function pushHistory() { pushSnapshot(snapshot()); }

export function undo() {
  if (!state.history.length) return false;
  state.sprites = JSON.parse(state.history.pop());
  state.selection.clear();
  emit();
  return true;
}

/* ---------- tools & mode ---------- */

export function setTool(tool) {
  state.tool = tool;
  emit();
}

export function setMode(mode) {
  state.mode = mode;
  if (!PALETTE[mode].includes(state.tool) && !TOOLS.includes(state.tool)) state.tool = PALETTE[mode][0];
  emit();
}

/* ---------- pieces ---------- */

/* Figma-style placement: create, snap to neighbours, select. Caller owns
 * the history snapshot (gestures commit history on release). */
export function place(name, x, y, angle) {
  const piece = { name, x: Math.floor(x), y: Math.floor(y), a: angle, c: 0 };
  snapPiece(piece, state.sprites);
  state.sprites.push(piece);
  state.selection.clear();
  state.selection.add(piece);
  notify();
  return piece;
}

export function removePiece(p) {
  pushHistory();
  state.sprites = state.sprites.filter((s) => s !== p);
  state.selection.delete(p);
  emit();
}

export function cycleColor(p) {
  pushHistory();
  p.c = (p.c + 1) % PIECES[p.name].colors;
  emit();
}

export function deleteSelected() {
  if (!state.selection.size) return;
  pushHistory();
  state.sprites = state.sprites.filter((p) => !state.selection.has(p));
  state.selection.clear();
  emit();
}

export function clearAll() {
  if (!state.sprites.length) return;
  pushHistory();
  state.sprites = [];
  state.selection.clear();
  emit();
}

/* Rotate the armed angle and (when present) the selection around its
 * centroid (average of the pieces' visual centers, so off-center pieces
 * like Cor1 spin in place). Returns true when a selection was rotated. */
export function rotate(delta) {
  state.angle = (state.angle + delta + 360) % 360;
  if (state.selection.size) {
    pushHistory();
    let cx = 0, cy = 0;
    for (const p of state.selection) { const c = centerOf(p); cx += c.x; cy += c.y; }
    cx /= state.selection.size; cy /= state.selection.size;
    for (const p of state.selection) {
      const r = rot(p.x - cx, p.y - cy, delta);
      p.x = cx + r.x; p.y = cy + r.y;
      p.a = (p.a + delta + 360) % 360;
    }
    emit();
    return true;
  }
  notify();
  return false;
}

/* Replace the whole track (import / share). */
export function loadSprites(sprites) {
  pushHistory();
  state.sprites = sprites;
  state.selection.clear();
  emit();
}

/* ---------- camera ---------- */

export function setView(v) { state.view = v; notify(); }

export function zoomAt(sx, sy, factor) {
  const v = state.view;
  const w = worldFromScreen(v, sx, sy);
  v.scale = clampScale(v.scale * factor);
  v.x = sx - w.x * v.scale;
  v.y = sy - w.y * v.scale;
  notify();
}

export function fitView(cssW, cssH) {
  state.view = state.sprites.length
    ? computeFit(state.sprites, cssW, cssH)
    : { x: cssW / 2, y: cssH / 2, scale: 0.62 };
  notify();
}
