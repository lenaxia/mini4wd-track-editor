# Test Plan — mini4wd-track-editor

## Strategy

Two automated layers over the module split, plus a manual device matrix for
what cannot be emulated faithfully. Everything runs with zero runtime
dependencies: unit tests use Node's built-in runner; e2e uses Playwright
(dev-only install).

| Layer | Runner | Scope | Speed |
|---|---|---|---|
| Unit | `node --test` (built-in) | Pure modules: `track.js`, `geometry.js`, `pieces.js`, `store.js` (DOM-free by design) | < 1s |
| E2E | Playwright (Chromium) | The wired app: gesture flows, UI shell, boot/restore, share links, touch | ~10s |
| Manual | human | Two-finger pinch, real touch devices, sprite rendering fidelity | — |

## Release blockers covered by automation

1. **Track format v2 fidelity** — `parseTrack → serialize` must reproduce
   the v2 string exactly, and legacy 5-field input must parse to z=0
   (unit, `track.test.js`). Persistence paths serialize via
   `serializeForSave` (minimal translation for negative-origin tracks).
   Connection invariants (tangent + level at joints) are pinned by
   `geometry.test.js`; overlay/clearance flags by `store.test.js`.
2. **Snapping correctness** — vertex snap and group snap (unit,
   `geometry.test.js`): closest-pair-wins, applied once, ties resolved
   deterministically by array order; chained placement produces byte-exact
   connections (e2e).
3. **Interaction model regressions** — the Figma-style flow (place → move →
   click-away deselect, Esc → Pan, tool revert) is pinned by e2e specs.

## Unit tests (`tests/unit/`)

- `track.test.js` — round-trip byte-compat on a fixed fixture;
  `/load/CODE.js` body extraction; malformed segments skipped;
  negative-coordinate filtering in `serialize`; share codec round-trip
  (verified against Node `Buffer` base64url); `serializeForSave`
  byte-identity for valid tracks + lossless translation for
  negative-origin tracks (no model mutation).
- `geometry.test.js` — `rot` basis rotations; `vertexOf` under rotation;
  `snapPiece` closest-pair-wins / deterministic ties / exact vertex
  connection; `groupSnap` best pair; `topPieceAt` z-order + bbox;
  `computeFit` clamping and centering; `solveGeo` finite arcs whose
  endpoints equal the catalog `v1`/`v2` exactly.
- `pieces.test.js` — catalog integrity: palette entries resolve, vertices
  finite, `colors >= 1`, footprints positive.
- `store.test.js` — actions: place floors + snaps + selects; undo/pop
  history (incl. 80-deep cap); rotate (selection around visual centers,
  armed angle only); delete, color cycle, clear, import; load-snapshots
  history.
- `storage.test.js` — autosave → restore round-trip through a Map-backed
  localStorage stub (350ms debounce), negative-origin losslessness,
  malformed-save tolerance.

## E2E tests (`tests/e2e/`, Playwright)

Run against the real app served by `serve.js` (auto-started, reused if
already running). Assertions read the model through the `window.__m4wd`
test hook (exposed by `src/main.js`) — never pixel-diffed.

1. Boot: empty track, Pan default tool, stats text.
2. Placement: palette → canvas click places, tool reverts to Move, piece
   selected.
3. Chaining: second placement snaps to first piece's far vertex exactly.
4. Drag: placed piece repositions by screen-delta / scale.
5. Deselect: click empty space clears selection.
6. Esc: dismisses armed piece tool → Pan.
7. Rotate: `X` rotates selection (coords + angle).
8. Undo: `R` steps back; empty-history is a no-op.
9. Import: menu → paste → Import loads the legacy fixture track (z=0).
9b. Corner chaining auto-orients (armed wrong angle corrected, sub-mm joint).
9c. Slope chaining adopts +75 mm; PageUp/▲▼ manual levels persist on reload;
    pivot rotation keeps the joint coincident; drag perf smoke on 500 pieces.
10. Share: `#t=` hash restores the track on a fresh load (hash-only gotos
    are same-document navigations — the spec hops via `about:blank`).
11. Autosave: placed track survives a reload through localStorage
    (layout preserved exactly; restored coords non-negative).
12. Touch (`hasTouch`): tap-chip + tap-canvas places (mobile viewport).
13. Keyboard: `1` arms the first piece family.
14. Rudoc drawer: mode switch + re-arm, reload via autosave, 1L 45° corner
    chains at its real geometry (chirality-agnostic weld).

## Manual matrix (not automatable with current tooling)

- Two-finger pan & pinch-zoom (Playwright `touchscreen` is tap-only;
  multi-touch needs CDP dispatch — roadmap).
- iOS Safari gesture quirks (`gesturestart` prevention).
- Sprite rendering fidelity vs procedural fallback.
- Performance feel on low-end Android.

## Running

```sh
npm test                          # unit (node --test)
npx playwright install chromium   # once, after clone — needs system libs for Chromium
npm run test:e2e                  # e2e (starts/reuses serve.js on :3000)
```

Note: headless Chromium requires OS libraries (glib/nss/etc.) that not
every sandbox provides (`npx playwright install-deps chromium` on Debian).
Where the browser cannot launch, the specs still run unchanged in CI or on
a developer machine; use the DOM-stub smoke trick or the unit layer for
headless wiring verification in constrained environments.

CI: both layers run on every PR and on pushes to main via
`.github/workflows/ci.yml` (unit → per-file syntax check → Playwright
with `chromium --with-deps`).
