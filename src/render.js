/* Render — canvas view. Subscribes to the store; queries input for gesture
 * overlays (rubber band, drag vertices, hover preview). */

import { state, subscribe } from './store.js';
import { PIECES, TOOLS, HITBOX_RADIUS, VARIANT_COLORS } from './pieces.js';
import { rad, rot, centerOf, vertexOf, vertsOf, pieceHalfExtents, worldFromScreen, snapPiece } from './geometry.js';
import { imageFor } from './assets.js';
import { drawPieceArt } from './art.js';
import * as input from './input.js';

export const canvas = document.getElementById('editor');
const ctx = canvas.getContext('2d');
const stage = document.getElementById('stage');
let dpr = 1, cssW = 0, cssH = 0;

export function dims() { return { w: cssW, h: cssH, dpr }; }

export function resize() {
  dpr = window.devicePixelRatio || 1;
  const r = stage.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  /* no-op guard: ResizeObserver can fire repeatedly; don't feed the render loop */
  if (w === cssW && h === cssH && canvas.width === Math.round(w * dpr) && canvas.height === Math.round(h * dpr)) return;
  cssW = w; cssH = h;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  scheduleDraw();
}

let drawQueued = false;
export function scheduleDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; render(); });
}

function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#1b1e24';
  ctx.fillRect(0, 0, cssW, cssH);

  ctx.save();
  ctx.translate(state.view.x, state.view.y);
  ctx.scale(state.view.scale, state.view.scale);

  drawGrid();

  /* painter's order by elevation (flat tracks: array order = today's
   * behavior); viewport culling keeps dense tracks cheap on phones */
  const tl = worldFromScreen(state.view, 0, 0), br = worldFromScreen(state.view, cssW, cssH);
  const byZ = [...state.sprites].sort((a, b) => (a.z || 0) - (b.z || 0));
  for (const p of byZ) {
    const { hx, hy } = pieceHalfExtents(p);
    if (p.x + hx < tl.x || p.x - hx > br.x || p.y + hy < tl.y || p.y - hy > br.y) continue;
    drawPiece(p, 1);
  }
  drawHitboxesIfTool();

  /* hover preview of the armed piece: same floor+snap the placement tap applies */
  const hoverPt = input.hover();
  if (hoverPt && !TOOLS.includes(state.tool) && !input.dragActive() && !input.rubber()) {
    const pv = { name: state.tool, x: Math.floor(hoverPt.x), y: Math.floor(hoverPt.y), a: state.angle, c: 0 };
    const sn = snapPiece(pv, state.sprites);
    drawPiece(pv, 0.8);
    drawVertices(pv, sn);
  }

  drawLinks(); /* disjunction arcs under the selection layer */
  drawSelection();
  if (input.dragActive()) for (const p of state.selection) drawVertices(p, input.dragSnapped());
  drawRubberBand();

  /* origin marker */
  ctx.strokeStyle = '#3d434d'; ctx.lineWidth = 2 / state.view.scale;
  ctx.beginPath();
  ctx.moveTo(-14, 0); ctx.lineTo(14, 0); ctx.moveTo(0, -14); ctx.lineTo(0, 14);
  ctx.stroke();
  ctx.restore();
}

function drawGrid() {
  const tl = worldFromScreen(state.view, 0, 0), br = worldFromScreen(state.view, cssW, cssH);
  const lw = 1 / state.view.scale;
  for (let pass = 0; pass < 2; pass++) {
    const step = pass === 0 ? 20 : 100;
    ctx.strokeStyle = pass === 0 ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.12)';
    ctx.lineWidth = lw;
    ctx.beginPath();
    for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
      ctx.moveTo(x, tl.y); ctx.lineTo(x, br.y);
    }
    for (let y = Math.floor(tl.y / step) * step; y <= br.y; y += step) {
      ctx.moveTo(tl.x, y); ctx.lineTo(br.x, y);
    }
    ctx.stroke();
  }
}

function drawPiece(p, alpha) {
  const def = PIECES[p.name];
  const img = imageFor(p.name, p.c);
  ctx.save();
  /* semi-transparency over lower track: the crossover experience depends
   * on seeing what you bridge over (docs/design §5) */
  ctx.globalAlpha = alpha * (p._over ? 0.8 : 1);
  ctx.translate(p.x, p.y);
  ctx.rotate(rad(p.a));
  if (img && img.complete && img.naturalWidth) {
    ctx.drawImage(img, -def.w / 2, -def.h / 2, def.w, def.h);
  } else {
    drawPieceArt(ctx, p.name, p.c); /* fallback until sprites load */
  }
  if (p._warn) { /* insufficient clearance over lower track (75 mm rule) */
    ctx.strokeStyle = '#e05263';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(-def.w / 2, -def.h / 2, def.w, def.h);
    ctx.setLineDash([]);
  }
  ctx.restore();
  drawElevation(p);
}

/* Disjunctions (owner rule): unwelded but facing open ends within jump
 * range — dashed info-blue flight arc, never an error. */
