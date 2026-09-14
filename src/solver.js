/* Loop solver — "close the loop" router. Given two pieces and their free
 * ends, finds the minimal-length run of catalog pieces that connects them,
 * respecting elevation and avoiding every placed piece. Pure module: no DOM,
 * no store. Search: A* over (x, y, heading, level) states; transitions are
 * the allowed pieces traversed in either vertex order (a corner entered
 * backwards turns the opposite way). Joints are exact by construction —
 * pieces land on the same lattice snapPiece welds with, so a solution for a
 * snapped track always exists (the track itself realizes the displacement).
 *
 * Collision model: roads, not footprints — straights are their exact OBB
 * footprint; corner/hairpin roads are the arc centerline (sampled ~15 deg)
 * inflated by band/2. Pieces sharing a connection vertex are exempt (they
 * are joints, like store.refreshFlags treats coincidence). Plan overlap at
 * a level gap >= CLEARANCE_MM is a bridge, not a clash. */

import { PIECES, CLEARANCE_MM, SNAP_RADIUS } from './pieces.js';
import {
  rad, rot, solveGeo, vertsOf, vertexOf, levelAt,
  inwardTangent, outwardTangent, snapPiece,
} from './geometry.js';

export const SOLVER_SET = ['Str1', 'Cor1', 'Lan1'];

const OPEN_EPS = 2;       // cm — a vertex with another this close is connected
const JOINT_EPS = 1e-6;   // exact vertex coincidence (store.refreshFlags value)
const INSET = 1;          // cm adjacency margin (mirrors store.bboxOverlap)
const GOAL_EPS = 0.01;    // cm — exact-lattice landing tolerance
const TURN_EPS = 0.05;    // deg (refreshFlags tangent tolerance)
const FLEX_SLACK = 0.05;  // m — A* may keep searching past a flex find by this

const norm360 = (deg) => ((deg % 360) + 360) % 360;
const angDist = (a, b) => { const d = Math.abs(norm360(a - b)); return Math.min(d, 360 - d); };

/* ---------- road models ---------- */

function roadOf(p) {
  const def = PIECES[p.name];
  if (def.kind === 'corner' || def.kind === 'hairpin') {
    const g = solveGeo(p.name);
    const n = Math.max(2, Math.ceil(Math.abs(g.sweep) / rad(15)));
    const pts = [];
    for (let k = 0; k <= n; k++) {
      const ang = g.a1 + (g.sweep * k) / n;
      const lp = rot(g.cx + g.R * Math.cos(ang), g.cy + g.R * Math.sin(ang), p.a);
      pts.push({ x: p.x + lp.x, y: p.y + lp.y });
    }
    return { arc: true, pts, r: def.band / 2 };
  }
  return { arc: false, hx: def.w / 2, hy: def.h / 2 };
}

function zRangeOf(p) {
  let lo = p.z || 0, hi = p.z || 0;
  for (const v of vertsOf(p)) {
    const z = (p.z || 0) + (v[2] || 0);
    if (z < lo) lo = z;
    if (z > hi) hi = z;
  }
  return [lo, hi];
}

/* ---------- segment / rect distance primitives ---------- */

function segSegDist(p1, p2, q1, q2) {
  const dx1 = p2.x - p1.x, dy1 = p2.y - p1.y;
  const dx2 = q2.x - q1.x, dy2 = q2.y - q1.y;
  const den = dx1 * dy2 - dy1 * dx2;
  const ex = q1.x - p1.x, ey = q1.y - p1.y;
  if (Math.abs(den) > 1e-12) {
    const t = (ex * dy2 - ey * dx2) / den;
    const u = (ex * dy1 - ey * dx1) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  const d = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const clampT = (px, py, ax, ay, bx, by) => {
    const vx = bx - ax, vy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1e-12)));
    return d(px, py, ax + t * vx, ay + t * vy);
  };
  return Math.min(
    clampT(p1.x, p1.y, q1.x, q1.y, q2.x, q2.y),
    clampT(p2.x, p2.y, q1.x, q1.y, q2.x, q2.y),
    clampT(q1.x, q1.y, p1.x, p1.y, p2.x, p2.y),
    clampT(q2.x, q2.y, p1.x, p1.y, p2.x, p2.y),
  );
}

