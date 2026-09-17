# 0026 — HTTP compression (gzip)

**Date:** 2026-09-17
**Triggered by:** Owner pick from the ledger ("2 and 3") — the server
shipped everything uncompressed; the 196 KB sprite bundle (and pages,
JS, CSS, JSON APIs) paid full freight per cold boot.

## What

- `lib/compress.js`: Accept-Encoding token match (`\\bgzip\\b` — no
  `xgzipz` false-positives), a compressible-type table (text/*, json,
  javascript, xml, svg — never png/gif: entropy-coded already) with a
  1 KB threshold, and `gzipBody` (gzip level 6; ~2 ms for 200 KB).
- Static handler (shared by serve.js + server.js): eligible files
  stream through `zlib.createGzip` with `Content-Encoding: gzip`;
  **Vary: Accept-Encoding rides every compressible response** so
  shared caches key on the encoding. ETag stays identity-based (it
  names the file) and the 304 path is untouched.
- JSON APIs: the `json()` helper gzips when the caller passes the
  request (the track list today); both sprite routes (per-file json
  envelope + the whole-set bundle) gzip with their
  immutable/no-cache semantics intact.

## Measurement

- /api/sprites: 196 KB → ~40 KB on the wire (~4.8×), asserted in the
  e2e (compressed bytes < identity bytes for bundle, /, main.js,
  style.css).

## Tests

- Unit: token matching, type/threshold table, gzipBody behavior.
- e2e over RAW http sockets (Playwright auto-decompresses and strips
  Content-Encoding for some types — its header view is not the wire
  truth): gzip + Vary on four payloads, identity without the header,
  PNG never compressed, ETag 304 intact under gzip semantics.

## Review round (an honest post-mortem)

The first cut had three real defects the review caught, and one
process failure worth recording:

- `acceptsGzip(req) && gzipBody(...)` evaluates to `false` for
  non-gzip clients, and `res.end(false ?? raw)` still ends EMPTY —
  ?? only falls through on null/undefined. Every non-gzip client
  (curl, HTTP/1.0, some proxies) got silently-truncated 200s. All
  three sites now use an explicit ternary returning null.
- The static-handler compression was NEVER in the shipped commit — a
  stash shuffle during branch juggling dropped the body of the edit
  and left only the imports. And the e2e still passed because
    reuseExistingServer
  picked up a stale probe server running the complete working-tree
  code on the same port. Lesson applied: probe servers are killed
  before suites now, and the wire assertions run against a server
  started from the COMMITTED tree.
- json()'s Vary header claimed variance the code never produced —
  Vary is now set only when the response is really compressed. (The
  round-1 fix note claimed the list route passed req; it did NOT —
  the reviewer caught the claim. It does now, round 2.)
- acceptsGzip no longer matches an explicit `gzip;q=0` refusal.

Verified on the wire (fresh server from the committed tree): bundle
196036B identity / 27731B gzip; / 17266→5057; main.js 3853→1909;
style.css 23131→5871; no-header clients get full identity bodies.

## Review round 2

- The list route REALLY passes req now (round 1 claimed it; the code
  said otherwise — rule 7 burn, twice checked since).
- Vary on the sprite routes only when the body is compressible-sized;
  acceptsGzip is case-insensitive (/i) per RFC 9110 tokens.
- reuseExistingServer is off under CI — the stale-listener class that
  produced round 1's false-pass can't recur there. (Locally, kill
  your probe servers before suites.)
