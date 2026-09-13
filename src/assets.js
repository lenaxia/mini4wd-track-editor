/* Sprite assets — Tamiya piece PNGs from the original editor (assets/Name.color.png). */

import { PIECES } from './pieces.js';

const IMAGES = {};

export function imageFor(name, c) { const n = PIECES[name]?.sprite || name; return IMAGES[`${n}.${c}`] || null; }

/* Preload every sprite; onload fires once per image that finishes loading
 * (caller redraws + repaints palette chips, debounced on its side). */
export function preloadImages(onload) {
  for (const [name, def] of Object.entries(PIECES)) {
    /* procedural: true — renders via art.js until the ortho-projection
     * pipeline ships its sprites (design spec §6/§9, track 2); skip the
     * doomed sprite requests. */
    if (def.procedural) continue;
    for (let c = 0; c < def.colors; c++) {
      const n = def.sprite || name;
      if (IMAGES[`${n}.${c}`]) continue; /* shared sprites load once */
      const img = new Image();
      img.onload = onload;
      img.src = `assets/${n}.${c}.png?v=3`;
      IMAGES[`${n}.${c}`] = img;
    }
  }
}
