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
