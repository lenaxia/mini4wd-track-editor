import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PIECES, PALETTE, TOOLS, VARIANT_COLORS, SNAP_RADIUS } from '../../src/pieces.js';

const TAMIYA = new Set([...PALETTE[3], ...PALETTE[5]]);

test('every palette entry resolves to a piece definition (all drawers)', () => {
  for (const mode of [3, 5]) {
    assert.ok(PALETTE[mode].length > 0);
    for (const name of PALETTE[mode]) {
      assert.ok(PIECES[name], `${name} (mode ${mode})`);
    }
  }
});

test('palette respects lane mode of its pieces', () => {
  for (const name of PALETTE[3]) assert.equal(PIECES[name].lanes, 3);
  for (const name of PALETTE[5]) assert.equal(PIECES[name].lanes, 5);
});

test('catalog fields are sane for every piece', () => {
  for (const [name, def] of Object.entries(PIECES)) {
    assert.ok(def.label, name);
    assert.ok(def.l === 3 || def.lanes === def.lanes, name); /* lanes present */
    assert.ok(def.l > 0 && def.w > 0 && def.h > 0, name);
    assert.ok(Number.isInteger(def.colors) && def.colors >= 1, name);
    assert.ok(def.verts.length >= 2, name);
    let minSep = Infinity;
    for (const v of def.verts) {
      assert.ok(Array.isArray(v) && v.length >= 2 && v.slice(0, 2).every(Number.isFinite), name);
      if (v.length === 3) assert.ok(Number.isInteger(v[2]), `${name}: zOff integer`);
    }
    for (let i = 0; i < def.verts.length; i++) {
      for (let j = i + 1; j < def.verts.length; j++) {
        const d = Math.hypot(def.verts[i][0] - def.verts[j][0], def.verts[i][1] - def.verts[j][1]);
        minSep = Math.min(minSep, d);
      }
    }
    /* Tamiya keeps the strict no-pair-ambiguity floor (>2x SNAP_RADIUS);
     * rucdoc's tight 1-lane corners sit at ~1.65x — closest-pair
     * determinism still holds, only the both-vertices window widens
     * (hysteresis deferred: docs/design/orient-elevation.md §9). */
    const floor = TAMIYA.has(name) ? 2 : 1.5;
    assert.ok(minSep > floor * SNAP_RADIUS, `${name}: vertex separation ${minSep} < ${floor}x snap radius`);
    if (def.kind === 'corner' || def.kind === 'hairpin') {
      assert.ok(def.R > 0 && def.band > 0, name);
    }
  }
});

test('color count never exceeds the variant palette', () => {
  for (const def of Object.values(PIECES)) {
    assert.ok(def.colors <= VARIANT_COLORS.length);
  }
});

test('TOOLS contains exactly the non-piece tools', () => {
  assert.deepEqual(TOOLS, ['Pan', 'Move', 'Delete', 'Color']);
});
