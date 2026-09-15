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

/* ---------- server mirror: retry semantics (fake timers) ---------- */

const realSetTimeout = globalThis.setTimeout;
function deferredFetch(handler) {
  const calls = [];
  globalThis.fetch = (...a) => { calls.push(a); return handler(a, calls.length); };
  return calls;
}
const flush = (ms) => new Promise((r) => realSetTimeout(r, ms));

test('mirror: permanent 4xx is never retried (static-only server = one PUT)', async () => {
  const calls = deferredFetch(() => Promise.resolve({ ok: false, status: 404 }));
  autosave(makeState());
  await flush(350 + 1500 + 100);          /* debounce chain + slack */
  await flush(14000);                     /* would cover all retries if any */
  assert.equal(calls.length, 1);
});

test('mirror: network failure retries with backoff, then gives up at 4 attempts', async () => {
  const calls = deferredFetch(() => Promise.reject(new Error('offline')));
  autosave(makeState());
  await flush(350 + 1500 + 100);
  assert.equal(calls.length, 1);          /* attempt 0 fired; retries pending */
  await flush(2000 + 50);                 /* +2s backoff -> attempt 1 */
  assert.equal(calls.length, 2);
  await flush(4000 + 6000 + 100);         /* attempts 2 and 3 */
  assert.equal(calls.length, 4);
  await flush(20000);
  assert.equal(calls.length, 4);          /* gave up: no 5th attempt */
});

test('mirror: 5xx retries, 2xx stops, and a newer edit abandons an old chain', async () => {
  let mode = 500;
  const calls = deferredFetch(() => Promise.resolve({ ok: mode < 400, status: mode }));
  autosave(makeState());
  await flush(350 + 1500 + 100);
  assert.equal(calls.length, 1);          /* chain A attempt 0 (500) */
  autosave(makeState());
  await flush(350 + 1500 + 100);
  assert.equal(calls.length, 2);          /* chain B attempt 0 (500) */
  mode = 200;
  await flush(2000 + 100);                /* chain B retry lands 200 -> stops */
  assert.equal(calls.length, 3);
  await flush(10000);                     /* chain A's pending retry fires but
                                             is generation-stale: no fetch */
  assert.equal(calls.length, 3);
});

test('mirror: body carries the snapshot under the stable track id', async () => {
  const calls = deferredFetch(() => Promise.resolve({ ok: true, status: 200 }));
  autosave(makeState());
  await flush(350 + 1500 + 100);
  const [url, init] = calls[0];
  assert.match(url, /^\/api\/tracks\/[0-9a-f-]{6,}$/);
  const body = JSON.parse(init.body);
  assert.equal(body.name, 'Untitled');
  assert.ok(body.data.track.includes('Str2;'));
});
