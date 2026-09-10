/*
 * Mini4WD Track Editor — mobile-friendly fork (proof of concept)
 *
 * Piece geometry, snapping algorithm and the track serialization format are
 * derived from the "Mini4WD Online Track Editor" client code:
 *
 *   MIT License
 *   Copyright (c) 2016 Michele Ferri, support@pimentoso.com
 *   https://mini4wd-track-editor.pimentoso.com
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 *
 * Track pieces are trademarks/copyright of Tamiya inc.; piece artwork in
 * assets/ is the original editor's sprite set (Tamiya designs). Procedural
 * vector drawing is retained only as a fallback while sprites load.
 *
 * Everything else (touch UI, camera, rendering, storage) is new code for this PoC.
 */
'use strict';

/* ============================================================
 * Constants — identical values to the original editor
 * ============================================================ */
const SNAP_RADIUS = 10;    // cm, snap distance between connection vertices
const HITBOX_RADIUS = 18;  // cm, tap target radius around a piece center

/* Connection vertices are in piece-local cm, unrotated, origin = piece pos.
 * l = official lap length in meters, w/h = footprint in cm (1 px = 1 cm). */
const PIECES = {
  /* ---------- 3 lane (Japan Cup) ---------- */
  Str1: { label: 'Straight',      lanes: 3, l: 1.62, w: 54,  h: 36,  colors: 7,  v1: [-27, 0],   v2: [27, 0],   kind: 'straight' },
  Str2: { label: 'Start',         lanes: 3, l: 1.62, w: 54,  h: 36,  colors: 1,  v1: [-27, 0],   v2: [27, 0],   kind: 'start' },
  Cor1: { label: '45\u00B0 corner', lanes: 3, l: 1.27, w: 52, h: 52, colors: 10, v1: [-26, -8],  v2: [12.2, 7.8], center: [-5, -3.5], kind: 'corner', R: 54, band: 36 },
  Lan1: { label: 'Lane changer',  lanes: 3, l: 4.86, w: 162, h: 36,  colors: 2,  v1: [-81, 0],   v2: [81, 0],   kind: 'changer' },
  Lan2: { label: 'Rainbow',       lanes: 3, l: 9.81, w: 180, h: 144, colors: 1,  v1: [-90, -54], v2: [-90, 54], kind: 'hairpin', R: 54, band: 36 },
  Chi1: { label: 'Wave',          lanes: 3, l: 1.62, w: 54,  h: 42,  colors: 2,  v1: [-27, 3],   v2: [27, 3],   center: [0, -3], kind: 'wave' },
  Bri1: { label: 'Slope',         lanes: 3, l: 1.62, w: 54,  h: 36,  colors: 4,  v1: [-27, 0],   v2: [27, 0],   kind: 'slope' },
  Bri2: { label: 'Jump',          lanes: 3, l: 1.62, w: 54,  h: 36,  colors: 1,  v1: [-27, 0],   v2: [27, 0],   kind: 'jump' },
  Ban1: { label: 'Bank',          lanes: 3, l: 0.66, w: 28,  h: 36,  colors: 4,  v1: [-14, 0],   v2: [14, 0],   kind: 'bank' },

  /* ---------- 5 lane (WIDE) ---------- */
  Str3: { label: '\u00BC Straight', lanes: 5, l: 1.5,  w: 30,  h: 60,  colors: 4, v1: [-15, 0],   v2: [15, 0],   kind: 'straight' },
  Str4: { label: '\u00BD Straight', lanes: 5, l: 3,    w: 60,  h: 60,  colors: 4, v1: [-30, 0],   v2: [30, 0],   kind: 'straight' },
  Str5: { label: '\u00BE Straight', lanes: 5, l: 4.5,  w: 90,  h: 60,  colors: 4, v1: [-45, 0],   v2: [45, 0],   kind: 'straight' },
  Str6: { label: 'Straight',      lanes: 5, l: 6,    w: 120, h: 60,  colors: 4,  v1: [-60, 0],   v2: [60, 0],   kind: 'straight' },
  Cor2: { label: '45\u00B0 corner', lanes: 5, l: 2.46, w: 72,  h: 72,  colors: 3, v1: [-36, -6],  v2: [6.42, 11.58], kind: 'corner', R: 60, band: 60 },
  Cor3: { label: '90\u00B0 corner', lanes: 5, l: 4.92, w: 90,  h: 90,  colors: 3, v1: [-45, -15], v2: [15, 45],  kind: 'corner', R: 60, band: 60 },
  Cor4: { label: 'Digital curve', lanes: 5, l: 4.92, w: 90,  h: 90,  colors: 3,  v1: [-45, -15], v2: [15, 45],  kind: 'corner', R: 60, band: 60 },
  Cor5: { label: 'R2100 curve',   lanes: 5, l: 14.33, w: 210, h: 210, colors: 1, v1: [-105, -75], v2: [75, 105], kind: 'corner', R: 210, band: 60 },
  Lan3: { label: 'Burning chg.',  lanes: 5, l: 9.84, w: 90,  h: 180, colors: 1,  v1: [-45, -60], v2: [-45, 60], kind: 'hairpin', R: 60, band: 60 },
  Lan4: { label: 'Lane changer',  lanes: 5, l: 12,   w: 240, h: 60,  colors: 1,  v1: [-120, 0],  v2: [120, 0],  kind: 'changer' },
  Bri3: { label: '\u00BD Slope',    lanes: 5, l: 3,    w: 60,  h: 60,  colors: 1, v1: [-30, 0],   v2: [30, 0],   kind: 'slope' },
  Bri4: { label: 'Slope',         lanes: 5, l: 6,    w: 120, h: 60,  colors: 1,  v1: [-60, 0],   v2: [60, 0],   kind: 'slope' },
  Ban2: { label: 'Bank',          lanes: 5, l: 2.7,  w: 54,  h: 60,  colors: 1,  v1: [-27, 0],   v2: [27, 0],   kind: 'bank' },
  Chi2: { label: 'Wave',          lanes: 5, l: 6,    w: 120, h: 72,  colors: 1,  v1: [-60, 6],   v2: [60, 6],   kind: 'wave' },
};

