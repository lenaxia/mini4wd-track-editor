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

/* per-boot bound for every CacheStorage interaction: corrupted
 * entries/caches can HANG reads (interrupted-write failure mode) — no
 * read may stall the loader. Generous because all ~75 sprite loads
 * start together and share one wall-clock window on slow devices; a
 * bound that tight would evict the slow (healthy) tail every boot. */
const CACHE_BOUND_MS = 2500;

/* Resolve the boot cache. Safe to call repeatedly; failures — including
 * a HANG anywhere (a corrupted cache can hang keys()/delete() reads,
 * which would stall every sprite behind initCache) — degrade to
 * fallback mode (cache stays null, sprites load from plain URLs). */
export async function initCache() {
  try {
    /* hard refresh (owner rule): the server tags hard-reloaded documents
     * via Set-Cookie (browsers send Cache-Control: no-cache on hard
     * reload; soft reload sends max-age=0). Wipe the asset cache so a
     * hard refresh is a reliable recovery tool, then boot network-only;
     * the next soft refresh repopulates. */
    if (/(?:^|;\s*)m4wd_hard=1(?:;|$)/.test(document.cookie)) {
      document.cookie = 'm4wd_hard=; Max-Age=0; Path=/';
      await Promise.race([
        caches.delete(CACHE_NAME),
        new Promise((resolve) => setTimeout(resolve, CACHE_BOUND_MS)),
      ]);
      cache = null;
      return false;
    }
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
      const race = { live: true };   /* lets the losing path revoke its URL */
      let timer = null;
      const hit = await Promise.race([
        verifiedHit(url, want, race),
        new Promise((resolve) => { timer = setTimeout(() => { race.live = false; resolve(null); }, CACHE_BOUND_MS); }),
      ]);
      clearTimeout(timer);
      /* verified bytes, or null for corrupt-but-readable / clean miss —
       * either way the img loads the plain URL and banking runs detached */
      if (race.live) { if (!hit) bank(url, want); return hit ?? url; }
      if (hit) URL.revokeObjectURL(hit);  /* lost the race: don't leak */
      cache.delete(url).catch(() => {});  /* hung: best-effort eviction */
      return url;
    }
  } catch { /* fall through to network */ }
  return url;
}

/* Verified cache hit -> object URL. NEVER falls through to a foreground
 * fetch: some proxies (observed: the safespaces preview) answer fetch()
 * with EMPTY 200 bodies while serving <img> loads correctly — a
 * foreground fetch-verify would fail forever and cost a wasted request
 * per sprite per boot (HAR evidence in worklog 0011). The image element
 * loads the plain URL natively instead; banking runs in the background
 * where fetch works. */
async function verifiedHit(url, want, race) {
  const hit = await cache.match(url);
  if (!hit || !hit.ok) return null;
  const blob = await hit.blob();
  if (blob.size > 0 && (!crypto?.subtle || await blobSha(blob) === want)) {
    const objUrl = URL.createObjectURL(blob);
    if (!race.live) { URL.revokeObjectURL(objUrl); return null; }
    return objUrl;
  }
  await cache.delete(url).catch(() => {});   /* corrupt/empty: evict + bank fresh below */
  bank(url, want);
  return null;
}

/* Background banking: fetch + verify + store. Detached by design — where
 * fetch is broken (proxy) it silently no-ops and boots use the HTTP
 * cache; where it works, the next boot serves from CacheStorage. */
function bank(url, want) {
  if (banking.has(url)) return;
  banking.add(url);
  (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const blob = await res.blob();
      if (blob.size > 0 && (!crypto?.subtle || await blobSha(blob) === want)) {
        await cache.put(url, new Response(blob, {
          headers: { 'Content-Type': res.headers.get('Content-Type') || 'image/svg+xml' },
        }));
      }
    } catch { /* banking is opportunistic */ }
    finally { banking.delete(url); }
  })();
}
const banking = new Set();

/* sha-256 of a blob, hex — for hit verification (self-healing cache).
 * Absent crypto.subtle (insecure context) the caller skips verifying. */
export async function blobSha(blob) {
  const buf = await blob.arrayBuffer();
  const h = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, '0')).join('');
}
