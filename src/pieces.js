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

  /* ---------- rucdoc 3D-printed system (seed set, published dims) ----------
   * Dimensions published by rucdoc (MIT (c) rucdoc, thangs.com/designer/
   * rucdoc). Derived analytically (115mm lanes +
   * 50mm walls => 1L 13cm / 2L 25cm / 3L 37cm wide; corners: centerline
   * R = IR + width/2; ramps carry real rise as zOff in mm). Procedural
   * art covers the entries without sprite: files; svg.py supplies
   * the rest (docs/design/orient-elevation.md SS6). */
  R1S250: { sprite: 'R1S250.svg', label: 'R 1L straight 250mm', lanes: 1, l: 0.25, w: 25, h: 13.3, colors: 1, verts: [[-12.5, -6], [12.5, -6]], kind: 'straight' },
  R1REntry: { sprite: 'R1REntry.svg', label: 'R 1L ramp entry', lanes: 1, l: 0.10, w: 10.4, h: 13.3, colors: 1, verts: [[-5.2, -6], [5.2, -6, 16]], kind: 'slope' },
  R2Ramp5: { sprite: 'R2Ramp.svg', label: 'R 2L ramp 225mm +5', lanes: 2, l: 0.225, w: 22.8, h: 25, colors: 1, verts: [[-11.35, -11.9], [11.35, -11.9, 5]], kind: 'slope' },
  R2Ramp10: { sprite: 'R2Ramp.svg', label: 'R 2L ramp 225mm +10', lanes: 2, l: 0.225, w: 22.8, h: 25, colors: 1, verts: [[-11.35, -11.9], [11.35, -11.9, 10]], kind: 'slope' },
  R2Ramp15: { sprite: 'R2Ramp.svg', label: 'R 2L ramp 225mm +15', lanes: 2, l: 0.225, w: 22.8, h: 25, colors: 1, verts: [[-11.35, -11.9], [11.35, -11.9, 15]], kind: 'slope' },
  R2Ramp20: { sprite: 'R2Ramp.svg', label: 'R 2L ramp 225mm +20', lanes: 2, l: 0.225, w: 22.8, h: 25, colors: 1, verts: [[-11.35, -11.9], [11.35, -11.9, 20]], kind: 'slope' },
  R2Ramp25: { sprite: 'R2Ramp.svg', label: 'R 2L ramp 225mm +25', lanes: 2, l: 0.225, w: 22.8, h: 25, colors: 1, verts: [[-11.35, -11.9], [11.35, -11.9, 25]], kind: 'slope' },
  R2Ramp30: { sprite: 'R2Ramp.svg', label: 'R 2L ramp 225mm +30', lanes: 2, l: 0.225, w: 22.8, h: 25, colors: 1, verts: [[-11.35, -11.9], [11.35, -11.9, 30]], kind: 'slope' },
  R2Ramp35: { sprite: 'R2Ramp.svg', label: 'R 2L ramp 225mm +35', lanes: 2, l: 0.225, w: 22.8, h: 25, colors: 1, verts: [[-11.35, -11.9], [11.35, -11.9, 35]], kind: 'slope' },
  R2Ramp40: { sprite: 'R2Ramp.svg', label: 'R 2L ramp 225mm +40', lanes: 2, l: 0.225, w: 22.8, h: 25, colors: 1, verts: [[-11.35, -11.9], [11.35, -11.9, 40]], kind: 'slope' },
  R2Ramp45: { sprite: 'R2Ramp.svg', label: 'R 2L ramp 225mm +45', lanes: 2, l: 0.225, w: 22.8, h: 25, colors: 1, verts: [[-11.35, -11.9], [11.35, -11.9, 45]], kind: 'slope' },
  R1C45I150: { procedural: true, label: 'R 1L corner 45\u00B0 IR150', lanes: 1, l: 0.17, w: 31, h: 22, colors: 1, verts: [[7.6, 3.15], [-7.6, -3.15]], kind: 'corner', R: 21.5, band: 13 },
  R1C90I150: { procedural: true, label: 'R 1L corner 90\u00B0 IR150', lanes: 1, l: 0.34, w: 37, h: 37, colors: 1, verts: [[10.75, 10.75], [-10.75, -10.75]], kind: 'corner', R: 21.5, band: 13 },
  R2S250: { procedural: true, label: 'R 2L straight 250mm', lanes: 2, l: 0.25, w: 25, h: 25, colors: 1, verts: [[-12.5, 0], [12.5, 0]], kind: 'straight' },
  R2C45I150: { procedural: true, label: 'R 2L corner 45\u00B0 IR150', lanes: 2, l: 0.22, w: 47, h: 36, colors: 1, verts: [[9.72, 4.03], [-9.72, -4.03]], kind: 'corner', R: 27.5, band: 25 },
  R2R250: { procedural: true, label: 'R 2L ramp 250mm R50', lanes: 2, l: 0.25, w: 25, h: 25, colors: 1, verts: [[-12.5, 0], [12.5, 0, 50]], kind: 'slope' },
  R3S250: { procedural: true, label: 'R 3L straight 250mm', lanes: 3, l: 0.25, w: 25, h: 37, colors: 1, verts: [[-12.5, 0], [12.5, 0]], kind: 'straight' },
  R3C45I115: { procedural: true, label: 'R 3L corner 45\u00B0 IR115', lanes: 3, l: 0.24, w: 61, h: 48, colors: 1, verts: [[10.61, 4.39], [-10.61, -4.39]], kind: 'corner', R: 30, band: 37 },
  R3R250: { procedural: true, label: 'R 3L ramp 250mm R50', lanes: 3, l: 0.25, w: 25, h: 37, colors: 1, verts: [[-12.5, 0], [12.5, 0, 50]], kind: 'slope' },
};

/* palette order mirrors the original sidebar radios; the rucdoc drawer is
 * grouped by lane count (his catalog's own organization) */
export const PALETTE = {
  3: ['Str1', 'Cor1', 'Lan1', 'Chi1', 'Str2', 'Bri1', 'Ban1', 'Bri2', 'Lan2'],
  5: ['Str3', 'Str4', 'Str5', 'Str6', 'Cor2', 'Cor3', 'Cor4', 'Cor5', 'Lan4', 'Lan3', 'Chi2', 'Bri3', 'Bri4', 'Ban2'],
  rucdoc: ['R1S250', 'R1REntry', 'R2Ramp5', 'R2Ramp10', 'R2Ramp15', 'R2Ramp20', 'R2Ramp25', 'R2Ramp30', 'R2Ramp35', 'R2Ramp40', 'R2Ramp45', 'R1C45I150', 'R1C90I150', 'R2S250', 'R2C45I150', 'R3S250', 'R3C45I115', 'R3R250'],
};

export const VARIANT_COLORS = ['#c9d1dc', '#e05263', '#4f8fdd', '#2ea89b', '#e5b84b',
  '#9b6bd6', '#e08b4f', '#4fb67a', '#d66fae', '#7f8c9b'];

export const TOOLS = ['Pan', 'Move', 'Delete', 'Color']; // non-piece tools