/* palette order mirrors the original sidebar radios */
const PALETTE = {
  3: ['Str1', 'Cor1', 'Lan1', 'Chi1', 'Str2', 'Bri1', 'Ban1', 'Bri2', 'Lan2'],
  5: ['Str3', 'Str4', 'Str5', 'Str6', 'Cor2', 'Cor3', 'Cor4', 'Cor5', 'Lan4', 'Lan3', 'Chi2', 'Bri3', 'Bri4', 'Ban2'],
};

const VARIANT_COLORS = ['#c9d1dc', '#e05263', '#4f8fdd', '#2ea89b', '#e5b84b',
  '#9b6bd6', '#e08b4f', '#4fb67a', '#d66fae', '#7f8c9b'];

const TOOLS = ['Pan', 'Move', 'Delete', 'Color']; // non-piece tools

/* ---------- piece artwork: original sprite PNGs (assets/Name.color.png) ---------- */
const IMAGES = {};
function imageFor(name, c) { return IMAGES[`${name}.${c}`] || null; }
let paletteTimer = null;
function preloadImages() {
  for (const [name, def] of Object.entries(PIECES)) {
    for (let c = 0; c < def.colors; c++) {
      const img = new Image();
      img.onload = () => {
        scheduleDraw();
        clearTimeout(paletteTimer);
        paletteTimer = setTimeout(buildPalette, 120); /* repaint chips with sprites */
      };
      img.src = `assets/${name}.${c}.png?v=3`;
      IMAGES[`${name}.${c}`] = img;
    }
  }
}

/* ============================================================
 * Tiny 2D point helpers
 * ============================================================ */
const rad = (d) => (d * Math.PI) / 180;
const norm2pi = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

function rot(x, y, deg) {
  if (!deg) return { x, y };
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
  return { x: x * c - y * s, y: x * s + y * c };
}

/* ============================================================
 * Corner / hairpin arc solving (centers derived from the
 * published connection vertices, radii from the MIT source data)
 * ============================================================ */
const geoCache = new Map();

function sampleArcFits(cx, cy, R, band, a1, sweep, halfW, halfH) {
  const steps = 28;
  for (let i = 0; i <= steps; i++) {
    const a = a1 + (sweep * i) / steps;
    const ca = Math.cos(a), sa = Math.sin(a);
    for (const r of [R - band / 2, R + band / 2]) {
      const x = cx + r * ca, y = cy + r * sa;
      if (x < -halfW || x > halfW || y < -halfH || y > halfH) return false;
    }
  }
  return true;
}

