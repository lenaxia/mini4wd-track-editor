import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PIECES } from '../../src/pieces.js';
import {
  rot, rad, solveGeo, centerOf, vertexOf, isHit, topPieceAt,
  snapPiece, groupSnap, worldFromScreen, clampScale, computeFit, pieceHalfExtents,
} from '../../src/geometry.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('rot rotates basis vectors correctly', () => {
  const r = rot(1, 0, 90);
  assert.ok(near(r.x, 0, 1e-12) && near(r.y, 1, 1e-12));
  const r45 = rot(1, 0, 45);
  assert.ok(near(r45.x, Math.SQRT1_2, 1e-12) && near(r45.y, Math.SQRT1_2, 1e-12));
  assert.deepEqual(rot(3, 4, 0), { x: 3, y: 4 });
});

test('vertexOf maps local vertices through position + rotation', () => {
  const p = { name: 'Str1', x: 100, y: 100, a: 0, c: 0 };
  assert.deepEqual(vertexOf(p, 1), { x: 73, y: 100 });
  assert.deepEqual(vertexOf(p, 2), { x: 127, y: 100 });
  const q = { name: 'Str1', x: 100, y: 100, a: 90, c: 0 };
  const v1 = vertexOf(q, 1), v2 = vertexOf(q, 2);
  assert.ok(near(v1.x, 100, 1e-9) && near(v1.y, 73, 1e-9));
  assert.ok(near(v2.x, 100, 1e-9) && near(v2.y, 127, 1e-9));
});

test('centerOf honors the piece center offset (Cor1)', () => {
  const c = centerOf({ name: 'Cor1', x: 0, y: 0, a: 0, c: 0 });
  assert.ok(near(c.x, -5, 1e-9) && near(c.y, -3.5, 1e-9));
});

test('snapPiece snaps within SNAP_RADIUS and connects vertices exactly', () => {
  const placed = { name: 'Str1', x: 100, y: 100, a: 0, c: 0 }; /* v2 = 127,100 */
  const ghost = { name: 'Str1', x: 150, y: 103, a: 0, c: 0 };  /* v1 = 123,103 -> dist 5 */
  const snapped = snapPiece(ghost, [placed]);
  assert.equal(snapped, true);
  assert.equal(ghost.x, 154);
  assert.equal(ghost.y, 100);
  assert.deepEqual(vertexOf(ghost, 1), vertexOf(placed, 2));
});

test('snapPiece leaves far pieces untouched', () => {
  const placed = { name: 'Str1', x: 100, y: 100, a: 0, c: 0 };
  const ghost = { name: 'Str1', x: 300, y: 300, a: 0, c: 0 };
  assert.equal(snapPiece(ghost, [placed]), false);
  assert.deepEqual({ x: ghost.x, y: ghost.y }, { x: 300, y: 300 });
});

test('snapPiece applies only the closest vertex pair', () => {
  /* ghost v1=(173,100). A's v2 is exactly on ghost v1 (d=0); B's v1 is
   * 8 from ghost v2. The d=0 pair must win alone — a second, worse snap
   * must not pull the piece off the perfect connection. */
  const a = { name: 'Str1', x: 146, y: 100, a: 0, c: 0 };  /* v2 = 173,100 */
  const b = { name: 'Str1', x: 246, y: 100, a: 0, c: 0 };  /* v1 = 219,100 */
  const ghost = { name: 'Str1', x: 200, y: 100, a: 0, c: 0 };
  assert.equal(snapPiece(ghost, [a, b]), true);
  assert.equal(ghost.x, 200); /* stays on the perfect connection */
  assert.deepEqual(vertexOf(ghost, 1), vertexOf(a, 2));
});

test('snapPiece resolves equidistant pairs deterministically (array order)', () => {
  /* both offers are 6 away: A v2 -> ghost v1 (+6), B v1 -> ghost v2 (-6).
   * A comes first in the sprite array and must win the tie. */
  const a = { name: 'Str1', x: 152, y: 100, a: 0, c: 0 };
  const b = { name: 'Str1', x: 260, y: 100, a: 0, c: 0 };
  const ghost = { name: 'Str1', x: 200, y: 100, a: 0, c: 0 };
  assert.equal(snapPiece(ghost, [a, b]), true);
  assert.equal(ghost.x, 206);
  assert.deepEqual(vertexOf(ghost, 1), vertexOf(a, 2));
});

test('groupSnap moves the whole selection by the best vertex pair', () => {
  const anchor = { name: 'Str1', x: 100, y: 100, a: 0, c: 0 }; /* v2 = 127,100 */
  const moving = { name: 'Str1', x: 160, y: 100, a: 0, c: 0 };  /* v1 = 133,100 -> dist 6 */
  const selection = new Set([moving]);
  assert.equal(groupSnap(selection, [anchor, moving]), true);
  assert.equal(moving.x, 154);
  assert.deepEqual(vertexOf(moving, 1), vertexOf(anchor, 2));
});

test('groupSnap returns false when nothing is in range', () => {
  const a = { name: 'Str1', x: 0, y: 0, a: 0, c: 0 };
  const b = { name: 'Str1', x: 500, y: 500, a: 0, c: 0 };
  assert.equal(groupSnap(new Set([b]), [a, b]), false);
});

test('topPieceAt prefers the topmost sprite (hitbox or bbox)', () => {
  const bottom = { name: 'Str1', x: 100, y: 100, a: 0, c: 0 };
  const top = { name: 'Str1', x: 110, y: 100, a: 0, c: 0 };
  const sprites = [bottom, top];
  assert.equal(topPieceAt(sprites, { x: 110, y: 100 }), top);
  assert.equal(topPieceAt(sprites, { x: 80, y: 100 }), bottom);
  assert.equal(topPieceAt(sprites, { x: 1000, y: 1000 }), null);
});

test('isHit uses the hitbox radius around the piece center', () => {
  const p = { name: 'Str1', x: 100, y: 100, a: 0, c: 0 };
  assert.equal(isHit(p, { x: 112, y: 100 }), true);
  assert.equal(isHit(p, { x: 130, y: 100 }), false);
});

test('pieceHalfExtents grows with rotation', () => {
  const flat = pieceHalfExtents({ name: 'Str1', x: 0, y: 0, a: 0, c: 0 });
  const turned = pieceHalfExtents({ name: 'Str1', x: 0, y: 0, a: 90, c: 0 });
  assert.deepEqual(flat, { hx: 27, hy: 18 });
  assert.ok(near(turned.hx, 18, 1e-9) && near(turned.hy, 27, 1e-9));
});

test('worldFromScreen inverts the view transform', () => {
  const view = { x: 50, y: 60, scale: 0.5 };
  assert.deepEqual(worldFromScreen(view, 100, 110), { x: 100, y: 100 });
});

test('clampScale bounds zoom', () => {
  assert.equal(clampScale(100), 4);
  assert.equal(clampScale(0.01), 0.12);
  assert.equal(clampScale(1), 1);
});

test('computeFit centers the content and clamps scale', () => {
  const sprites = [
    { name: 'Str1', x: 0, y: 0, a: 0, c: 0 },
    { name: 'Str1', x: 500, y: 0, a: 0, c: 0 },
  ];
  const view = computeFit(sprites, 800, 600);
  assert.ok(view.scale > 0.12 && view.scale <= 4);
  const { hx } = pieceHalfExtents(sprites[0]);
  const minX = -hx, maxX = 500 + hx;
  const cx = (minX + maxX) / 2;
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
