import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeLoop, closeLoopStepping, piecesCollide, solverSetFor, endPieceIssue } from '../../src/solver.js';
import { PIECES } from '../../src/pieces.js';
import {
  orientAngle, vertexOf, vertsOf, levelAt, rot, outwardTangent, inwardTangent,
} from '../../src/geometry.js';

const mk = (name, x, y, a = 0, z = 0) => ({ name, x, y, a, c: 0, z });

/* Weld a new piece onto sprite s at vertex si via its vertex gi — the same
 * joint math snapPiece applies (orientAngle + exact vertex coincidence). */
function weldOn(sprites, name, s, si, gi = 0) {
  const def = PIECES[name];
  const tmpl = { name, x: 0, y: 0, a: 0, c: 0, z: 0 };
  const a = orientAngle(s, si, tmpl, gi);
  const v = vertexOf(s, si);
  const off = rot(def.verts[gi][0], def.verts[gi][1], a);
  const p = { name, x: v.x - off.x, y: v.y - off.y, a, c: 0, z: levelAt(s, si) - (def.verts[gi][2] || 0) };
  sprites.push(p);
  return p;
}

/* Mirrors store.refreshFlags: coincident vertices must not break tangent/level. */
function badJoints(sprites) {
  const bad = [];
  for (let i = 0; i < sprites.length; i++) {
    for (let j = 0; j < sprites.length; j++) {
      if (i === j) continue;
      const s = sprites[i], g = sprites[j];
      for (let si = 0; si < vertsOf(s).length; si++) {
        const va = vertexOf(s, si);
        for (let gi = 0; gi < vertsOf(g).length; gi++) {
          const vb = vertexOf(g, gi);
          if (Math.hypot(va.x - vb.x, va.y - vb.y) > 1e-6) continue;
          const dT = Math.abs(((outwardTangent(s, si) - inwardTangent(g, gi) + 540) % 360) - 180);
          if (dT > 0.05 || levelAt(s, si) !== levelAt(g, gi)) bad.push([s.name, g.name, dT]);
        }
      }
    }
  }
  return bad;
}

function noCollisions(sprites) {
  for (let i = 0; i < sprites.length; i++) {
    for (let j = i + 1; j < sprites.length; j++) {
      if (piecesCollide(sprites[i], sprites[j])) return [sprites[i], sprites[j]];
    }
  }
  return null;
}

/* A ---- (108 cm gap) ---- B, gap measured in whole Str1 steps */
function straightGapFixture(z = 0) {
  const sprites = [mk('Str1', 100, 100, 0, z)];
  const A = sprites[0];
  let cur = A;
  for (let k = 0; k < 2; k++) cur = weldOn(sprites, 'Str1', cur, 1, 0);
  const B = weldOn(sprites, 'Str1', cur, 1, 0);
  sprites.splice(1, 2); /* pull the two middle pieces: 2x54 cm gap */
  return { sprites, A, B };
}

test('solver set is straights + 45-degree corners of the ends\u2019 family', () => {
  /* owner ruling: no lane changers; family keyed on the selected ends */
  assert.deepEqual(solverSetFor(mk('Str1', 0, 0), mk('Cor1', 0, 0)), ['Str1', 'Cor1']);
});

test('closes a straight 108 cm gap with the minimal 2 straights', () => {
  const { sprites, A, B } = straightGapFixture();
  const res = closeLoop(sprites, A, B);
  assert.equal(res.ok, true);
  assert.equal(res.flex, false);
  assert.equal(res.pieces.length, 2);
  assert.ok(res.pieces.every((p) => p.name === 'Str1'));
  assert.ok(Math.abs(res.cost - 3.24) < 1e-9);
  const all = sprites.concat(res.pieces);
  assert.deepEqual(badJoints(all), []);
  assert.equal(noCollisions(all), null);
});

test('closes a corner gap: two 45s are rebuilt exactly', () => {
  const sprites = [mk('Str1', 100, 100)];
  const A = sprites[0];
  let cur = A;
  for (let k = 0; k < 2; k++) cur = weldOn(sprites, 'Cor1', cur, 1, 0);
  const B = weldOn(sprites, 'Str1', cur, 1, 0);
  sprites.splice(1, 2); /* pull the two corners */
  const res = closeLoop(sprites, A, B);
  assert.equal(res.ok, true);
  assert.equal(res.flex, false);
  assert.equal(res.pieces.length, 2);
  assert.ok(res.pieces.every((p) => p.name === 'Cor1'));
  assert.ok(Math.abs(res.cost - 2.54) < 1e-9);
  const all = sprites.concat(res.pieces);
  assert.deepEqual(badJoints(all), []);
  assert.equal(noCollisions(all), null);
});

