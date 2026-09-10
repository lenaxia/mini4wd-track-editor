# 2026-09-10 — Figma-style placement, ES-module split, test plan & framework

## Context

Continuing from the PoC fork: placement used a two-stage ghost/confirm flow
(tap empty space to aim, tap the track to place) that felt clumsy. This
session reworked the interaction model, then took the architecture step we
had discussed: split the 1167-line `editor.js` monolith into ES modules
with a real model layer, and define the testing story (plan + frameworks).
Also onboarded the repo onto lenaxia/ai-workflows (separate PRs, see
References).

## Changes

### 1. Interaction model (Figma-style: place → move → click away)
- Press on canvas with an armed piece places it immediately (floored
  coords + vertex snap); drag positions it with live snapping (green dots);
  release commits and the tool reverts to Move with the piece selected.
- Hover preview: translucent armed piece + snap vertices follows the cursor
  on desktop (mouse/pen); suppressed during gestures; cleared on leave.
- Esc: cancels an in-progress placement drag (piece removed, no history
  entry) or dismisses the armed tool; always returns to Pan.
- Pan is now the default/boot tool; setMode preserves tool-tools.
- Shift held on release keeps the piece armed for rapid stamping;
  right-click (button > 0) no longer places.

### 2. Architecture — ES modules, no build step
- `editor.js` deleted; split into `src/` along the existing seams:
  `pieces` (catalog data) → `geometry`/`track`/`art`/`assets`/`storage`
  → `store` → `ui`/`input` → `render` → `main`. Acyclic graph.
- New store (`src/store.js`): single model; all mutations via actions
  (`place`, `rotate`, `undo`, `deleteSelected`, …) or `updateLight` for
  transient gesture frames; subscribers (render, ui, autosave) notified
  through one path. DOM-free → unit-testable under plain node.
- Pure modules (pieces, geometry, track, store) import nothing DOM-bound.
- `package.json` added — **dev tooling only** (`node --test`, Playwright);
  the app import graph stays zero-dependency, no bundler. ES modules
  require http: `file://` no longer works (documented).
- MIT/Tamiya attribution preserved (full notice in `src/main.js`, derived
  notices in pieces/geometry/track).
- Dead state removed (`lastPointer`); `window.__m4wd` test hook exposed.

### 3. Test plan & frameworks (TESTPLAN.md)
- **Unit** — Node built-in runner (`npm test`), 39 tests green:
  track codec byte-compat round-trips + `/load/CODE.js` extraction +
  negative-coord filtering + share codec vs Node `base64url`; snap/groupSnap
  math; vertex/rotation basis; computeFit clamping+centering; solveGeo
  finiteness; catalog integrity; store actions incl. 80-deep history cap.
- **E2E** — Playwright (`npm run test:e2e`), 13 specs: place/revert,
  snap-chaining (vertex-exact), drag, deselect, Esc→Pan, rotate, undo,
  import dialog, share-hash restore, keyboard, touch (hasTouch context).
  Assertions read the model via `window.__m4wd` — never pixel-diffed.
  **Not yet executed**: this sandbox lacks Chromium system libs (glib…);
  run `npx playwright install chromium` on a real env/CI.
- **Wiring smoke** — DOM-stub script boots `src/main.js` headlessly
  (kept out-of-tree; documents the technique in TESTPLAN.md).
- Docs updated: README (architecture/run), README-LLM rewritten for the
  module era (acyclicity rule, dev-tooling-only package.json, validation
  with `npm test`), `.gitignore` (node_modules, test-results, report).

## Verification (this session)

- `npm test` → 39/39 pass
- `node --check` over all src modules + serve.js + specs → clean
- DOM-stub smoke: boots, default tool Pan, store mutates via hook
- `curl` smoke via serve.js: `/`, `/src/main.js` → 200
- Byte-compat pinned by unit fixture (release blocker)

## Known gaps / next steps

1. `solveGeo` tested only for finiteness — needs endpoint/geometry asserts.
2. `snapPiece` first-match-not-best ambiguity unpinned.
3. Undo snapshots sprites only (tool/angle/selection not restorable).
4. `storage.js` round-trip untested (needs localStorage stub).
5. Autosave-restore-on-reload has no e2e spec.
6. Playwright specs never executed (need Chromium env) — run in CI.
7. CI not wired yet (ai-workflows plumbing exists; secrets pending).
8. TDD not yet codified into README-LLM (pure modules make it practical
   now: red-green-refactor for store/geometry/track; spec-first for
   interaction changes).

## References

- ai-workflows consumer onboarding: lenaxia/ai-workflows#45
- Repo-side onboarding (workflows/prompts/opencode.json/README-LLM):
  lenaxia/mini4wd-track-editor#1
- Architecture discussion that motivated the split: session log
  (vanilla JS retained; Konva/Fabric/Pixi/Excalidraw/tldraw evaluated and
  rejected; ES modules adopted as the no-build-compatible modularization).
