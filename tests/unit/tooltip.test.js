import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeTip } from '../../src/tooltip.js';

/* placeTip: viewport-aware tooltip placement. Prefers centered below
 * the anchor; flips above when there is no room; clamps to the viewport
 * with a margin so it can never render off-screen. Pure math — the DOM
 * wiring lives in initTooltips. */

test('places below the anchor, centered, when there is room', () => {
  const p = placeTip({ x: 100, y: 100, w: 20, h: 20 }, { w: 120, h: 40 }, { w: 390, h: 780 }, 8);
  assert.equal(p.placement, 'below');
  assert.equal(p.x, 100 + 10 - 60);        /* anchor center - half tip */
  assert.equal(p.y, 100 + 20 + 8);         /* anchor bottom + margin */
});

test('clamps horizontally at both viewport edges', () => {
  const left = placeTip({ x: 0, y: 100, w: 20, h: 20 }, { w: 120, h: 40 }, { w: 390, h: 780 }, 8);
  assert.equal(left.x, 8);                 /* would be -50 */
  const right = placeTip({ x: 370, y: 100, w: 20, h: 20 }, { w: 120, h: 40 }, { w: 390, h: 780 }, 8);
  assert.equal(right.x, 390 - 120 - 8);    /* would be 300 -> overflows by 38 */
});

test('flips above when there is no room below', () => {
  const p = placeTip({ x: 100, y: 770, w: 20, h: 20 }, { w: 120, h: 40 }, { w: 390, h: 780 }, 8);
  assert.equal(p.placement, 'above');
  assert.equal(p.y, 770 - 40 - 8);         /* tip top - tip height - margin */
  assert.ok(p.y >= 8);
});

test('never returns off-screen coordinates, whatever the inputs', () => {
  for (const anchor of [
    { x: -30, y: -30, w: 20, h: 20 },                  /* off-viewport anchor */
    { x: 0, y: 0, w: 500, h: 20 },                     /* wider than viewport */
    { x: 180, y: 760, w: 20, h: 40 },                  /* no room below or above */
  ]) {
    const p = placeTip(anchor, { w: 200, h: 60 }, { w: 390, h: 780 }, 8);
    assert.ok(p.x >= 8 && p.x + 200 <= 390 - 8, `x off-screen: ${JSON.stringify(p)}`);
    assert.ok(p.y >= 8 && p.y + 60 <= 780 - 8, `y off-screen: ${JSON.stringify(p)}`);
  }
});
