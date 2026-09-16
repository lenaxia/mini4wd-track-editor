/* Gallery — pure helpers for browsing every published track on the
 * server. The DOM lives in ui.js (same split as the codec in track.js):
 * sort menu, list-query building, row formatting, and the per-browser
 * star de-dupe. There is no auth — "one star per browser per track" is
 * enforced client-side via localStorage, the server counter is public. */

export const GALLERY_SORTS = [
  { value: '-updated_at', label: 'Newest' },
  { value: '-length', label: 'Length' },
  { value: 'lanes', label: 'Lanes' },
  { value: '-bbox', label: 'Footprint' },
  { value: '-stars', label: 'Stars' },
  { value: '-straights', label: 'Straights' },
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