function solveGeo(name) {
  if (geoCache.has(name)) return geoCache.get(name);
  const def = PIECES[name];
  const v1 = { x: def.v1[0], y: def.v1[1] };
  const v2 = { x: def.v2[0], y: def.v2[1] };
  const halfW = def.w / 2 + 1.5, halfH = def.h / 2 + 1.5;
  let geo = null;

  if (def.kind === 'hairpin') {
    const cx = (v1.x + v2.x) / 2, cy = (v1.y + v2.y) / 2;
    const R = Math.hypot(v1.x - v2.x, v1.y - v2.y) / 2;
    const a1 = Math.atan2(v1.y - cy, v1.x - cx);
    for (const sweep of [Math.PI, -Math.PI]) {
      if (sampleArcFits(cx, cy, R, def.band, a1, sweep, halfW, halfH)) {
        geo = { cx, cy, R, a1, sweep }; break;
      }
    }
    geo = geo || { cx, cy, R, a1, sweep: Math.PI };
  } else {
    const d = Math.hypot(v2.x - v1.x, v2.y - v1.y);
    const halfSweep = Math.asin(Math.min(1, d / (2 * def.R)));
    const off = def.R * Math.cos(halfSweep);
    const mx = (v1.x + v2.x) / 2, my = (v1.y + v2.y) / 2;
    const px = -(v2.y - v1.y) / d, py = (v2.x - v1.x) / d;
    const cands = [{ x: mx + off * px, y: my + off * py }, { x: mx - off * px, y: my - off * py }];
    const target = 2 * halfSweep;
    for (const c of cands) {
      const a1 = Math.atan2(v1.y - c.y, v1.x - c.x);
      const a2 = Math.atan2(v2.y - c.y, v2.x - c.x);
      for (const sweep of [norm2pi(a2 - a1), -norm2pi(a1 - a2)]) {
        if (Math.abs(Math.abs(sweep) - target) < 0.03 &&
            sampleArcFits(c.x, c.y, def.R, def.band, a1, sweep, halfW, halfH)) {
          geo = { cx: c.x, cy: c.y, R: def.R, a1, sweep }; break;
        }
      }
      if (geo) break;
    }
    /* deterministic fallback if the fitting heuristic misses */
    if (!geo) {
      const c = cands[0];
      const a1 = Math.atan2(v1.y - c.y, v1.x - c.x);
      geo = { cx: c.x, cy: c.y, R: def.R, a1, sweep: target };
    }
  }
  geoCache.set(name, geo);
  return geo;
}

/* ============================================================
 * Procedural piece art (replaces the original Tamiya PNGs)
 * ============================================================ */
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