/* Distance from a segment to a piece's OBB footprint (0 when crossing). */
function segPieceDist(p1, p2, p, road) {
  const c = Math.cos(rad(road.a ?? p.a)), s = Math.sin(rad(road.a ?? p.a));
  const to = (q) => {
    const dx = q.x - p.x, dy = q.y - p.y;
    return { x: dx * c + dy * s, y: -dx * s + dy * c };
  };
  const a = to(p1), b = to(p2);
  const hx = road.hx, hy = road.hy;
  const inside = (q) => Math.abs(q.x) <= hx && Math.abs(q.y) <= hy;
  if (inside(a) || inside(b)) return 0;
  let best = Infinity;
  const corners = [{ x: -hx, y: -hy }, { x: hx, y: -hy }, { x: hx, y: hy }, { x: -hx, y: hy }];
  for (let i = 0; i < 4; i++) {
    const d = segSegDist(a, b, corners[i], corners[(i + 1) % 4]);
    if (d < best) best = d;
  }
  return best;
}

function obbSeparated(a, ra, b, rb) {
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const deg of [a.a, a.a + 90, b.a, b.a + 90]) {
    const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
    const d = Math.abs(dx * c + dy * s);
    const ca = Math.abs(Math.cos(rad(deg - a.a))), sa = Math.abs(Math.sin(rad(deg - a.a)));
    const cb = Math.abs(Math.cos(rad(deg - b.a))), sb = Math.abs(Math.sin(rad(deg - b.a)));
    if (d >= ra.hx * ca + ra.hy * sa + rb.hx * cb + rb.hy * sb - INSET) return true;
  }
  return false;
}

/* ---------- collision data (cached per piece for the search loop) ---------- */

function vertsOfWorld(p) {
  return vertsOf(p).map((v) => {
    const r = rot(v[0], v[1], p.a);
    return { x: p.x + r.x, y: p.y + r.y };
  });
}

function collisionData(p) {
  const road = roadOf(p);
  let reach;
  if (road.arc) {
    reach = road.r;
    for (const q of road.pts) reach = Math.max(reach, Math.hypot(q.x - p.x, q.y - p.y) + road.r);
  } else reach = Math.hypot(road.hx, road.hy);
  return { p, road, zr: zRangeOf(p), verts: vertsOfWorld(p), reach };
}

/* ---------- piece-level collision (piecesCollide is exported for tests) ---------- */

function collideData(dA, dB) {
  const a = dA.p, b = dB.p;
  if (Math.hypot(b.x - a.x, b.y - a.y) >= dA.reach + dB.reach - INSET) return false;
  if (Math.max(dA.zr[0] - dB.zr[1], dB.zr[0] - dA.zr[1]) >= CLEARANCE_MM) return false; /* bridge */
  for (const va of dA.verts) {
    for (const vb of dB.verts) {
      if (Math.hypot(va.x - vb.x, va.y - vb.y) <= JOINT_EPS) return false; /* joint */
    }
  }
  const ra = dA.road, rb = dB.road;
  if (!ra.arc && !rb.arc) return !obbSeparated(a, ra, b, rb);
  if (ra.arc && rb.arc) {
    for (let i = 0; i + 1 < ra.pts.length; i++) {
      for (let j = 0; j + 1 < rb.pts.length; j++) {
        if (segSegDist(ra.pts[i], ra.pts[i + 1], rb.pts[j], rb.pts[j + 1]) < ra.r + rb.r - INSET) return true;
      }
    }
    return false;
  }
  const arc = ra.arc ? ra : rb, box = ra.arc ? rb : ra, boxP = ra.arc ? b : a;
  for (let i = 0; i + 1 < arc.pts.length; i++) {
    if (segPieceDist(arc.pts[i], arc.pts[i + 1], boxP, box) < arc.r - INSET) return true;
  }
  return false;
}

export function piecesCollide(a, b) {
  return collideData(collisionData(a), collisionData(b));
}

/* ---------- A* search ---------- */

