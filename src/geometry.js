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
  const v1 = { x: def.verts[0][0], y: def.verts[0][1] };
  const v2 = { x: def.verts[1][0], y: def.verts[1][1] };
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
 * Geometry helpers on pieces ({name,x,y,a,c,z})
 * ============================================================ */
export function vertsOf(p) {
  return PIECES[p.name].verts;
}

export function centerOf(p) {
  const def = PIECES[p.name];
  const c = def.center || [0, 0];
  const r = rot(c[0], c[1], p.a);
  return { x: p.x + r.x, y: p.y + r.y };
}

/* World position of connection vertex i (0-based into def.verts). */
export function vertexOf(p, i) {
  const v = PIECES[p.name].verts[i];
  const r = rot(v[0], v[1], p.a);
  return { x: p.x + r.x, y: p.y + r.y };
}

/* Elevation (mm) at connection vertex i: serialized level + per-vertex offset. */
export function levelAt(p, i) {
  return (p.z || 0) + (PIECES[p.name].verts[i][2] || 0);
}

/* ---------- tangents (catalog-local, degrees; docs/design §1) ---------- */
const tangentCache = new Map();

/* Local tangent of the travel direction at vertex i. Arc kinds derive it
 * from the solved arc; axis kinds from the verts[0]->verts[last] axis. */
function localTangent(name) {
  if (tangentCache.has(name)) return tangentCache.get(name);
  const def = PIECES[name];
  let t;
  if (def.kind === 'corner' || def.kind === 'hairpin') {
    const geo = solveGeo(name); /* radians */
    const sgn = geo.sweep >= 0 ? Math.PI / 2 : -Math.PI / 2;
    const deg = (r) => r * 180 / Math.PI;
    t = { in0: deg(geo.a1 + sgn), out1: deg(geo.a1 + geo.sweep + sgn) };
  } else {
    const a = def.verts[0], b = def.verts[def.verts.length - 1];
    const d = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
    t = { in0: d, out1: d };
  }
  tangentCache.set(name, t);
  return t;
}

const norm360 = (deg) => ((deg % 360) + 360) % 360;

/* Outward tangent (degrees, world) at vertex i: direction of travel LEAVING
 * the piece through that vertex. */
export function outwardTangent(p, i) {
  const t = localTangent(p.name);
  return norm360(p.a + (i === localLast(p) ? t.out1 : t.in0 + 180));
}

/* Inward tangent (degrees, world) at vertex i: direction of travel ENTERING
 * the piece through that vertex. */
export function inwardTangent(p, i) {
  const t = localTangent(p.name);
  return norm360(p.a + (i === localLast(p) ? t.out1 + 180 : t.in0));
}

function localLast(p) {
  return PIECES[p.name].verts.length - 1;
}

/* Absolute angle for g so its inward tangent at gi aligns with s's outward
 * tangent at si (travel flows s -> g through the joint). The tangent helpers
 * already return world values (piece rotation included). */
export function orientAngle(s, si, g, gi) {
  return norm360(outwardTangent(s, si) - (inwardTangent(g, gi) - g.a));
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

/* Topmost piece at w: highest z first, array order within a level
 * (matches painter's order — a bridge wins clicks over the road below). */
export function topPieceAt(sprites, w) {
  const byZ = [...sprites].sort((a, b) => (a.z || 0) - (b.z || 0));
  for (let i = byZ.length - 1; i >= 0; i--) {
    if (isHit(byZ[i], w) || bboxContains(byZ[i], w)) return byZ[i];
  }
  return null;
}

/* ---------- snapping ---------- */

/* Snap a placed-or-about-to-be piece to the closest connection vertex of
 * every other piece, then make the joint PROPER (docs/design §1): rotate
 * so tangents align, translate so vertices coincide exactly, adopt the
 * neighbor's level at the joint. Pair selection is closest-wins with
 * deterministic encounter-order ties (hysteresis deferred until splits).
 * Mutates g. */
export function snapPiece(g, sprites) {
  let best = null;
  for (const s of sprites) {
    if (s === g) continue;
    for (let si = 0; si < vertsOf(s).length; si++) {
      for (let gi = 0; gi < vertsOf(g).length; gi++) {
        const a = vertexOf(s, si), b = vertexOf(g, gi);
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d <= SNAP_RADIUS && (!best || d < best.d)) best = { d, s, si, gi };
      }
    }
  }
  if (!best) return false;
  const { s, si, gi } = best;
  g.a = orientAngle(s, si, g, gi);
  const a = vertexOf(s, si), b = vertexOf(g, gi);
  g.x += a.x - b.x; g.y += a.y - b.y;
  g.z = levelAt(s, si) - (vertsOf(g)[gi][2] || 0);
  return true;
}

