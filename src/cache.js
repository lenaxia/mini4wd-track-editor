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
 * no ?h= (legacy entries) are stale by definition. Pathnames are parsed
 * so subpath deployments (…/repo/assets/…) work like root ones. */
export function staleKeys(keys, manifest) {
  const out = [];
  for (const url of keys) {
    let u;
    try { u = new URL(url); } catch { out.push(url); continue; }
    const m = /^(?:.*\/)?assets\/([^/?]+)$/.exec(u.pathname);
    const h = /[?&]h=([0-9a-f]+)/.exec(u.search);
    if (!m || !h || !manifest || manifest[m[1]] !== h[1]) out.push(url);
  }
  return out;
}

let cache = null;
let manifest = null;

/* per-operation bound for every CacheStorage interaction: corrupted
 * entries/caches can HANG reads (interrupted-write failure mode) — no
 * read may stall the loader */
const CACHE_BOUND_MS = 1200;

/* Resolve the boot cache. Safe to call repeatedly; failures — including
 * a HANG anywhere (a corrupted cache can hang keys()/delete() reads,
 * which would stall every sprite behind initCache) — degrade to
 * fallback mode (cache stays null, sprites load from plain URLs). */
export async function initCache() {
  try {
    if (typeof caches === 'undefined') return false;
    const res = await fetch('assets/manifest.json', { cache: 'no-store' });
    if (!res.ok) return false;
    manifest = await res.json();
    /* the whole cache interaction is bounded: a hung open/keys/delete
     * must never block preload — race it and fall back to no-cache */
    const ok = await Promise.race([
      (async () => {
        cache = await caches.open(CACHE_NAME);
        const keys = (await cache.keys()).map(r => r.url);
        for (const url of staleKeys(keys, manifest)) await cache.delete(url);
        return true;
      })(),
      new Promise((resolve) => setTimeout(() => resolve(false), CACHE_BOUND_MS)),
    ]);
    if (!ok) { cache = null; }
    return ok;
  } catch {
    cache = null; manifest = null;
    return false;
  }
}

/* Load a sprite as an image-ready URL. The cache path is fully bounded:
 * a corrupt entry whose body READ HANGS (an interrupted-write failure
 * mode — observed live: manifest fetched, zero sprite requests, sprites
 * stuck as procedural fallbacks) cannot stall the loader; the race
 * evicts it and the image falls back to the plain network URL. Verified
 * hits return object URLs; verified fetches are banked. */
export async function cachedSpriteUrl(file, buster) {
  const url = spriteUrl(file, manifest, buster);
  try {
    if (cache && manifest && manifest[file]) {
      const want = manifest[file];
      const loaded = await Promise.race([
        loadVerified(url, want),
        new Promise((resolve) => setTimeout(() => resolve(null), CACHE_BOUND_MS)),
      ]);
      if (loaded) return loaded;
      /* hung or unverifiable: evict so the next boot starts clean */
      cache.delete(url).catch(() => {});
    }
  } catch { /* fall through to network */ }
  return url;
}

async function loadVerified(url, want) {
  const hit = await cache.match(url);
  if (hit && hit.ok) {
    const blob = await hit.blob();
    if (blob.size > 0 && (!crypto?.subtle || await blobSha(blob) === want))
      return URL.createObjectURL(blob);
    await cache.delete(url).catch(() => {});   /* corrupt: evict (awaited — a late delete must not evict the fresh entry) + refetch */
  }
  const res = await fetch(url);
  if (res.ok) {
    const blob = await res.blob();
    if (blob.size > 0 && (!crypto?.subtle || await blobSha(blob) === want)) {
      cache.put(url, new Response(blob, {
        headers: { 'Content-Type': res.headers.get('Content-Type') || 'image/svg+xml' },
      })).catch(() => {});
      return URL.createObjectURL(blob);
    }
  }
  return null;
}

/* sha-256 of a blob, hex — for hit verification (self-healing cache).
 * Absent crypto.subtle (insecure context) the caller skips verifying. */
export async function blobSha(blob) {
  const buf = await blob.arrayBuffer();
  const h = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, '0')).join('');
}
