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

/* Owner-reported regression: a genuinely complete shared track must not
 * read as dangling. The codec rounds positions/angles to 3 decimals, so
 * true welds sit up to ~0.1 cm apart after a round-trip (measured 0.095
 * on this 22-piece circuit) — connectivity tolerance is 1 cm (owner
 * cap), far above rounding noise, not float-exactness. */
const OWNER_CIRCUIT_B64 = 'Q29yMTs0MjQuMTQ1OzIyNy41ODc7NDUuMDE0OzA7MCNDb3IxOzM0OS4yMDQ7MzMwLjgyMDsxMzUuMDM0OzA7MCNDb3IxOzMwOS4wNjY7MzI1LjkwMzsxODAuMDQ1OzA7MCNDb3IxOzQxOS4yNDI7MjY3LjcyNzs5MC4wMjQ7MDswI1N0cjE7MzkyLjM0NTsyOTkuMDE1OzEzNTswOzAjU3RyMTsyNzcuNzg3OzI5OC45OTU7MjI1LjAyOzA7MCNMYW4xOzM1NC4xMjc7MTQ2LjI4NzsyMjQuOTg7MDswI0NvcjE7MjQ1Ljk5NzsyNTUuODQzOzIyNS4wNTQ7MDswI0NvcjE7MjUwLjkyODsyMTUuNzA2OzI3MC4wNjU7MDswI0NvcjE7MjY2LjU1NjsxOTEuMzI0OzkwLjA2NTswOzAjQ29yMTsyNzEuNDg4OzE1MS4xODg7NDUuMDU1OzA7MCNDaGkxOzI3OS44NTM7NjcuODI0OzQ0Ljk4OzA7MCNTdHIxOzIzOS41MzU7MzEuNzc1OzIyNC45ODswOzAjQ29yMTsyMDguMjM3OzQuODg5OzAuMDA0OzA7MCNDb3IxOzE2OC4wOTY7MC4wMDA7MzE0Ljk5NDswOzAjU3RyMTsxMjQuOTc3OzMxLjgzNjsxMzQuOTY7MDswI0NvcjE7OTguMTAyOzYzLjE0MzsyNjkuOTg0OzA7MCNDb3IxOzkzLjIyNzsxMDMuMjg2OzIyNC45NzQ7MDswI0NvcjE7MTE4LjE3MTsxMzUuMTE0OzE3OS45NjQ7MDswI0NvcjE7MTU4LjMxNTsxMzkuOTc1OzEzNC45NTQ7MDswI0NvcjE7MjA2LjM3ODsxMTQuNDgxOzMxNC45NTQ7MDswI0NvcjE7MjQ2LjU4OTsxMTkuMzI0OzAuMDQ1OzA7MCM';
test('a complete shared track (rounded coords) validates clean', () => {
  const sprites = parseTrack(Buffer.from(OWNER_CIRCUIT_B64, 'base64url').toString('utf8'));
  assert.equal(sprites.length, 22);
  const r = validateTrack(sprites);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

/* ---------- same-level road overlap (silhouette-true, sampled) ---------- */

test('two parallel straights exactly touching do NOT overlap', () => {
  const r = validateTrack([P('Str1', 0, 0), P('Str1', 0, 36)]);   /* road width 36: edges kiss */
  assert.equal(r.errors.filter((e) => /overlap/i.test(e)).length, 0);
});

test('two parallel straights squeezed together overlap', () => {
  const r = validateTrack([P('Str1', 0, 0), P('Str1', 0, 30)]);
  assert.ok(r.errors.some((e) => /overlap/i.test(e)), JSON.stringify(r.errors));
});

test('two straights crossing at the same level overlap', () => {
  const r = validateTrack([P('Str1', 0, 0), P('Str1', 0, 0, 90)]);
  assert.ok(r.errors.some((e) => /overlap/i.test(e)));
});

test('the same crossing bridged at 75 mm is clean (paint rule, not overlap)', () => {
  const r = validateTrack([P('Str1', 0, 0), P('Str1', 0, 0, 90, 0, 75)]);
  assert.equal(r.errors.filter((e) => /overlap/i.test(e)).length, 0);
});

test('a near-miss under 75 mm stays a clearance warning, not an overlap error', () => {
  const r = validateTrack([P('Str1', 0, 0), P('Str1', 0, 0, 90, 0, 40)]);
  assert.equal(r.errors.filter((e) => /overlap/i.test(e)).length, 0);
  assert.ok(r.warnings.some((w) => /Clearance/.test(w)));
});

test('chained straights and the closed square stay clean (joint neighborhoods exempt)', () => {
  const chain = validateTrack([P('Str1', 0, 0), P('Str1', 54, 0)]);
  assert.equal(chain.errors.filter((e) => /overlap/i.test(e)).length, 0);
  const sq = validateTrack(parseTrack(SQUARE));
  assert.equal(sq.errors.filter((e) => /overlap/i.test(e)).length, 0);
});

test('a corner overlapping a straight at the same level errors', () => {
  /* straight running straight through the middle of a corner's arc */
  const r = validateTrack([P('Cor1', 0, 0), P('Str1', -10, 4, 0)]);
  assert.ok(r.errors.some((e) => /overlap/i.test(e)));
});

test('review fixture: a straight clear of a wave\u2019s wandering surface does not overlap', () => {
  /* Chi2 (5-lane wave, h=72 footprint, 60-wide road wandering <=6cm):
   * the straight spans y >= 53; the wave surface tops out at ~36 —
   * a true gap of >=17cm. The footprint-rectangle version flagged it. */
  const r = validateTrack([P('Chi2', 0, 0), P('Str1', 45, 80, 90)]);
  assert.equal(r.errors.filter((e) => /overlap/i.test(e)).length, 0);
});

test('a straight crossing a wave\u2019s road at the same level overlaps', () => {
  const r = validateTrack([P('Chi1', 0, 0), P('Str1', 0, 0, 90)]);
  assert.ok(r.errors.some((e) => /overlap/i.test(e)));
});

test('the wave width fix is load-bearing, not just the bbox window (review r1 pin)', () => {
  /* horizontal straight riding y=53.5: inside the pair's bbox window,
   * but 53.5 - 18 = 35.5.. its surface starts above the wave's true
   * 60-wide road reach (y<=36 with 30 half-width -> contact), while
   * the OLD footprint width (h=72/2=36) flags it. Under def.h this
   * errors; under lane-width it must be clean. */
  const r = validateTrack([P('Chi2', 0, 0), P('Str1', 0, 53.5, 0)]);
  assert.equal(r.errors.filter((e) => /overlap/i.test(e)).length, 0);
});
