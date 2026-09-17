import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseTrip, tripHash, tripCode, _resetSaltCache } from '../../lib/tripcode.js';

test('parseTrip: name#phrase splits on the first #', () => {
  assert.deepEqual(parseTrip('Alex#secret phrase'), { name: 'Alex', phrase: 'secret phrase' });
  assert.deepEqual(parseTrip('Alex'), { name: 'Alex', phrase: null });
  assert.deepEqual(parseTrip('#justaphrase'), { name: null, phrase: 'justaphrase' });
  assert.deepEqual(parseTrip(''), { name: null, phrase: null });
  assert.deepEqual(parseTrip(null), { name: null, phrase: null });
  assert.deepEqual(parseTrip('weird#two#hashes'), { name: 'weird', phrase: 'two#hashes' });
  assert.deepEqual(parseTrip('  spaced  #  padded  '), { name: 'spaced', phrase: 'padded' });
  assert.deepEqual(parseTrip('Alex#'), { name: 'Alex', phrase: null });   /* empty phrase = no lock */
});

test('tripHash: deterministic per salt, distinct per phrase, hex', () => {
  const a = tripHash('open sesame');
  assert.equal(a, tripHash('open sesame'));
  assert.notEqual(a, tripHash('open sesamf'));
  assert.match(a, /^[0-9a-f]{32}$/);
});

test('tripHash: output shape is stable regardless of env', () => {
  /* salt-dependence itself is pinned by the e2e suite (M4WD_TRIP_SALT
   * produces a matching TRIP_HASH contract); here: hex shape only */
  assert.match(tripHash('phrase'), /^[0-9a-f]{32}$/);
  assert.match(tripHash(''), /^[0-9a-f]{32}$/);
});

test('tripCode: 8-char display prefix', () => {
  assert.equal(tripCode('0123456789abcdef'), '01234567');
  assert.equal(tripCode(null), null);
  assert.equal(tripCode(undefined), null);
});

/* ---------- salt file resolution (issue #66) ---------- */

test('salt file lands beside SQLITE_PATH and the hash is stable', () => {
  _resetSaltCache();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm4wd-salt-'));
  const env = { SQLITE_PATH: path.join(dir, 'tracks.db') };
  const h = tripHash('persisted phrase', env);
  const p = path.join(dir, 'trip.salt');
  assert.ok(fs.existsSync(p), 'trip.salt beside the database');
  assert.match(fs.readFileSync(p, 'utf8'), /^[0-9a-f]{32}\n$/, 'hex + newline');
  const onDisk = fs.readFileSync(p, 'utf8').trim();
  assert.equal(crypto.scryptSync('persisted phrase', onDisk, 16).toString('hex'), h);
  assert.equal(tripHash('persisted phrase', env), h);   /* memoized, not regenerated */
});

test('M4WD_TRIP_SALT still wins over the salt file', () => {
  _resetSaltCache();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm4wd-salt-'));
  const env = { SQLITE_PATH: path.join(dir, 'tracks.db'), M4WD_TRIP_SALT: 'pinned' };
  assert.equal(tripHash('env phrase', env),
    crypto.scryptSync('env phrase', 'pinned', 16).toString('hex'));
});

test('unwritable salt location degrades to an ephemeral salt without throwing', () => {
  /* a regular file where the salt dir should be → mkdir fails ENOTDIR */
  const blocker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'm4wd-ro-')), 'blocker');
  fs.writeFileSync(blocker, '');
  const env = { SQLITE_PATH: path.join(blocker, 'sub', 'tracks.db') };
  _resetSaltCache();
  const h1 = tripHash('degraded', env);   /* must not throw */
  assert.match(h1, /^[0-9a-f]{32}$/);
  _resetSaltCache();
  assert.notEqual(tripHash('degraded', env), h1);   /* fresh random per resolution */
});

test('no SQLITE_PATH: salt still defaults to ./data next to the CWD', () => {
  _resetSaltCache();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm4wd-cwd-'));
  const cwd = process.cwd();
  process.chdir(tmp);
  try {
    tripHash('legacy', {});
    assert.ok(fs.existsSync(path.join(tmp, 'data', 'trip.salt')));
  } finally { process.chdir(cwd); }
});
