/* Procedural piece art — vector fallback used while the Tamiya sprite PNGs
 * load (and in palette chips before sprites arrive). Pure canvas ops. */

import { PIECES, VARIANT_COLORS } from './pieces.js';
import { solveGeo } from './geometry.js';

function roundRectPath(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function arcPath(g, geo, r, pad) {
  g.beginPath();
  g.arc(geo.cx, geo.cy, r, geo.a1, geo.a1 + geo.sweep, geo.sweep < 0);
  if (pad !== undefined) { g.arc(geo.cx, geo.cy, r + pad, geo.a1 + geo.sweep, geo.a1, geo.sweep >= 0); g.closePath(); }
}

function drawStraightBase(g, def, cIdx) {
  const w = def.w, h = def.h, lanes = def.lanes;
  const vc = VARIANT_COLORS[cIdx % VARIANT_COLORS.length];

  roundRectPath(g, -w / 2, -h / 2, w, h, 5);
  g.fillStyle = '#4d545d'; g.fill();
  g.lineWidth = 2; g.strokeStyle = '#2b2f36'; g.stroke();

  /* colored side rails identify the color variant */
  g.fillStyle = vc;
  roundRectPath(g, -w / 2, -h / 2, w, h, 5);
  g.save(); g.clip();
  g.fillRect(-w / 2, -h / 2, w, 3.5);
  g.fillRect(-w / 2, h / 2 - 3.5, w, 3.5);
  g.restore();

  /* dashed lane separators */
  g.save();
  roundRectPath(g, -w / 2, -h / 2, w, h, 5); g.clip();
  g.strokeStyle = 'rgba(255,255,255,.65)'; g.lineWidth = 1.2; g.setLineDash([5, 6]);
  g.beginPath();
  for (let i = 1; i < lanes; i++) {
    const y = -h / 2 + (i * h) / lanes;
    g.moveTo(-w / 2, y); g.lineTo(w / 2, y);
  }
  g.stroke();
  g.restore();
}

function chevron(g, x, y, size, dir) { /* dir: +1 points +x */
  g.beginPath();
  g.moveTo(x - dir * size, y - size);
  g.lineTo(x + dir * size, y);
  g.lineTo(x - dir * size, y + size);
  g.stroke();
}

export function drawPieceArt(g, name, cIdx) {
  const def = PIECES[name];
  const w = def.w, h = def.h, lanes = def.lanes;
  g.lineCap = 'round'; g.lineJoin = 'round';

  if (def.kind === 'corner' || def.kind === 'hairpin') {
    const geo = solveGeo(name);
    const vc = VARIANT_COLORS[cIdx % VARIANT_COLORS.length];
    arcPath(g, geo, geo.R, def.band);
    g.fillStyle = '#4d545d'; g.fill();
    g.lineWidth = 2; g.strokeStyle = '#2b2f36'; g.stroke();
    /* side rails */
    g.save();
    arcPath(g, geo, geo.R, def.band); g.clip();
    g.strokeStyle = vc; g.lineWidth = 3.5;
    arcPath(g, geo, geo.R + def.band / 2 - 1.7); g.stroke();
    arcPath(g, geo, geo.R - def.band / 2 + 1.7); g.stroke();
    /* dashed lanes */
    g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 1.2; g.setLineDash([5, 6]);
    g.beginPath();
    for (let i = 1; i < lanes; i++) {
      const r = geo.R - def.band / 2 + (i * def.band) / lanes;
      g.moveTo(geo.cx + r * Math.cos(geo.a1), geo.cy + r * Math.sin(geo.a1));
      g.arc(geo.cx, geo.cy, r, geo.a1, geo.a1 + geo.sweep, geo.sweep < 0);
    }
    g.stroke();
    /* direction chevron at mid-arc */
    g.setLineDash([]);
    const mid = geo.a1 + geo.sweep / 2;
    const mx = geo.cx + geo.R * Math.cos(mid), my = geo.cy + geo.R * Math.sin(mid);
    g.save();
    g.translate(mx, my); g.rotate(mid + Math.PI / 2 * Math.sign(geo.sweep || 1));
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2.2;
    chevron(g, 0, 0, 5, 1);
    g.restore();
    g.restore();
    return;
  }

  drawStraightBase(g, def, cIdx);
  g.save();
  roundRectPath(g, -w / 2, -h / 2, w, h, 5); g.clip();

  if (def.kind === 'start') {
    const cell = h / 4;
    g.fillStyle = '#fff';
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 2; c++)
        if ((r + c) % 2 === 0) g.fillRect(-w / 2 + c * cell, -h / 2 + r * cell, cell, cell);
  } else if (def.kind === 'slope') {
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2.2;
    const n = Math.max(2, Math.round(w / 26));
    for (let i = 0; i < n; i++) chevron(g, -w / 2 + (w / n) * (i + 0.5), 0, h / 6, 1);
  } else if (def.kind === 'jump') {
    g.fillStyle = '#e5b84b';
    g.fillRect(-w / 6, -h / 2 + 3.5, w / 3, h - 7);
    g.strokeStyle = '#2b2f36'; g.lineWidth = 1.4;
    g.strokeRect(-w / 6, -h / 2 + 3.5, w / 3, h - 7);
    g.strokeStyle = 'rgba(0,0,0,.45)';
    for (let x = -w / 6; x < w / 6; x += 5) {
      g.beginPath(); g.moveTo(x, h / 2 - 4); g.lineTo(x + 6, -h / 2 + 4); g.stroke();
    }
  } else if (def.kind === 'bank') {
    const cs = 5;
    for (let x = -w / 2 + 2; x < w / 2 - 2; x += cs) {
      g.fillStyle = (Math.round(x / cs) % 2 === 0) ? '#e05263' : '#f2f2f2';
      g.fillRect(x, -h / 2 + 3.5, Math.min(cs, w / 2 - 2 - x), 3);
      g.fillRect(x, h / 2 - 6.5, Math.min(cs, w / 2 - 2 - x), 3);
    }
  } else if (def.kind === 'wave') {
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2;
    g.beginPath();
    const amp = h / 7, n = Math.max(2, Math.round(w / 27));
    for (let x = -w / 2 + 4; x <= w / 2 - 4; x += 2) {
      const y = Math.sin(((x + w / 2) / w) * Math.PI * 2 * n) * amp;
      x === -w / 2 + 4 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
  } else if (def.kind === 'changer') {
    /* lane shift: lanes cross over diagonally */
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.6;
    g.beginPath();
    for (let i = 0; i <= lanes; i++) {
      const y1 = -h / 2 + (i * h) / lanes, y2 = -h / 2 + ((lanes - i) * h) / lanes;
      g.moveTo(-w / 2 + 3, y1); g.lineTo(w / 2 - 3, y2);
    }
    g.stroke();
    g.lineWidth = 2.4;
    chevron(g, -w / 6, 0, 6, 1); chevron(g, w / 6, 0, 6, -1);
  } else {
    /* plain straight: direction chevrons */
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 2;
    const n = Math.max(1, Math.round(w / 54));
    for (let i = 0; i < n; i++) chevron(g, -w / 4 + (w / 2 / n) * i, 0, h / 8, 1);
  }
  g.restore();
}
