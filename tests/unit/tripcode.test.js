import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseTrip, tripHash, tripCode, tripMatches, _resetSaltCache, initSalt, saltSource } from '../../lib/tripcode.js';

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

test('no SQLITE_PATH: salt still defaults to ./data next to the CWD', async () => {
  _resetSaltCache();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm4wd-cwd-'));
  const cwd = process.cwd();
  process.chdir(tmp);
  try {
    await initSalt({});
    assert.ok(fs.existsSync(path.join(tmp, 'data', 'trip.salt')));
  } finally { process.chdir(cwd); }
});

test('lazy tripHash never creates directories — absent dir degrades to ephemeral', () => {
  /* directory creation is boot work (initSalt): the lazy path must not
   * recursive-mkdir, because that call can spin forever on
   * ENOENT-lying mounts */
  _resetSaltCache();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm4wd-salt-'));
  const sub = path.join(tmp, 'absent');
  assert.match(tripHash('lazy', { SQLITE_PATH: path.join(sub, 'tracks.db') }), /^[0-9a-f]{32}$/);
  assert.equal(saltSource(), 'ephemeral');
  assert.ok(!fs.existsSync(sub), 'no directory was created lazily');
});

test('initSalt: a hanging mkdir kills the boot instead of degrading', async () => {
  _resetSaltCache();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm4wd-salt-'));
  const real = fs.promises.mkdir;
  fs.promises.mkdir = () => new Promise(() => {});   /* never settles (lying mount) */
  try {
    await assert.rejects(
      initSalt({ SQLITE_PATH: path.join(tmp, 'absent', 'tracks.db') }),
      (e) => e.code === 'M4WD_MKDIR_TIMEOUT',
    );
    assert.notEqual(saltSource(), 'ephemeral');   /* timeout is loud, not a silent degrade */
  } finally { fs.promises.mkdir = real; }
});

/* Issue 64 — the DELETE lock gate. Unsigned rows (null hash) are always
 * open (the no-auth model); a stored hash opens only for the matching
 * phrase, presented as the raw byline form `name#phrase`. */
test('tripMatches: null stored hash means no lock — everything opens it', () => {
  assert.equal(tripMatches(null, null), true);
  assert.equal(tripMatches(null, undefined), true);
  assert.equal(tripMatches(null, ''), true);
  assert.equal(tripMatches(null, 'Alex#anything'), true);
});

test('tripMatches: stored hash requires the exact phrase', () => {
  const h = tripHash('secret phrase');
  assert.equal(tripMatches(h, 'Alex#secret phrase'), true);   /* name part ignored */
  assert.equal(tripMatches(h, '#secret phrase'), true);        /* anonymous form works too */
  assert.equal(tripMatches(h, 'Alex#wrong'), false);
  assert.equal(tripMatches(h, 'secret phrase'), false);       /* bare phrase is a name, not a phrase */
  assert.equal(tripMatches(h, null), false);
  assert.equal(tripMatches(h, ''), false);
  assert.equal(tripMatches(tripHash(''), 'Alex#'), false);    /* empty phrase never hashes to a lock's key */
});

test('existing salt dir is not mkdir-ed again', () => {
  /* recursive mkdir can spin forever on ENOENT-lying mounts — the
   * existsSync gate must keep it away from dirs we already have */
  _resetSaltCache();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm4wd-salt-'));
  const realMkdir = fs.mkdirSync;
  const realPmkdir = fs.promises.mkdir;
  const boom = () => { throw new Error('mkdir ran for an existing dir'); };
  fs.mkdirSync = boom;
  fs.promises.mkdir = boom;
  try {
    assert.match(tripHash('gated', { SQLITE_PATH: path.join(dir, 'tracks.db') }), /^[0-9a-f]{32}$/);
    assert.ok(fs.existsSync(path.join(dir, 'trip.salt')));
  } finally { fs.mkdirSync = realMkdir; fs.promises.mkdir = realPmkdir; }
});

test('initSalt: resolves at boot, primes the hash path, env still wins', async () => {
  _resetSaltCache();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm4wd-salt-'));
  const env = { SQLITE_PATH: path.join(dir, 'tracks.db') };
  const s = await initSalt(env);
  assert.match(s, /^[0-9a-f]{32}$/);
  assert.ok(fs.existsSync(path.join(dir, 'trip.salt')), 'salt file created at boot');
  /* boot-primed salt is exactly what later hashing uses (no further IO) */
  assert.equal(tripHash('boot primed', env), crypto.scryptSync('boot primed', s, 16).toString('hex'));
  assert.equal(await initSalt({ ...env, M4WD_TRIP_SALT: 'pinned' }), 'pinned');
});

test('saltSource: reports env | file | ephemeral for the live salt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm4wd-salt-'));
  _resetSaltCache();
  assert.equal(saltSource(), null);   /* nothing resolved yet */
  tripHash('src', { M4WD_TRIP_SALT: 'k' });
  assert.equal(saltSource(), 'env');
  _resetSaltCache();
  tripHash('src', { SQLITE_PATH: path.join(dir, 'tracks.db') });
  assert.equal(saltSource(), 'file');
  const blocker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'm4wd-ro-')), 'blocker');
  fs.writeFileSync(blocker, '');
  _resetSaltCache();
  tripHash('src', { SQLITE_PATH: path.join(blocker, 'sub', 'tracks.db') });
  assert.equal(saltSource(), 'ephemeral');
});
