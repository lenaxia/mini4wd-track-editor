import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTrack } from '../../src/validate.js';
import { parseTrack } from '../../src/track.js';
import { rot, orientAngle, vertsOf } from '../../src/geometry.js';

const P = (name, x, y, a = 0, c = 0, z = 0) => ({ name, x, y, a, c, z });

/* exact square: 4x R1C90I150 chained — closure verified at 2.5e-15 */
const SQUARE = 'R1C90I150;0.000;0.000;0.000;0;0#R1C90I150;0.000;-21.500;90.000;0;0#R1C90I150;21.500;-21.500;180.000;0;0#R1C90I150;21.500;0.000;270.000;0;0#';

test('empty track fails', () => {
  const r = validateTrack([]);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /empty/i);
});

test('a lone straight has two dangling ends', () => {
  const r = validateTrack([P('Str1', 0, 0)]);
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 2);
  assert.match(r.errors[0], /Dangling/);
});

test('a chained run still dangles (ends face away)', () => {
  const r = validateTrack([P('Str1', 0, 0), P('Str1', 54, 0)]);
  assert.equal(r.ok, false);
  assert.equal(r.errors.filter((e) => /Dangling/.test(e)).length, 2);
});

test('the exact square is complete and consistent', () => {
  const r = validateTrack(parseTrack(SQUARE));
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});

test('facing open ends pair as an intentional jump (the far ends still dangle)', () => {
  /* A ends at +27 facing +x; B (flipped) spans 37..91 facing -x: 10 cm gap */
  const r = validateTrack([P('Str1', 0, 0), P('Str1', 64, 0, 180)]);
  assert.equal(r.errors.length, 2);   /* only the far ends */
  assert.ok(r.errors.every((e) => /\(-27|\(91/.test(e)));
  assert.ok(!r.errors.some((e) => /\(27|\(37/.test(e)));   /* jump ends linked */
});

test('a kinked joint is an error', () => {
  /* B's v0 lands float-exactly on A's v1 (rotation-inverse placement) but
   * points 10° off the travel axis */
  const A = P('Str1', 0, 0);
  const B = P('Str1', 0, 0, 10);
  const r = rot(-27, 0, 10);
  B.x = 27 - r.x; B.y = -r.y;
  const res = validateTrack([A, B]);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /Kinked/.test(e)));
});

test('three pieces meeting at one point (a junction) are permitted', () => {
  /* A exits into BOTH B and C at the same point (a Y-junction): every
   * out->in pair stays tangent-aligned, so no kink and no junction error;
   * the two far ends dangle, which is the finding that matters */
  const A = P('Str1', 0, 0);
  const B = P('Str1', 54, 0);
  const C = P('Cor1', 0, 0);
  C.a = orientAngle(A, 1, C, 0);
  const v = vertsOf(C)[0];
  const rr = rot(v[0], v[1], C.a);
  C.x = 27 - rr.x; C.y = -rr.y;
  const res = validateTrack([A, B, C]);
  assert.ok(!res.errors.some((e) => /Kinked/.test(e)));
  assert.equal(res.errors.filter((e) => /Dangling/.test(e)).length, 3);   /* the two far ends + the branch end */
});

test('insufficient crossover clearance warns but does not block', () => {
  /* two identical closed squares, offset 5 cm and 50 mm apart vertically:
   * both complete, but the upper deck cannot clear the lower one */
  const lower = parseTrack(SQUARE);
  const upper = lower.map((p) => ({ ...p, x: p.x + 5, y: p.y + 5, z: 50 }));
  const res = validateTrack(lower.concat(upper));
  assert.equal(res.ok, true);
  assert.deepEqual(res.errors, []);
  assert.ok(res.warnings.some((w) => /75 mm/.test(w)));
});
