/* Client asset cache — content-hash manifest + CacheStorage.
 *
 * Boot: fetch assets/manifest.json (served no-cache). Sprite URLs carry
 * ?h=<sha256>; fetched responses are stored in the CacheStorage. On boot,
 * cached keys whose hash no longer matches the manifest are evicted
 * (updated art) and keys absent from the manifest are dropped (deleted
 * pieces). If the manifest is missing (404), or the Cache API is
 * unavailable (insecure context, old browser), the loader degrades to
 * plain network URLs with the global ?v= buster — no client cache.
 *
 * Images consume the cached bytes as object URLs (new Image() cannot read
 * the Cache API directly). Pure decision helpers are exported for tests. */

export const CACHE_NAME = 'm4wd-assets-v1';

/* URL for a sprite under manifest mode (per-file content hash) or
 * fallback mode (global buster). manifest maps basename -> sha256 hex. */
export function spriteUrl(file, manifest, buster) {
  const h = manifest && manifest[file];
  return h ? `assets/${file}?h=${h}` : `assets/${file}?v=${buster}`;
}

/* Which cached request keys are stale given the current manifest:
 * anything whose file is gone, or whose ?h= no longer matches. Keys with
 * no ?h= (legacy entries) are stale by definition. */
export function staleKeys(keys, manifest) {
  const out = [];
  for (const url of keys) {
    const m = /^(?:https?:\/\/[^/]+)?\/?assets\/([^?]+)\?h=([0-9a-f]+)$/.exec(url);
    if (!m || !manifest || manifest[m[1]] !== m[2]) out.push(url);
  }
  return out;
}

let cache = null;
let manifest = null;

/* Resolve the boot cache. Safe to call repeatedly; failures degrade to
 * fallback mode (cache stays null). */
export async function initCache(busterVersion) {
  try {
    if (typeof caches === 'undefined') return false;
    const res = await fetch('assets/manifest.json', { cache: 'no-store' });
    if (!res.ok) return false;
    manifest = await res.json();
    cache = await caches.open(CACHE_NAME);
    const keys = (await cache.keys()).map(r => r.url);
    for (const url of staleKeys(keys, manifest)) await cache.delete(url);
    return true;
  } catch {
    cache = null; manifest = null;
    return false;
  }
}

/* Load a sprite as an image-ready URL. Cache hit -> object URL from the
 * stored bytes (boot without network). Miss -> the plain network URL
 * (immutable, so the HTTP cache serves repeats) while the response is
 * banked into the CacheStorage in the background — the image never waits
 * on the cache write. Never throws; falls back to the buster URL. */
export async function cachedSpriteUrl(file, buster) {
  const url = spriteUrl(file, manifest, buster);
  try {
    if (cache && manifest && manifest[file]) {
      const hit = await cache.match(url);
      if (hit && hit.ok) return URL.createObjectURL(await hit.blob());
      const res = await fetch(url);
      if (res.ok) cache.put(url, res.clone()).catch(() => {});
    }
  } catch { /* fall through to network */ }
  return url;
}
