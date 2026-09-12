# 0003 — Orientation, elevation & the design that survived three stress rounds

**Date:** 2026-09-11  
**Triggered by:** Owner reports — snap doesn't auto-orient; rotating connected pieces breaks joints; crossovers/bridges need z. Design iterated in-conversation through three hostile review rounds + a rucdoc-catalog reality check, then spec-first implementation.

---

## Summary

Connections became a three-part invariant (coincident vertex + aligned
tangent + matching level), pieces gained per-vertex elevation, and the
format took the owner-approved breaking change (6th field `z`). The app
stress test that preceded this (worklog 0002 era tooling) surfaced the
`encodeShare` stack crash, fixed here. All ambiguities from the design
rounds are resolved in `docs/design/orient-elevation.md` — the spec is
the contract; this log records what the work actually did.

Branch: `feat/orient-elevation`.

## Changes Made

### 1. Connection model (geometry.js)

- Catalog migrated `v1/v2` → `verts: [[x,y,zOff],…]` (all 23 pieces;
  slopes get provisional `zOff=75` — the clearance standard).
- Cached local tangents per piece: axis kinds from `verts[0]→verts[last]`,
  arc kinds from `solveGeo` (radians→degrees — first implementation added
  degrees to radians; caught immediately by the red tests).
- `snapPiece` now makes joints PROPER: absolute-rotation orient
  (`orientAngle`), exact vertex coincidence, level adoption
  (`z = neighborLevel − own zOff`). Chaining onto a slope top lands the
  next piece at +75 mm automatically; entering a corner at v1/v2 gives
  both chiralities — no mirroring, ever.
- `groupSnap` stays position-only (pinned by test). `externalJoint` finds
  the single-joint case for pivot rotation. `topPieceAt` is z-ordered.
- Vertex-pair ties: deterministic encounter order (hysteresis deferred
  until 3-vertex pieces exist — recorded in the spec).

### 2. Store & interaction

- `place(…, z = state.zArm)`; sprites carry `z`.
- `rotate`: exactly one external joint → pivot about it (the connection
  survives; the kink is honest and flagged); else visual-center centroid.
- `bumpLevel(±10 mm)` for armed piece or selection (clamp ±300),
  wired to PageUp/PageDown and new ▲▼ toolbar buttons (touch parity).
- `refreshFlags` on every `emit()` — never per frame: `_over`
  (draw semi-transparent over lower track), `_warn` (0 < Δz < 75 mm —
  insufficient clearance, red dashed outline), `_bad` (coincident joint
  with tangent/level mismatch — red vertex dots).

### 3. Rendering

- Painter's order by z (flat tracks render exactly as before), viewport
  culling (phone-first perf), elevation shadow, `z` badge on selected
  raised pieces, `art.js` generic fallback for unknown kinds.

### 4. Serialization v2 (breaking, owner-approved)

- `Name;x;y;angle;color;z#`, z always emitted (integer mm, signed),
  angle rounded to 3 dp (float-rotation artifacts must not reach files).
- Read path: 5-field legacy → z=0, v2, `/load/CODE.js` — forever.
- `encodeShare` chunked — the ≥~2,500-piece `String.fromCharCode` spread
  crash is fixed and pinned by a 5,000-piece test.
- `index.html` `?v=3`; README-LLM hard rule 2 rewritten (v2 writes,
  legacy imports); TESTPLAN updated.

## Validation Findings

- Catalog vertex data is approximate (solved Cor1 arc = 45.01°, not
  45.000°): tangent tests and e2e joint assertions use 0.05°/sub-mm
  tolerances — exactness would be testing fiction.
- The corner-chaining e2e taught a real interaction lesson: pressing Z/X
  with a piece still selected rotates the selection, not just the armed
  angle. Correct per the model (selection ops and armed angle are one
  action), but specs must account for it.
- `refreshFlags` is O(n²) on discrete changes (not frames) — at 1,000
  pieces ≈ 8 ms per action, acceptable; noted if it ever matters.
- Deferred (recorded in spec §9): palette redesign for parametric
  families, lazy assets, split flow-roles, full clearance validation,
  rucdoc attribution+license file (MIT confirmed) when assets land.

## Validation (this branch, before push)

    npm test          → 68 pass, 0 fail
    npm run test:e2e  → 20 pass, 0 fail (Chromium headless shell)
    per-file node --check over src/*.js + serve.js → clean
    node serve.js + curl smoke (/, /src/main.js?v=3) → ok
    drag perf smoke: 60-move drag on a 500-piece track — well under gate

## Files Changed

`docs/design/orient-elevation.md` (spec), `src/pieces.js`, `src/geometry.js`,
`src/track.js`, `src/store.js`, `src/input.js`, `src/ui.js`, `src/render.js`,
`src/art.js`, `index.html` (▲▼ buttons, `?v=3`), `tests/unit/*` (codec v2,
tangents, orient/adopt, pivot, flags, catalog), `tests/e2e/editor.spec.js`
(+6 specs), `README-LLM.md` (rule 2), `TESTPLAN.md`.
