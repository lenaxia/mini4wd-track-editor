/* Track validator — gates publish/save (owner rule: a published track is
 * complete and consistent). Pure: sprites in, findings out.
 *
 *   errors  (block publishing)
 *     - empty track
 *     - dangling end: a vertex coincident with no other piece's vertex AND
 *       not facing another open end as an intentional jump (same range/
 *       facing thresholds as geometry.openLinks)
 *     - kinked joint: connected vertices whose tangents mismatch beyond
 *       KINK_TANGENT_TOL (0.5° — rounding-scaled for serialized tracks)
 *   warnings (allowed, shown)
 *     - crossover clearance < 75 mm (the paint-rule check; bridges and
 *       jumps are legitimate design)
 *   permitted, no finding
 *     - junctions: 3+ vertices at one point (Y-junctions are a planned
 *       piece family — the validator must not become their enemy)
 */

import { PIECES, CLEARANCE_MM } from './pieces.js';
import { solveGeo, rot, rad, norm2pi, vertsOf, vertexOf, levelAt, outwardTangent, inwardTangent, pieceHalfExtents, LINK_RANGE, LINK_FACING, CONNECTED_EPS } from './geometry.js';

/* Serialization rounds positions and angles to 3 decimals, so a true
 * weld can sit ~0.1 cm apart after a save/share round-trip (measured on
 * real tracks). Connectivity tolerance is the shared CONNECTED_EPS
 * (owner cap: 1 cm absolute max) — comfortably above the observed
 * 0.095 cm rounding noise, far below any real gap. Tangent tolerance
 * likewise scales for rounding: 3-decimal angle error shows as ~0.1°
 * deltas. */
const KINK_TANGENT_TOL = 0.5;   /* deg — visible kinks, above rounding noise */

/* Same-level overlap (owner ledger — bbox tests false-positive on
 * weaves, so this tests the actual road corridors by containment:
 * straight kinds are the rectangle over the v1->v2 axis, arcs the
 * annular sector; centerline samples every ~5 cm). Two roads collide
 * when one's corridor contains a same-level sample of the other —
 * dz under CLEARANCE but at/above LEVEL_EPS stays the paint-rule
 * WARNING's domain (a ramp over a low road is never an impossible
 * overlap). Samples inside a shared joint's neighborhood are the
 * junction itself, not a collision. */
const OVERLAP_STEP = 5;      /* cm between centerline samples */
const TOUCH_SLACK = 1;       /* cm: exactly-touching corridors are legal */
const LEVEL_EPS = 20;        /* mm: below this the levels read as equal */
const JOINT_NEIGH = 16;      /* cm: junction-neighborhood exemption radius */

/* the TRUE road width: corner/hairpin carry band; waves wander inside
 * a taller footprint so their road is the lane width (3L=36, 5L=60),
 * not def.h. Both this AND the bbox early-out were needed to clear
 * the review fixture — the width alone leaves boundary-equality hits
 * (|u| == hw passes containment), the bbox alone would reinstate the
 * footprint overreach inside the window. The r1 pin rides a placement
 * INSIDE the window where def.h errors and lane-width is clean. */
function roadWidth(def) {
  if (def.band) return def.band;
  if (def.kind === 'wave') return def.lanes === 5 ? 60 : 36;
  return def.h;
}

/* centerline fraction t of point s inside piece p's corridor WIDENED
 * by the guest's half-width, or null. The widened corridor is what a
 * sample of the OTHER piece tests against (its centerline must sit
 * within hwA+hwB for the roads to share surface); ends are
 * endpoint-INCLUSIVE — a sample exactly on a host's end counts as on
 * it (welded ends are joint-exempt; an unwelded endpoint touch is
 * genuine contact), past the end does not (chained pieces and jump
 * gaps have close centerlines but disjoint surfaces). */