function drawPieceArt(g, name, cIdx) {
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

/* ============================================================
 * State
 * ============================================================ */
const state = {
  mode: 3,
  tool: 'Str1',          // piece name, or one of TOOLS
  angle: 0,
  sprites: [],           // placed pieces: {name,x,y,a,c}
  selection: new Set(),  // pieces selected with the Move tool
  view: { x: 0, y: 0, scale: 0.62 },
  history: [],
  savedUrl: '',
};

const canvas = document.getElementById('editor');
const ctx = canvas.getContext('2d');
const stage = document.getElementById('stage');
let dpr = 1, cssW = 0, cssH = 0;
let ghost = null;        // {name,x,y,a,c,snapped} or null
let lastPointer = null;  // world pos of last pointer activity
let hintShown = true;

/* ---------- geometry helpers on pieces ---------- */
function centerOf(p) {
  const def = PIECES[p.name];
  const c = def.center || [0, 0];
  const r = rot(c[0], c[1], p.a);
  return { x: p.x + r.x, y: p.y + r.y };
}
function vertexOf(p, n) {
  const def = PIECES[p.name];
  const v = n === 1 ? def.v1 : def.v2;
  const r = rot(v[0], v[1], p.a);
  return { x: p.x + r.x, y: p.y + r.y };
}
function isHit(p, pt) {
  const c = centerOf(p);
  return Math.hypot(pt.x - c.x, pt.y - c.y) <= HITBOX_RADIUS;
}

/* ---------- selection helpers (Move tool) ---------- */
function pieceHalfExtents(p) {
  const def = PIECES[p.name];
  const c = Math.abs(Math.cos(rad(p.a))), s = Math.abs(Math.sin(rad(p.a)));
  return { hx: (def.w / 2) * c + (def.h / 2) * s, hy: (def.w / 2) * s + (def.h / 2) * c };
}
function bboxContains(p, w) {
  const { hx, hy } = pieceHalfExtents(p);
  return Math.abs(w.x - p.x) <= hx && Math.abs(w.y - p.y) <= hy;
}
function topPieceAt(w) {
  for (let i = state.sprites.length - 1; i >= 0; i--) {
    if (isHit(state.sprites[i], w) || bboxContains(state.sprites[i], w)) return state.sprites[i];
  }
  return null;
}

/* snap a dragged group by its best vertex pair against unselected pieces */
function groupSnap() {
  let best = null;
  for (const s of state.selection) {
    for (const vi of [1, 2]) {
      const va = vertexOf(s, vi);
      for (const t of state.sprites) {
        if (state.selection.has(t)) continue;
        for (const vt of [1, 2]) {
          const vb = vertexOf(t, vt);
          const d = Math.hypot(va.x - vb.x, va.y - vb.y);
          if (d <= SNAP_RADIUS && (!best || d < best.d)) best = { d, dx: vb.x - va.x, dy: vb.y - va.y };
        }
      }
    }
  }
  if (best) {
    for (const s of state.selection) { s.x += best.dx; s.y += best.dy; }
    return true;
  }
  return false;
}

/* ---------- snapping (algorithm from the original MIT source) ---------- */
function snapGhost() {
  if (!ghost || TOOLS.includes(state.tool)) return false;
  const g = ghost;
  let snapped = false;
  for (const s of state.sprites) {
    if (s === g) continue;
    const pairs = [[1, 1], [1, 2], [2, 1], [2, 2]];
    for (const [si, gi] of pairs) {
      const a = vertexOf(s, si), b = vertexOf(g, gi);
      if (Math.hypot(a.x - b.x, a.y - b.y) <= SNAP_RADIUS) {
        g.x += a.x - b.x; g.y += a.y - b.y;
        snapped = true;
        break;
      }
    }
  }
  return snapped;
}

/* ---------- camera ---------- */
function worldFromScreen(sx, sy) {
  return { x: (sx - state.view.x) / state.view.scale, y: (sy - state.view.y) / state.view.scale };
}
function screenFromEvent(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function clampScale(s) { return Math.min(4, Math.max(0.12, s)); }
function zoomAt(sx, sy, factor) {
  const v = state.view;
  const w = worldFromScreen(sx, sy);
  v.scale = clampScale(v.scale * factor);
  v.x = sx - w.x * v.scale;
  v.y = sy - w.y * v.scale;
  scheduleDraw();
}
function fitView() {
  if (!state.sprites.length) {
    state.view = { x: cssW / 2, y: cssH / 2, scale: 0.62 };
    return scheduleDraw();
  }
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const p of state.sprites) {
    const def = PIECES[p.name];
    const c = Math.abs(Math.cos(rad(p.a))), s = Math.abs(Math.sin(rad(p.a)));
    const hx = (def.w / 2) * c + (def.h / 2) * s;
    const hy = (def.w / 2) * s + (def.h / 2) * c;
    minX = Math.min(minX, p.x - hx); maxX = Math.max(maxX, p.x + hx);
    minY = Math.min(minY, p.y - hy); maxY = Math.max(maxY, p.y + hy);
  }
  const pad = 60;
  const scale = clampScale(Math.min((cssW - pad) / (maxX - minX + pad), (cssH - pad) / (maxY - minY + pad)));
  state.view.scale = scale;
  state.view.x = cssW / 2 - ((minX + maxX) / 2) * scale;
  state.view.y = cssH / 2 - ((minY + maxY) / 2) * scale;
  scheduleDraw();
}

/* ============================================================
 * Rendering
 * ============================================================ */
let drawQueued = false;
function scheduleDraw() {
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

  if (ghost && !TOOLS.includes(state.tool)) {
    snapGhost();
    drawPiece(ghost, 0.8);
    drawVertices(ghost, snapGhost());
  }
  drawSelection();
  drawRubberBand();

  /* origin marker */
  ctx.strokeStyle = '#3d434d'; ctx.lineWidth = 2 / state.view.scale;
  ctx.beginPath();
  ctx.moveTo(-14, 0); ctx.lineTo(14, 0); ctx.moveTo(0, -14); ctx.lineTo(0, 14);
  ctx.stroke();
  ctx.restore();

  updateStats();
}

function drawGrid() {
  const tl = worldFromScreen(0, 0), br = worldFromScreen(cssW, cssH);
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

function updateRubberSelection() {
  const x1 = Math.min(rubber.x1, rubber.x2), y1 = Math.min(rubber.y1, rubber.y2);
  const x2 = Math.max(rubber.x1, rubber.x2), y2 = Math.max(rubber.y1, rubber.y2);
  state.selection.clear();
  for (const p of state.sprites) {
    const { hx, hy } = pieceHalfExtents(p);
    if (p.x + hx >= x1 && p.x - hx <= x2 && p.y + hy >= y1 && p.y - hy <= y2) state.selection.add(p);
  }
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

/* ============================================================
 * Track data — serialization is byte-compatible with the original
 * format: "Name;x;y;angle;color#Name;x;y;angle;color#..."
 * ============================================================ */
function serialize() {
  return state.sprites
    .filter((p) => p.x >= 0 && p.y >= 0)
    .map((p) => [p.name, p.x.toFixed(3), p.y.toFixed(3), p.a, p.c].join(';') + '#')
    .join('');
}

function parseTrack(text) {
  /* accept either the raw format or a pasted /load/CODE.js response */
  const m = text.match(/var\s+text\s*=\s*'([^']*)'/);
  if (m) text = m[1];
  const out = [];
  for (const elem of String(text).split('#')) {
    const attrs = elem.split(';');
    if (attrs[0] && PIECES[attrs[0]]) {
      out.push({
        name: attrs[0],
        x: parseFloat(attrs[1]) || 0,
        y: parseFloat(attrs[2]) || 0,
        a: parseFloat(attrs[3]) || 0,
        c: parseInt(attrs[4], 10) || 0,
      });
    }
  }
  return out;
}

/* ---------- history ---------- */
function pushHistory() {
  state.history.push(JSON.stringify(state.sprites));
  if (state.history.length > 80) state.history.shift();
}
function undo() {
  if (!state.history.length) return toast('Nothing to undo');
  state.sprites = JSON.parse(state.history.pop());
  state.selection.clear();
  scheduleDraw(); autosave();
}

/* ---------- mutations ---------- */
function placePiece() {
  snapGhost();
  pushHistory();
  state.sprites.push({ ...ghost });
  /* advance the ghost to the new piece's far end so repeated taps chain pieces */
  const placed = state.sprites[state.sprites.length - 1];
  const v2 = vertexOf(placed, 2);
  const r = rot(PIECES[ghost.name].v1[0], PIECES[ghost.name].v1[1], ghost.a);
  ghost = { ...ghost, x: v2.x - r.x, y: v2.y - r.y, c: 0 };
  if (hintShown) { hintShown = false; document.getElementById('hint').style.opacity = '0'; }
  scheduleDraw(); autosave();
}

function actAt(pt) {
  if (state.tool === 'Pan') return;
  if (TOOLS.includes(state.tool)) {
    /* topmost piece under the tap */
    let hit = null;
    for (let i = state.sprites.length - 1; i >= 0; i--) {
      if (isHit(state.sprites[i], pt)) { hit = state.sprites[i]; break; }
    }
    if (!hit) return;
    if (state.tool === 'Delete') {
      pushHistory();
      state.sprites.splice(state.sprites.indexOf(hit), 1);
      state.selection.delete(hit);
    } else if (state.tool === 'Color') {
      pushHistory();
      hit.c = (hit.c + 1) % PIECES[hit.name].colors;
    }
    scheduleDraw(); autosave();
  } else if (ghost) {
    /* two-stage placement: a tap on empty space only aims the ghost;
       the piece is placed by tapping on the track or on the ghost itself */
    if (tapOnTarget) placePiece();
  }
}

/* ============================================================
 * Input — Pointer Events: tap to place, drag ghost, pinch zoom
 * ============================================================ */
const pointers = new Map();
let pinch = null;   // {d, cx, cy, scale, vx, vy}
let tapInfo = null; // {x,y,t,moved,id}
let panning = null;
let groupDrag = null; // {start, snapshot, orig, moved}
let rubber = null;    // {x1,y1,x2,y2}
let selectPending;    // piece to toggle on ctrl/cmd+click
let tapOnTarget = false; // tap landed on track/ghost at pointerdown (confirm-tap)

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

function moveGhostTo(screenPt) {
  const w = worldFromScreen(screenPt.x, screenPt.y);
  if (!ghost) return;
  ghost.x = Math.floor(w.x);
  ghost.y = Math.floor(w.y);
  scheduleDraw();
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, screenFromEvent(e));
  if (pointers.size === 2) { beginPinch(); panning = null; return; }
  const s = screenFromEvent(e);
  tapInfo = { x: s.x, y: s.y, t: performance.now(), moved: false, id: e.pointerId };
  if (state.tool === 'Pan' || e.shiftKey) { panning = { x: s.x, y: s.y, vx: state.view.x, vy: state.view.y }; return; }

  if (state.tool === 'Move') {
    const w = worldFromScreen(s.x, s.y);
    const hitP = topPieceAt(w);
    if (e.ctrlKey || e.metaKey) { selectPending = hitP; return; }
    if (hitP) {
      if (!state.selection.has(hitP)) {
        state.selection.clear();
        state.selection.add(hitP);
      }
      groupDrag = {
        start: w,
        snapshot: JSON.stringify(state.sprites),
        orig: [...state.selection].map((p) => [p, p.x, p.y]),
        moved: false,
      };
    } else {
      state.selection.clear();
      rubber = { x1: w.x, y1: w.y, x2: w.x, y2: w.y };
    }
    scheduleDraw();
    return;
  }
  if (ghost && !TOOLS.includes(state.tool)) {
    /* tapping on the track extends the chain; tapping empty space repositions the ghost */
    const wpt = worldFromScreen(s.x, s.y);
    tapOnTarget = !!(topPieceAt(wpt) || bboxContains(ghost, wpt) || isHit(ghost, wpt));
    if (!topPieceAt(wpt)) moveGhostTo(s);
    else scheduleDraw();
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, screenFromEvent(e));

  if (panning) {
    const s = screenFromEvent(e);
    state.view.x = panning.vx + (s.x - panning.x);
    state.view.y = panning.vy + (s.y - panning.y);
    scheduleDraw(); return;
  }
  if (pointers.size >= 2 && pinch) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    state.view.scale = clampScale(pinch.scale * (d / pinch.d));
    /* keep the pinch centroid anchored and follow its movement (pan) */
    state.view.x = cx - ((pinch.cx - pinch.vx) / pinch.scale) * state.view.scale;
    state.view.y = cy - ((pinch.cy - pinch.vy) / pinch.scale) * state.view.scale;
    scheduleDraw(); return;
  }
  const s = screenFromEvent(e);
  if (tapInfo && e.pointerId === tapInfo.id) {
    if (Math.hypot(s.x - tapInfo.x, s.y - tapInfo.y) > 10) tapInfo.moved = true;
  }
  if (groupDrag && pointers.size === 1) {
    const w = worldFromScreen(s.x, s.y);
    const dx = w.x - groupDrag.start.x, dy = w.y - groupDrag.start.y;
    for (const [p, x0, y0] of groupDrag.orig) { p.x = x0 + dx; p.y = y0 + dy; }
    if (Math.hypot(dx, dy) > 2) groupDrag.moved = true;
    groupSnap();
    scheduleDraw();
    return;
  }
  if (rubber) {
    const w = worldFromScreen(s.x, s.y);
    rubber.x2 = w.x; rubber.y2 = w.y;
    updateRubberSelection();
    scheduleDraw();
    return;
  }
  if (ghost && !TOOLS.includes(state.tool)) moveGhostTo(s);
});

