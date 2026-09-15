# Sprite invariants

Rules every track-piece sprite obeys, calibrated by the owner across
the Lan1/Lan2/Bri2 art rounds. The emitter (`svg.py`) is the single
source; a change that violates any rule here is a bug.

## Geometry

- **Lane width is regulation: `LANE_W = 11.5`** (Tamiya 115 mm). All
  lane boundaries sit at `±(n·LANE_W)/2 + i·LANE_W`, centered in the
  piece footprint. Every lane on every piece is 11.5 wide — raster-
  verified by line-center gaps at entry, exit, and through weaves.
- **Footprints are layout truth.** Catalog `w`/`h`/`verts`/`R` (and
  `solveGeo`) never change for art reasons; art must fit inside them.
  Multi-piece alignment (a weave built from 45° turns landing where
  the real track lands) depends only on footprints.
- **Bed traces the road, never the footprint.** The bed fill follows
  the actual boundary lines (walls, weave S-curves, bridge edges,
  split exactly at curve crossings via de Casteljau). No fill may
  escape the line-work; vacated slots and merge gaps stay
  transparent by construction, not by triangle cutouts.
- **Weaves are identical S families.** A lane step is one flat-ended
  cubic (`s_cmd`): leaves horizontally, arrives horizontally, steps
  exactly one `LANE_W`. All stepped boundaries in a weave share the
  same shape and bend zone; curves that must land on a level format
  with enough precision to hit it exactly (`.2f` — a 0.05-short arc
  endpoint shifts a semicircle's center ~1.5 cm).
- **Arcs are exact.** Annulus walls/dividers are semicircles about
  the measured center with endpoints exactly `2r` apart (centers on
  the solveGeo axis). Ray-verify: every angle hits the nominal radii.
- **Corners close.** Horizontal runs fully underlap the end caps
  (extend to the piece edge); end caps span exactly wall-line to
  wall-line — nothing pokes past a crossing stroke. Closed rectangles
  use miter joins; separate segments use butt caps.

## Z stacking (bottom → top)

1. Bed fill
2. Surface shading (ramp gradients) — under every line
3. Lane lines and any delineators that pass under a bridge
4. Bridge / band fill (solid `BANK_GRAY`)
5. Bridge edges, walls, remaining delineators
6. End caps (rails)

A bridge band's flat tails tuck **over** the lane lines they land on;
its own edges and everything above draw **over** the band. Delineators
marking a bridge's departure/landing draw above the band.

## Colors

- Palette constants only: `BED #efeae5`, `OUTLINE #5d5a57`,
  `DASH #8a8683`, `BANK_GRAY #c0bcb8`; rails per `VARIANT_COLORS`,
  banks per family `BANK_COLORS`. Never invent swatches.
- **All line-work is one color** (`OUTLINE`): walls, lane boundaries,
  bridge edges, delineators, end caps. Stroke widths 1.1–1.2.
- Lane-surface shading (gradients) uses `BED → ramp gray #c8c4c0` only
  (the calibrated ramp-face stop in every ramp sprite — distinct from
  `BANK_GRAY`, the Bri2 jump-face midtone).
- Gradients indicate rise: approach lanes ramp bed→gray into the
  climb, exit lanes settle gray→bed at the piece edge; bridge bands
  and the bed stay solid. (Bri2's ramp lane: measured stops 2–20 cm
  from the left edge, flat gray to the face.)

## Delineators (section/piece boundaries)

- Same color and weight as walls; butt caps.
- Span **exactly the lanes they mark**, outer outline to outer
  outline (two lanes = 23.0, landing on the boundary lines in flat
  zones).
- Piece boundaries on turns: full-height at the tangent, radial at
  the 45° divisions (a 180° turn is 4×45° pieces).

## Verification

- Raster in Chromium and diff against the rip / invariants:
  lane-width gaps, silhouette radii, zero bed pixels beyond walls.
- Seam alignment: a piece's entry and exit level sets are identical
  and match the straights' divider levels.
- `npm test` 70/70, `npm run test:e2e` 29/29, `node --check` clean.