test('closes around a blocked corridor without colliding (or fails honestly)', () => {
  const { sprites, A, B } = straightGapFixture();
  const wall = mk('Lan1', 181, 100, 90); /* vertical 162 cm wall across the corridor */
  sprites.push(wall);
  assert.equal(noCollisions(sprites), null); /* scene itself is valid */
  const res = closeLoop(sprites, A, B);
  if (res.ok) {
    const clash = res.pieces.find((p) => piecesCollide(p, wall));
    assert.equal(clash, undefined, 'solution must not cross the wall');
    const all = sprites.concat(res.pieces);
    assert.deepEqual(badJoints(all), []);
    assert.equal(noCollisions(all), null);
  } else {
    assert.equal(res.reason, 'no-path');
    assert.ok(res.miss.d > 0);
  }
});

test('different levels with a flat-only set is reported, not searched', () => {
  const sprites = [mk('Str1', 100, 100), mk('Str1', 262, 100, 0, 75)];
  const res = closeLoop(sprites, sprites[0], sprites[1]);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'level');
});

test('a 75 mm level difference bridges straight over a wall', () => {
  const { sprites, A, B } = straightGapFixture(75);
  const wall = mk('Lan1', 181, 100, 90, 0); /* wall stays at level 0 */
  sprites.push(wall);
  const res = closeLoop(sprites, A, B);
  assert.equal(res.ok, true);
  assert.equal(res.pieces.length, 2);
  assert.ok(res.pieces.every((p) => p.name === 'Str1' && p.z === 75));
});

test('off-grid target within snap range welds with a reported flex gap', () => {
  const sprites = [mk('Str1', 100, 100)];
  const A = sprites[0];
  const B = mk('Str1', 262, 105, 0); /* 5 cm north of the lattice point (235,100) */
  sprites.push(B);
  const res = closeLoop(sprites, A, B);
  assert.equal(res.ok, true);
  assert.equal(res.flex, true);
  assert.ok(Math.abs(res.gap - 5) < 0.5, `gap ~5, got ${res.gap}`);
  const last = res.pieces[res.pieces.length - 1];
  /* welded end now sits exactly on B's v0 */
  const lv = vertexOf(last, 1), bv = vertexOf(B, 0);
  assert.ok(Math.hypot(lv.x - bv.x, lv.y - bv.y) <= 1e-6);
});

test('far off-grid or walled-in target returns no-path with diagnostics', () => {
  const sprites = [mk('Str1', 100, 100), mk('Lan1', 181, 100, 90)]; /* wall on the goal vert */
  const A = sprites[0];
  const B = mk('Str1', 262, 100, 0);
  sprites.push(B);
  const res = closeLoop(sprites, A, B, { maxExpansions: 4000 });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'no-path');
});

test('no free ends is reported', () => {
  const sprites = [mk('Str1', 100, 100)];
  const A1 = sprites[0];
  const A = weldOn(sprites, 'Str1', A1, 1, 0); /* A welded on both sides */
  weldOn(sprites, 'Str1', A, 1, 0);
  const B = mk('Str1', 400, 400);
  sprites.push(B);
  const res = closeLoop(sprites, A, B);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'no-open');
});

/* ---------- piecesCollide (road-level model) ---------- */

test('chained straights share an edge, not an overlap', () => {
  const a = mk('Str1', 100, 100);
  const b = mk('Str1', 154, 100);
  assert.equal(piecesCollide(a, b), false);
});

test('parallel straights 20 cm apart collide; 60 cm apart do not', () => {
  assert.equal(piecesCollide(mk('Str1', 100, 100), mk('Str1', 100, 120)), true);
  assert.equal(piecesCollide(mk('Str1', 100, 100), mk('Str1', 100, 160)), false);
});

test('chained corners (making a 90) do not collide', () => {
  const a = mk('Cor1', 100, 100);
  const b = weldOn([], 'Cor1', a, 1, 0);
  assert.equal(piecesCollide(a, b), false);
});

test('corner arc overlapping a straight collides', () => {
  const s = mk('Str1', 100, 100);
  const c = mk('Cor1', 130, 100); /* arc body across the straight */
  assert.equal(piecesCollide(s, c), true);
});

test('same-plan pieces at >=75 mm level difference are a bridge, not a clash', () => {
  assert.equal(piecesCollide(mk('Str1', 100, 100, 0, 0), mk('Str1', 100, 120, 0, 75)), false);
  assert.equal(piecesCollide(mk('Str1', 100, 100, 0, 0), mk('Str1', 100, 120, 0, 40)), true);
});

