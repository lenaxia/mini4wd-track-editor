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

/* Resolve the boot cache. Safe to call repeatedly; failures degrade to
 * fallback mode (cache stays null). */
export async function initCache() {
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
 * stored bytes, VERIFIED against the manifest hash — a corrupt/truncated
 * entry (interrupted put, engine quirk) is deleted and re-fetched instead
 * of permanently shadowing the asset. Miss -> fetch, verify, bank into
 * the CacheStorage, and return an object URL; on any failure fall back to
 * the plain network URL (immutable, HTTP cache serves repeats). */
export async function cachedSpriteUrl(file, buster) {
  const url = spriteUrl(file, manifest, buster);
  try {
    if (cache && manifest && manifest[file]) {
      const want = manifest[file];
      const hit = await cache.match(url);
      if (hit && hit.ok) {
        const blob = await hit.blob();
        if (blob.size > 0 && (!crypto?.subtle || await blobSha(blob) === want))
          return URL.createObjectURL(blob);
        /* corrupt: evict (awaited — a late delete must not evict the fresh entry), refetch */
        await cache.delete(url).catch(() => {});
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
    }
  } catch { /* fall through to network */ }
  return url;
}

/* sha-256 of a blob, hex — for hit verification (self-healing cache).
 * Absent crypto.subtle (insecure context) the caller skips verifying. */
export async function blobSha(blob) {
  const buf = await blob.arrayBuffer();
  const h = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, '0')).join('');
}
