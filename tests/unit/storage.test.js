import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { autosave, restore } from '../../src/storage.js';

/* Map-backed localStorage stub — node --test has no webstorage. */
const backing = new Map();
globalThis.localStorage = {
  getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  setItem: (k, v) => backing.set(k, String(v)),
  removeItem: (k) => backing.delete(k),
};

const KEY = 'm4wd.autosave';

function makeState() {
  return {
    mode: 5,
    tool: 'Str4',
    angle: 90,
    sprites: [
      { name: 'Str2', x: 100.5, y: 100, a: 0, c: 0, z: 0 },
      { name: 'Cor1', x: 154.25, y: 100, a: 45, c: 3, z: 75 },
    ],
  };
}

beforeEach(() => backing.clear());

test('autosave then restore round-trips through localStorage', async () => {
  autosave(makeState());
  await new Promise((r) => setTimeout(r, 450)); /* debounce is 350ms */

  const state = { mode: 3, tool: 'Pan', angle: 0, sprites: [] };
  assert.equal(restore(state), true);
  assert.equal(state.mode, 5);
  assert.equal(state.angle, 90);
  /* coords pass through serialize's toFixed(3) — exact for these values */
  assert.deepEqual(state.sprites, [
    { name: 'Str2', x: 100.5, y: 100, a: 0, c: 0, z: 0 },
    { name: 'Cor1', x: 154.25, y: 100, a: 45, c: 3, z: 75 },
  ]);
});

test('autosave keeps negative-origin pieces (translated, not dropped)', async () => {
  const state = {
    mode: 3, tool: 'Move', angle: 0,
    sprites: [
      { name: 'Str1', x: -30, y: -68, a: 0, c: 0 },
      { name: 'Str1', x: 100, y: 50, a: 0, c: 0 },
    ],
  };
  autosave(state);
  await new Promise((r) => setTimeout(r, 450));

  const restored = { mode: 3, tool: 'Pan', angle: 0, sprites: [] };
  assert.equal(restore(restored), true);
  assert.equal(restored.sprites.length, 2);
  assert.ok(restored.sprites.every((p) => p.x >= 0 && p.y >= 0));
  assert.equal(restored.sprites[1].x - restored.sprites[0].x, 130); /* layout kept */
  assert.equal(restored.sprites[1].y - restored.sprites[0].y, 118);
});

test('restore returns false with nothing saved', () => {
  const state = { mode: 3, tool: 'Pan', angle: 0, sprites: [] };
  assert.equal(restore(state), false);
  assert.deepEqual(state.sprites, []);
});

test('restore tolerates malformed saved data', () => {
  backing.set(KEY, '{not json');
  const state = { mode: 3, tool: 'Pan', angle: 0, sprites: [] };
  assert.equal(restore(state), false);
  assert.deepEqual(state.sprites, []);
});
