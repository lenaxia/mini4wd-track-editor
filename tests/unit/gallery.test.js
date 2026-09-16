import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  GALLERY_SORTS, galleryQuery, formatFootprint, completeBadge,
  readStarred, isStarred, addStarred, removeStarred, thumbFit,
} from '../../src/gallery.js';

/* Map-backed localStorage stub — node --test has no webstorage (same
 * pattern as storage.test.js). */
const backing = new Map();
const ls = {
  getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  setItem: (k, v) => backing.set(k, String(v)),
  removeItem: (k) => backing.delete(k),
};

beforeEach(() => backing.clear());

/* The server rejects unknown sort columns with a 400 (server.js
 * parseListQuery) — every offered sort must stay inside that set. */
const SERVER_SORTS = /^-?(updated_at|created_at|name|pieces|length|lanes|bbox|straights|corners|stars|complete)$/;

test('every gallery sort is a column the API accepts', () => {
  assert.ok(GALLERY_SORTS.length >= 5);
  for (const s of GALLERY_SORTS) {
    assert.match(s.value, SERVER_SORTS, `sort "${s.value}" not accepted by the API`);
    assert.ok(s.label.length > 0);
  }
});

test('galleryQuery builds the list query; complete only when asked', () => {
  assert.equal(galleryQuery({ sort: '-length', complete: false, limit: 25, offset: 0 }),
    'sort=-length&limit=25&offset=0');
  assert.equal(galleryQuery({ sort: '-updated_at', complete: true, limit: 25, offset: 50 }),
    'sort=-updated_at&limit=25&offset=50&complete=true');
});

test('formatFootprint stays in cm under a meter, switches to m above', () => {
  assert.equal(formatFootprint(95.4, 60.25), '95\u00D760 cm');
  assert.equal(formatFootprint(240, 95), '2.4\u00D70.95 m');
  assert.equal(formatFootprint(154.3, 208.9), '1.54\u00D72.09 m');
  assert.equal(formatFootprint(0, 0), '\u2014');   /* empty track, no bbox */
});

test('completeBadge: ok check, wip cross with issue count, plain cross', () => {
  assert.deepEqual(completeBadge({ complete: 1 }), { text: '\u2713', cls: 'ok', title: 'complete track' });
  assert.deepEqual(completeBadge({ complete: 0, issues: 2 }),
    { text: '\u2716 2', cls: 'wip', title: 'work in progress \u00B7 2 issue(s)' });
  assert.deepEqual(completeBadge({ complete: 0, issues: 0 }),
    { text: '\u2716', cls: 'wip', title: 'work in progress' });
});

test('starred ids round-trip through localStorage, de-duplicated', () => {
  assert.deepEqual(readStarred(ls), []);
  assert.equal(isStarred(ls, 'abc'), false);
  addStarred(ls, 'abc');
  addStarred(ls, 'abc');                    /* one star per browser per track */
  assert.deepEqual(readStarred(ls), ['abc']);
  assert.equal(isStarred(ls, 'abc'), true);
  addStarred(ls, 'def');
  assert.deepEqual(readStarred(ls), ['abc', 'def']);
});

test('removeStarred drops one id, keeps the rest, never throws', () => {
  addStarred(ls, 'abc');
  addStarred(ls, 'def');
  assert.deepEqual(removeStarred(ls, 'abc'), ['def']);
  assert.equal(isStarred(ls, 'abc'), false);
  assert.deepEqual(removeStarred(ls, 'not-there'), ['def']);   /* inert */
  const broken = {
    getItem: () => { throw new Error('private'); },
    setItem: () => { throw new Error('private'); },
    removeItem: () => {},
  };
  assert.doesNotThrow(() => removeStarred(broken, 'abc'));
});

/* thumbFit: maps track coords (cm) into a canvas box (px), center-fit
 * with padding — the gallery card preview geometry. */
test('thumbFit center-fits a piece into the box', () => {
  /* one Str1 (54x36 cm) at the origin, 80x60 px box, 4px pad */
  const t = thumbFit([{ name: 'Str1', x: 0, y: 0, a: 0, c: 0, z: 0 }], 80, 60);
  assert.ok(t);
  assert.ok(Math.abs(t.scale - 72 / 54) < 1e-9);           /* width-bound */
  /* centered: track x [-27,27] -> box centre 40 */
  const cx = t.cx + t.scale * 27;                          /* right edge */
  const cl = t.cx - t.scale * 27;                          /* left edge */
  assert.ok(Math.abs((cx + cl) / 2 - 40) < 1e-9);
  assert.ok(Math.abs((cx - cl) - 72) < 1e-9);              /* padded width */
});

test('thumbFit rotates the footprint (a 90-deg straight swaps w/h)', () => {
  const t = thumbFit([{ name: 'Str1', x: 0, y: 0, a: 90, c: 0, z: 0 }], 80, 60);
  assert.ok(Math.abs(t.scale - 52 / 54) < 1e-9);           /* height-bound now */
});

test('thumbFit spans every piece and recenters off-origin tracks', () => {
  const t = thumbFit([
    { name: 'Str1', x: 500, y: -300, a: 0, c: 0, z: 0 },
    { name: 'Str1', x: 630, y: -300, a: 0, c: 0, z: 0 },
  ], 80, 60);
  /* span: 54 + (630-500) = 184 cm wide, 36 tall; width-bound */
  assert.ok(Math.abs(t.scale - 72 / 184) < 1e-9);
  const midX = t.cx + t.scale * ((500 - 27) + (630 + 27)) / 2;
  assert.ok(Math.abs(midX - 40) < 1e-6);                   /* recentered */
  assert.equal(thumbFit([], 80, 60), null);                /* empty track */
});

test('starred storage never throws: corrupt json, private mode', () => {
  backing.set('m4wd.starred', '{not json');
  assert.deepEqual(readStarred(ls), []);
  assert.equal(isStarred(ls, 'abc'), false);
  const broken = {
    getItem: () => { throw new Error('private'); },
    setItem: () => { throw new Error('private'); },
    removeItem: () => {},
  };
  assert.deepEqual(readStarred(broken), []);
  assert.doesNotThrow(() => addStarred(broken, 'abc'));
  assert.equal(isStarred(broken, 'abc'), false);
});
