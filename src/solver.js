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
  inwardTangent, outwardTangent, CONNECTED_EPS,
} from './geometry.js';

/* Per-family piece sets (owner ruling: straights + 45-degree corners only,
 * no lane changers). The family is keyed on the lane count of the two
 * selected end pieces — they must match. */
const FAMILY_SETS = {
  1: ['R1S250', 'R1C45I150'],
  2: ['R2S250', 'R2C45I150'],
  3: ['Str1', 'Cor1'],
  5: ['Str3', 'Str4', 'Str5', 'Str6', 'Cor2'],
};

export function solverSetFor(a, b) {
  const la = PIECES[a.name].lanes, lb = PIECES[b.name].lanes;
  if (la !== lb) return null;
  return FAMILY_SETS[la] || null;
}

/* Complete-tool endpoint contract (owner rules): straights (incl. the start
 * gate), corners, waves and lane changers — level-neutral or flat kinds.
 * Bridges/jumps/banks/hairpins are not supported ends yet. Each end piece
 * must have exactly one free vertex (unambiguous direction into the gap). */
const END_KINDS = new Set(['straight', 'start', 'corner', 'wave', 'changer']);

/* null when p is a valid completion end; otherwise why not. */
export function endPieceIssue(sprites, p) {
  if (!END_KINDS.has(PIECES[p.name].kind)) return 'kind';
  const open = openVerts(sprites, p);
  if (open.length === 1) return null;
  return open.length === 0 ? 'no-open' : 'multi-open';
}

const OPEN_EPS = CONNECTED_EPS; // cm — the shared connectivity threshold (owner cap)
const INSET = 1;          // cm adjacency margin (mirrors store.bboxOverlap)
/* Joint exemption width: the app's own chained welds drift ~0.01 cm per
 * piece (orientAngle/rot floats), so a hand-built ring's ends sit ~0.1 cm
 * apart — joints must be exempt at connection range, not at 1e-6, or every
 * long-chain closure reads as a collision with its own neighbor. */
const JOINT_WELD_EPS = OPEN_EPS;
/* A genuine joint also needs the travel directions to align through the
 * shared vertex — proximity alone would exempt real crossings (a run whose
 * end happens to land near another piece's end while the roads cross). */
const JOINT_TANGENT_EPS = 10; // deg
const GOAL_EPS = 0.5;     // cm — exact landing (float-drifted chains land ~0.1)
const TURN_EPS = 0.05;    // deg (refreshFlags tangent tolerance) — diagnostics only
const FLEX_TURN_EPS = 1.5; // deg — flex weld re-orients onto the target, so a
                           // small heading mismatch (catalog corners carry
                           // ~0.024 deg each) becomes a sub-cm kink, not a flaw
/* Flex welds are only acceptable when near-invisible: the weld anchors the
 * last piece onto the goal and dumps the whole remainder as a break at the
 * run's previous joint (owner: a 9 cm break reads as broken, not closed).
 * Larger offsets report honestly and offer step-back instead. */
const FLEX_WELD_MAX = 2; // cm
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
      if (Math.hypot(va.x - vb.x, va.y - vb.y) <= JOINT_WELD_EPS) {
        const flowAB = angDist(outwardTangent(a, dA.verts.indexOf(va)), inwardTangent(b, dB.verts.indexOf(vb)));
        const flowBA = angDist(outwardTangent(b, dB.verts.indexOf(vb)), inwardTangent(a, dA.verts.indexOf(va)));
        if (flowAB <= JOINT_TANGENT_EPS || flowBA <= JOINT_TANGENT_EPS) return false; /* joint */
      }
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

/* Returns the piece that blocks this placement, or null when clear. */
function collideAny(data, obstacles, ancestor) {
  for (const ob of obstacles) if (collideData(data, ob)) return ob.p;
  for (let node = ancestor; node; node = node.parent) {
    if (node.data && collideData(data, node.data)) return node.piece; /* root has none */
  }
  return null;
}

/* One A* run from (start,h0,z0) to (goal,hGoal,zGoal). Updates ctx
 * { exact, flex, missD, missDh } — returns nothing. */
