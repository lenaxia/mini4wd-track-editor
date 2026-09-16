import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { autosave, restore, publishTrack, publishedTrack, unpublishTrack } from '../../src/storage.js';

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

/* ---------- publish model (mock timers + mock fetch) ---------- */

function deferredFetch(handler) {
  const calls = [];
  globalThis.fetch = (...a) => { calls.push(a); return handler(a, calls.length); };
  return calls;
}
const fire = async (ms) => {
  for (let done = 0; done < ms; done += 50) {
    mock.timers.tick(Math.min(50, ms - done));
    await Promise.resolve(); await Promise.resolve();
  }
};
const reset = () => { backing.delete('m4wd.published'); };

test('unpublished tracks are local-only: autosave never touches the server', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    reset();
    const calls = deferredFetch(() => Promise.resolve({ ok: true, status: 200 }));
    autosave(makeState());
    await fire(350 + 4000);
    assert.equal(calls.length, 0);          /* no POST, no PUT — owner rule */
  } finally { mock.timers.reset(); }
});

test('publishTrack POSTs when unbound, PUTs (renames) when bound', async () => {
  reset();
  const calls = deferredFetch((args) => Promise.resolve({
    ok: true, status: 201, json: async () => ({ id: 'row-1', name: JSON.parse(args[1].body).name }),
  }));
  const row = await publishTrack('Hairpins', makeState());
  assert.equal(row.id, 'row-1');
  assert.equal(calls[0][0], '/api/tracks');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(JSON.parse(calls[0][1].body).name, 'Hairpins');
  assert.equal(publishedTrack().id, 'row-1');

  const row2 = await publishTrack('Renamed', makeState());
  assert.equal(calls[1][0], '/api/tracks/row-1');
  assert.equal(calls[1][1].method, 'PUT');
  assert.equal(publishedTrack().name, 'Renamed');
});

test('published tracks mirror every autosave under the bound name', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    reset();
    const calls = deferredFetch(() => Promise.resolve({ ok: true, status: 200 }));
    backing.set('m4wd.published', JSON.stringify({ id: 'pub-9', name: 'Mine' }));
    autosave(makeState());
    await fire(350 + 1500);
    assert.equal(calls.length, 1);
    const [url, init] = calls[0];
    assert.equal(url, '/api/tracks/pub-9');
    const body = JSON.parse(init.body);
    assert.equal(body.name, 'Mine');
    assert.ok(body.data.track.includes('Str2;'));
  } finally { mock.timers.reset(); }
});

test('mirror: network failure retries with backoff, then gives up at 4 attempts', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    reset();
    const calls = deferredFetch(() => Promise.reject(new Error('offline')));
    backing.set('m4wd.published', JSON.stringify({ id: 'pub-9', name: 'Mine' }));
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
    assert.equal(calls.length, 4);
  } finally { mock.timers.reset(); }
});

test('unpublish stops the mirror (New Track)', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    reset();
    const calls = deferredFetch(() => Promise.resolve({ ok: true, status: 200 }));
    backing.set('m4wd.published', JSON.stringify({ id: 'pub-9', name: 'Mine' }));
    unpublishTrack();
    autosave(makeState());
    await fire(350 + 4000);
    assert.equal(calls.length, 0);
  } finally { mock.timers.reset(); }
});
