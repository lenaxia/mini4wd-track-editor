import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PIECES, SNAP_RADIUS } from '../../src/pieces.js';
import {
  rot, rad, solveGeo, centerOf, vertexOf, levelAt, vertsOf,
  outwardTangent, inwardTangent, orientAngle, topPieceAt,
  snapPiece, groupSnap, externalJoint, worldFromScreen, clampScale, computeFit, pieceHalfExtents,
} from '../../src/geometry.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const mk = (name, x, y, a = 0, z = 0) => ({ name, x, y, a, c: 0, z });

test('rot rotates basis vectors correctly', () => {
  const r = rot(1, 0, 90);
  assert.ok(near(r.x, 0, 1e-12) && near(r.y, 1, 1e-12));
  const r45 = rot(1, 0, 45);
  assert.ok(near(r45.x, Math.SQRT1_2, 1e-12) && near(r45.y, Math.SQRT1_2, 1e-12));
  assert.deepEqual(rot(3, 4, 0), { x: 3, y: 4 });
});

test('vertexOf maps local vertices through position + rotation (0-based)', () => {
  const p = mk('Str1', 100, 100);
  assert.deepEqual(vertexOf(p, 0), { x: 73, y: 100 });
  assert.deepEqual(vertexOf(p, 1), { x: 127, y: 100 });
  const q = mk('Str1', 100, 100, 90);
  const v0 = vertexOf(q, 0), v1 = vertexOf(q, 1);
  assert.ok(near(v0.x, 100, 1e-9) && near(v0.y, 73, 1e-9));
  assert.ok(near(v1.x, 100, 1e-9) && near(v1.y, 127, 1e-9));
});

test('levelAt = serialized level + per-vertex zOff', () => {
  const s = mk('Bri1', 100, 100, 0, 40); /* slope: verts[1].zOff = 75 */
  assert.equal(levelAt(s, 0), 40);
  assert.equal(levelAt(s, 1), 115);
  assert.equal(levelAt(mk('Str1', 0, 0, 0, 75), 1), 75); /* flat piece: same */
});

test('centerOf honors the piece center offset (Cor1)', () => {
  const c = centerOf(mk('Cor1', 0, 0));
  assert.ok(near(c.x, -5, 1e-9) && near(c.y, -3.5, 1e-9));
});

/* ---------- tangents (docs/design §1) ---------- */

test('straight tangents: in0 == out1 == axis; far ends are +180', () => {
  const p = mk('Str1', 0, 0, 0);
  assert.ok(near(inwardTangent(p, 0), 0));
  assert.ok(near(outwardTangent(p, 1), 0));
  assert.ok(near(outwardTangent(p, 0), 180));
  assert.ok(near(inwardTangent(p, 1), 180));
});

const wrap = (deg) => ((deg + 540) % 360) - 180;

test('corner tangents turn by the catalog sweep (45 deg for Cor1)', () => {
  const p = mk('Cor1', 0, 0, 0);
  assert.ok(near(Math.abs(wrap(outwardTangent(p, 1) - inwardTangent(p, 0))), 45, 0.05));
});

test('hairpin tangents are anti-parallel (180 deg turn)', () => {
  const p = mk('Lan2', 0, 0, 0);
  assert.ok(near(Math.abs(wrap(outwardTangent(p, 1) - inwardTangent(p, 0))), 180, 0.05));
});

test('reversed traversal flips the effective turn direction (chirality)', () => {
  /* entering Cor1 at vertex 1 traverses the same arc backwards -> -45 */
  const p = mk('Cor1', 0, 0, 0);
  const fwd = outwardTangent(p, 1) - inwardTangent(p, 0);
  const rev = outwardTangent(p, 0) - inwardTangent(p, 1);
  assert.ok(near(wrap(fwd) + wrap(rev), 0, 0.05));
});

test('orientAngle chains a straight onto a corner exit at +45', () => {
  const s = mk('Cor1', 100, 100, 0);
  const g = mk('Str1', 0, 0, 10);
  const a = orientAngle(s, 1, g, 0);
  assert.ok(near(a, 45, 0.05));
});

test('orientAngle chains a straight onto a straight at 90 -> 90', () => {
  const s = mk('Str1', 0, 0, 90);
  const g = mk('Str1', 0, 0, 200);
  assert.ok(near(orientAngle(s, 1, g, 0), 90, 0.05));
});

/* ---------- snapPiece: closest pair + orient + level adoption ---------- */

