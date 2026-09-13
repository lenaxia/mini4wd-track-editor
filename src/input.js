/* Input — Pointer Events gesture machine + keyboard. Owns all transient
 * gesture state; mutates the store via actions (discrete) and updateLight
 * (per-frame). Render queries the exported accessors for overlays. */

import {
  state, updateLight, update, setTool, place, snapshot, pushSnapshot,
  undo, removePiece, cycleColor, deleteSelected, rotate, bumpLevel, zoomAt, fitView,
} from './store.js';
import { TOOLS } from './pieces.js';
import { topPieceAt, isHit, snapPiece, groupSnap, worldFromScreen, clampScale, pieceHalfExtents } from './geometry.js';
import { toast } from './ui.js';

const pointers = new Map();
let pinch = null;   // {d, cx, cy, scale, vx, vy}
let tapInfo = null; // {x,y,t,moved,id}
let panning = null;
let groupDrag = null; // {start, snapshot, orig, moved, placed?}
let rubber_ = null;   // {x1,y1,x2,y2}
let selectPending;    // piece to toggle on ctrl/cmd+click
let dragSnapped_ = false; // selection currently snapped while dragging
let hoverPt = null;   // world pos under the cursor while hovering (preview)
let hintShown = true;
let canvasEl = null;
let getDims = () => ({ w: 800, h: 600, dpr: 1 });

/* ---------- accessors for the render layer ---------- */
export const rubber = () => rubber_;
export const dragActive = () => !!groupDrag;
export const dragSnapped = () => dragSnapped_;
export const hover = () => hoverPt;

function screenFromEvent(e) {
  const r = canvasEl.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function world(e_or_s) {
  return worldFromScreen(state.view, e_or_s.x, e_or_s.y);
}

function beginPinch() {
  const [a, b] = [...pointers.values()];
  pinch = {
    d: Math.hypot(a.x - b.x, a.y - b.y),
    cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
    scale: state.view.scale,
    vx: state.view.x, vy: state.view.y,
  };
  tapInfo = null;
}

/* ---------- tap actions for the Delete / Color tools ---------- */
function actAt(pt) {
  if (!['Delete', 'Color'].includes(state.tool)) return;
  const hit = topPieceAt(state.sprites, pt); /* z-ordered like Move: bridges win taps */
  if (!hit || !isHit(hit, pt)) return; /* isHit honors centerOf + HITBOX_RADIUS */
  if (state.tool === 'Delete') removePiece(hit);
  else cycleColor(hit);
}

function updateRubberSelection() {
  const x1 = Math.min(rubber_.x1, rubber_.x2), y1 = Math.min(rubber_.y1, rubber_.y2);
  const x2 = Math.max(rubber_.x1, rubber_.x2), y2 = Math.max(rubber_.y1, rubber_.y2);
  state.selection.clear();
  for (const p of state.sprites) {
    const { hx, hy } = pieceHalfExtents(p);
    if (p.x + hx >= x1 && p.x - hx <= x2 && p.y + hy >= y1 && p.y - hy <= y2) state.selection.add(p);
  }
}

function onPointerDown(e) {
  canvasEl.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, screenFromEvent(e));
  if (pointers.size === 2) { beginPinch(); panning = null; return; }
  const s = screenFromEvent(e);
  if (e.button > 0) return; /* primary button / finger only */
  tapInfo = { x: s.x, y: s.y, t: performance.now(), moved: false, id: e.pointerId };
  if (state.tool === 'Pan' || e.shiftKey) { panning = { x: s.x, y: s.y, vx: state.view.x, vy: state.view.y }; return; }

  if (state.tool === 'Move') {
    const w = world(s);
    const hitP = topPieceAt(state.sprites, w);
    if (e.ctrlKey || e.metaKey) { selectPending = hitP; return; }
    if (hitP) {
      if (!state.selection.has(hitP)) {
        state.selection.clear();
        state.selection.add(hitP);
      }
      groupDrag = {
        start: w,
        snapshot: snapshot(),
        orig: [...state.selection].map((p) => [p, p.x, p.y, p.a, p.z]),
        moved: false,
      };
    } else {
      state.selection.clear();
      rubber_ = { x1: w.x, y1: w.y, x2: w.x, y2: w.y };
    }
    updateLight(() => {});
    return;
  }
  if (!TOOLS.includes(state.tool)) {
    /* Figma-style placement: the piece appears under the pointer on press,
       dragging positions it (with live snapping), release commits it. */
    const w = world(s);
    const before = snapshot();
    const piece = place(state.tool, w.x, w.y, state.angle);
    groupDrag = { start: w, snapshot: before, orig: [[piece, piece.x, piece.y, piece.a, piece.z]], moved: false, placed: piece };
    if (hintShown) { hintShown = false; document.getElementById('hint').style.opacity = '0'; }
    updateLight(() => {});
  }
}

