/* Track facets — searchable metadata derived from the track codec string
 * by way of the catalog (the catalog is truth: art AND app geometry AND
 * these facets all read the same defs). Shared by every store driver so
 * facet values are identical across sqlite/postgres/memory. */

import { PIECES } from '../../src/pieces.js';

const MAX_TRACK_BYTES = 512 * 1024;

/* Bump when validation RULES change: the sweep re-validates rows whose
 * stamp is older, so tightened rules converge without anyone re-saving. */
export const VALIDATOR_VERSION = 1;

/* Piece classification for gallery search (owner spec):
 *   straights = straight family (straight, wave, slope — waves count as
 *               straights; slopes are straights with elevation)
 *   corners   = corner family (corner, hairpin)
 *   specials  = everything else (lane changers, jumps, banks, starts) —
 *               excluded from both counts */
const STRAIGHT_KINDS = new Set(['straight', 'wave', 'slope']);
const CORNER_KINDS = new Set(['corner', 'hairpin']);

/* Parse a codec string minimally: count pieces, bbox, lanes, length.
 * Mirrors track.js semantics: unknown piece names are ignored rows. */
export function facets(data) {
  const track = typeof data?.track === 'string' ? data.track : '';
  if (track.length > MAX_TRACK_BYTES) throw new Error('track string too large');
  let pieceCount = 0, lanes = 0, lengthCm = 0, straights = 0, corners = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const elem of track.split('#')) {
    const a = elem.split(';');
    const def = PIECES[a[0]];
    if (!a[0] || !def) continue;
    pieceCount += 1;
    if (STRAIGHT_KINDS.has(def.kind)) straights += 1;
    else if (CORNER_KINDS.has(def.kind)) corners += 1;
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
    corners,
  };
}

export const MAX_TRACK_BYTES_EXPORTED = MAX_TRACK_BYTES;
