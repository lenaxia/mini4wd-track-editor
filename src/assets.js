/* Sprite assets — Tamiya piece PNGs from the original editor (assets/Name.color.png). */

import { PIECES } from './pieces.js';

const IMAGES = {};

export function imageFor(name, c) { return IMAGES[`${name}.${c}`] || null; }

/* Preload every sprite; onload fires once per image that finishes loading
 * (caller redraws + repaints palette chips, debounced on its side). */
/* rucdoc seed pieces render procedurally until the ortho-projection
 * pipeline ships their sprites (design spec §6/§9, track 2) — skip the
 * doomed requests. */
const PROCEDURAL_ONLY = /^R[123]/;

export function preloadImages(onload) {
  for (const [name, def] of Object.entries(PIECES)) {
    if (PROCEDURAL_ONLY.test(name)) continue;
    for (let c = 0; c < def.colors; c++) {
      const img = new Image();
      img.onload = onload;
      img.src = `assets/${name}.${c}.png?v=3`;
      IMAGES[`${name}.${c}`] = img;
    }
  }
}
