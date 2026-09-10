# 0001 — Figma-style placement, ES-module split & test plan

**Date:** 2026-09-10  
**Triggered by:** Placement rework session — the two-stage ghost/confirm flow felt clumsy ("shift from the ghost/move confirm, go figma style of place, then move, then click away to deselect"), followed by an architecture step-back ("is it modular enough to build on?") and a testing directive ("define a testplan and test framework. we will also use playwright").

---

## Summary

Replaced the two-stage ghost/confirm placement with a Figma-style flow
(place → move → click-away deselect), split the 1167-line `editor.js`
monolith into acyclic ES modules with a real model layer (store), and
defined + implemented the testing story: TESTPLAN.md, 39 unit tests on
Node's built-in runner, and 13 Playwright e2e specs. Also onboarded the
repo onto lenaxia/ai-workflows (separate PRs, see Files Changed).

**Committed to main as `7c25ab6`.**

## Changes Made

### 1. Interaction model (Figma-style)

- Press on canvas with an armed piece places it immediately (floored
  coords + vertex snap); drag positions it with live snapping (green
  dots); release commits and the tool reverts to Move with the piece
  selected.
- Hover preview: translucent armed piece + snap vertices follows the
  cursor on desktop; suppressed during gestures; cleared on `pointerleave`.
- `Esc` cancels an in-progress placement drag (piece removed, no history
  entry) or dismisses the armed tool; always returns to Pan.
- Pan is now the default/boot tool; `setMode` preserves tool-tools.
- Shift held on release keeps the piece armed for rapid stamping;
  right-click (`button > 0`) no longer places.

### 2. Architecture — ES modules, no build step

- `editor.js` deleted; split into `src/` along the existing seams:
  `pieces` (catalog data) → `geometry`/`track`/`art`/`assets`/`storage`
  → `store` → `ui`/`input` → `render` → `main`. Acyclic graph.
- New store (`src/store.js`): single model; mutations via actions
  (`place`, `rotate`, `undo`, `deleteSelected`, …) or `updateLight` for
  transient gesture frames; render/ui/autosave subscribe through one
  notification path. DOM-free → unit-testable under plain node.
- `package.json` added — **dev tooling only** (`node --test`, Playwright);
  the app import graph stays zero-dependency, no bundler. ES modules
  require http: `file://` no longer works (documented in README).
- MIT/Tamiya attribution preserved (full notice in `src/main.js`,
  derived-data notices in `pieces.js`/`geometry.js`/`track.js`).
- Dead state removed (`lastPointer` was write-only);
  `window.__m4wd` test hook exposed in `main.js`.

### 3. Test plan & frameworks

| Layer | Runner | Coverage |
|---|---|---|
| Unit | `node --test` (built-in, zero deps) | Track codec byte-compat round-trips, `/load/CODE.js` extraction, negative-coord filtering, share codec vs Node `base64url`; snap/groupSnap math; vertex/rotation basis; computeFit clamping + centering; solveGeo finiteness; catalog integrity; store actions incl. 80-deep history cap |
| E2E | Playwright (dev-only dep) | place/revert, snap-chaining (vertex-exact), drag, deselect, Esc→Pan, rotate, undo, import dialog, share-hash restore, keyboard, touch (`hasTouch` context) |

E2E assertions read the model via `window.__m4wd` — never pixel-diffed.
A DOM-stub smoke script boots `src/main.js` headlessly for wiring
verification where Chromium cannot run (technique documented in
TESTPLAN.md).

## Validation Findings (known gaps)

### `solveGeo` is only tested for finiteness

A wrong-but-finite arc passes. Needs geometric assertions (arc endpoints
must equal the catalog's `v1`/`v2`).

### `snapPiece` snaps to the first in-range vertex pair, not the best

Order-dependent ambiguity unpinned by tests; two equidistant neighbours
resolve by array order.

### Undo snapshots sprites only

Tool/angle/selection changes are not restorable; untested.

### `storage.js` round-trip untested

Autosave → restore needs a localStorage stub test.

### Autosave-restore-on-reload has no e2e spec

Share-hash restore is covered; the localStorage boot path is not.

### Playwright specs have never executed

This sandbox lacks Chromium system libs (glib etc., no root to install).
Specs are valid but unverified — must run in CI or on a dev machine
(`npx playwright install chromium`).

### CI not wired

Nothing runs the suites on PRs yet; ai-workflows plumbing exists but
secrets/variables are still unset (deferred by owner).

### TDD not yet codified

Pure modules make red-green-refactor practical now; README-LLM should
mandate it for `store`/`geometry`/`track` changes and spec-first for
interaction changes.

## Files Changed

### mini4wd-track-editor (commit `7c25ab6`)

- `editor.js` — deleted (split into `src/`)
- `src/pieces.js`, `src/geometry.js`, `src/track.js`, `src/art.js`, `src/assets.js`, `src/storage.js`, `src/store.js`, `src/render.js`, `src/input.js`, `src/ui.js`, `src/main.js` — new module graph
- `index.html` — module entry (`src/main.js?v=1`), hint + help text for the new interaction model
- `package.json`, `package-lock.json`, `playwright.config.js`, `.gitignore` — dev tooling
- `tests/unit/` (4 files, 39 tests), `tests/e2e/` (2 files, 13 specs) — test suites
- `TESTPLAN.md`, `README.md`, `README-LLM.md` — docs
- `docs/worklogs/0001_2026-09-10_figma-placement-module-split-tests.md` — this file

### Related PRs (ai-workflows onboarding)

- lenaxia/ai-workflows#45 — consumer config + propagate matrix + README row
- lenaxia/mini4wd-track-editor#1 — caller workflows, forked `.github/prompts/`, `opencode.json` (open; will conflict on `README-LLM.md` — resolve in favor of main's module-era version)