/* Snap a dragged group by its best vertex pair against unselected pieces.
 * Position-only by design (docs/design §4). Mutates the selection's pieces. */
export function groupSnap(selection, sprites) {
  let best = null;
  for (const s of selection) {
    for (let vi = 0; vi < vertsOf(s).length; vi++) {
      const va = vertexOf(s, vi);
      for (const t of sprites) {
        if (selection.has(t)) continue;
        for (let vt = 0; vt < vertsOf(t).length; vt++) {
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

/* The single external joint of a selection (for pivot rotation): a vertex
 * of a selected piece coinciding (<= 1e-6) with a vertex of an unselected
 * piece. Returns the joint world point, or null when 0 or 2+ exist. */
export function externalJoint(selection, sprites) {
  const found = [];
  for (const s of sprites) {
    if (selection.has(s)) continue;
    for (let si = 0; si < vertsOf(s).length; si++) {
      const a = vertexOf(s, si);
      for (const g of selection) {
        for (let gi = 0; gi < vertsOf(g).length; gi++) {
          const b = vertexOf(g, gi);
          if (Math.hypot(a.x - b.x, a.y - b.y) <= 1e-6) found.push(a);
        }
      }
    }
  }
  return found.length === 1 ? found[0] : null;
}

/* ---------- disjunctions (unwelded but related ends) ---------- */

export const LINK_RANGE = 45;  // cm — plausible jump/landing or near-miss span
export const LINK_FACING = 50; // deg — each end must point at the other, roughly
/* Connectivity threshold: a vertex with another this close is CONNECTED
 * (owner cap: 1 cm absolute max). Serialization rounding is ~0.1 cm, so
 * true welds always land inside it; a real gap reads as open. Shared by
 * openLinks, the solver's joint exemption, and the publish validator. */
export const CONNECTED_EPS = 1.0;

/* Pairs of OPEN connection vertices that face each other within jump range
 * but are not welded: intentional jumps and landings, or near-miss joints.
 * Informational only — never an error, never blocks anything. Pure. */
export function openLinks(sprites) {
  const open = [];
  for (const p of sprites) {
    for (let i = 0; i < vertsOf(p).length; i++) {
      const v = vertexOf(p, i);
      let connected = false;
      for (const q of sprites) {
        if (q === p) continue;
        for (let j = 0; j < vertsOf(q).length; j++) {
          const w = vertexOf(q, j);
          if (Math.hypot(v.x - w.x, v.y - w.y) <= CONNECTED_EPS) { connected = true; break; }
        }
        if (connected) break;
      }
      if (!connected) open.push({ p, i, v, out: outwardTangent(p, i) });
    }
  }
  const links = [];
  for (let m = 0; m < open.length; m++) {
    for (let n = m + 1; n < open.length; n++) {
      const a = open[m], b = open[n];
      if (a.p === b.p) continue;
      const d = Math.hypot(b.v.x - a.v.x, b.v.y - a.v.y);
      if (d > LINK_RANGE || d < 1e-6) continue;
      const toB = Math.atan2(b.v.y - a.v.y, b.v.x - a.v.x) * 180 / Math.PI;
      const toA = toB + 180;
      const face = (t, to) => { const x = Math.abs(((t - to + 540) % 360) - 180); return 180 - x; }; /* 0..180, 180=aligned */
      if (face(a.out, toB) < 180 - LINK_FACING || face(b.out, toA) < 180 - LINK_FACING) continue;
      links.push({ a: a.p, ai: a.i, b: b.p, bi: b.i, d });
    }
  }
  return links;
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
