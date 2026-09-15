/* Track facets — searchable metadata derived from the track codec string
 * by way of the catalog (the catalog is truth: art AND app geometry AND
 * these facets all read the same defs). Shared by every store driver so
 * facet values are identical across sqlite/postgres/memory. */

import { PIECES } from '../../src/pieces.js';

const MAX_TRACK_BYTES = 512 * 1024;

/* Parse a codec string minimally: count pieces, bbox, lanes, length.
 * Mirrors track.js semantics: unknown piece names are ignored rows. */
export function facets(data) {
  const track = typeof data?.track === 'string' ? data.track : '';
  if (track.length > MAX_TRACK_BYTES) throw new Error('track string too large');
  let pieceCount = 0, lanes = 0, lengthCm = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const elem of track.split('#')) {
    const a = elem.split(';');
    const def = PIECES[a[0]];
    if (!a[0] || !def) continue;
    pieceCount += 1;
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
  };
}

export const MAX_TRACK_BYTES_EXPORTED = MAX_TRACK_BYTES;
