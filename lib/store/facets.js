/* Track facets — searchable metadata derived from the track codec string
 * by way of the catalog (the catalog is truth: art AND app geometry AND
 * these facets all read the same defs). Shared by every store driver so
 * facet values are identical across sqlite/postgres/memory. */

import { PIECES } from '../../src/pieces.js';
import { validateTrack } from '../../src/validate.js';
import { parseTrack } from '../../src/track.js';

const MAX_TRACK_BYTES = 512 * 1024;

/* Piece-count write cap (issue #63: CPU DoS). validateTrack is
 * super-quadratic on crafted coincident pieces — measured 275 ms @200,
 * 11.6 s @1600 — and the 512 KiB byte cap admits ~19k pieces, i.e.
 * ~30 min of blocked event loop per write and per sweep. Real
 * owner-scale tracks sit far below 2000 pieces (the biggest measured
 * layouts are a few hundred), so anything beyond this is not a track. */
export const MAX_PIECES = 2000;

/* Sentinel issue count for rows that are unwritable under current
 * rules (oversized / over-cap): complete=false plus a count no real
 * validation can produce — visibly junk in the gallery, never mistaken
 * for a validated track. */
export const ISSUES_OVER_CAP = 999999;

/* Bump when validation/facet RULES change: the sweep re-validates rows
 * whose stamp is older, so tightened rules converge without anyone
 * re-saving. v2: slopes leave the straight count (owner ruling — not
 * interchangeable) and hairpins count as 4 corners (a 180° is four
 * 45° pieces' worth). v5: piece-count cap (issue #63) — over-cap rows
 * now read complete:false with a sentinel issue count; legacy poison
 * rows converge to that marking in one O(n) sweep pass. */
export const VALIDATOR_VERSION = 5;

/* Piece classification for gallery search (owner spec + rulings
 * 2026-09-16):
 *   straights = straight family (straight, wave — waves ARE flat
 *               straights with a bump)
 *   slopes    = elevation changers — their OWN count: a slope is not
 *               interchangeable with a straight piece
 *   corners   = corner family weighted by sweep: 45°=1, 90°=2,
 *               hairpin/rainbow (180°)=4 — always sweep/45 (owner
 *               rulings 2026-09-16)
 *   specials  = everything else (lane changers, jumps, banks, starts) —
 *               excluded from all counts */
const STRAIGHT_KINDS = new Set(['straight', 'wave']);
const CORNER_KINDS = new Set(['corner']);
const HAIRPIN_KINDS = new Set(['hairpin']);
const SLOPE_KINDS = new Set(['slope']);
/* corner sweep in degrees — everything unlisted is a 45° corner
 * (Cor1, Cor2, the rucdoc 45s); 90s: Cor3, Cor4, Cor5 (geometry-pinned
 * — solveGeo gives 90 for the R2100 too), R1C90I150; hairpins 180 */
const SWEEP_DEG = { Cor3: 90, Cor4: 90, Cor5: 90, R1C90I150: 90 };

/* Parse a codec string minimally: count pieces, bbox, lanes, length.
 * Mirrors track.js semantics: unknown piece names are ignored rows. */
export function facets(data) {
  const track = typeof data?.track === 'string' ? data.track : '';
  if (track.length > MAX_TRACK_BYTES) throw new Error('track string too large');
  let pieceCount = 0, lanes = 0, lengthCm = 0, straights = 0, slopes = 0, corners = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const elem of track.split('#')) {
    const a = elem.split(';');
    const def = PIECES[a[0]];
    if (!a[0] || !def) continue;
    pieceCount += 1;
    if (STRAIGHT_KINDS.has(def.kind)) straights += 1;
    else if (SLOPE_KINDS.has(def.kind)) slopes += 1;
    else if (CORNER_KINDS.has(def.kind)) corners += Math.round((SWEEP_DEG[a[0]] ?? 45) / 45);
    else if (HAIRPIN_KINDS.has(def.kind)) corners += 4;
    lanes = Math.max(lanes, def.lanes || 1);
    lengthCm += (def.l || 0) * 100;
    const x = parseFloat(a[1]) || 0, y = parseFloat(a[2]) || 0;
    minX = Math.min(minX, x - def.w / 2); maxX = Math.max(maxX, x + def.w / 2);
    minY = Math.min(minY, y - def.h / 2); maxY = Math.max(maxY, y + def.h / 2);
  }
  return {
    piece_count: pieceCount,
    lanes,
    length_cm: Math.round(lengthCm * 10) / 10,
    bbox_w_cm: pieceCount ? Math.round((maxX - minX) * 10) / 10 : 0,
    bbox_h_cm: pieceCount ? Math.round((maxY - minY) * 10) / 10 : 0,
    straights,
    slopes,
    corners,
  };
}

/* Cheap O(n) piece counter for the write cap: one split per row, no
 * catalog work. Counts every row with a non-empty name BEFORE catalog
 * lookup — an over-approximation of facets()' catalog-known count, which
 * is the safe direction for a cap (unknown-name junk rows are rejected
 * too; the validator only ever sees catalog-known rows anyway). */
export function pieceCount(track) {
  let n = 0;
  for (const elem of track.split('#')) {
    if (elem.split(';', 1)[0]) n += 1;
  }
  return n;
}

/* Write gate (issue #63): reject over-cap tracks BEFORE any validation.
 * The check itself is a linear split — sub-millisecond at the 512 KiB
 * ceiling — while the validation it precedes is super-quadratic. */
export function assertWritableTrack(track) {
  if (pieceCount(track) > MAX_PIECES) throw new Error(`too many pieces (max ${MAX_PIECES})`);
}

export const MAX_TRACK_BYTES_EXPORTED = MAX_TRACK_BYTES;

/* Full facets: cheap derived columns + server-side validation (complete /
 * issues) computed on every write. Browser-computed validity is UI-only;
 * the stored facet is authoritative. TOTAL (issue #63): oversized or
 * over-cap rows yield zeroed facets, complete:false and the sentinel
 * issue count instead of throwing or burning the quadratic validator —
 * a legacy poison row costs one O(n) pass, never a sweep abort. */
const ZERO_FACETS = { piece_count: 0, lanes: 0, length_cm: 0, bbox_w_cm: 0, bbox_h_cm: 0, straights: 0, slopes: 0, corners: 0 };
export function fullFacets(data) {
  const track = typeof data?.track === 'string' ? data.track : '';
  const poison = track.length > MAX_TRACK_BYTES || pieceCount(track) > MAX_PIECES;
  let f = { ...ZERO_FACETS };
  if (!poison) { try { f = facets(data); } catch { /* unreachable: both caps pre-checked — total anyway */ } }
  let complete = false;
  let issues = poison ? ISSUES_OVER_CAP : 0;
  if (!poison) {
    try {
      const v = validateTrack(parseTrack(track));
      complete = v.ok;
      issues = v.errors.length;
    } catch { /* unparsable reads as incomplete */ }
  }
  return { ...f, complete, issues, validator_version: VALIDATOR_VERSION };
}