function buildTransitions(allowed) {
  const ts = [];
  for (const name of allowed) {
    const def = PIECES[name];
    const last = def.verts.length - 1;
    for (const [gi, gj] of [[0, last], [last, 0]]) {
      const tmpl = { name, x: 0, y: 0, a: 0, c: 0, z: 0 };
      ts.push({
        name, gi, gj, l: def.l,
        lin: inwardTangent(tmpl, gi),   /* local tangent (deg) entering at gi */
        lout: outwardTangent(tmpl, gj), /* local tangent (deg) leaving at gj */
        xi: def.verts[gi][0], yi: def.verts[gi][1],
        dx: def.verts[gj][0] - def.verts[gi][0],
        dy: def.verts[gj][1] - def.verts[gi][1],
        zi: def.verts[gi][2] || 0,
        zj: def.verts[gj][2] || 0,
      });
    }
  }
  return ts;
}

const less = (u, v) => u.f < v.f || (u.f === v.f && (u.n < v.n || (u.n === v.n && u.ser < v.ser)));

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(node) {
    this.a.push(node);
    let i = this.a.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (less(this.a[i], this.a[par])) { [this.a[i], this.a[par]] = [this.a[par], this.a[i]]; i = par; }
      else break;
    }
  }
  pop() {
    const top = this.a[0], lastEl = this.a.pop();
    if (this.a.length) {
      this.a[0] = lastEl;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.a.length && less(this.a[l], this.a[m])) m = l;
        if (r < this.a.length && less(this.a[r], this.a[m])) m = r;
        if (m === i) break;
        [this.a[i], this.a[m]] = [this.a[m], this.a[i]];
        i = m;
      }
    }
    return top;
  }
}

function openVerts(sprites, p) {
  const out = [];
  for (let i = 0; i < vertsOf(p).length; i++) {
    const v = vertexOf(p, i);
    let open = true;
    for (const q of sprites) {
      if (q === p) continue;
      for (let j = 0; j < vertsOf(q).length; j++) {
        const w = vertexOf(q, j);
        if (Math.hypot(v.x - w.x, v.y - w.y) <= OPEN_EPS) { open = false; break; }
      }
      if (!open) break;
    }
    if (open) out.push(i);
  }
  return out;
}

function collideAny(data, obstacles, ancestor) {
  for (const ob of obstacles) if (collideData(data, ob)) return true;
  for (let node = ancestor; node; node = node.parent) {
    if (node.data && collideData(data, node.data)) return true; /* root has none */
  }
  return false;
}

/* One A* run from (start,h0,z0) to (goal,hGoal,zGoal). Updates ctx
 * { exact, flex, missD, missDh } — returns nothing. */
function astar(start, h0, z0, goal, hGoal, zGoal, obstacles, trans, opts, ctx) {
  const seen = new Map();
  const open = new Heap();
  let ser = 0, expansions = 0;

  const push = (node) => {
    const key = `${Math.round(node.x * 20)},${Math.round(node.y * 20)},${Math.round(node.h * 10)},${node.z}`;
    const prev = seen.get(key);
    if (prev !== undefined && prev <= node.g + 1e-9) return;
    seen.set(key, node.g);
    open.push(node);
  };

  push({ x: start.x, y: start.y, h: h0, z: z0, g: 0, n: 0, ser: ser++,
    f: Math.hypot(goal.x - start.x, goal.y - start.y) / 100, parent: null, data: null });

  while (open.size && expansions < opts.maxExpansions && opts.budget.left > 0) {
    const node = open.pop();
    expansions++;
    opts.budget.left--;

    const d = Math.hypot(node.x - goal.x, node.y - goal.y);
    const dh = angDist(node.h, hGoal);
    if (node.z === zGoal && d + 0.2 * dh < ctx.missD + 0.2 * ctx.missDh) { ctx.missD = d; ctx.missDh = dh; }
    if (node.z === zGoal && dh <= TURN_EPS) {
      if (d <= GOAL_EPS) { ctx.exact = node; return; } /* first pop = optimal */
      if (d <= SNAP_RADIUS) {
        const key = node.g + 0.001 * d;
        if (!ctx.flex || key < ctx.flexCost) { ctx.flex = node; ctx.flexCost = key; ctx.flexGoal = goal; }
      }
    }
    if (ctx.flex && node.f > ctx.flexCost + FLEX_SLACK) return; /* nothing better remains */

    if (node.n >= opts.maxDepth) continue;
    for (const t of trans) {
      const a = norm360(node.h - t.lin);
      const off = rot(t.xi, t.yi, a);
      const piece = { name: t.name, x: node.x - off.x, y: node.y - off.y, a, c: 0, z: node.z - t.zi };
      const disp = rot(t.dx, t.dy, a);
      const nx = node.x + disp.x, ny = node.y + disp.y;
      const g2 = node.g + t.l;
      const f2 = g2 + Math.hypot(goal.x - nx, goal.y - ny) / 100;
      if (f2 > opts.maxCost) continue; /* beyond the detour budget */
      const data = collisionData(piece);
      if (collideAny(data, obstacles, node)) continue;
      const child = { x: nx, y: ny, h: norm360(a + t.lout), z: node.z - t.zi + t.zj,
        g: g2, n: node.n + 1, ser: ser++, f: f2, parent: node, piece, data };
      push(child);
    }
  }
}

