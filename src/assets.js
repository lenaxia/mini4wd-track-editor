/* Sprite assets — SVG redraws in the original editor's illustrated style;
 * the original PNG rips stay in assets/ as provenance (unused at runtime). */

import { PIECES } from './pieces.js';
import { initCache, cachedSpriteUrl } from './cache.js';

const IMAGES = {};
const BUSTER = 27;

export function imageFor(name, c) { const f = PIECES[name]?.sprite || `${name}.${c}.svg`; return IMAGES[f] || null; }

/* Preload every sprite; onload fires once per image that finishes loading
 * (caller redraws + repaints palette chips, debounced on its side).
 * Manifest cache first (per-file content hashes, stale entries evicted
 * on boot — see cache.js); plain buster URLs when it is unavailable. */
export async function preloadImages(onload) {
  await initCache();
  const jobs = [];
  for (const [name, def] of Object.entries(PIECES)) {
    /* procedural: true — renders via art.js (no sprite request); kept for
     * future pieces even though the current catalog is all-sprite. */
    if (def.procedural) continue;
    for (let c = 0; c < def.colors; c++) {
      const f = def.sprite || `${name}.${c}.svg`;
      if (IMAGES[f]) continue; /* shared sprites load once */
      const img = new Image();
      img.onload = onload;
      img.dataset.sprite = f; /* survives object-URL srcs (cache mode) */
      IMAGES[f] = img;
      jobs.push(cachedSpriteUrl(f, BUSTER).then(u => { img.src = u; }));
    }
  }
  await Promise.all(jobs);
}
