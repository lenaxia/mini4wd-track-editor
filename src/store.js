/* Store — the single model. All mutations go through actions (discrete
 * changes, auto-persisted) or update/updateLight (transient gestures).
 * Subscribers (render, ui) are notified on every change. DOM-free: the
 * store is unit-testable under plain node. */

import { PIECES, PALETTE, TOOLS, CLEARANCE_MM } from './pieces.js';
import { rot, centerOf, snapPiece, groupSnap, externalJoint, worldFromScreen, clampScale, computeFit, vertsOf, vertexOf, levelAt, outwardTangent, inwardTangent, pieceHalfExtents } from './geometry.js';
import * as storage from './storage.js';

export const state = {
  mode: 3,
  tool: 'Pan',          // piece name, or one of TOOLS (Pan is the default tool)
  angle: 0,
  zArm: 0,              // armed elevation (mm) for the next placement
  sprites: [],           // placed pieces: {name,x,y,a,c,z}
  selection: new Set(),  // pieces selected with the Move tool
  view: { x: 0, y: 0, scale: 0.62 },
  history: [],
};

const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }

function notify() { for (const fn of subs) fn(); }

/* Discrete change: notify + autosave + refresh cached joint/overlap flags. */
function emit() { refreshFlags(); notify(); storage.autosave(state); }

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

/* Figma-style placement: create, make the joint proper (snap orients,
 * connects exactly, adopts the neighbor level), select. Caller owns
 * the history snapshot (gestures commit history on release). */
export function place(name, x, y, angle, z = state.zArm) {
  const piece = { name, x: Math.floor(x), y: Math.floor(y), a: angle, c: 0, z: Math.round(z) };
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

/* Rotate the armed angle and (when present) the selection. With exactly one
 * external joint the selection pivots about it (the connection survives);
 * otherwise it spins around the visual-center centroid (docs/design §4). */
export function rotate(delta) {
  state.angle = (state.angle + delta + 360) % 360;
  if (state.selection.size) {
    pushHistory();
    const joint = externalJoint(state.selection, state.sprites);
    let cx, cy;
    if (joint) { cx = joint.x; cy = joint.y; }
    else {
      cx = 0; cy = 0;
      for (const p of state.selection) { const c = centerOf(p); cx += c.x; cy += c.y; }
      cx /= state.selection.size; cy /= state.selection.size;
    }
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

/* Elevation: +-10 mm steps on the armed piece or the selection
 * (clamped +-300 mm). Manual z is a power tool — touch users get levels
 * via ramp chaining (snap adoption). */
export function bumpLevel(steps) {
  const dz = steps * 10;
  if (state.selection.size) {
    pushHistory();
    for (const p of state.selection) p.z = Math.max(-300, Math.min(300, (p.z || 0) + dz));
    emit();
    return 'selection';
  }
  state.zArm = Math.max(-300, Math.min(300, state.zArm + dz));
  emit();
  return 'armed';
}

/* ---------- cached joint/overlap flags (computed on mutation, never per
 * frame — docs/design §5) ---------- */

const JOINT_EPS = 1e-6;

function refreshFlags() {
  const sprites = state.sprites;
  for (const p of sprites) { p._over = false; p._warn = false; p._bad = false; }
  for (let i = 0; i < sprites.length; i++) {
    for (let j = i + 1; j < sprites.length; j++) {
      const a = sprites[i], b = sprites[j];
      const za = a.z || 0, zb = b.z || 0;
      if (za === zb) continue;
      const [hi, lo] = za > zb ? [a, b] : [b, a];
      if (!bboxOverlap(hi, lo)) continue;
      hi._over = true; /* drawn semi-transparent so under-track stays visible */
      if ((hi.z || 0) - (lo.z || 0) < CLEARANCE_MM) hi._warn = true; /* can't clear */
    }
  }
  /* imperfect joints: coincident vertices where tangent or level mismatch */
  for (let i = 0; i < sprites.length; i++) {
    const s = sprites[i];
    for (let si = 0; si < vertsOf(s).length; si++) {
      const a = vertexOf(s, si);
      for (let j = 0; j < sprites.length; j++) {
        if (i === j) continue;
        const g = sprites[j];
        for (let gi = 0; gi < vertsOf(g).length; gi++) {
          const b = vertexOf(g, gi);
          if (Math.hypot(a.x - b.x, a.y - b.y) > JOINT_EPS) continue;
          const dT = Math.abs(((outwardTangent(s, si) - inwardTangent(g, gi) + 540) % 360) - 180);
          if (dT > 0.05 || levelAt(s, si) !== levelAt(g, gi)) { s._bad = true; g._bad = true; }
        }
      }
    }
  }
}

function bboxOverlap(a, b) {
  /* strict with a 1cm inset: edge-touching (chained joints, adjacency) is
   * NOT plan overlap — the slope-chaining flow must not read as "over".
   * AABB is a proxy: a manually re-leveled connected corner chain can flag
   * without true plan overlap (narrow case, already _bad-flagged by the
   * level break); a true plan-overlap test can replace this when needed. */
  const ea = pieceHalfExtents(a), eb = pieceHalfExtents(b);
  const inset = 1;
  return Math.abs(a.x - b.x) < ea.hx + eb.hx - inset && Math.abs(a.y - b.y) < ea.hy + eb.hy - inset;
}

/* Replace the whole track (import / share). */
export function loadSprites(sprites) {
  pushHistory();
  state.sprites = sprites;
  state.selection.clear();
  emit();
}

/* Bulk-add pre-computed pieces (solver output): one history step, the run
 * ends up selected so it can be dragged/re-colored as a section. */
export function addPieces(list) {
  if (!list || !list.length) return;
  pushHistory();
  for (const p of list) state.sprites.push(p);
  state.selection.clear();
  for (const p of list) state.selection.add(p);
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