function chainOf(node) {
  const out = [];
  for (let n = node; n && n.piece; n = n.parent) out.unshift(n.piece);
  return out;
}

const lengthOf = (pieces) => pieces.reduce((m, p) => m + PIECES[p.name].l, 0);

/* ---------- entry point ---------- */

export function closeLoop(sprites, a, b, opts = {}) {
  const allowed = opts.set || SOLVER_SET;
  const searchOpts = { maxDepth: opts.maxDepth ?? 40, maxExpansions: opts.maxExpansions ?? 20000 };

  const openA = openVerts(sprites, a), openB = openVerts(sprites, b);
  if (!openA.length || !openB.length) return { ok: false, reason: 'no-open' };

  const obstacles = sprites.map(collisionData);
  const trans = buildTransitions(allowed);
  const canZ = allowed.some((n) => PIECES[n].verts.some((v) => v[2]));

  const combos = [];
  for (const va of openA) {
    for (const vb of openB) {
      const p = vertexOf(a, va), q = vertexOf(b, vb);
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d > 1) combos.push({ va, vb, d });
    }
  }
  combos.sort((u, v) => u.d - v.d);

  /* shared expansion budget: total worst case stays bounded */
  const budget = { left: searchOpts.maxExpansions * Math.max(1, combos.length) };
  const ctx = { exact: null, flex: null, flexCost: 0, missD: Infinity, missDh: 0 };
  let allLevelMiss = combos.length > 0;
  for (const c of combos) {
    const z0 = levelAt(a, c.va), zGoal = levelAt(b, c.vb);
    if (z0 !== zGoal && !canZ) continue; /* flat set cannot change level */
    allLevelMiss = false;
    if (ctx.exact && c.d / 100 >= ctx.exact.g) continue; /* cannot beat it */
    /* detour budget: 8x the crow flight + 10 m slack (overridable) */
    const per = { ...searchOpts, maxCost: opts.maxCost ?? 10 + (8 * c.d) / 100, budget };
    astar(vertexOf(a, c.va), outwardTangent(a, c.va), z0,
      vertexOf(b, c.vb), inwardTangent(b, c.vb), zGoal,
      obstacles, trans, per, ctx);
    if (ctx.exact || budget.left <= 0) break;
  }

  if (ctx.exact) {
    const pieces = chainOf(ctx.exact);
    return { ok: true, pieces, cost: ctx.exact.g, length: lengthOf(pieces), flex: false };
  }
  if (ctx.flex) {
    const pieces = chainOf(ctx.flex);
    const gap = Math.hypot(ctx.flex.x - ctx.flexGoal.x, ctx.flex.y - ctx.flexGoal.y);
    /* weld the last piece onto B exactly (app snap semantics: the previous
     * joint absorbs the off-grid remainder) */
    const last = pieces[pieces.length - 1];
    const prev = pieces[pieces.length - 2];
    const cands = sprites.concat(pieces.slice(0, -1)).filter((p) => p !== prev);
    snapPiece(last, cands);
    return { ok: true, pieces, cost: ctx.flex.g, length: lengthOf(pieces), flex: true, gap };
  }
  if (allLevelMiss) return { ok: false, reason: 'level' };
  return { ok: false, reason: 'no-path', miss: { d: ctx.missD, dh: ctx.missDh } };
}