function corridorT(p, s, guestHw) {
  const def = PIECES[p.name];
  const hw = roadWidth(def) / 2 + guestHw - TOUCH_SLACK;
  if (def.kind === 'corner' || def.kind === 'hairpin') {
    const g = solveGeo(p.name);
    const { x: cx, y: cy } = rot(g.cx, g.cy, p.a || 0);
    const wx = p.x + cx, wy = p.y + cy;
    const rr = Math.hypot(s.x - wx, s.y - wy);
    if (Math.abs(rr - g.R) > hw) return null;
    const da = norm2pi(Math.atan2(s.y - wy, s.x - wx) - (g.a1 + rad(p.a || 0)));
    if (g.sweep >= 0 ? da > g.sweep + 1e-9 : da < 2 * Math.PI + g.sweep - 1e-9) return null;
    /* t in [0,1] for BOTH sweep signs: negative sweeps live in
     * [2pi+sweep, 2pi), where da/sweep would run negative */
    return g.sweep >= 0 ? da / g.sweep : (2 * Math.PI - da) / -g.sweep;
  }
  const a = vertexOf(p, 0), b = vertexOf(p, 1);
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const t = ((s.x - a.x) * dx + (s.y - a.y) * dy) / len;
  const u = ((s.x - a.x) * -dy + (s.y - a.y) * dx) / len;
  if (t < 0 || t > len || Math.abs(u) > hw) return null;
  return t / len;
}

function corridorSamples(p) {
  const def = PIECES[p.name];
  const z0 = levelAt(p, 0), z1 = levelAt(p, 1);
  const out = [];
  const push = (x, y, t) => out.push({ x, y, z: z0 + (z1 - z0) * t });
  if (def.kind === 'corner' || def.kind === 'hairpin') {
    const g = solveGeo(p.name);
    const steps = Math.max(2, Math.ceil(Math.abs(g.sweep) * g.R / OVERLAP_STEP));
    for (let k = 0; k <= steps; k += 1) {
      const t = k / steps, ang = g.a1 + g.sweep * t;
      const lx = g.cx + g.R * Math.cos(ang), ly = g.cy + g.R * Math.sin(ang);
      const { x: wx, y: wy } = rot(lx, ly, p.a || 0);
      push(p.x + wx, p.y + wy, t);
    }
  } else {
    const a = vertexOf(p, 0), b = vertexOf(p, 1);
    const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / OVERLAP_STEP));
    for (let k = 0; k <= steps; k += 1) {
      const t = k / steps;
      push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, t);
    }
  }
  return out;
}

function sameLevelOverlaps(sprites, groups) {
  const samples = sprites.map(corridorSamples);
  const zAt = (p, t) => levelAt(p, 0) + (levelAt(p, 1) - levelAt(p, 0)) * t;
  /* joint neighborhoods shared by BOTH pieces of a pair are exempt */
  const sharedJoints = new Map();
  for (const g of groups) {
    const idx = [...new Set(g.map((e) => e.i))];
    for (let a = 0; a < idx.length; a += 1)
      for (let b = a + 1; b < idx.length; b += 1) {
        const key = `${Math.min(idx[a], idx[b])}:${Math.max(idx[a], idx[b])}`;
        if (!sharedJoints.has(key)) sharedJoints.set(key, []);
        sharedJoints.get(key).push(g[0].v);
      }
  }
  const near = (s, pts) => pts.some((v) => Math.hypot(s.x - v.x, s.y - v.y) <= JOINT_NEIGH);
  const findings = [];
  for (let i = 0; i < sprites.length; i += 1) {
    const ei = pieceHalfExtents(sprites[i]);
    for (let j = i + 1; j < sprites.length; j += 1) {
      /* coarse reject: footprints that cannot touch cannot overlap —
       * the pair loop runs per settled mutation, keep far pairs free */
      const ej = pieceHalfExtents(sprites[j]);
      if (Math.abs(sprites[i].x - sprites[j].x) >= ei.hx + ej.hx ||
          Math.abs(sprites[i].y - sprites[j].y) >= ei.hy + ej.hy) continue;
      const joints = sharedJoints.get(`${i}:${j}`) || [];
      let hit = null;
      /* containment both ways — a thin crossing lens may hold samples
       * of only one side; dz compares the guest sample to the HOST's z
       * interpolated at the containment point (a ramp only collides
       * where it is actually low) */
      for (const [hostIdx, guestIdx] of [[j, i], [i, j]]) {
        const hostP = sprites[hostIdx], guestP = sprites[guestIdx];
        const guestHw = roadWidth(PIECES[guestP.name]) / 2;
        for (const s of samples[guestIdx]) {
          const t = corridorT(hostP, s, guestHw);
          if (t == null) continue;
          if (Math.abs(s.z - zAt(hostP, t)) >= LEVEL_EPS) continue;
          if (joints.length && near(s, joints)) continue;   /* the junction itself */
          hit = { x: s.x, y: s.y };
          break;
        }
        if (hit) break;
      }
      if (hit) findings.push(`Roads overlap at the same level near (${hit.x.toFixed(0)}, ${hit.y.toFixed(0)}) — a car cannot pass through another road`);
    }
  }
  return findings;
}