function onPointerMove(e) {
  /* hover preview (no buttons pressed) — shows where the armed piece will land */
  if (!pointers.size && e.buttons === 0) {
    const h = screenFromEvent(e);
    hoverPt = world(h);
    updateLight(() => {});
    return;
  }
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, screenFromEvent(e));

  if (panning) {
    const s = screenFromEvent(e);
    updateLight((st) => {
      st.view.x = panning.vx + (s.x - panning.x);
      st.view.y = panning.vy + (s.y - panning.y);
    });
    return;
  }
  if (pointers.size >= 2 && pinch) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    updateLight((st) => {
      st.view.scale = clampScale(pinch.scale * (d / pinch.d));
      /* keep the pinch centroid anchored and follow its movement (pan) */
      st.view.x = cx - ((pinch.cx - pinch.vx) / pinch.scale) * st.view.scale;
      st.view.y = cy - ((pinch.cy - pinch.vy) / pinch.scale) * st.view.scale;
    });
    return;
  }
  const s = screenFromEvent(e);
  if (tapInfo && e.pointerId === tapInfo.id) {
    if (Math.hypot(s.x - tapInfo.x, s.y - tapInfo.y) > 10) tapInfo.moved = true;
  }
  if (groupDrag && pointers.size === 1) {
    const w = world(s);
    const dx = w.x - groupDrag.start.x, dy = w.y - groupDrag.start.y;
    for (const [p, x0, y0] of groupDrag.orig) { p.x = x0 + dx; p.y = y0 + dy; }
    if (Math.hypot(dx, dy) > 2) groupDrag.moved = true;
    if (groupDrag.placed || groupDrag.orig.length === 1) {
      /* single-piece drag (placement OR move): full joint semantics —
       * restore the press-time angle/level each frame, then snapPiece
       * orients + connects exactly + adopts the neighbor level (spec §4).
       * orig.length (not live selection.size) is authoritative: Esc can
       * clear the selection mid-drag. Only multi-piece groups snap
       * position-only. */
      const [p, , , a0, z0] = groupDrag.orig[0];
      p.a = a0; p.z = z0;
      dragSnapped_ = snapPiece(p, state.sprites);
    } else {
      dragSnapped_ = groupSnap(state.selection, state.sprites); /* multi-piece: position-only by design */
    }
    /* ANY successful snap displaces pieces (position-only welds translate
     * up to SNAP_RADIUS with <=2cm of drag) — it must be undoable, so it
     * counts as a move even under the translation threshold. A no-op undo
     * step for an already-welded jiggle is cosmetic; an unundoable weld
     * (or undo deleting the piece) is not. */
    if (dragSnapped_) groupDrag.moved = true;
    updateLight(() => {});
    return;
  }
  if (rubber_) {
    const w = world(s);
    rubber_.x2 = w.x; rubber_.y2 = w.y;
    updateRubberSelection();
    updateLight(() => {});
    return;
  }
}

