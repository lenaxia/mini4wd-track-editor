/* Gallery — pure helpers for browsing every published track on the
 * server. The DOM lives in ui.js (same split as the codec in track.js):
 * sort menu, list-query building, row formatting, the per-browser star
 * de-dupe (star/unstar), and the card-preview fit math. There is no
 * auth — "one star per browser per track" is enforced client-side via
 * localStorage, the server counter is public. */

import { PIECES } from './pieces.js';

export const GALLERY_SORTS = [
  { value: '-updated_at', label: 'Newest' },
  { value: '-length', label: 'Length' },
  { value: 'lanes', label: 'Lanes' },
  { value: '-bbox', label: 'Footprint' },
  { value: '-stars', label: 'Stars' },
  { value: '-straights', label: 'Straights' },
  { value: '-slopes', label: 'Slopes' },
  { value: '-corners', label: 'Corners' },
];

/* Query for GET /api/tracks. complete is opt-in only — the toggle means
 * "complete only", an off toggle lists everything. */
export function galleryQuery({ sort, complete, limit, offset }) {
  const q = `sort=${sort}&limit=${limit}&offset=${offset}`;
  return complete ? `${q}&complete=true` : q;
}

/* Bbox in cm (1 px = 1 cm); under a meter stays in cm, above switches
 * to meters with trailing-zero-trimmed 2-dp values. */
export function formatFootprint(wCm, hCm) {
  if (!wCm || !hCm) return '\u2014';
  const m = (cm) => String(+(cm / 100).toFixed(2));
  return wCm >= 100 || hCm >= 100
    ? `${m(wCm)}\u00D7${m(hCm)} m`
    : `${Math.round(wCm)}\u00D7${Math.round(hCm)} cm`;
}

/* ✓ for server-validated complete tracks; amber ✖ + issue count for
 * work-in-progress rows (the stored facet is authoritative — worklog
 * 0013's server-side validation). */
export function completeBadge(row) {
  if (row.complete) return { text: '\u2713', cls: 'ok', title: 'complete track' };
  return {
    text: row.issues ? `\u2716 ${row.issues}` : '\u2716',
    cls: 'wip',
    title: row.issues ? `work in progress \u00B7 ${row.issues} issue(s)` : 'work in progress',
  };
}

/* ---------- star de-dupe (localStorage: 'm4wd.starred' = [id, ...]) ---------- */

const STAR_KEY = 'm4wd.starred';

export function readStarred(ls = globalThis.localStorage) {
  try {
    const raw = ls.getItem(STAR_KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}

export function isStarred(ls = globalThis.localStorage, id) {
  return readStarred(ls).includes(id);
}

/* Never throws — private-mode storage failures just skip the de-dupe. */
export function addStarred(ls = globalThis.localStorage, id) {
  const ids = readStarred(ls);
  if (ids.includes(id)) return ids;
  ids.push(id);
  try { ls.setItem(STAR_KEY, JSON.stringify(ids)); } catch (_) {}
  return ids;
}

/* Un-star: drops the id so the browser may star again. Same never-throws
 * contract. */
export function removeStarred(ls = globalThis.localStorage, id) {
  const ids = readStarred(ls).filter((x) => x !== id);
  try { ls.setItem(STAR_KEY, JSON.stringify(ids)); } catch (_) {}
  return ids;
}

/* ---------- local track metadata (topbar popup) ----------
 * Mirrors the server's facet stamping (lib/store/facets.js), owner
 * rulings 2026-09-16 included: waves are straights, SLOPES ARE THEIR
 * OWN COUNT (not interchangeable with straights), hairpins/rainbows
 * count as 4 corners (a 180° turn is four 45° pieces' worth), specials
 * excluded, lanes = max. Unit tests cross-check the two classifiers
 * over a serialized round-trip so the popup can never disagree with
 * the stored row. */
const STRAIGHT_KINDS = new Set(['straight', 'wave']);
const CORNER_KINDS = new Set(['corner']);
const HAIRPIN_KINDS = new Set(['hairpin']);
const SLOPE_KINDS = new Set(['slope']);

export function trackFacets(sprites) {
  let pieces = 0, lengthCm = 0, lanes = 0, straights = 0, slopes = 0, corners = 0;
  for (const p of sprites) {
    const def = PIECES[p.name];
    if (!def) continue;
    pieces += 1;
    if (STRAIGHT_KINDS.has(def.kind)) straights += 1;
    else if (SLOPE_KINDS.has(def.kind)) slopes += 1;
    else if (CORNER_KINDS.has(def.kind)) corners += 1;
    else if (HAIRPIN_KINDS.has(def.kind)) corners += 4;
    lanes = Math.max(lanes, def.lanes || 1);
    lengthCm += (def.l || 0) * 100;
  }
  return { pieces, length_cm: Math.round(lengthCm * 10) / 10, lanes, straights, slopes, corners };
}

/* ---------- card preview fit (track cm -> canvas px) ---------- */

/* Center-fit transform for the gallery card thumbnails: bbox over every
 * piece's rotated footprint, then a uniform scale into the padded box.
 * Returns { scale, cx, cy } where canvas x = cx + scale * trackX, or
 * null for an empty track. Pure math — ui.js owns the drawing. */
export function thumbFit(sprites, boxW, boxH, pad = 4) {
  if (!sprites.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of sprites) {
    const def = PIECES[p.name];
    if (!def) continue;
    const r = (p.a || 0) * Math.PI / 180;
    const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
    /* axis-aligned bbox of the rotated w x h rect */
    const hw = (def.w * c + def.h * s) / 2;
    const hh = (def.w * s + def.h * c) / 2;
    minX = Math.min(minX, p.x - hw); maxX = Math.max(maxX, p.x + hw);
    minY = Math.min(minY, p.y - hh); maxY = Math.max(maxY, p.y + hh);
  }
  if (!Number.isFinite(minX)) return null;   /* no catalog pieces at all */
  const scale = Math.min((boxW - 2 * pad) / (maxX - minX), (boxH - 2 * pad) / (maxY - minY));
  return {
    scale,
    cx: boxW / 2 - scale * (minX + maxX) / 2,
    cy: boxH / 2 - scale * (minY + maxY) / 2,
  };
}
