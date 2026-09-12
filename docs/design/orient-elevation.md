# Spec — Orientation, Elevation & Overlay Colors (`feat/orient-elevation`)

Status: decided (all ambiguities resolved below). Precedes implementation
(spec-first per README-LLM). Supersedes the "levels" idea from earlier
discussion — killed by rucdoc's real dimensions (rises 40–100 mm,
clearance standard 75 mm).

## 1. Connection model (the invariant)

A **joint** between pieces S and G is *proper* when all three hold:

1. a vertex of S coincides with a vertex of G (≤ ε, ε = 1e-6 cm),
2. tangents align: S's outward tangent at its vertex == G's inward tangent
   at its vertex (mod 360),
3. levels match: z at S's vertex == z at G's vertex (exact mm).

Tangents: straight-axis kinds (straight/start/changer/wave/slope/jump/bank)
use the v1→v2 axis; arc kinds (corner/hairpin) use the solved arc
(`solveGeo`: tangent = radial angle ± 90°, sign from sweep). Tangents are
catalog-local and cached; runtime rotation is O(1). All current-catalog
results land on the 45° grid; the math is general (rucdoc has 10–30°,
90°, 180° pieces).

**Decision (chirality):** no mirroring, ever. Opposite-turn corners come
from reversed traversal (entering v2) — the 4-pair enumeration is the
complete connection space for 2-vertex pieces.

**Decision (ties/hysteresis):** closest-pair wins with the existing
deterministic tie-break. No hysteresis: the orientation-flap case cannot
occur in the current catalog (min vertex separation 30 cm > 2×SNAP_RADIUS).
Revisit when 3-vertex pieces (splits) land.

## 2. Catalog schema v2

- `verts: [[x, y, zOff], …]` replaces `v1`/`v2` (mechanical migration of
  all 23 entries; `zOff` defaults 0 and may be omitted).
- **z is per-vertex from day one** (`zOff` per vertex) — a single piece dz
  cannot express banked splits whose exits differ. Serialized z = level at
  `verts[0]`; level at vertex k = `z + verts[k].zOff`.
- `colors` = variant count (decoupled from file count — see §6).
- Provisonal Tamiya elevations (**documented unstable**): slope kinds get
  `verts[1].zOff = 75` (the clearance standard, so one slope = one
  crossing level); jump/bank/changer 0. Correct with measured values
  later; changes require a worklog note (tracks keep their placed values).
- Future (rucdoc): arbitrary angles, verts lists of length ≠ 2, measured
  dz from connector running-surface heights, `w/h` from projection bbox.
  Flow roles on splits are explicitly out of scope until splits exist.

## 3. Serialization v2 (owner-approved breaking change; fork not live)

- `Name;x;y;angle;color;z#` — z always emitted (integer mm, may be
  negative). Angle rounded to 3 decimals on write (float-rotation
  artifacts like `29.999999996` must not reach files/links).
- Read path stays legacy-tolerant forever: 5-field → z=0; 6-field;
  `/load/CODE.js` wrappers. The original site has no export feature
  (verified: reset/save/print only), so write-compat is moot; import-compat
  is kept because it's free.
- `track.test.js` re-pinned: 6-field round-trip exact; legacy 5-field →
  z=0; angle/z rounding; `encodeShare` chunked base64 (kills the
  ≥~2500-piece `String.fromCharCode(...)` stack crash).
- `normalizeForSave` stays (still correct, now no longer load-bearing).

## 4. Behavior

**Auto-orient on snap (place + single-piece drag):** on the winning pair,
set `g.a` absolutely so inward/outward tangents align, then translate for
vertex coincidence (exact), then adopt level: `g.z = zS(vertex si) −
verts[gj].zOff`. Armed angle is overridden when snapping; it still applies
to free placement. Multi-piece group-drag snap stays position-only (documented
limitation); single-piece drags — placement or move-tool — carry full
joint semantics (field report: tap-place then Move-drag is the primary
touch flow).

