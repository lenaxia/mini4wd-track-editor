# 0009 — Asset caching: HTTP policy + sha-256 manifest + Docker packaging

**Date:** 2026-09-15
**Triggered by:** Owner request — proper browser caching for assets (stale
identification + intelligent eviction via a content-hash manifest generated at
package time, graceful no-cache fallback), then Docker packaging.

---

## Three cache layers

1. **HTTP policy (serve.js)**: `assets/`/`src/` `?v=`/`?h=` URLs →
   `immutable, max-age=1y` (content-addressed by manifest hash or
   rule-5 buster — root files like `style.css?v=N` are hand-bumped and
   keep `no-cache` + ETag so a forgotten bump can never pin stale
   content); `/assets/manifest.json` → `no-cache` (it IS the
   invalidation signal); other `/assets/*` → 5 min; html/src →
   `no-cache` + ETag (304s).
2. **Content-hash manifest**: `tools/gen-manifest.js` writes
   `assets/manifest.json` = `{sprite: sha256}` (75 entries; generated at
   package time — Dockerfile `RUN`, `npm run manifest`, and the playwright
   webServer all produce it; it is gitignored, never committed).
3. **Client cache (src/cache.js)**: boot fetches the manifest, opens
   CacheStorage, and evicts keys whose `?h=` hash no longer matches (updated
   art) or whose file is gone (deleted pieces) — eviction the HTTP cache
   cannot do. Loads: cache hit → object URL (network-free boot); miss →
   plain immutable URL while the response is banked in the background (the
   image never waits on the cache write). Fallback — manifest absent, fetch
   failed, or Cache API unavailable (plain-HTTP LAN) — is exactly the old
   behavior: `?v=` busters + HTTP headers.

Hash: sha-256 over md5 — no adversary, but sha-256 is free and ends the
debate. Preload is parallel (`Promise.all`); images carry `dataset.sprite`
because manifest-mode srcs are object URLs.

## Docker

`Dockerfile` (node:24-bookworm-slim, non-root, healthcheck) copies the
static app + manifest generator and bakes the manifest at build. The app
stays zero-dependency. Not buildable in this sandbox (no docker binary) —
flagged for the reviewer; the image is a static-file server on :3000.

## Test hardening found along the way

- `real rucdoc sprites load`: replaced a fixed 2500 ms wait with a poll on
  actual sprite readiness. Two traps: an unassigned-src `Image` is
  vacuously `complete` (must check `src` + `naturalWidth`), and
  `waitForFunction` with an async-import predicate resolves on a cancelled
  poll under load — `expect.poll` with one-shot evaluates instead.
- `drag perf smoke`: the 15 s absolute gate failed on this sandbox **on
  clean main** (load average 9+ on 8 cores; A/B evidence in the PR). The
  gate is now self-normalizing: a 20-idle-move baseline, drag must stay
  under max(15 s, 9× baseline) — same order-of-magnitude intent, immune to
  box load.

## Results

- npm test: 117 pass / 0 fail (6 new cache-helper units)
- e2e: 43 passed, twice consecutively (6 new caching/manifest specs)
- boot probe: manifest mode ~514 ms to all-sprites vs ~553 ms fallback
