# 0002 — First e2e execution: validation findings fixed

**Date:** 2026-09-10  
**Triggered by:** Handoff directive — run the never-executed Playwright
suite on a Chromium-capable machine and work through worklog 0001's
"Validation Findings" list in priority order.

---

## Summary

Executed the Playwright suite for the first time (13 specs: 10 passed,
3 failed) and worked the validation-findings backlog. The run surfaced
**four real app bugs** (dev server could not boot at all; rotation
swung off-center pieces around their corners; snapping could drag a
piece off an exact connection; negative-origin tracks were silently
dropped from every persistence path) plus **two spec bugs** and a
**docs bug** in the README-LLM validation block. All fixed red-green.
Also: solveGeo geometric asserts, storage round-trip unit tests,
autosave-reload e2e spec, CI wiring, TDD codified into README-LLM.

Branch: `fix/e2e-validation-findings` (7 commits).

## Changes Made

### 1. e2e suite executed for the first time

`npx playwright install chromium` + `npm run test:e2e` on this sandbox
(Chromium 153 headless shell worked; the 0001 blocker is gone here).
First run: **10/13**.

### 2. App bugs found & fixed (each red-green)

- **`serve.js` could not boot** — CommonJS `require` under
  `"type": "module"`: `ReferenceError`, so the Playwright `webServer`
  (and the README-LLM smoke block) always failed. Converted to ESM
  (`import.meta.dirname`); `node serve.js` unchanged as the command.
  This means the 0001 "validation before push" block can never have
  actually passed as written — worth knowing when trusting older
  claims of manual validation.
- **`rotate` used origins, not visual centers** — a selected Cor1
  (center −5,−3.5 local) swung around its corner; mixed selections
  orbited a biased centroid. Now the centroid is the average of
  `centerOf()`; centered pieces are unaffected. e2e spec rewritten to
  pin in-place rotation (Str1: x/y fixed) and center-invariance
  (Cor1: origin moves, center fixed to 1e−6).
- **`snapPiece` accumulated snaps across sprites** — the inner `break`
  only exited the pairs loop, so a later sprite with a merely
  in-range pair (≤ SNAP_RADIUS) could pull a piece off an exact (d=0)
  connection made to an earlier sprite; result depended on sprite
  array order. Now: enumerate all pairs, apply the single
  minimum-distance displacement (mirrors `groupSnap`); ties resolve
  deterministically by encounter order (pinned).
- **Negative-origin tracks silently dropped from persistence** —
  `serialize()` filters `x<0 || y<0` (byte-compat codec, unit-pinned),
  correct for the original's positive-quadrant room, but this fork's
  boot view centers the world origin → ~half of placements land
  negative → **autosave, share links and file export all lost them**
  (the new autosave-reload e2e caught it: localStorage held
  `track:""` with 1 sprite on screen). Fix: `normalizeForSave` /
  `serializeForSave` (pure, minimal translation so all origins ≥ 0;
  byte-identical for already-valid tracks) wired into autosave,
  `encodeShare`, and the export blob. Layout preserved exactly;
  idempotent on restore.

### 3. Spec bugs fixed (intentions that contradicted the model)

- **chaining** clicked ON the far vertex — the new piece's vertices sit
  27 cm away (SNAP_RADIUS is 10), so nothing snaps. Now aims the origin
  ~4 cm short of the chained position so the snap does real work.
- **share-link** used a hash-only `goto` from `/` — same-document
  navigation, `boot()` never re-runs (verified by probe: real reload
  restores fine). Now hops via `about:blank`.

### 4. Test hardening (worklog 0001 items 2–5)

- `solveGeo`: arcs must start exactly at `v1` and end exactly at `v2`
  (1e−6) — finiteness alone let wrong-but-finite arcs pass. Passes for
  all 23 corner/hairpin catalog entries.
- `storage.test.js` (new): autosave → restore round-trip through a
  Map-backed localStorage stub (350 ms debounce), negative-origin
  losslessness, malformed-save tolerance.
- autosave-restore-on-reload e2e spec (share-hash path was already
  covered; the localStorage boot path was not).

### 5. CI + process

- `.github/workflows/ci.yml`: unit → per-file syntax check → Playwright
  (`chromium --with-deps`) on every PR and pushes to main.
- **README-LLM validation block was wrong**: `node --check src/*.js
  serve.js` validates only the *first* file (probe: planted syntax
  error in the 2nd file — undetected). Fixed to a per-file loop in both
  README-LLM and CI.
- TDD codified into README-LLM: red-green for pure-module changes,
  spec-first for interaction changes, "README wins over specs" rule.

## Validation Findings (still open)

- **Undo scope (0001 item 8) — deferred, needs an owner decision.**
  Snapshots cover `sprites` only. Extending scope to tool/angle/
  selection is a UX design call (Figma restores selection with the
  step; tool state is usually NOT undone), and interacts with gesture
  commit points (`input.js` pushes snapshots on release). Recommend a
  dedicated `feat/undo-scope` PR with a written spec first.
- **Multi-touch e2e** still manual-only (Playwright `touchscreen` is
  tap-only; needs CDP dispatch — unchanged from 0001).
- **ai-workflows secrets/variables** (`OPENAI_API_KEY`/`OPENAI_MODEL`…)
  still unset by the owner; `ci.yml` is plain GitHub Actions and runs
  regardless.
- Rotate round-trips (45° then −45°) accumulate float drift in
  coordinates (inherent to float rotation; serialize floors to
  3 decimals). Cosmetic; not pinned either way.

## Validation (this session, before writing this log)

    npm test          → 51 pass, 0 fail
    npm run test:e2e  → 14 pass, 0 fail (Chromium 153 headless shell)
    for f in src/*.js serve.js; do node --check "$f"; done → clean
    node serve.js + curl smoke (/, /src/main.js) → ok

## Files Changed

- `serve.js` — ESM conversion (bug fix)
- `src/geometry.js` — `snapPiece` closest-pair (bug fix)
- `src/store.js` — `rotate` around visual centers (bug fix)
- `src/track.js` — `normalizeForSave` / `serializeForSave` (new)
- `src/storage.js`, `src/ui.js` — persist via `serializeForSave`
- `index.html` — `?v=1` → `?v=2` (app code changed)
- `tests/unit/geometry.test.js`, `store.test.js`, `track.test.js` — new
  pins; `tests/unit/storage.test.js` — new file
- `tests/e2e/editor.spec.js` — 2 spec fixes, rotate spec rewrite,
  autosave-reload spec
- `.github/workflows/ci.yml` — new
- `README-LLM.md` — TDD section, corrected validation block
- `TESTPLAN.md` — coverage refresh, CI wired
