/* Sprite assets — SVG redraws in the original editor's illustrated style;
 * the original PNG rips stay in assets/ as provenance (unused at runtime). */

import { PIECES } from './pieces.js';

const IMAGES = {};

export function imageFor(name, c) { const f = PIECES[name]?.sprite || `${name}.${c}.svg`; return IMAGES[f] || null; }

/* Preload every sprite; onload fires once per image that finishes loading
 * (caller redraws + repaints palette chips, debounced on its side). */
export function preloadImages(onload) {
  for (const [name, def] of Object.entries(PIECES)) {
    /* procedural: true — renders via art.js until the ortho-projection
     * pipeline ships its sprites (design spec §6/§9, track 2); skip the
     * doomed sprite requests. */
    if (def.procedural) continue;
    for (let c = 0; c < def.colors; c++) {
      const f = def.sprite || `${name}.${c}.svg`;
      if (IMAGES[f]) continue; /* shared sprites load once */
      const img = new Image();
      img.onload = onload;
      img.src = `assets/${f}?v=16`;
      IMAGES[f] = img;
    }
  }
}