test('snapPiece connects exactly, orients, and stays for aligned straights', () => {
  const placed = mk('Str1', 100, 100);
  const ghost = { name: 'Str1', x: 150, y: 103, a: 0, c: 0, z: 0 };
  assert.equal(snapPiece(ghost, [placed]), true);
  assert.equal(ghost.a, 0);
  assert.equal(ghost.x, 154);
  assert.equal(ghost.z, 0);
  assert.deepEqual(vertexOf(ghost, 0), vertexOf(placed, 1));
});

test('snapPiece auto-orients a straight onto a corner exit (a=45, exact vertex)', () => {
  const cor = mk('Cor1', 100, 100, 0); /* v2 world = (112.2, 107.8) */
  const ghost = { name: 'Str1', x: 135, y: 106, a: 0, c: 0, z: 0 }; /* v1 ~4.6 away */
  assert.equal(snapPiece(ghost, [cor]), true);
  assert.ok(near(ghost.a, 45, 0.05));
  const v = vertexOf(ghost, 0), t = vertexOf(cor, 1);
  assert.ok(Math.hypot(v.x - t.x, v.y - t.y) < 1e-9);
});

test('snapPiece adopts the neighbor level at the joint (slope chaining)', () => {
  const slope = mk('Bri1', 100, 100, 0, 0); /* v2 level = 75 */
  const ghost = { name: 'Str1', x: 155, y: 103, a: 0, c: 0, z: 0 };
  assert.equal(snapPiece(ghost, [slope]), true);
  assert.equal(ghost.z, 75);
});

test('snapPiece chained onto a slope top gives the next piece +75 level', () => {
  const slope = mk('Bri1', 100, 100, 0, 0);
  const top = { name: 'Str1', x: 154, y: 100, a: 0, c: 0, z: 75 };
  const ghost = { name: 'Str1', x: 208, y: 103, a: 0, c: 0, z: 0 };
  assert.equal(snapPiece(ghost, [slope, top]), true);
  assert.equal(ghost.z, 75);
  assert.equal(ghost.x, 208);
});

test('snapPiece reversed entry onto a slope top lands at level 0 (descends)', () => {
  /* ghost's v1 snapping to the slope's v2 means travel exits the slope there:
     adoption uses the level at that joint (75) minus the ghost's own v-entry
     offset — a flat ghost entering at its v1 lands at 75. Reversed slope
     traversal is expressed by entering the slope at its v1 from level-75
     track: */
  const slope = mk('Bri1', 100, 100, 0, 75); /* placed at top level */
  const ghost = { name: 'Str1', x: 45, y: 103, a: 0, c: 0, z: 0 };
  assert.equal(snapPiece(ghost, [slope]), true); /* snaps to slope v1 (level 75) */
  assert.equal(ghost.z, 75);
  assert.equal(levelAt(slope, 1), 150); /* continuing up would need another rise */
});

test('snapPiece applies only the closest vertex pair (single displacement)', () => {
  const a = mk('Str1', 146, 100);  /* v1 = 173,100 */
  const b = mk('Str1', 246, 100);  /* v1 = 219,100 */
  const ghost = { name: 'Str1', x: 200, y: 100, a: 0, c: 0, z: 0 };
  assert.equal(snapPiece(ghost, [a, b]), true);
  assert.equal(ghost.x, 200);
  assert.deepEqual(vertexOf(ghost, 0), vertexOf(a, 1));
});

test('snapPiece resolves equidistant pairs deterministically (array order)', () => {
  const a = mk('Str1', 152, 100); /* v2=179 vs ghost v1=173: d=6 */
  const b = mk('Str1', 260, 100); /* v1=233 vs ghost v2=227: d=6 */
  const ghost = { name: 'Str1', x: 200, y: 100, a: 0, c: 0, z: 0 };
  assert.equal(snapPiece(ghost, [a, b]), true);
  assert.equal(ghost.x, 206);
  assert.deepEqual(vertexOf(ghost, 0), vertexOf(a, 1));
});

test('snapPiece leaves far pieces untouched', () => {
  const ghost = { name: 'Str1', x: 300, y: 300, a: 0, c: 0, z: 0 };
  assert.equal(snapPiece(ghost, [mk('Str1', 100, 100)]), false);
  assert.deepEqual({ x: ghost.x, y: ghost.y, a: ghost.a }, { x: 300, y: 300, a: 0 });
});

/* ---------- groupSnap (position-only by design) ---------- */