const face = (t, to) => 180 - Math.abs(((t - to + 540) % 360) - 180); /* 0..180, 180=aligned */

export function validateTrack(sprites) {
  const errors = [];
  const warnings = [];
  if (!sprites.length) return { ok: false, errors: ['Track is empty'], warnings };

  /* coincidence groups over all vertices */
  const points = [];
  sprites.forEach((p, i) => vertsOf(p).forEach((_, vi) => points.push({ i, vi, v: vertexOf(p, vi) })));
  const taken = new Array(points.length).fill(false);
  const groups = [];
  for (let a = 0; a < points.length; a++) {
    if (taken[a]) continue;
    taken[a] = true;
    const g = [points[a]];
    for (let b = a + 1; b < points.length; b++) {
      if (!taken[b] && Math.hypot(points[a].v.x - points[b].v.x, points[a].v.y - points[b].v.y) <= CONNECTED_EPS) {
        taken[b] = true;
        g.push(points[b]);
      }
    }
    groups.push(g);
  }

  /* dangling ends: singletons must pair as intentional jumps */
  const open = groups.filter((g) => g.length === 1).map((g) => g[0]);
  const linked = new Set();
  for (let m = 0; m < open.length; m++) {
    for (let n = m + 1; n < open.length; n++) {
      const A = open[m], B = open[n];
      if (sprites[A.i] === sprites[B.i]) continue;   /* same guard as openLinks: a piece cannot jump to itself */
      const d = Math.hypot(A.v.x - B.v.x, A.v.y - B.v.y);
      if (d > LINK_RANGE) continue;
      const toB = Math.atan2(B.v.y - A.v.y, B.v.x - A.v.x) * 180 / Math.PI;
      const toA = toB + 180;
      if (face(outwardTangent(sprites[A.i], A.vi), toB) >= 180 - LINK_FACING &&
          face(outwardTangent(sprites[B.i], B.vi), toA) >= 180 - LINK_FACING) {
        linked.add(m); linked.add(n);
      }
    }
  }
  open.forEach((o, idx) => {
    if (!linked.has(idx))
      errors.push(`Dangling end — ${PIECES[sprites[o.i].name].label} at (${o.v.x.toFixed(0)}, ${o.v.y.toFixed(0)}): weld it, or face it at a jump`);
  });

  /* kinked joints: every vertex in a coincidence group must have at least
   * one OTHER piece it pairs with tangentially (out -> in). All-pairs
   * would over-flag real junctions: two entries at one point both flow
   * away from the shared exit and are not connected to each other. */
  const kinkAt = new Set();
  for (const g of groups) {
    if (g.length < 2) continue;
    for (const x of g) {
      const aligned = g.some((y) => y !== x && sprites[y.i] !== sprites[x.i] &&
        Math.abs(((outwardTangent(sprites[x.i], x.vi) - inwardTangent(sprites[y.i], y.vi) + 540) % 360) - 180) <= KINK_TANGENT_TOL);
      if (!aligned) kinkAt.add(`(${x.v.x.toFixed(0)}, ${x.v.y.toFixed(0)})`);
    }
  }
  for (const at of kinkAt) errors.push(`Kinked joint at ${at} — a piece meets the joint at an angle`);

  /* clearance warnings: overlapping bboxes at different levels under 75 mm */
  for (let i = 0; i < sprites.length; i++) {
    for (let j = i + 1; j < sprites.length; j++) {
      const a = sprites[i], b = sprites[j];
      const za = a.z || 0, zb = b.z || 0;
      if (za === zb) continue;
      const [hi, lo] = za > zb ? [a, b] : [b, a];
      const ha = pieceHalfExtents(hi), lb = pieceHalfExtents(lo);
      if (Math.abs(hi.x - lo.x) >= ha.hx + lb.hx || Math.abs(hi.y - lo.y) >= ha.hy + lb.hy) continue;
      const dz = (hi.z || 0) - (lo.z || 0);
      if (dz < CLEARANCE_MM)
        warnings.push(`Clearance ${dz.toFixed(0)} mm < 75 mm over a ${PIECES[lo.name].label} at (${lo.x.toFixed(0)}, ${lo.y.toFixed(0)})`);
    }
  }

  errors.push(...sameLevelOverlaps(sprites, groups));

  return { ok: errors.length === 0, errors: [...new Set(errors)], warnings };
}
