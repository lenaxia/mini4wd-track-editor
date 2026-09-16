/* Track validator — gates publish/save (owner rule: a published track is
 * complete and consistent). Pure: sprites in, findings out.
 *
 *   errors  (block publishing)
 *     - empty track
 *     - dangling end: a vertex coincident with no other piece's vertex AND
 *       not facing another open end as an intentional jump (same range/
 *       facing thresholds as geometry.openLinks)
 *     - kinked joint: coincident vertices whose tangents mismatch (same
 *       0.05° tolerance the canvas flags as _bad)
 *   warnings (allowed, shown)
 *     - crossover clearance < 75 mm (the paint-rule check; bridges and
 *       jumps are legitimate design)
 *   permitted, no finding
 *     - junctions: 3+ vertices at one point (Y-junctions are a planned
 *       piece family — the validator must not become their enemy)
 */

import { PIECES, CLEARANCE_MM } from './pieces.js';
import { vertsOf, vertexOf, outwardTangent, inwardTangent, pieceHalfExtents, LINK_RANGE, LINK_FACING } from './geometry.js';

const JOINT_EPS = 1e-6;   /* same weld tolerance as the store's flags */

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
      if (!taken[b] && Math.hypot(points[a].v.x - points[b].v.x, points[a].v.y - points[b].v.y) <= JOINT_EPS) {
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
      const d = Math.hypot(A.v.x - B.v.x, A.v.y - B.v.y);
      if (d > LINK_RANGE || d < 1e-6) continue;
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
        Math.abs(((outwardTangent(sprites[x.i], x.vi) - inwardTangent(sprites[y.i], y.vi) + 540) % 360) - 180) <= 0.05);
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

  return { ok: errors.length === 0, errors: [...new Set(errors)], warnings };
}