test('groupSnap moves the whole selection by the best vertex pair, no re-orient', () => {
  const anchor = mk('Str1', 100, 100);        /* v1(world) = (127,100) */
  const moving = mk('Str1', 130, 130, 90);    /* v0 rotated 90 = (130,103): d=4.2 in range */
  const selection = new Set([moving]);
  assert.equal(groupSnap(selection, [anchor, moving]), true);
  assert.equal(moving.x, 127);
  assert.equal(moving.y, 127);                /* v0 lands exactly on (127,100) */
  assert.equal(moving.a, 90);                 /* orientation untouched */
});

test('groupSnap returns false when nothing is in range', () => {
  const far = mk('Str1', 500, 500);
  assert.equal(groupSnap(new Set([far]), [mk('Str1', 0, 0), far]), false);
});

/* ---------- externalJoint (pivot rotation) ---------- */

test('externalJoint finds the single coincident vertex', () => {
  const a = mk('Str1', 100, 100);
  const b = mk('Str1', 154, 100); /* chained: b.v0 == a.v1 */
  const j = externalJoint(new Set([b]), [a, b]);
  assert.ok(j && near(j.x, 127, 1e-9) && near(j.y, 100, 1e-9));
});

test('externalJoint returns null for 0 or 2+ joints (closed circuits)', () => {
  const lone = mk('Str1', 100, 100);
  assert.equal(externalJoint(new Set([lone]), [lone]), null);
  const a = mk('Str1', 100, 100), b = mk('Str1', 154, 100), c = mk('Str1', 208, 100);
  assert.equal(externalJoint(new Set([b]), [a, b, c]), null);
});

/* ---------- camera & misc (unchanged behavior) ---------- */

test('topPieceAt prefers the topmost sprite, and higher z wins regardless of array order', () => {
  const bottom = mk('Str1', 100, 100), top = mk('Str1', 110, 100);
  const sprites = [bottom, top];
  assert.equal(topPieceAt(sprites, { x: 110, y: 100 }), top);
  assert.equal(topPieceAt(sprites, { x: 80, y: 100 }), bottom);
  assert.equal(topPieceAt(sprites, { x: 1000, y: 1000 }), null);
  /* a bridge drawn later in the array but placed FIRST must win the click */
  const ground = mk('Str1', 100, 100, 0, 0);
  const bridge = mk('Str1', 110, 100, 0, 75);
  assert.equal(topPieceAt([bridge, ground], { x: 110, y: 100 }), bridge);
  assert.equal(topPieceAt([ground, bridge], { x: 110, y: 100 }), bridge);
});

test('worldFromScreen inverts the view transform', () => {
  assert.deepEqual(worldFromScreen({ x: 50, y: 60, scale: 0.5 }, 100, 110), { x: 100, y: 100 });
});

test('clampScale bounds zoom', () => {
  assert.equal(clampScale(100), 4);
  assert.equal(clampScale(0.01), 0.12);
  assert.equal(clampScale(1), 1);
});

test('computeFit centers the content and clamps scale', () => {
  const sprites = [mk('Str1', 0, 0), mk('Str1', 500, 0)];
  const view = computeFit(sprites, 800, 600);
  assert.ok(view.scale > 0.12 && view.scale <= 4);
  const { hx } = pieceHalfExtents(sprites[0]);
  const cx = (-hx + 500 + hx) / 2;
  assert.ok(Math.abs(view.x + cx * view.scale - 400) < 1e-6);
});

test('solveGeo yields finite arcs for every corner and hairpin', () => {
  for (const [name, def] of Object.entries(PIECES)) {
    if (def.kind !== 'corner' && def.kind !== 'hairpin') continue;
    const geo = solveGeo(name);
    assert.ok(geo && Number.isFinite(geo.cx) && Number.isFinite(geo.cy), name);
    assert.ok(Number.isFinite(geo.R) && geo.R > 0, name);
    assert.ok(Number.isFinite(geo.a1) && Number.isFinite(geo.sweep), name);
  }
});

test('solveGeo arcs start exactly at verts[0] and end exactly at verts[1]', () => {
  for (const [name, def] of Object.entries(PIECES)) {
    if (def.kind !== 'corner' && def.kind !== 'hairpin') continue;
    const geo = solveGeo(name);
    const at = (a) => ({ x: geo.cx + geo.R * Math.cos(a), y: geo.cy + geo.R * Math.sin(a) });
    const p1 = at(geo.a1), p2 = at(geo.a1 + geo.sweep);
    assert.ok(Math.hypot(p1.x - def.verts[0][0], p1.y - def.verts[0][1]) < 1e-6, `${name}: start`);
    assert.ok(Math.hypot(p2.x - def.verts[1][0], p2.y - def.verts[1][1]) < 1e-6, `${name}: end`);
  }
});
