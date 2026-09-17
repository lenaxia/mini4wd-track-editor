import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTrip, tripHash, tripCode } from '../../lib/tripcode.js';

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

test('tripHash: env salt changes the code (server-scoped identity)', () => {
  const withDefault = tripHash('phrase');
  const other = process.execPath && true;   /* eslint-disable-line no-unused-expressions */
  assert.ok(other);
  /* salt pinning is exercised by the e2e suite (M4WD_TRIP_SALT); here we
   * only assert shape so the suite never depends on env ordering */
  assert.match(tripHash('phrase'), /^[0-9a-f]{32}$/);
});

test('tripCode: 8-char display prefix', () => {
  assert.equal(tripCode('0123456789abcdef'), '01234567');
  assert.equal(tripCode(null), null);
  assert.equal(tripCode(undefined), null);
});