test('off-grid ends with corner-chain heading drift still flex-weld', () => {
  /* A is a corner: its exit tangent is the catalog's 44.976 deg, not exactly
   * 45. B is a hand-placed straight at exactly 45 deg with its entry vert
   * 6.5 cm off the reachable lattice — the "nearest fit 6.5 cm / 0 deg off"
   * toast case. The flex weld must absorb both, not give up. */
  const A = mk('Cor1', 100, 100);
  const exit = vertexOf(A, 1);
  const dir = (deg) => ({ x: Math.cos(deg * Math.PI / 180), y: Math.sin(deg * Math.PI / 180) });
  const d45 = dir(45), perp = dir(135);
  const goal = { x: exit.x + 108 * d45.x + 6.5 * perp.x, y: exit.y + 108 * d45.y + 6.5 * perp.y };
  const B = mk('Str1', goal.x - 27 * d45.x, goal.y - 27 * d45.y, 45);
  const sprites = [A, B];
  const res = closeLoop(sprites, A, B);
  assert.equal(res.ok, true);
  assert.equal(res.flex, true);
  assert.ok(Math.abs(res.gap - 6.5) < 1.5, `gap ~6.5, got ${res.gap}`);
  const last = res.pieces[res.pieces.length - 1];
  const lv = vertexOf(last, 1), bv = vertexOf(B, 0);
  assert.ok(Math.hypot(lv.x - bv.x, lv.y - bv.y) <= 1e-6); /* welded onto B */
});

test('7-corner ring: the missing 8th corner is placed exactly (chain drift)', () => {
  /* App-welded chains drift ~0.01 cm per piece — the ring's ends sit ~0.08 cm
   * apart, so joints must be exempt at connection range and the landing
   * tolerance must absorb the drift (the "41.3 cm / 45 deg off" case). */
  const sprites = [mk('Cor1', 0, 0)];
  let cur = sprites[0];
  for (let k = 1; k < 7; k++) cur = weldOn(sprites, 'Cor1', cur, 1, 0);
  const first = sprites[0], last = sprites[6];
  const res = closeLoop(sprites, last, first);
  assert.equal(res.ok, true);
  assert.equal(res.flex, false);
  assert.equal(res.pieces.length, 1);
  assert.equal(res.pieces[0].name, 'Cor1');
  /* welded arrival vertex sits exactly on first's v0 */
  const lv = vertexOf(res.pieces[0], 1), bv = vertexOf(first, 0);
  assert.ok(Math.hypot(lv.x - bv.x, lv.y - bv.y) <= 1e-6);
  assert.equal(noCollisions(sprites.concat(res.pieces)), null);
});

test('oval missing one straight: 54 cm gap refilled exactly (chain drift)', () => {
  /* Str1 - Cor - Cor - [gap] - Cor - Cor - Str1 oval; the pulled straight's
   * slot lands ~0.1 cm off the welded chain ends (the "54 cm / 0 deg off"
   * case) and must still refill with exactly one Str1. */
  const sprites = [mk('Str1', 0, 0)];
  let cur = sprites[0];
  for (let k = 0; k < 2; k++) cur = weldOn(sprites, 'Cor1', cur, 1, 0);
  const mid = weldOn(sprites, 'Str1', cur, 1, 0); /* the piece we pull */
  const B = weldOn(sprites, 'Cor1', mid, 1, 0);
  weldOn(sprites, 'Cor1', B, 1, 0);
  weldOn(sprites, 'Str1', sprites[sprites.length - 1], 1, 0);
  sprites.splice(sprites.indexOf(mid), 1);
  const A = sprites[2]; /* second corner: its exit vert faces the gap */
  const res = closeLoop(sprites, A, B);
  assert.equal(res.ok, true);
  assert.equal(res.flex, false);
  assert.equal(res.pieces.length, 1);
  assert.equal(res.pieces[0].name, 'Str1');
  const lv = vertexOf(res.pieces[0], 1), bv = vertexOf(B, 0);
  assert.ok(Math.hypot(lv.x - bv.x, lv.y - bv.y) <= 1e-6);
  assert.equal(noCollisions(sprites.concat(res.pieces)), null);
});

test('no-path classifies a blocked closure and names the blocker', () => {
  const { sprites, A, B } = straightGapFixture();
  const wall = mk('Lan1', 208, 100, 90); /* sits on the second straight's slot */
  sprites.push(wall);
  const res = closeLoop(sprites, A, B, { maxCost: 4 }); /* no detour budget: pure block */
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'no-path');
  assert.equal(res.why, 'blocked');
  assert.equal(res.blocker, wall); /* the actual piece in the way */
});

