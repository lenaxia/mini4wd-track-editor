/* Generate assets/manifest.json — {file: sha256} for every sprite.
 * Run at package time (Dockerfile) or via `npm run manifest`.
 * The client cache (src/cache.js) fetches this first; per-file hashes key
 * the CacheStorage entries and drive stale eviction. Absent manifest =
 * client cache off (graceful fallback to the ?v= busters).
 * Output is sorted for stable diffs. Zero dependencies. */
'use strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(import.meta.dirname, '..', 'assets');

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.svg')).sort();
const manifest = {};
for (const f of files) {
  manifest[f] = createHash('sha256').update(fs.readFileSync(path.join(DIR, f))).digest('hex');
}
const out = JSON.stringify(manifest, null, 1) + '\n';
fs.writeFileSync(path.join(DIR, 'manifest.json'), out);
console.log(`manifest: ${files.length} sprites -> assets/manifest.json`);