function astar(start, h0, z0, goal, hGoal, zGoal, vb, obstacles, trans, opts, ctx) {
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
    /* An aligned near-miss within snap range settles the diagnostic: the
     * ends are out of line by miss.d. A* pops by f, so any exact/flex
     * closure (small f) has long since popped; stop after a safety headroom
     * instead of flooding the whole detour budget (also keeps this return
     * path out of the truncated flag below). */
    if (ctx.missD <= SNAP_RADIUS && ctx.missDh <= 5 && !ctx.missAt) ctx.missAt = expansions;
    if (ctx.missAt && expansions > ctx.missAt + 5000) return;
    if (node.z === zGoal && dh <= FLEX_TURN_EPS) {
      if (d <= GOAL_EPS) { ctx.exact = node; ctx.goal = goal; ctx.goalVb = vb; return; } /* first pop = optimal */
      if (d <= FLEX_WELD_MAX) {
        const key = node.g + 0.001 * d;
        if (!ctx.flex || key < ctx.flexCost) { ctx.flex = node; ctx.flexCost = key; ctx.flexGoal = goal; ctx.flexVb = vb; }
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
      const nh = norm360(a + t.lout);
      const nz = node.z - t.zi + t.zj;
      const g2 = node.g + t.l;
      const f2 = g2 + Math.hypot(goal.x - nx, goal.y - ny) / 100;
      if (f2 > opts.maxCost) continue; /* beyond the detour budget */
      const data = collisionData(piece);
      const hit = collideAny(data, obstacles, node);
      if (hit) {
        /* a would-be closing placement that existing track rejects: the
         * geometry works, something is in the way — remember the culprit */
        if (nz === zGoal && Math.hypot(goal.x - nx, goal.y - ny) <= SNAP_RADIUS
            && angDist(nh, hGoal) <= FLEX_TURN_EPS) ctx.blocker = ctx.blocker || hit;
        continue;
      }
      const child = { x: nx, y: ny, h: nh, z: nz,
        g: g2, n: node.n + 1, ser: ser++, f: f2, parent: node, piece, data };
      push(child);
    }
  }
  ctx.truncated = ctx.truncated || open.size > 0; /* frontier left unexplored */
}

function chainOf(node) {
  const out = [];
  for (let n = node; n && n.piece; n = n.parent) out.unshift(n.piece);
  return out;
}

/* Rotate + translate the run's last piece so its arrival vertex sits exactly
 * on b's vertex vb with tangents aligned (the weld snapPiece applies, but
 * aimed at the chosen goal — snapPiece itself would re-weld the run's own
 * internal joint on short paths). The run's previous joint absorbs the
 * remainder: sub-mm for exact landings, the reported bend for flex. */
function weldToEnd(piece, b, vb) {
  const goal = vertexOf(b, vb);
  let j = 0, best = Infinity;
  for (let i = 0; i < vertsOf(piece).length; i++) {
    const v = vertexOf(piece, i);
    const dd = Math.hypot(v.x - goal.x, v.y - goal.y);
    if (dd < best) { best = dd; j = i; }
  }
  const tmpl = { name: piece.name, x: 0, y: 0, a: 0, c: 0, z: 0 };
  piece.a = norm360(inwardTangent(b, vb) - outwardTangent(tmpl, j));
  const v = vertexOf(piece, j);
  piece.x += goal.x - v.x;
  piece.y += goal.y - v.y;
  piece.z = levelAt(b, vb) - (vertsOf(piece)[j][2] || 0);
}

const lengthOf = (pieces) => pieces.reduce((m, p) => m + PIECES[p.name].l, 0);

/* ---------- entry point ---------- */