**Rotation (X/Z):** if the selection has **exactly one** external joint
(ε above) → pivot about that joint vertex (keeps it coincident; tangent
kinks are honest and flagged); otherwise rotate about the visual-center
centroid (current behavior). In closed circuits every piece has two joints
→ centroid — pivot is a construction-time behavior by design.

**Manual elevation:** PageUp/PageDown = ±10 mm on armed piece or
selection (clamped ±300 mm), plus ▲▼ toolbar buttons (touch parity).
Primary touch flow is ramp chaining via level adoption — manual z is a
power tool. Badge shows level of armed/selected pieces when ≠ 0.

## 5. Rendering

- Painter's order by z ascending (draw order within equal z = array
  order → flat tracks render exactly as today). Hit-testing sorts the
  same way (`topPieceAt`).
- A piece that plan-overlaps a lower-z piece draws at **alpha 0.8** —
  under-track stays visible (the crossover experience depends on it).
- **Insufficient-clearance warning:** overlap in plan with 0 < Δz < 75 mm
  → red dashed warning outline on the upper piece (visualization must not
  imply a bridge that physically doesn't clear).
- Joint dots: green only when the full invariant holds; red when
  coincident-but-imperfect (kink or level mismatch). Informational, never
  blocking.
- Overlap/joint state is **computed on mutation and cached on sprites** —
  never per-frame (O(n²) trap).
- **Viewport culling:** skip drawing pieces whose bbox is outside the
  view (cheap, addresses the phone-first 70 ms/frame problem).
- Drop-shadow offset scales with z; future rucdoc art may carry baked
  shading; Tamiya artwork stays byte-as-is (mixed DPI accepted).

## 6. Overlay colors

- Pipeline (future): `base.png` + `mask.png` per piece (material-ID pass,
  pixel-aligned with base by construction). Tamiya per-color PNGs remain
  untouched (hard rule).
- Runtime: at load, pre-composite variants into offscreen canvases
  (`VARIANT_COLORS` through mask), cache keyed `(name, c)`; per-frame cost
  unchanged. `imageFor` dual-path: per-color PNG if present else composite.
- `c` stays a plain index in the format.

## 7. Circuit indicator (minimal validator)

With joints cached on mutation: walk the circuit from the start piece
through proper joints — stats bar shows `circuit ✓` when the walk returns
to its origin with matching level, `open` otherwise. Full validation
(lap length vs official, clearance over non-joint overlaps) stays roadmap.

## 8. Fallbacks & hygiene

- `art.js` gains a generic default branch (bbox + kind label) for unknown
  kinds; unknown catalog entries degrade, never throw.
- `encodeShare` chunked (§3). Perf gate: one wall-clock e2e (500-piece
  track, 60-move drag < 15 s) — catches order-of-magnitude regressions;
  CI does not otherwise gate perf (recorded decision).
- `?v=2 → ?v=3`. README-LLM hard rule 2 rewritten: byte-identity →
  legacy-import compatibility.

## 9. Deferred (recorded debt, with trigger)

| Item | Trigger |
|---|---|
| Palette/keyboard redesign for 100+ parametric pieces | rucdoc catalog ingestion |
| Lazy sprite loading | when asset count ~doubles |
| Hysteresis for pair choice | first 3-vertex piece (splits) |
| solveGeo sweep-range coverage test | rucdoc corner parameters land |
| Flow roles on splits | splits land |
| Full clearance validation + 75 mm constant promotion | first crossover track saved |
| rucdoc attribution (MIT © rucdoc) + license file | first rucdoc asset lands |

## 10. Test map (red-green)

Unit: tangent per kind (incl. hairpin anti-parallel, reversed corner);
closest-pair orient; adoption arithmetic (incl. descending via reversed
slope); per-vertex level; pivot-vs-centroid rotation; serialization v2
matrix; encodeShare chunking at 5k pieces; joint/overlap cache on
mutation; topPieceAt z-order.
E2E: corner-exit chaining pins angle 45 + level 0; slope chaining lands
next piece at +75; rotate-connected keeps joint coincident; reload
preserves z; drag perf smoke; ▲▼ button parity.
