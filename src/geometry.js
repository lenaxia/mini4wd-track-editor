/* Geometry & snapping — algorithm derived from the MIT-licensed original
 * editor. Pure functions: no DOM, no store. Full notice: src/main.js header. */

import { PIECES, SNAP_RADIUS, HITBOX_RADIUS } from './pieces.js';

/* ============================================================
 * Tiny 2D point helpers
 * ============================================================ */
export const rad = (d) => (d * Math.PI) / 180;
export const norm2pi = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

export function rot(x, y, deg) {
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

export function solveGeo(name) {
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
 * Geometry helpers on pieces ({name,x,y,a,c})
 * ============================================================ */
export function centerOf(p) {
  const def = PIECES[p.name];
  const c = def.center || [0, 0];
  const r = rot(c[0], c[1], p.a);
  return { x: p.x + r.x, y: p.y + r.y };
}

export function vertexOf(p, n) {
  const def = PIECES[p.name];
  const v = n === 1 ? def.v1 : def.v2;
  const r = rot(v[0], v[1], p.a);
  return { x: p.x + r.x, y: p.y + r.y };
}

export function isHit(p, pt) {
  const c = centerOf(p);
  return Math.hypot(pt.x - c.x, pt.y - c.y) <= HITBOX_RADIUS;
}

export function pieceHalfExtents(p) {
  const def = PIECES[p.name];
  const c = Math.abs(Math.cos(rad(p.a))), s = Math.abs(Math.sin(rad(p.a)));
  return { hx: (def.w / 2) * c + (def.h / 2) * s, hy: (def.w / 2) * s + (def.h / 2) * c };
}

export function bboxContains(p, w) {
  const { hx, hy } = pieceHalfExtents(p);
  return Math.abs(w.x - p.x) <= hx && Math.abs(w.y - p.y) <= hy;
}

export function topPieceAt(sprites, w) {
  for (let i = sprites.length - 1; i >= 0; i--) {
    if (isHit(sprites[i], w) || bboxContains(sprites[i], w)) return sprites[i];
  }
  return null;
}

/* ---------- snapping ---------- */

/* Snap a placed-or-about-to-be piece to the closest connection vertex of
 * every other piece (algorithm from the original MIT source). Mutates g. */
export function snapPiece(g, sprites) {
  let snapped = false;
  for (const s of sprites) {
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

/* Snap a dragged group by its best vertex pair against unselected pieces.
 * Mutates the selection's pieces. */
export function groupSnap(selection, sprites) {
  let best = null;
  for (const s of selection) {
    for (const vi of [1, 2]) {
      const va = vertexOf(s, vi);
      for (const t of sprites) {
        if (selection.has(t)) continue;
        for (const vt of [1, 2]) {
          const vb = vertexOf(t, vt);
          const d = Math.hypot(va.x - vb.x, va.y - vb.y);
          if (d <= SNAP_RADIUS && (!best || d < best.d)) best = { d, dx: vb.x - va.x, dy: vb.y - va.y };
        }
      }
    }
  }
  if (best) {
    for (const s of selection) { s.x += best.dx; s.y += best.dy; }
    return true;
  }
  return false;
}

/* ---------- camera ---------- */

export function worldFromScreen(view, sx, sy) {
  return { x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale };
}

export function clampScale(s) { return Math.min(4, Math.max(0.12, s)); }

/* View that fits all sprites (with padding) into cssW x cssH. */
export function computeFit(sprites, cssW, cssH) {
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const p of sprites) {
    const def = PIECES[p.name];
    const c = Math.abs(Math.cos(rad(p.a))), s = Math.abs(Math.sin(rad(p.a)));
    const hx = (def.w / 2) * c + (def.h / 2) * s;
    const hy = (def.w / 2) * s + (def.h / 2) * c;
    minX = Math.min(minX, p.x - hx); maxX = Math.max(maxX, p.x + hx);
    minY = Math.min(minY, p.y - hy); maxY = Math.max(maxY, p.y + hy);
  }
  const pad = 60;
  const scale = clampScale(Math.min((cssW - pad) / (maxX - minX + pad), (cssH - pad) / (maxY - minY + pad)));
  return {
    scale,
    x: cssW / 2 - ((minX + maxX) / 2) * scale,
    y: cssH / 2 - ((minY + maxY) / 2) * scale,
  };
}