function endPointer(e) {
  const wasPinch = pointers.size >= 2;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (panning && pointers.size === 0) panning = null;

  /* commit group drag / rubber band before tap filtering */
  if (groupDrag) {
    const g = groupDrag; groupDrag = null;
    if (g.moved) {
      state.history.push(g.snapshot);
      if (state.history.length > 80) state.history.shift();
      autosave();
    }
    scheduleDraw();
    return;
  }
  if (rubber) { rubber = null; scheduleDraw(); return; }

  const t = tapInfo;
  tapInfo = null;
  if (!t || wasPinch || t.moved || e.pointerId !== t.id) return;
  if (performance.now() - t.t > 450) return; /* long press ignored */
  const w = worldFromScreen(t.x, t.y);
  lastPointer = w;

  if (selectPending !== undefined) {
    const p2 = selectPending; selectPending = undefined;
    if (p2) {
      if (state.selection.has(p2)) state.selection.delete(p2);
      else state.selection.add(p2);
    } else {
      state.selection.clear();
    }
    scheduleDraw();
    return;
  }
  actAt(w);
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const s = screenFromEvent(e);
  zoomAt(s.x, s.y, e.deltaY < 0 ? 1.12 : 1 / 1.12);
}, { passive: false });

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault()); /* iOS Safari */

