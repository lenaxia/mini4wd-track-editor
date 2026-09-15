import { test, beforeEach, mock } from 'node:test';
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

/* ---------- server mirror: retry semantics (mock timers) ---------- */

function deferredFetch(handler) {
  const calls = [];
  globalThis.fetch = (...a) => { calls.push(a); return handler(a, calls.length); };
  return calls;
}
/* advance in 50ms steps with microtask flushes: a timer scheduled DURING a
 * tick does not fire until the next tick call, and the debounce chain
 * schedules nested timers */
const fire = async (ms) => {
  for (let done = 0; done < ms; done += 50) {
    mock.timers.tick(Math.min(50, ms - done));
    await Promise.resolve(); await Promise.resolve();
  }
};

test('mirror: permanent 4xx is never retried (static-only server = one PUT)', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const calls = deferredFetch(() => Promise.resolve({ ok: false, status: 404 }));
    autosave(makeState());
    await fire(350 + 1500);
    assert.equal(calls.length, 1);
    mock.timers.tick(30000);           /* would cover every retry if any */
    assert.equal(calls.length, 1);
  } finally { mock.timers.reset(); }
});

test('mirror: network failure retries with backoff, then gives up at 4 attempts', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const calls = deferredFetch(() => Promise.reject(new Error('offline')));
    autosave(makeState());
    await fire(350 + 1500);
    assert.equal(calls.length, 1);
    await fire(2000);
    assert.equal(calls.length, 2);
    await fire(4000);
    assert.equal(calls.length, 3);
    await fire(6000);
    assert.equal(calls.length, 4);
    mock.timers.tick(30000);
    assert.equal(calls.length, 4);     /* gave up: no 5th attempt */
  } finally { mock.timers.reset(); }
});

test('mirror: 5xx retries, 2xx stops, and a newer edit abandons an old chain', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let mode = 500;
    const calls = deferredFetch(() => Promise.resolve({ ok: mode < 400, status: mode }));
    autosave(makeState());
    await fire(350 + 1500);
    assert.equal(calls.length, 1);     /* chain A attempt 0 (500) */
    autosave(makeState());             /* chain B supersedes A mid-backoff */
    await fire(350 + 1500);
    assert.equal(calls.length, 2);     /* chain B attempt 0 (500) */
    mode = 200;
    await fire(2000);
    assert.equal(calls.length, 3);     /* chain B retry lands 200 -> stops */
    mock.timers.tick(30000);           /* chain A's pending retry is stale:
                                         guard at fetch time -> no call */
    assert.equal(calls.length, 3);
  } finally { mock.timers.reset(); }
});

test('mirror: body carries the snapshot under the stable track id', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const calls = deferredFetch(() => Promise.resolve({ ok: true, status: 200 }));
    autosave(makeState());
    await fire(350 + 1500);
    const [url, init] = calls[0];
    assert.match(url, /^\/api\/tracks\/[0-9a-f-]{6,}$/);
    const body = JSON.parse(init.body);
    assert.equal(body.name, 'Untitled');
    assert.ok(body.data.track.includes('Str2;'));
  } finally { mock.timers.reset(); }
});
