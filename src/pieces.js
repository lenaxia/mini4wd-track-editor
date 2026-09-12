/* Piece catalog — data derived from the MIT-licensed original editor.
 * Full license notice: see src/main.js header.
 *
 * Schema v2 (docs/design/orient-elevation.md §2):
 *  - verts: [[x, y, zOff], ...] connection vertices in piece-local cm,
 *    unrotated, origin = piece pos. zOff (optional, default 0) is the
 *    per-vertex elevation offset in mm; serialized z = level at verts[0].
 *  - Slope zOff=75 is PROVISIONAL (the clearance standard — one slope =
 *    one crossing level); correct with measured values later. Changing a
 *    zOff requires a worklog note.
 *  - colors = variant count (decoupled from sprite file count).
 *  - l = official lap length in meters, w/h = footprint in cm (1 px = 1 cm). */

export const SNAP_RADIUS = 10;    // cm, snap distance between connection vertices
export const HITBOX_RADIUS = 18;  // cm, tap target radius around a piece center
export const CLEARANCE_MM = 75;   // mm, plan-overlap clearance standard (warning threshold)

export const PIECES = {
  /* ---------- 3 lane (Japan Cup) ---------- */
  Str1: { label: 'Straight',      lanes: 3, l: 1.62, w: 54,  h: 36,  colors: 7,  verts: [[-27, 0], [27, 0]],            kind: 'straight' },
  Str2: { label: 'Start',         lanes: 3, l: 1.62, w: 54,  h: 36,  colors: 1,  verts: [[-27, 0], [27, 0]],            kind: 'start' },
  Cor1: { label: '45\u00B0 corner', lanes: 3, l: 1.27, w: 52, h: 52, colors: 10, verts: [[-26, -8], [12.2, 7.8]],       center: [-5, -3.5], kind: 'corner', R: 54, band: 36 },
  Lan1: { label: 'Lane changer',  lanes: 3, l: 4.86, w: 162, h: 36,  colors: 2,  verts: [[-81, 0], [81, 0]],            kind: 'changer' },
  Lan2: { label: 'Rainbow',       lanes: 3, l: 9.81, w: 180, h: 144, colors: 1,  verts: [[-90, -54], [-90, 54]],        kind: 'hairpin', R: 54, band: 36 },
  Chi1: { label: 'Wave',          lanes: 3, l: 1.62, w: 54,  h: 42,  colors: 2,  verts: [[-27, 3], [27, 3]],            center: [0, -3], kind: 'wave' },
  Bri1: { label: 'Slope',         lanes: 3, l: 1.62, w: 54,  h: 36,  colors: 4,  verts: [[-27, 0], [27, 0, 75]],        kind: 'slope' },
  Bri2: { label: 'Jump',          lanes: 3, l: 1.62, w: 54,  h: 36,  colors: 1,  verts: [[-27, 0], [27, 0]],            kind: 'jump' },
  Ban1: { label: 'Bank',          lanes: 3, l: 0.66, w: 28,  h: 36,  colors: 4,  verts: [[-14, 0], [14, 0]],            kind: 'bank' },

  /* ---------- 5 lane (WIDE) ---------- */
  Str3: { label: '\u00BC Straight', lanes: 5, l: 1.5,  w: 30,  h: 60,  colors: 4, verts: [[-15, 0], [15, 0]],           kind: 'straight' },
  Str4: { label: '\u00BD Straight', lanes: 5, l: 3,    w: 60,  h: 60,  colors: 4, verts: [[-30, 0], [30, 0]],           kind: 'straight' },
  Str5: { label: '\u00BE Straight', lanes: 5, l: 4.5,  w: 90,  h: 60,  colors: 4, verts: [[-45, 0], [45, 0]],           kind: 'straight' },
  Str6: { label: 'Straight',      lanes: 5, l: 6,    w: 120, h: 60,  colors: 4, verts: [[-60, 0], [60, 0]],             kind: 'straight' },
  Cor2: { label: '45\u00B0 corner', lanes: 5, l: 2.46, w: 72, h: 72, colors: 3, verts: [[-36, -6], [6.42, 11.58]],       kind: 'corner', R: 60, band: 60 },
  Cor3: { label: '90\u00B0 corner', lanes: 5, l: 4.92, w: 90, h: 90, colors: 3, verts: [[-45, -15], [15, 45]],          kind: 'corner', R: 60, band: 60 },
  Cor4: { label: 'Digital curve', lanes: 5, l: 4.92, w: 90,  h: 90,  colors: 3, verts: [[-45, -15], [15, 45]],          kind: 'corner', R: 60, band: 60 },
  Cor5: { label: 'R2100 curve',   lanes: 5, l: 14.33, w: 210, h: 210, colors: 1, verts: [[-105, -75], [75, 105]],       kind: 'corner', R: 210, band: 60 },
  Lan3: { label: 'Burning chg.',  lanes: 5, l: 9.84, w: 90,  h: 180, colors: 1, verts: [[-45, -60], [-45, 60]],         kind: 'hairpin', R: 60, band: 60 },
  Lan4: { label: 'Lane changer',  lanes: 5, l: 12,   w: 240, h: 60,  colors: 1, verts: [[-120, 0], [120, 0]],           kind: 'changer' },
  Bri3: { label: '\u00BD Slope',    lanes: 5, l: 3,    w: 60,  h: 60,  colors: 1, verts: [[-30, 0], [30, 0, 75]],       kind: 'slope' },
  Bri4: { label: 'Slope',         lanes: 5, l: 6,    w: 120, h: 60,  colors: 1, verts: [[-60, 0], [60, 0, 75]],         kind: 'slope' },
  Ban2: { label: 'Bank',          lanes: 5, l: 2.7,  w: 54,  h: 60,  colors: 1, verts: [[-27, 0], [27, 0]],             kind: 'bank' },
  Chi2: { label: 'Wave',          lanes: 5, l: 6,    w: 120, h: 72,  colors: 1, verts: [[-60, 6], [60, 6]],             kind: 'wave' },
};

/* palette order mirrors the original sidebar radios */
export const PALETTE = {
  3: ['Str1', 'Cor1', 'Lan1', 'Chi1', 'Str2', 'Bri1', 'Ban1', 'Bri2', 'Lan2'],
  5: ['Str3', 'Str4', 'Str5', 'Str6', 'Cor2', 'Cor3', 'Cor4', 'Cor5', 'Lan4', 'Lan3', 'Chi2', 'Bri3', 'Bri4', 'Ban2'],
};

export const VARIANT_COLORS = ['#c9d1dc', '#e05263', '#4f8fdd', '#2ea89b', '#e5b84b',
  '#9b6bd6', '#e08b4f', '#4fb67a', '#d66fae', '#7f8c9b'];

export const TOOLS = ['Pan', 'Move', 'Delete', 'Color']; // non-piece tools