/* ---------- keyboard (desktop parity with the original) ---------- */
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  if (document.querySelector('dialog[open]')) return;
  const k = e.key.toLowerCase();
  const pal = PALETTE[state.mode];
  if (k >= '1' && k <= '9') {
    /* cycle within piece families, mirroring the original hotkeys */
    const families = { 3: { 1: ['Str1'], 2: ['Cor1'], 3: ['Lan1'], 4: ['Chi1'], 5: ['Str2'], 6: ['Bri1'], 7: ['Ban1'], 8: ['Bri2'], 9: ['Lan2'] },
                       5: { 1: ['Str3', 'Str4', 'Str5', 'Str6'], 2: ['Cor2', 'Cor3', 'Cor4', 'Cor5'], 3: ['Lan4', 'Lan3'], 4: ['Chi2'], 5: ['Bri3', 'Bri4'], 6: ['Ban2'] } };
    const fam = families[state.mode][+k];
    if (fam) {
      const i = fam.indexOf(state.tool);
      setTool(fam[(i + 1) % fam.length]);
    }
  } else if (k === 'q') setTool('Move');
  else if (k === 'h') setTool('Pan');
  else if (k === 'w') setTool('Delete');
  else if (k === 'e') setTool('Color');
  else if (k === 'z') rotateTool(-45);
  else if (k === 'x') rotateTool(45);
  else if (k === 'r') undo();
  else if (k === 'f') fitView();
  else if (k === 'escape') { state.selection.clear(); scheduleDraw(); }
  else if (k === 'delete' || k === 'backspace') {
    if (state.selection.size) {
      pushHistory();
      state.sprites = state.sprites.filter((p) => !state.selection.has(p));
      state.selection.clear();
      scheduleDraw(); autosave();
    }
  }
  else if (k === '+' || k === '=') zoomAt(cssW / 2, cssH / 2, 1.25);
  else if (k === '-') zoomAt(cssW / 2, cssH / 2, 0.8);
});

