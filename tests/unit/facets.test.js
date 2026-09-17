/* Piece-count cap + total fullFacets (issue #63: unauthenticated CPU
 * DoS — validateTrack is super-quadratic on crafted coincident pieces,
 * measured 11.6 s @1600; the 512 KiB track cap admits ~19k pieces). */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  facets, fullFacets, pieceCount, assertWritableTrack,
  MAX_PIECES, ISSUES_OVER_CAP, MAX_TRACK_BYTES_EXPORTED,
} from '../../lib/store/facets.js';

const row = (name) => `${name};10.000;10.000;0;1;0#`;
const many = (n) => row('Str1').repeat(n);   /* all-coincident Str1 — the adversarial shape */

test('pieceCount counts v2, legacy, and malformed tracks', () => {
  assert.equal(pieceCount(''), 0);
  assert.equal(pieceCount('#'), 0);
  assert.equal(pieceCount('Str1;10.000;10.000;0;1;0#'), 1);
  assert.equal(pieceCount('Str1;10.000;10.000;0;1;0'), 1);          /* no trailing # */
  assert.equal(pieceCount('Str1;10;10;0;1#Cor1;20;20;45;2#'), 2);   /* 5-field legacy rows */
  assert.equal(pieceCount('Str1;10;10;0;1;0##Nope;1;2;3;4;5#'), 2); /* empty rows drop; unknown names COUNT (cap over-approximation) */
  assert.equal(pieceCount('Str1;10;10;0;1;0#junk'), 2);              /* a name-only trailing row is a row */
});

/* Timing bounds here guard the COMPLEXITY CLASS, not latency: measured
 * 2-16 ms, bounds are ~50-200x looser so a loaded shared CI runner
 * cannot flake them — while a quadratic regression (minutes at 19k
 * rows, ~20 s for an un-skipped validator at 2100) still fails hard. */
test('pieceCount stays linear on the 512 KiB ceiling (~19k rows)', () => {
  const poison = many(19000);
  assert.equal(pieceCount(poison), 19000);
  const t0 = process.hrtime.bigint();
  assert.equal(pieceCount(poison), 19000);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 500, `pieceCount took ${ms}ms on 19k rows — not linear?`);
});

test('assertWritableTrack enforces the cap at the exact boundary', () => {
  assert.equal(MAX_PIECES, 2000);
  assertWritableTrack(many(MAX_PIECES));   /* at the cap: allowed */
  assert.throws(() => assertWritableTrack(many(MAX_PIECES + 1)), /too many pieces \(max 2000\)/);
  assertWritableTrack('');                 /* empty track is the validator's business, not the cap's */
});

test('assertWritableTrack rejects a 19k-piece poison string in <500ms', () => {
  const poison = many(19000);
  const t0 = process.hrtime.bigint();
  assert.throws(() => assertWritableTrack(poison), /too many pieces/);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 500, `cap rejection took ${ms}ms — pre-validator cost must stay linear`);
});

test('fullFacets is total: oversized and over-cap rows never throw (issue #63 pin)', () => {
  /* pre-fix: facets() throws on >512 KiB and fullFacets called it outside
   * its try — one legacy oversized row aborted the whole sweep */
  const huge = { track: `${row('Str1')}${'x'.repeat(MAX_TRACK_BYTES_EXPORTED)}` };
  assert.throws(() => facets(huge), /too large/);
  const f = fullFacets(huge);
  assert.equal(f.piece_count, 0);
  assert.equal(f.complete, false);
  assert.equal(f.issues, ISSUES_OVER_CAP);

  /* over-cap but byte-legal: zeroed facets, sentinel issues, and the
   * quadratic validator SKIPPED — 2100 coincident pieces would burn
   * for minutes inside validateTrack (issue table: 1600 → 11.6 s) */
  const over = { track: many(MAX_PIECES + 100) };
  const t0 = process.hrtime.bigint();
  const g = fullFacets(over);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 2000, `over-cap fullFacets took ${ms}ms — validator not skipped?`);
  assert.equal(g.piece_count, 0);
  assert.equal(g.lanes, 0);
  assert.equal(g.complete, false);
  assert.equal(g.issues, ISSUES_OVER_CAP);
  assert.equal(typeof g.validator_version, 'number');
});

test('fullFacets unchanged for normal tracks: real facets + real validation', () => {
  const doc = { track: 'Str1;10.000;10.000;0;1;0#Cor1;40.000;10.000;90;1;0#' };
  const f = fullFacets(doc);
  assert.deepEqual(
    { piece_count: f.piece_count, lanes: f.lanes, straights: f.straights, corners: f.corners },
    { piece_count: 2, lanes: 3, straights: 1, corners: 1 },
  );
  assert.equal(f.complete, false);          /* two floating pieces: genuinely incomplete */
  assert.ok(f.issues > 0 && f.issues < ISSUES_OVER_CAP);
  /* unparsable-but-small input keeps the old lenient path (reads
   * incomplete: zero sprites → the empty-track error) */
  const weird = fullFacets({ track: ';;;;;;#' });
  assert.equal(weird.complete, false);
  assert.equal(weird.issues, 1);
});