test('no-path classifies off-grid ends (nothing near the goal to block)', () => {
  const sprites = [mk('Str1', 100, 100), mk('Str1', 262, 140)]; /* 40 cm sideways */
  const res = closeLoop(sprites, sprites[0], sprites[1], { maxCost: 4 });
  assert.equal(res.ok, false);
  assert.equal(res.why, 'off-grid');
  assert.ok(res.miss.d > 30);
});

test('no-path classifies perpendicular ends as facing', () => {
  const A = mk('Str1', 100, 100);
  const B = mk('Str1', 127, 127, 90); /* entry heading 90 deg from A's exit */
  const res = closeLoop([A, B], A, B, { maxCost: 1 }); /* forbid the loop-out */
  assert.equal(res.ok, false);
  assert.equal(res.why, 'facing');
  assert.ok(res.miss.dh > 45);
});

test('no-path reports truncated searches honestly', () => {
  const A = mk('Str1', 100, 100);
  const B = mk('Str1', 262, 100);
  const res = closeLoop([A, B], A, B, { maxExpansions: 3 });
  assert.equal(res.ok, false);
  assert.equal(res.why, 'limit');
});

test('level failures carry the two levels', () => {
  const sprites = [mk('Str1', 100, 100), mk('Str1', 262, 100, 0, 75)];
  const res = closeLoop(sprites, sprites[0], sprites[1]);
  assert.equal(res.reason, 'level');
  assert.deepEqual(res.levels, [0, 75]);
});

test('stepping removes the blocker and closes', () => {
  const { sprites, A, B } = straightGapFixture();
  const wall = mk('Lan1', 208, 100, 90);
  sprites.push(wall);
  const res = closeLoopStepping(sprites, A, B, { maxCost: 4 });
  assert.equal(res.ok, true);
  assert.deepEqual(res.removed, [wall]);
  assert.equal(res.closed.pieces.length, 2); /* the 2-straight fill */
  assert.ok(Math.abs(res.closed.cost - 3.24) < 1e-9);
  const kept = sprites.filter((p) => p !== wall).concat(res.closed.pieces);
  assert.equal(noCollisions(kept), null);
});

test('stepping backs the end chain past an offending corner', () => {
  /* P0 - A(45 deg corner into the corridor) ... gap ... B. The corner's own
   * approach cannot close; stepping removes it and the straight gap behind
   * closes with a single lane changer. */
  const sprites = [mk('Str1', 46, 100)];
  const P0 = sprites[0];
  const A = weldOn(sprites, 'Cor1', P0, 1, 0);
  const B = mk('Str1', 262, 100);
  sprites.push(B);
  assert.equal(closeLoop(sprites, A, B, { maxCost: 6 }).ok, false); /* needs stepping */
  const res = closeLoopStepping(sprites, A, B, { maxCost: 6 });
  assert.equal(res.ok, true);
  assert.deepEqual(res.removed, [A]);
  assert.equal(res.closed.pieces.length, 3); /* 162 cm as 3x Str1 (no Lan1) */
  assert.ok(res.closed.pieces.every((p) => p.name === 'Str1'));
  assert.ok(Math.abs(res.closed.cost - 4.86) < 1e-9);
  const kept = sprites.filter((p) => p !== A).concat(res.closed.pieces);
  assert.equal(noCollisions(kept), null);
});

test('stepping gives up cleanly when nothing helps', () => {
  const A = mk('Str1', 100, 100);
  const B = mk('Str1', 127, 127, 90); /* perpendicular, isolated ends */
  const res = closeLoopStepping([A, B], A, B, { maxCost: 2, maxSteps: 2 });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'no-path');
});

/* ---------- lane-family solver sets (keyed on the selected ends) ---------- */

test('solverSetFor derives the family from the two selected ends', () => {
  assert.deepEqual(solverSetFor(mk('Str1', 0, 0), mk('Cor1', 0, 0)), ['Str1', 'Cor1']);
  const five = solverSetFor(mk('Str4', 0, 0), mk('Cor2', 0, 0));
  assert.ok(five.includes('Str4') && five.includes('Cor2'));
  assert.ok(!five.includes('Cor3') && !five.includes('Cor5') && !five.includes('Lan4')); /* straights + 45s only */
  assert.deepEqual(solverSetFor(mk('R2S250', 0, 0), mk('R2C45I150', 0, 0)), ['R2S250', 'R2C45I150']);
});