function rotateTool(delta) {
  state.angle = (state.angle + delta + 360) % 360;
  if (ghost) ghost.a = state.angle;
  if (state.selection.size) {
    pushHistory();
    let cx = 0, cy = 0;
    for (const p of state.selection) { cx += p.x; cy += p.y; }
    cx /= state.selection.size; cy /= state.selection.size;
    for (const p of state.selection) {
      const r = rot(p.x - cx, p.y - cy, delta);
      p.x = cx + r.x; p.y = cy + r.y;
      p.a = (p.a + delta + 360) % 360;
    }
    autosave();
  }
  scheduleDraw();
}

/* ============================================================
 * UI wiring
 * ============================================================ */
function setTool(tool) {
  state.tool = tool;
  if (!TOOLS.includes(tool)) ghost = { name: tool, x: ghost ? ghost.x : 0, y: ghost ? ghost.y : 0, a: state.angle, c: 0 };
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.piece === tool));
  scheduleDraw(); autosave();
}

function setMode(mode) {
  state.mode = mode;
  document.getElementById('mode3').classList.toggle('active', mode === 3);
  document.getElementById('mode5').classList.toggle('active', mode === 5);
  buildPalette();
  if (!PALETTE[mode].includes(state.tool)) setTool(PALETTE[mode][0]);
  else setTool(state.tool);
}

function buildPalette() {
  const pal = document.getElementById('palette');
  pal.innerHTML = '';
  for (const name of PALETTE[state.mode]) {
    const def = PIECES[name];
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.piece = name;
    chip.setAttribute('role', 'radio');

    const cv = document.createElement('canvas');
    const cw = 64, ch = 44;
    cv.width = cw * dpr; cv.height = ch * dpr;
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    g.translate(cw / 2, ch / 2);
    const s = Math.min((cw - 6) / def.w, (ch - 6) / def.h);
    g.scale(s, s);
    const img = imageFor(name, 0);
    if (img && img.complete && img.naturalWidth) {
      g.drawImage(img, -def.w / 2, -def.h / 2, def.w, def.h);
    } else {
      drawPieceArt(g, name, 0); /* fallback until sprites load */
    }

    const label = document.createElement('span');
    label.className = 'chip-label';
    label.textContent = def.label;

    chip.append(cv, label);
    chip.addEventListener('click', () => setTool(name));
    pal.appendChild(chip);
  }
  document.querySelectorAll('.chip').forEach((c) =>
    c.classList.toggle('active', c.dataset.piece === state.tool));
}

/* ---------- stats ---------- */
let lastStatsText = '';
function updateStats() {
  let len = 0;
  for (const p of state.sprites) len += PIECES[p.name].l;
  const txt = `${len.toFixed(2)} m \u00B7 ${state.sprites.length} pcs`;
  if (txt === lastStatsText) return; /* avoid DOM writes from the render loop */
  lastStatsText = txt;
  document.getElementById('stats').textContent = txt;
}

/* ---------- persistence ---------- */
let autosaveTimer = null;
function autosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem('m4wd.autosave', JSON.stringify({
        mode: state.mode, tool: state.tool, angle: state.angle, track: serialize(),
      }));
    } catch (_) { /* private mode etc. */ }
  }, 350);
}

