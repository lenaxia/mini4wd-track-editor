import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PIECES, PALETTE, TOOLS, VARIANT_COLORS } from '../../src/pieces.js';

test('every palette entry resolves to a piece definition', () => {
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
    for (const v of [def.v1, def.v2]) {
      assert.ok(Array.isArray(v) && v.length === 2 && v.every(Number.isFinite), name);
    }
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
