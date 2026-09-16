import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldArchive, keepSet, TIERS } from '../../lib/store/retention.js';

const MIN = 60 * 1000, H = 60 * MIN, D = 24 * H;
const now = Date.now();
const e = (seq, age) => ({ seq, created_at: now - age });

test('stability rule: a head that lived under the window is never archived', () => {
  assert.equal(shouldArchive(now - 4 * MIN, now), false);   /* mid-burst */
  assert.equal(shouldArchive(now - 5 * MIN, now), true);    /* stable */
  assert.equal(shouldArchive(now - 10 * MIN, now), true);
  assert.equal(shouldArchive(undefined, now), true);        /* unknown age: keep, never lose */
  assert.equal(shouldArchive(NaN, now), true);
});

test('keepSet: newest always survives; a rapid burst collapses to one', () => {
  const kept = keepSet([e(1, 1 * MIN), e(2, 30_000), e(3, 500)]);
  assert.deepEqual([...kept].sort(), [3]);                  /* only the newest of the burst */
});

test('keepSet: 5-minute spacing inside the last half hour', () => {
  const kept = keepSet([e(1, 0), e(2, 3 * MIN), e(3, 6 * MIN), e(4, 11 * MIN)]);
  assert.deepEqual([...kept].sort((a, b) => a - b), [1, 3, 4]);   /* 6- and 11-minute gaps pass, 3 doesn't */
});

test('keepSet: hourly spacing in the 30-min..4h band', () => {
  const kept = keepSet([e(1, 0), e(2, 40 * MIN), e(3, 80 * MIN), e(4, 150 * MIN)]);
  /* e2 (40 min old) needs a 1h gap below the newest → dropped; e3 is 80m down (≥1h, kept); e4 is 70m below e3 (≥1h, kept) */
  assert.deepEqual([...kept].sort((a, b) => a - b), [1, 3, 4]);
});

test('keepSet: daily spacing in the 4h..7d band; older is dropped', () => {
  const kept = keepSet([
    e(1, 0), e(2, 5 * H), e(3, 29 * H), e(4, 53 * H), e(5, 8 * D),
  ]);
  /* e2 (5h old) needs a 1d gap below newest → dropped; e3→e4 are 24h apart → both kept; e5 is past the week */
  assert.deepEqual([...kept].sort((a, b) => a - b), [1, 3, 4]);
});

test('keepSet: worst-case retained stays small (~17)', () => {
  /* fill every minute for a week — the ladder must thin it hard */
  const entries = [];
  for (let m = 0; m < 7 * 24 * 60; m += 1) entries.push(e(entries.length + 1, m * MIN));
  const kept = keepSet(entries);
  assert.ok(kept.size > 10 && kept.size <= 20, `kept=${kept.size}`);
});

test('tiers widen monotonically and end at a week', () => {
  let prev = 0;
  for (const t of TIERS) { assert.ok(t.maxAge > prev); assert.ok(t.spacing >= prev); prev = t.maxAge; }
  assert.equal(TIERS[TIERS.length - 1].maxAge, 7 * D);
});