function restoreFromAutosave() {
  try {
    const raw = localStorage.getItem('m4wd.autosave');
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

/* ---------- share links (#t=base64url) ---------- */
function encodeShare() {
  const s = serialize();
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeShare(b64) {
  const norm = b64.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(norm);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/* ---------- dialogs, buttons, toast ---------- */
const $ = (id) => document.getElementById(id);
let ioMode = 'import'; /* or 'share' */

function openDialog(dlg) { if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', ''); }
function closeDialog(dlg) { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2200);
}

$('btnMenu').addEventListener('click', () => openDialog($('menuDialog')));
$('btnCloseMenu').addEventListener('click', () => closeDialog($('menuDialog')));

$('btnShare').addEventListener('click', () => {
  ioMode = 'share';
  $('ioTitle').textContent = 'Share link';
  $('ioHint').innerHTML = 'This link encodes the whole track \u2014 no server needed. Send it to anyone; it opens in this editor.';
  $('ioText').value = `${location.origin}${location.pathname}#t=${encodeShare()}`;
  $('ioAction').textContent = 'Shorten (copy again)';
  closeDialog($('menuDialog'));
  openDialog($('ioDialog'));
});

$('btnExport').addEventListener('click', () => {
  const blob = new Blob([serialize()], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mini4wd-track.txt';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Track file downloaded');
});

$('fileImport').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  file.text().then((t) => importText(t));
  e.target.value = '';
});

$('btnImportText').addEventListener('click', () => {
  ioMode = 'import';
  $('ioTitle').textContent = 'Import';
  $('ioHint').innerHTML = 'Paste an original-site track string (<code>Name;x;y;angle;color#Name;\u2026</code>) or the full text of a <code>/load/CODE.js</code> response.';
  $('ioText').value = '';
  $('ioAction').textContent = 'Import';
  closeDialog($('menuDialog'));
  openDialog($('ioDialog'));
});

function importText(text) {
  const sprites = parseTrack(text);
  if (!sprites.length) return toast('No valid pieces found');
  pushHistory();
  state.sprites = sprites;
  state.selection.clear();
  fitView();
  closeDialog($('ioDialog'));
  scheduleDraw(); autosave();
  toast(`Imported ${sprites.length} pieces`);
}

$('ioAction').addEventListener('click', () => {
  if (ioMode === 'import') importText($('ioText').value);
  else { navigator.clipboard?.writeText($('ioText').value); toast('Copied to clipboard'); }
});
$('ioCopy').addEventListener('click', () => {
  navigator.clipboard?.writeText($('ioText').value);
  toast('Copied to clipboard');
});
$('ioClose').addEventListener('click', () => closeDialog($('ioDialog')));

$('btnHelp').addEventListener('click', () => { closeDialog($('menuDialog')); openDialog($('helpDialog')); });
$('helpClose').addEventListener('click', () => closeDialog($('helpDialog')));

document.querySelectorAll('[data-tool]').forEach((b) => {
  b.addEventListener('click', () => setTool(b.dataset.tool));
});
$('btnRotL').addEventListener('click', () => rotateTool(-45));
$('btnRotR').addEventListener('click', () => rotateTool(45));
$('btnUndo').addEventListener('click', undo);
$('btnClear').addEventListener('click', () => {
  if (!state.sprites.length) return;
  if (confirm('Delete all pieces?')) {
    pushHistory();
    state.sprites = [];
    state.selection.clear();
    scheduleDraw(); autosave();
  }
});
$('btnZoomIn').addEventListener('click', () => zoomAt(cssW / 2, cssH / 2, 1.25));
$('btnZoomOut').addEventListener('click', () => zoomAt(cssW / 2, cssH / 2, 0.8));
$('btnFit').addEventListener('click', fitView);
$('mode3').addEventListener('click', () => setMode(3));
$('mode5').addEventListener('click', () => setMode(5));

window.addEventListener('beforeunload', (e) => {
  if (state.sprites.length) { e.preventDefault(); e.returnValue = ''; }
});

/* ============================================================
 * Boot
 * ============================================================ */
function resize() {
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

function boot() {
  new ResizeObserver(resize).observe(stage);
  resize();
  preloadImages();

  /* 1. shared link, 2. autosave, 3. fresh start */
  const m = location.hash.match(/[#&]t=([A-Za-z0-9\-_]+)/);
  if (m) {
    try {
      state.sprites = parseTrack(decodeShare(m[1]));
      toast(`Loaded shared track (${state.sprites.length} pieces)`);
    } catch (_) { toast('Could not read shared link'); }
  }
  if (!state.sprites.length) restoreFromAutosave();

  setMode(state.mode);
  setTool(PALETTE[state.mode].includes(state.tool) ? state.tool : PALETTE[state.mode][0]);
  if (state.sprites.length) fitView();
  else { state.view = { x: cssW / 2, y: cssH / 2, scale: 0.62 }; }
  scheduleDraw();
}

boot();
