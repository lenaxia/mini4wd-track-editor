# 0011 — The preview proxy saga: sprites through a hostile middlebox

**Date:** 2026-09-15
**Triggered by:** Owner reports of placeholder pieces across many refreshes
and hard refreshes; two Edge HARs (same 13 sprites double-fetched every
boot; Cor1.0 among them — "the 3-lane corner chip").

---

## Evidence trail

1. Server logs: refreshes fetched the manifest, then ZERO sprite requests —
   cache "hits" whose bodies never arrived.
2. HAR 1 (v45): every fetch()-initiated sprite request = 200 with **size 0**;
   every `<img>` request = 200 with real bytes. ~13 specific sprites went
   through this double-fetch every boot; the other ~62 cache-hit fine.
3. HAR 2 (v49, after the fetch-out-of-path redesign): identical 13-sprite
   set. Origin serves Cor1.0.svg as 695 bytes; the img response through the
   proxy is **751 bytes — a constant +56 injected into svg image responses**
   (Str1.5: 419→475, same +56). main.js/style.css/manifest pass untouched.
4. The manifest (application/json) fetches **cleanly through the same proxy
   every boot** — json transport is the proven-safe path.

## Diagnosis

The safespaces preview proxy (a) empties svg-typed fetch() responses and
(b) injects ~56 bytes into svg image responses, corrupting their XML —
decode fails, `naturalWidth` stays 0, and the piece renders as procedural
art. The 13 broken sprites are exactly the set whose CacheStorage entries
were poisoned in earlier eras (empty/never-banked) — they can never re-bank
through a broken transport, so they img-load (and fail) every boot.

## Fix

`/api/sprites/<file>` on server.js serves the sprite bytes as
**application/json** (hash-addressed via `?h=` → immutable; plain →
no-cache; traversal/missing → 404). The client loads misses through this
endpoint, verifies sha-256 against the manifest, banks into CacheStorage
under the `/assets` key, and renders via a correctly-typed object URL. The
`/assets` img path remains only as a last-resort fallback (and for
static-only serve.js contexts, where the endpoint 404s gracefully).

Regression pin: an e2e corrupts EVERY /assets svg transport (empty for
fetch, +garbage for img) and asserts the sprite still renders — this fails
on the pre-fix code, which had no clean transport.

## Earlier hardening that remains

Hash-verified hits, bounded reads (hangs fall back), background-safe
banking, hard-refresh wipe (cookie signal precedes the 304), sync retry
with generation guards. The proxy also strips the hard-refresh cookie
signal — the wipe works on direct deployments; through the preview the
bounded-corruption defenses carry the load.
