/* Render — canvas view. Subscribes to the store; queries input for gesture
 * overlays (rubber band, drag vertices, hover preview). */

import { state, subscribe } from './store.js';
import { PIECES, TOOLS, HITBOX_RADIUS } from './pieces.js';
import { rad, centerOf, vertexOf, pieceHalfExtents, worldFromScreen, snapPiece } from './geometry.js';
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

  for (const p of state.sprites) drawPiece(p, 1);
  drawHitboxesIfTool();

  /* hover preview of the armed piece: same floor+snap the placement tap applies */
  const hoverPt = input.hover();
  if (hoverPt && !TOOLS.includes(state.tool) && !input.dragActive() && !input.rubber()) {
    const pv = { name: state.tool, x: Math.floor(hoverPt.x), y: Math.floor(hoverPt.y), a: state.angle, c: 0 };
    const sn = snapPiece(pv, state.sprites);
    drawPiece(pv, 0.8);
    drawVertices(pv, sn);
  }

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
  ctx.globalAlpha = alpha;
  ctx.translate(p.x, p.y);
  ctx.rotate(rad(p.a));
  if (img && img.complete && img.naturalWidth) {
    ctx.drawImage(img, -def.w / 2, -def.h / 2, def.w, def.h);
  } else {
    drawPieceArt(ctx, p.name, p.c); /* fallback until sprites load */
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
  ctx.fillStyle = snapped ? '#7CE38B' : '#ffd166';
  for (const v of [vertexOf(p, 1), vertexOf(p, 2)]) {
    ctx.beginPath();
    ctx.arc(v.x, v.y, 6 / state.view.scale + 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawHitboxesIfTool() {
  if (!['Move', 'Delete', 'Color'].includes(state.tool)) return;
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