export function closeLoop(sprites, a, b, opts = {}) {
  const allowed = opts.set || solverSetFor(a, b);
  if (!allowed) return { ok: false, reason: 'lane-mismatch' };
  const searchOpts = { maxDepth: opts.maxDepth ?? 40, maxExpansions: opts.maxExpansions ?? 25000 };

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
  const ctx = { exact: null, flex: null, flexCost: 0, missD: Infinity, missDh: 0, blocker: null, truncated: false };
  let allLevelMiss = combos.length > 0;
  let levels = null;
  for (const c of combos) {
    const z0 = levelAt(a, c.va), zGoal = levelAt(b, c.vb);
    if (z0 !== zGoal && !canZ) { levels = [z0, zGoal]; continue; } /* flat set */
    allLevelMiss = false;
    if (ctx.exact && c.d / 100 >= ctx.exact.g) continue; /* cannot beat it */
    /* detour budget: crow flight + slack + the net turn the ends demand
     * (perpendicular ends need an out-and-back loop even when they touch —
     * ~2 corners + repositioning per 45 deg, overridable) */
    const turn = Math.ceil(angDist(outwardTangent(a, c.va), inwardTangent(b, c.vb)) / 45);
    const per = { ...searchOpts, maxCost: opts.maxCost ?? 18 + (8 * c.d) / 100 + 2.5 * turn, budget };
    astar(vertexOf(a, c.va), outwardTangent(a, c.va), z0,
      vertexOf(b, c.vb), inwardTangent(b, c.vb), zGoal, c.vb,
      obstacles, trans, per, ctx);
    if (ctx.exact || budget.left <= 0) break;
  }

  if (ctx.exact) {
    const pieces = chainOf(ctx.exact);
    weldToEnd(pieces[pieces.length - 1], b, ctx.goalVb);
    return { ok: true, pieces, cost: ctx.exact.g, length: lengthOf(pieces), flex: false };
  }
  if (ctx.flex) {
    const pieces = chainOf(ctx.flex);
    const gap = Math.hypot(ctx.flex.x - ctx.flexGoal.x, ctx.flex.y - ctx.flexGoal.y);
    weldToEnd(pieces[pieces.length - 1], b, ctx.flexVb);
    return { ok: true, pieces, cost: ctx.flex.g, length: lengthOf(pieces), flex: true, gap };
  }
  if (allLevelMiss) return { ok: false, reason: 'level', levels };
  /* classify the miss so the toast can tell the owner what to do. The
   * selected ends never count as blockers: a near-goal approach colliding
   * with the target itself is misalignment (off-grid), not obstruction. */
  const miss = { d: ctx.missD, dh: ctx.missDh };
  const blocker = ctx.blocker && ctx.blocker !== a && ctx.blocker !== b ? ctx.blocker : null;
  const why = blocker ? 'blocked'
    : ctx.truncated ? 'limit' /* half-explored: any miss guess would be a lie */
    : miss.dh > 5 ? 'facing'
    : 'off-grid';
  return { ok: false, reason: 'no-path', why, miss, blocker };
}

/* ---------- step-back: remove pieces until a closure exists ---------- */

function neighborAt(sprites, p, vi) {
  const v = vertexOf(p, vi);
  let best = null, bd = OPEN_EPS;
  for (const q of sprites) {
    if (q === p) continue;
    for (let j = 0; j < vertsOf(q).length; j++) {
      const w = vertexOf(q, j);
      const d = Math.hypot(v.x - w.x, v.y - w.y);
      if (d <= bd) { bd = d; best = q; }
    }
  }
  return best;
}

/* The piece behind end piece p in its chain: its single open vertex faces
 * the gap, step through the other one. Guarded against walking through the
 * near-touching gap joint into the other selected end. */
function chainBack(sprites, p, other) {
  const open = [];
  for (let i = 0; i < vertsOf(p).length; i++) if (!neighborAt(sprites, p, i)) open.push(i);
  if (open.length !== 1) return null; /* isolated or not an end */
  const back = vertsOf(p).length - 1 - open[0];
  const pred = neighborAt(sprites, p, back);
  return pred && pred !== other ? pred : null;
}

/* Close the loop, removing as few pieces as possible until it works:
 * first named blockers one at a time, then stepping each selected end back
 * through its chain (removing a corner also flips the end heading — the
 * cure for "facing" gaps). Returns the removals plus the closing run. */
export function closeLoopStepping(sprites, a, b, opts = {}) {
  const maxSteps = opts.maxSteps ?? 4;

  /* 1. remove the named blocker(s), retrying after each */
  {
    const removed = [];
    let scene = sprites;
    for (let i = 0; i <= maxSteps; i++) {
      const r = closeLoop(scene, a, b, opts);
      if (r.ok) return { ok: true, removed, closed: r };
      if (r.reason !== 'no-path' || !r.blocker || r.blocker === a || r.blocker === b) break;
      removed.push(r.blocker);
      scene = scene.filter((p) => p !== r.blocker);
    }
  }

  /* 2. step each end chain back (independent of any blocker removals) */
  for (const end of [a, b]) {
    const other = end === a ? b : a;
    const removed = [];
    let scene = sprites;
    let cur = end;
    for (let k = 0; k < maxSteps; k++) {
      const pred = chainBack(scene, cur, other);
      if (!pred) break;
      removed.push(cur);
      scene = scene.filter((p) => p !== cur);
      cur = pred;
      const r = closeLoop(scene, cur, other, opts);
      if (r.ok) return { ok: true, removed, closed: r };
    }
  }
  return { ok: false, reason: 'no-path' };
}