function onPointerEnd(e) {
  const wasPinch = pointers.size >= 2;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (panning && pointers.size === 0) panning = null;

  /* commit placement / group drag / rubber band before tap filtering */
  if (groupDrag) {
    const g = groupDrag; groupDrag = null;
    dragSnapped_ = false;
    if (g.moved || g.placed) {
      pushSnapshot(g.snapshot);
      if (g.placed && !e.shiftKey) setTool('Move'); /* Figma revert — this emits */
      else update(() => {}); /* shift-kept placement / plain drag — emit once */
    }
    updateLight(() => {});
    return;
  }
  if (rubber_) { rubber_ = null; updateLight(() => {}); return; }

  const t = tapInfo;
  tapInfo = null;
  if (!t || wasPinch || t.moved || e.pointerId !== t.id) return;
  if (performance.now() - t.t > 450) return; /* long press ignored */
  const w = world(t);

  if (selectPending !== undefined) {
    const p2 = selectPending; selectPending = undefined;
    if (p2) {
      if (state.selection.has(p2)) state.selection.delete(p2);
      else state.selection.add(p2);
    } else {
      state.selection.clear();
    }
    updateLight(() => {});
    return;
  }
  actAt(w);
}

function onKeyDown(e) {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  if (document.querySelector('dialog[open]')) return;
  const k = e.key.toLowerCase();
  if (k >= '1' && k <= '9') {
    /* cycle within piece families, mirroring the original hotkeys */
    const families = { 3: { 1: ['Str1'], 2: ['Cor1'], 3: ['Lan1'], 4: ['Chi1'], 5: ['Str2'], 6: ['Bri1'], 7: ['Ban1'], 8: ['Bri2'], 9: ['Lan2'] },
                       5: { 1: ['Str3', 'Str4', 'Str5', 'Str6'], 2: ['Cor2', 'Cor3', 'Cor4', 'Cor5'], 3: ['Lan4', 'Lan3'], 4: ['Chi2'], 5: ['Bri3', 'Bri4'], 6: ['Ban2'] },
                       rucdoc: { 1: ['R1S250', 'R2S250', 'R3S250'], 2: ['R1C45I150', 'R1C90I150', 'R2C45I150', 'R3C45I115'], 3: ['R1REntry', 'R2Ramp5', 'R2Ramp10', 'R2Ramp15', 'R2Ramp20', 'R2Ramp25', 'R2Ramp30', 'R2Ramp35', 'R2Ramp40', 'R2Ramp45'] } };
    const fam = families[state.mode][+k];
    if (fam) {
      const i = fam.indexOf(state.tool);
      setTool(fam[(i + 1) % fam.length]);
    }
  } else if (k === 'q') setTool('Move');
  else if (k === 'h') setTool('Pan');
  else if (k === 'w') setTool('Delete');
  else if (k === 'e') setTool('Color');
  else if (k === 'z') rotateFeedback(rotate(-45));
  else if (k === 'x') rotateFeedback(rotate(45));
  else if (k === 'r') { if (!undo()) toast('Nothing to undo'); }
  else if (k === 'f') fitView(getDims().w, getDims().h);
  else if (k === 'escape') {
    if (groupDrag && groupDrag.placed) {
      /* cancel an in-progress placement: remove the piece */
      const g = groupDrag; groupDrag = null;
      dragSnapped_ = false;
      updateLight((st) => { st.sprites = st.sprites.filter((p) => p !== g.placed); });
    }
    state.selection.clear();
    setTool('Pan'); /* Esc returns to the default tool */
  }
  else if (k === 'delete' || k === 'backspace') deleteSelected();
  else if (k === 'pageup') bumpLevel(1);
  else if (k === 'pagedown') bumpLevel(-1);
  else if (k === '+' || k === '=') zoomAt(getDims().w / 2, getDims().h / 2, 1.25);
  else if (k === '-') zoomAt(getDims().w / 2, getDims().h / 2, 0.8);
}

function rotateFeedback(rotatedSelection) {
  if (!rotatedSelection) toast(`${state.angle}\u00B0`); /* feedback for the armed piece angle */
}

export function attach(canvas, dimsGetter) {
  canvasEl = canvas;
  getDims = dimsGetter;

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerEnd);
  canvas.addEventListener('pointercancel', onPointerEnd);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const s = screenFromEvent(e);
    zoomAt(s.x, s.y, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });
  canvas.addEventListener('pointerleave', () => { hoverPt = null; updateLight(() => {}); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault()); /* iOS Safari */
  document.addEventListener('keydown', onKeyDown);
}