test('solverSetFor rejects mixed-lane selections', () => {
  assert.equal(solverSetFor(mk('Str1', 0, 0), mk('Str4', 0, 0)), null);
  assert.equal(closeLoop([mk('Str1', 100, 100), mk('Str4', 300, 300)], mk('Str1', 100, 100), mk('Str4', 300, 300)).reason, 'lane-mismatch');
});

test('closes a 5-lane gap with 5-lane pieces', () => {
  const sprites = [mk('Str4', 100, 100)];
  const A = sprites[0];
  let cur = A;
  for (let k = 0; k < 2; k++) cur = weldOn(sprites, 'Str4', cur, 1, 0);
  const B = weldOn(sprites, 'Str4', cur, 1, 0);
  sprites.splice(1, 2); /* 2 x 60 cm gap */
  const res = closeLoop(sprites, A, B);
  assert.equal(res.ok, true);
  /* 120 cm: one Str6 ties 2x Str4 on length and wins on piece count */
  assert.equal(res.pieces.length, 1);
  assert.equal(res.pieces[0].name, 'Str6');
  assert.ok(Math.abs(res.cost - 6) < 1e-9);
  assert.equal(noCollisions(sprites.concat(res.pieces)), null);
});

test('closes a rucdoc 2-lane gap with rucdoc pieces', () => {
  const sprites = [mk('R2S250', 500, 500)];
  const A = sprites[0];
  const M = weldOn(sprites, 'R2S250', A, 1, 0);
  const B = weldOn(sprites, 'R2S250', M, 1, 0);
  sprites.splice(sprites.indexOf(M), 1); /* 25 cm gap */
  const res = closeLoop(sprites, A, B);
  assert.equal(res.ok, true);
  assert.equal(res.pieces.length, 1);
  assert.equal(res.pieces[0].name, 'R2S250');
  const all = sprites.concat(res.pieces);
  assert.deepEqual(badJoints(all), []);
  assert.equal(noCollisions(all), null);
});

/* ---------- end-piece eligibility (Complete tool contract) ---------- */

test('endPieceIssue: supported kinds, exactly one open end required', () => {
  const chain = [mk('Str1', 100, 100)];
  weldOn(chain, 'Str1', chain[0], 1, 0); /* chain: A - B */
  const A = chain[0], B = chain[1];
  assert.equal(endPieceIssue(chain, A), null); /* one open end (v0) */
  assert.equal(endPieceIssue(chain, B), null);
  const lone = [mk('Str1', 400, 400)];
  assert.equal(endPieceIssue(lone, lone[0]), 'multi-open'); /* both ends free */
  const ring = [mk('Cor1', 0, 0)];
  let cur = ring[0];
  for (let k = 1; k < 8; k++) cur = weldOn(ring, 'Cor1', cur, 1, 0);
  assert.equal(endPieceIssue(ring, ring[0]), 'no-open'); /* fully connected */
});

test('endPieceIssue: bridges, jumps, banks, hairpins rejected as ends', () => {
  for (const name of ['Str1', 'Cor1', 'Chi1', 'Lan1', 'Str2']) {
    const chain = [mk('Str1', 100, 100)];
    weldOn(chain, name, chain[0], 1, 0); /* welded on: exactly one open end */
    assert.equal(endPieceIssue(chain, chain[1]), null, `${name} should be a valid end`);
  }
  for (const name of ['Bri1', 'Bri2', 'Ban1', 'Lan2', 'Bri3', 'Ban2', 'Lan3']) {
    const chain = [mk('Str1', 100, 100)];
    weldOn(chain, name, chain[0], 1, 0);
    assert.equal(endPieceIssue(chain, chain[1]), 'kind', `${name} should be rejected`);
  }
});

test('vertex proximity alone is not a joint: crossing roads still collide', () => {
  /* Regression (owner report): a closing run's straight crossed the track's
   * bottom row perpendicularly, but its end vertex landed 0.3 cm from the
   * row piece's end vertex — the old proximity-only exemption let it
   * through. A joint needs aligned travel directions. */
  const row = mk('Str1', 272.019, 343.845, 179.98);      /* end vert ~ (299.02,343.85) */
  const crosser = mk('Str1', 298.8, 317.0, 270);          /* end vert ~ (298.8,344) */
  assert.equal(piecesCollide(row, crosser), true);         /* perpendicular: crossing */
  const chained = mk('Str1', 272.019 + 54, 343.845, 179.98); /* aligned continuation */
  assert.equal(piecesCollide(row, chained), false);        /* genuine joint */
});
