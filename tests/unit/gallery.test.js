import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  GALLERY_SORTS, GALLERY_LANES, galleryQuery, formatFootprint, formatLength, completeBadge, lengthToCm,
  readStarred, isStarred, addStarred, removeStarred, thumbFit, trackFacets, formatVersionTime,
} from '../../src/gallery.js';
import { facets } from '../../lib/store/facets.js';
import { serializeForSave } from '../../src/track.js';

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
const SERVER_SORTS = /^-?(updated_at|created_at|name|pieces|length|lanes|bbox|straights|corners|slopes|stars|complete)$/;

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

/* the drawer's filter state -> query params (owner round 2026-09-16):
 * min length (m), lane selection (OR), footprint max W/H (cm after unit
 * conversion), max straights/slopes/corners */
test('galleryQuery serializes the drawer filters', () => {
  const q = galleryQuery({
    sort: '-stars', complete: true, limit: 25, offset: 0,
    filter: { minLength: 20, maxLength: 40, lanes: [3, 5], maxW: 240, maxH: 120, maxStraights: 6, maxSlopes: 2, maxCorners: 12 },
  });
  assert.equal(q, 'sort=-stars&limit=25&offset=0&complete=true&min_length=2000&max_length=4000&lanes=3,5'
    + '&max_bbox_w=240&max_bbox_h=120&max_straights=6&max_slopes=2&max_corners=12');
  /* max alone works; defaults emit nothing: all lanes selected = no lanes param, no caps */
  const maxOnly = galleryQuery({ sort: '-stars', complete: true, limit: 25, offset: 0,
    filter: { minLength: 0, maxLength: 30, lanes: [2, 3, 5], maxW: null, maxH: null, maxStraights: null, maxSlopes: null, maxCorners: null } });
  assert.equal(maxOnly, 'sort=-stars&limit=25&offset=0&complete=true&max_length=3000');
  const base = galleryQuery({ sort: '-stars', complete: true, limit: 25, offset: 0,
    filter: { minLength: 0, maxLength: 0, lanes: [2, 3, 5], maxW: null, maxH: null, maxStraights: null, maxSlopes: null, maxCorners: null } });
  assert.equal(base, 'sort=-stars&limit=25&offset=0&complete=true');
});

test('lengthToCm converts the footprint units (metric + imperial)', () => {
  assert.equal(lengthToCm(2, 'm'), 200);
  assert.equal(lengthToCm(240, 'cm'), 240);
  assert.equal(lengthToCm(96, 'in'), Math.round(96 * 2.54));
  assert.equal(lengthToCm(8, 'ft'), Math.round(8 * 30.48));
});

test('gallery lanes options are the catalog widths the owner called out', () => {
  assert.deepEqual(GALLERY_LANES, [2, 3, 5]);
});

test('formatLength/formatFootprint follow the gallery unit (m default, ft)', () => {
  assert.equal(formatLength(1240), '12.40 m');
  assert.equal(formatLength(1240, 'ft'), '40.7 ft');
  assert.equal(formatFootprint(240, 95), '2.4\u00D70.95 m');
  assert.equal(formatFootprint(59, 59), '0.59\u00D70.59 m');      /* decimals, no cm */
  assert.equal(formatFootprint(240, 95, 'ft'), '7.9\u00D73.1 ft');
  assert.equal(formatFootprint(0, 0), '\u2014');                  /* empty track, no bbox */
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

/* trackFacets: the topbar/popup metadata for the LOCAL sprites — must
 * classify exactly like the server's facet stamping (same catalog,
 * same kinds). Owner rulings 2026-09-16: waves are straights; SLOPES
 * ARE THEIR OWN COUNT (not interchangeable with straights);
 * HAIRPINS/RAINBOWS COUNT AS 4 CORNERS (a 180° turn is four 45°
 * pieces' worth). Specials excluded, lanes = max. Cross-checked
 * against lib/store/facets.js over a serialized round-trip so the
 * popup can never disagree with the stored row. */
test('trackFacets matches the server facet classification', () => {
  const sprites = [
    { name: 'Str1', x: 100, y: 100, a: 0, c: 0, z: 0 },
    { name: 'Chi1', x: 200, y: 100, a: 0, c: 1, z: 0 },     /* wave -> straight */
    { name: 'Bri1', x: 300, y: 100, a: 0, c: 2, z: 75 },    /* slope -> OWN count */
    { name: 'Cor1', x: 400, y: 100, a: 45, c: 3, z: 0 },    /* corner (45°) */
    { name: 'Lan2', x: 500, y: 100, a: 0, c: 0, z: 0 },     /* hairpin (rainbow) -> 4 corners */
    { name: 'Lan1', x: 600, y: 100, a: 0, c: 0, z: 0 },     /* lane changer — excluded */
    { name: 'Ban1', x: 700, y: 100, a: 0, c: 1, z: 0 },     /* bank — excluded */
  ];
  const local = trackFacets(sprites);
  const server = facets({ track: serializeForSave(sprites) });
  assert.deepEqual(local, {
    pieces: server.piece_count,
    length_cm: server.length_cm,
    lanes: server.lanes,
    straights: server.straights,       /* Str1 + wave only */
    slopes: server.slopes,             /* Bri1 — counted separately */
    corners: server.corners,           /* Cor1 + 4 for the hairpin */
  });
  assert.equal(local.straights, 2);
  assert.equal(local.slopes, 1);
  assert.equal(local.corners, 5);      /* 1 × 45° corner + 4 for the 180° */
  assert.equal(local.pieces, 7);
  assert.equal(local.lanes, 3);
  assert.deepEqual(trackFacets([]),
    { pieces: 0, length_cm: 0, lanes: 0, straights: 0, slopes: 0, corners: 0 });
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

/* worklog 0022: history timestamps */
test('formatVersionTime: time today, weekday within the week, date beyond', () => {
  const now = Date.now();
  const t = (ageMs) => now - ageMs;
  assert.match(formatVersionTime(t(30 * 60_000)), /^\d{1,2}:\d{2}/);            /* 30 min ago → HH:MM */
  assert.match(formatVersionTime(t(2 * 24 * 3600_000)), /^[A-Za-z]{3} \d{1,2}:\d{2}/);  /* 2 days → Wed 14:05 */
  assert.match(formatVersionTime(t(30 * 24 * 3600_000)), /^[A-Za-z]{3} \d{1,2} \d{1,2}:\d{2}/); /* a month back */
});
