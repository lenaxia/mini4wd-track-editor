/* Store conformance + stress — every durable driver must pass the SAME
 * suite (the owner's robustness bar). Runs against memory + sqlite
 * always; postgres too when PG_TEST_URL is set (CI runs it against a
 * real postgres service). Because a postgres database persists across
 * tests (and across local runs), every test namespaced: rows carry a
 * unique author and every count-asserting query filters by it. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { facets } from '../../lib/store/facets.js';

const trackStr = (n) => Array.from({ length: n }, (_, i) =>
  `Str1;${100 + i * 30}.000;${100 + (i % 5) * 25}.000;${(i % 8) * 45};${i % 3};${(i % 2) * 75}#`).join('');
const doc = (n) => ({ track: trackStr(n), mode: 3 });
const ns = () => `suite-${process.pid.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const tmpDirs = [];
test.after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });
async function tmpSqlite() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm4wd-store-'));
  tmpDirs.push(dir);
  return path.join(dir, 't.db');
}

function suite(label, open) {
  test(`${label}: CRUD roundtrip with facet correctness`, async () => {
    const s = await open(); const A = ns();
    const meta = await s.upsert({ id: 't1', name: 'Hairpin heaven', author: A, data: doc(7), _facets: facets(doc(7)) });
    assert.equal(meta.piece_count, 7);
    assert.equal(meta.name, 'Hairpin heaven');
    const got = await s.get('t1');
    assert.equal(got.data.track.split('#').length - 1, 7);
    assert.ok(await s.remove('t1'));
    assert.equal(await s.get('t1'), null);
    assert.equal(await s.remove('t1'), false);
    await s.close();
  });

  test(`${label}: upsert is idempotent and preserves created_at`, async () => {
    const s = await open(); const A = ns();
    const first = await s.upsert({ id: 'dup', name: 'a', author: A, data: doc(3), _facets: facets(doc(3)) });
    await new Promise(r => setTimeout(r, 5));
    const second = await s.upsert({ id: 'dup', name: 'b', author: A, data: doc(5), _facets: facets(doc(5)) });
    const list = await s.list({ author: A, sort: '-updated_at', limit: 100 });
    assert.equal(list.total, 1);
    assert.equal(second.name, 'b');
    assert.equal(second.piece_count, 5);
    assert.equal(second.created_at, first.created_at);
    assert.ok(second.updated_at >= first.updated_at);
    await s.close();
  });

  test(`${label}: unicode, emoji, quotes, injection strings are inert data`, async () => {
    const s = await open(); const A = ns();
    const nasty = [`Robert'); DROP TABLE tracks;--`, `<script>alert(1)</script>`, '日本語トラック 🏁', "o'brien", `%"_`];
    for (let i = 0; i < nasty.length; i++) {
      const m = await s.upsert({ id: `inj-${i}`, name: nasty[i], author: nasty[i], data: doc(1), _facets: facets(doc(1)) });
      assert.equal(m.name, nasty[i]);
    }
    const got = await s.get('inj-0');
    assert.equal(got.name, nasty[0]);
    const q = await s.list({ author: nasty[0], sort: '-updated_at' });
    assert.equal(q.total, 1);
    const all = await s.list({ author: nasty[1], sort: 'name', limit: 100 });
    assert.equal(all.total, 1);
    await s.close();
  });

  test(`${label}: filters and sorts compose`, async () => {
    const s = await open(); const A = ns();
    await s.upsert({ id: 'f1', name: 'one', author: A, data: doc(3), _facets: facets(doc(3)) });
    await s.upsert({ id: 'f2', name: 'two', author: A, data: doc(9), _facets: facets(doc(9)) });
    await s.upsert({ id: 'f3', name: 'three', author: A, data: doc(12), _facets: facets(doc(12)) });
    const byPieces = await s.list({ author: A, sort: '-pieces' });
    assert.deepEqual(byPieces.items.map(i => i.id), ['f3', 'f2', 'f1']);
    const big = await s.list({ author: A, min_pieces: 5, sort: 'pieces' });
    assert.deepEqual(big.items.map(i => i.id), ['f2', 'f3']);
    const none = await s.list({ author: A, min_pieces: 100 });
    assert.equal(none.total, 0);
    await s.close();
  });

  test(`${label}: pagination is deterministic under sort ties`, async () => {
    const s = await open(); const A = ns();
    for (let i = 0; i < 25; i++) await s.upsert({ id: `p${String(i).padStart(2, '0')}`, name: 'same', author: A, data: doc(2), _facets: facets(doc(2)) });
    const seen = [];
    for (let off = 0; off < 30; off += 10) {
      const page = await s.list({ author: A, sort: 'name', limit: 10, offset: off });
      seen.push(...page.items.map(i => i.id));
    }
    assert.equal(new Set(seen).size, seen.length);   /* no dup across pages */
    assert.equal(seen.length, 25);
    await s.close();
  });

  test(`${label}: concurrent upserts all land`, async () => {
    const s = await open(); const A = ns();
    await Promise.all(Array.from({ length: 200 }, (_, i) =>
      s.upsert({ id: `c${i}`, name: `c${i}`, author: A, data: doc(i % 20), _facets: facets(doc(i % 20)) })));
    const all = await s.list({ author: A, sort: 'name', limit: 100 });
    assert.equal(all.total, 200);
    for (const it of all.items.slice(0, 20)) {
      const row = await s.get(it.id);
      assert.equal(row.data.track.split('#').length - 1, it.piece_count);
    }
    await s.close();
  });

  test(`${label}: scale — 5k tracks, indexed queries stay fast`, async () => {
    const s = await open(); const A = ns();
    const BATCH = 250;
    for (let b = 0; b < 20; b++) {
      await Promise.all(Array.from({ length: BATCH }, (_, i) => {
        const n = b * BATCH + i;
        const pieces = (n % 40) + 1;
        return s.upsert({ id: `s${String(n).padStart(5, '0')}`, name: `track ${n}`,
          author: n % 3 === 0 ? `${A}-alice` : n % 3 === 1 ? `${A}-bob` : null,
          data: doc(pieces), _facets: facets(doc(pieces)) });
      }));
    }
    const budgets = [
      [{ author: `${A}-alice`, min_pieces: 20, sort: '-pieces', limit: 100 }, 2500],
      [{ sort: '-length', limit: 100 }, 2500],
      [{ author: `${A}-bob`, sort: 'name', limit: 100 }, 2500],
    ];
    for (const [q, budgetMs] of budgets) {
      const t0 = performance.now();
      const res = await s.list(q);
      const dt = performance.now() - t0;
      assert.equal(res.items.length, 100);
      assert.ok(dt < budgetMs, `${label} ${JSON.stringify(q)} took ${dt.toFixed(0)}ms (budget ${budgetMs}ms)`);
    }
    await s.close();
  });

  test(`${label}: stars start at 0, increment, unstar floors at 0, re-saves keep the count`, async () => {
    const s = await open(); const A = ns();
    await s.upsert({ id: 'st1', name: 'starred', author: A, data: doc(2), _facets: facets(doc(2)) });
    assert.equal((await s.get('st1')).stars, 0);      /* column default, never null */
    assert.equal(await s.unstar('st1'), 0);           /* floor: never negative */
    assert.equal(await s.star('st1'), 1);
    assert.equal(await s.star('st1'), 2);
    assert.equal(await s.unstar('st1'), 1);
    assert.equal(await s.unstar('st1'), 0);
    assert.equal(await s.unstar('st1'), 0);           /* stays at the floor */
    await s.upsert({ id: 'st1', name: 'starred v2', author: A, data: doc(4), _facets: facets(doc(4)) });
    const row = await s.get('st1');
    assert.equal(row.stars, 0);                       /* a re-save never resets stars */
    assert.equal(row.piece_count, 4);
    assert.equal(await s.star('nope'), null);         /* unknown id, no throw */
    assert.equal(await s.unstar('nope'), null);
    await s.close();
  });

  /* worklog 0020: archive/history/revision + the 25-version cap */
  test(`${label}: version history — archive, cap, newest-first, delete cascades`, async () => {
    const s = await open(); const A = ns();
    await s.upsert({ id: 'hv', name: 'v0', author: A, data: doc(2), _facets: facets(doc(2)) });
    for (let i = 1; i <= 30; i++) await s.archive('hv', { id: 'hv', name: `v${i}`, data: doc(2) });
    const items = await s.history('hv');
    assert.equal(items.length, 25);                   /* capped: v6..v30 survive */
    assert.ok(items[0].seq > items[1].seq);           /* newest first */
    assert.equal(items[0].name, 'v30');
    assert.equal(items[24].name, 'v6');
    const snap = await s.revision('hv', items[0].seq);
    assert.equal(snap.name, 'v30');                   /* the snapshot carries the row */
    assert.equal(await s.revision('hv', 999999), null);
    assert.equal(await s.revision('nope', 1), null);
    assert.deepEqual(await s.history('nope'), []);    /* unknown id: empty, no throw */
    assert.ok(await s.remove('hv'));
    assert.deepEqual(await s.history('hv'), []);      /* delete takes the versions too */
    await s.close();
  });

  test(`${label}: setFacets converges a row without re-saving (sweep path)`, async () => {
    const s = await open(); const A = ns();
    await s.upsert({ id: 'sf1', name: 'flat', author: A, data: doc(2), _facets: facets(doc(2)) });
    const slopeDoc = { track: 'Bri1;100.000;100.000;0;0;0#Str1;160.000;100.000;0;0;0#' };
    await s.upsert({ id: 'sf2', name: 'hilly', author: A, data: slopeDoc, _facets: facets(slopeDoc) });
    assert.equal((await s.get('sf2')).slopes, 1);
    assert.equal((await s.get('sf2')).straights, 1);   /* the slope is NOT a straight */
    /* a pre-v2 row (slopes folded into straights) is re-stamped via
     * setFacets — no re-save needed. Two slopes so -slopes ordering is
     * deterministic against sf2's one. */
    const twoSlopes = { track: 'Bri1;100.000;100.000;0;0;0#Bri1;160.000;100.000;0;0;0#' };
    await s.setFacets('sf1', facets(twoSlopes));
    const converged = await s.get('sf1');
    assert.equal(converged.slopes, 2);
    assert.equal(converged.straights, 0);
    assert.equal(converged.piece_count, 2);
    /* slopes is a sortable column */
    const bySlopes = await s.list({ author: A, sort: '-slopes' });
    assert.equal(bySlopes.items[0].id, 'sf1');
    assert.ok(bySlopes.items.every((i) => typeof i.slopes === 'number'));
    await s.close();
  });

  test(`${label}: large track bodies (10k pieces) roundtrip`, async () => {
    const s = await open(); const A = ns();
    const big = doc(10000);
    await s.upsert({ id: 'big', name: 'big', author: A, data: big, _facets: facets(big) });
    const got = await s.get('big');
    assert.equal(got.piece_count, 10000);
    await s.close();
  });
}

/* memory: always */
suite('memory', async () => (await import('../../lib/store/memory.js')).open());

/* sqlite: always, on a fresh temp file */
suite('sqlite', async () => {
  const p = await tmpSqlite();
  return (await import('../../lib/store/sqlite.js')).open(p);
});

test('sqlite: reopen keeps data (durability across restarts)', async () => {
  const p = await tmpSqlite();
  const a = (await import('../../lib/store/sqlite.js')).open(p);
  await a.upsert({ id: 'dur', name: 'durable', data: doc(4), _facets: facets(doc(4)) });
  await a.close();
  const b = (await import('../../lib/store/sqlite.js')).open(p);
  const row = await b.get('dur');
  assert.equal(row.name, 'durable');
  assert.equal(row.piece_count, 4);
  await b.close();
});

/* postgres: only when a test URL is provided (CI service container) */
if (process.env.PG_TEST_URL) {
  suite('postgres', async () => (await import('../../lib/store/pg.js')).open(process.env.PG_TEST_URL));
} else {
  test('postgres: SKIPPED (set PG_TEST_URL to run the same suite)', { skip: true }, () => {});
}