function drawLinks() {
  if (!state.links.length) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(125,211,252,.75)';
  ctx.fillStyle = 'rgba(125,211,252,.9)';
  ctx.lineWidth = 1.5 / state.view.scale;
  ctx.setLineDash([6 / state.view.scale, 4 / state.view.scale]);
  for (const l of state.links) {
    const a = vertexOf(l.a, l.ai), b = vertexOf(l.b, l.bi);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = -(b.y - a.y) / (d || 1), ny = (b.x - a.x) / (d || 1);
    const bow = Math.min(10, d * 0.22); /* flight-path bulge */
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(mx + nx * bow, my + ny * bow, b.x, b.y);
    ctx.stroke();
    for (const v of [a, b]) {
      ctx.beginPath();
      ctx.arc(v.x, v.y, 3 / state.view.scale + 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

const luminance = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255;
};

/* Always-on elevation readouts (owner rule): every piece not at floor level
 * shows its level; ramps/banks of the slope kind get an amber chevron at
 * their high end (which side is up is intrinsic — no travel direction). */
function drawElevation(p) {
  const z = p.z || 0;
  const def = PIECES[p.name];
  let hi = -1;
  for (let i = 0; i < def.verts.length; i++) if ((def.verts[i][2] || 0) > 0) hi = i;
  if (!z && hi < 0) return;
  ctx.save();
  if (z) { /* level readout centered in a lane, ink contrasting the variant */
    const halfLane = def.h / def.lanes / 2;
    const o = def.lanes % 2 === 0 ? rot(0, halfLane, p.a) : { x: 0, y: 0 }; /* even lane counts: the center is a wall */
    const col = VARIANT_COLORS[p.c % VARIANT_COLORS.length];
    const lum = luminance(col);
    ctx.font = `bold ${13 / state.view.scale}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 2.5 / state.view.scale;
    ctx.strokeStyle = lum > 0.5 ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,.6)';
    ctx.fillStyle = lum > 0.5 ? '#1b1e24' : '#ffffff';
    ctx.strokeText(`${z}mm`, p.x + o.x, p.y + o.y);
    ctx.fillText(`${z}mm`, p.x + o.x, p.y + o.y);
  }
  if (hi >= 0) { /* amber chevron pointing at the high vertex */
    const v = vertexOf(p, hi), c = centerOf(p);
    const ang = Math.atan2(v.y - c.y, v.x - c.x);
    const mx = c.x + (v.x - c.x) * 0.55, my = c.y + (v.y - c.y) * 0.55;
    const s = 7 / state.view.scale + 2;
    ctx.translate(mx, my);
    ctx.rotate(ang);
    ctx.fillStyle = '#e5b84b';
    ctx.strokeStyle = '#1b1e24';
    ctx.lineWidth = 1.5 / state.view.scale;
    ctx.beginPath();
    ctx.moveTo(s, 0); ctx.lineTo(-s * 0.7, -s * 0.7); ctx.lineTo(-s * 0.7, s * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawSelection() {
  if (!state.selection.size) return;
  ctx.save();
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = 2 / state.view.scale;
  ctx.setLineDash([6 / state.view.scale, 4 / state.view.scale]);
  ctx.fillStyle = 'rgba(255,209,102,.08)';
  for (const p of state.selection) {
    const { hx, hy } = pieceHalfExtents(p);
    ctx.beginPath();
    ctx.rect(p.x - hx - 2, p.y - hy - 2, 2 * hx + 4, 2 * hy + 4);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawRubberBand() {
  const rubber = input.rubber();
  if (!rubber) return;
  const x = Math.min(rubber.x1, rubber.x2), y = Math.min(rubber.y1, rubber.y2);
  const w = Math.abs(rubber.x2 - rubber.x1), h = Math.abs(rubber.y2 - rubber.y1);
  ctx.save();
  ctx.strokeStyle = '#7dd3fc';
  ctx.lineWidth = 1.5 / state.view.scale;
  ctx.setLineDash([5 / state.view.scale, 4 / state.view.scale]);
  ctx.fillStyle = 'rgba(125,211,252,.10)';
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawVertices(p, snapped) {
  ctx.save();
  ctx.fillStyle = p._bad ? '#e05263' : snapped ? '#7CE38B' : '#ffd166';
  for (let i = 0; i < vertsOf(p).length; i++) { const v = vertexOf(p, i);
    ctx.beginPath();
    ctx.arc(v.x, v.y, 6 / state.view.scale + 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawHitboxesIfTool() {
  if (!['Move', 'Delete', 'Color', 'Complete'].includes(state.tool)) return;
  ctx.save();
  ctx.setLineDash([5 / state.view.scale]);
  ctx.lineWidth = 1.4 / state.view.scale;
  for (const p of state.sprites) {
    const c = centerOf(p);
    ctx.strokeStyle = 'rgba(125,211,252,.55)';
    ctx.beginPath(); ctx.arc(c.x, c.y, HITBOX_RADIUS, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

subscribe(scheduleDraw);
