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
      let wipe = null;
      await Promise.race([
        caches.delete(CACHE_NAME).then((v) => { if (wipe !== null) clearTimeout(wipe); return v; }),
        new Promise((resolve) => { wipe = setTimeout(resolve, CACHE_BOUND_MS); }),
      ]);
      cache = null;
      return false;
    }
    if (typeof caches === 'undefined') return false;
    const res = await fetch('assets/manifest.json', { cache: 'no-store' });
    if (!res.ok) return false;
    manifest = await res.json();
    /* the whole cache interaction is bounded: a hung open/keys/delete
     * must never block preload — race it and fall back to no-cache. The
     * handle is published only while the race is live; a late assignment
     * must not resurrect a zombie cache next to the fallback decision. */
    const race = { live: true };
    let timer = null;
    const ok = await Promise.race([
      (async () => {
        const c = await caches.open(CACHE_NAME);
        const keys = (await c.keys()).map(r => r.url);
        for (const url of staleKeys(keys, manifest)) await c.delete(url);
        if (!race.live) return false;   /* lost: publish nothing */
        cache = c;
        return true;
      })(),
      new Promise((resolve) => { timer = setTimeout(() => { race.live = false; resolve(false); }, CACHE_BOUND_MS); }),
    ]);
    clearTimeout(timer);
    return ok;
  } catch {
    cache = null; manifest = null;
    return false;
  }
}

/* The whole sprite set in one verified request (proxy-rate-limit
 * resilience — see the /api/sprites route). Returns Map(file ->
 * objectURL) of ONLY files whose bytes hash-match the manifest (each
 * also banked into CacheStorage for later boots), or null on any
 * failure — the caller falls back to the per-file path. */
export async function spriteBundle() {
  /* no crypto.subtle (insecure origin): the digest throws -> caught ->
   * per-file fallback (which trusts unverified bytes there) — the
   * 75->1 win quietly does not apply there */
  if (!cache || !manifest) return null;
  try {
    const canonical = Object.keys(manifest).sort().map((k) => `${k}:${manifest[k]}`).join('\n');
    const digest = await blobSha(new Blob([canonical]));
    /* same bound as the per-file path, covering fetch AND body read:
     * a proxy that stalls the response (headers or body) must not
     * stall the whole sprite path — bail to per-file after the race */
    const abort = new AbortController();
    let timer = null;
    const got = await Promise.race([
      (async () => {
        const res = await fetch(`/api/sprites?h=${digest}`, { signal: abort.signal });
        return res.ok ? { files: (await res.json())?.files } : null;
      })(),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), CACHE_BOUND_MS); }),
    ]);
    clearTimeout(timer);
    abort.abort();   /* no-op when the fetch already settled */
    const files = got?.files;
    if (!files || typeof files !== 'object') return null;
    const out = new Map();
    for (const [name, svg] of Object.entries(files)) {
      if (typeof svg !== 'string' || !manifest[name]) continue;
      if (await blobSha(new Blob([svg])) !== manifest[name]) continue;   /* unverified bytes are dropped, not trusted */
      out.set(name, URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })));
      cache.put(`assets/${name}?h=${manifest[name]}`,
        new Response(svg, { headers: { 'Content-Type': 'image/svg+xml' } })).catch(() => {});
    }
    return out.size ? out : null;
  } catch { return null; }
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
      const got = await Promise.race([
        verifiedLoad(file, url, want, race),
        new Promise((resolve) => { timer = setTimeout(() => { race.live = false; resolve(null); }, CACHE_BOUND_MS); }),
      ]);
      clearTimeout(timer);
      if (race.live) return got ?? url;   /* object URL, or fallback to the plain URL */
      if (got) URL.revokeObjectURL(got);  /* lost the race: don't leak */
      cache.delete(url).catch(() => {});  /* hung: best-effort eviction */
    }
  } catch { /* fall through to network */ }
  return url;
}

/* Verified load, hit-first. Misses fetch the json-typed sprite endpoint
 * (/api/sprites): the preview proxy empties svg-typed fetch responses and
 * injects bytes into svg image responses, while json passes clean (HAR
 * evidence — the manifest rides the same path every boot). Verified bytes
 * render as object URLs and bank into the CacheStorage under the /assets
 * key. Any failure returns null and the caller falls back to the plain
 * /assets URL (image-element path). */
async function verifiedLoad(file, url, want, race) {
  const objUrlOrNull = (blob) => {
    const u = URL.createObjectURL(blob);
    if (!race.live) { URL.revokeObjectURL(u); return null; }
    return u;
  };
  const hit = await cache.match(url);
  if (hit && hit.ok) {
    const blob = await hit.blob();
    if (blob.size > 0 && (!crypto?.subtle || await blobSha(blob) === want))
      return objUrlOrNull(blob);
    await cache.delete(url).catch(() => {});   /* corrupt/empty: evict, reload below */
  }
  let text = null;
  try {
    const res = await fetch(`/api/sprites/${file}?h=${want}`);
    if (res.ok) {
      const j = await res.json();          /* {svg: "<svg ..."} envelope */
      if (typeof j?.svg === 'string') text = j.svg;
    }
  } catch { /* endpoint absent or non-json — fall through */ }
  if (text !== null && text.length && (!crypto?.subtle || await blobSha(new Blob([text])) === want)) {
    cache.put(url, new Response(text, { headers: { 'Content-Type': 'image/svg+xml' } })).catch(() => {});
    return objUrlOrNull(new Blob([text], { type: 'image/svg+xml' }));
  }
  /* endpoint absent (static-only serve.js, subpath mounts) or unverifiable:
   * render via the plain img URL and bank from it in the background — where
   * fetch works this restores CacheStorage population; where the proxy
   * breaks fetch it is a verified no-op */
  bank(url, want);
  return null;
}

/* Detached bank from the plain /assets URL (the pre-endpoint path). */
function bank(url, want) {
  if (banking.has(url)) return;
  banking.add(url);
  (async () => {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const blob = await res.blob();
        if (blob.size > 0 && (!crypto?.subtle || await blobSha(blob) === want)) {
          await cache.put(url, new Response(blob, { headers: { 'Content-Type': 'image/svg+xml' } }));
        }
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
