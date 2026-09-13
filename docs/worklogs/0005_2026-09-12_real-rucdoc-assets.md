# 0005 — Real rucdoc assets: rendered sprites + measured catalog

**Date:** 2026-09-12  
**Triggered by:** Owner provided signed GCS URLs for rucdoc's zips (the
mobile-friendly door: logged-in tap-Download → copy link → paste).

---

## Summary

First real-data integration: three top-down orthographic renders of
rucdoc's actual 3D models now back the catalog (replacing derived data
for those pieces), including one shared sprite serving a nine-height ramp
family. The dz measurement method was validated against ground truth
(his labeled 5–45mm ramps: measured 7/13/18/23/27/32/38/43/47 — perfectly
monotonic, constant +2-3mm band offset, calibrated away by using labels).

## Changes

- **assets/**: R1S250.0.png (51×27), R1REntry.0.png (21×27), R2Ramp.0.png
  (46×51) — flat-lit Cycles renders (shared families must not bake slope
  shading), pipeline at tools/render-pipeline.
- **Catalog**: R1S250 now carries measured real geometry (verts [[0,-6],
  [25,-6]] — the real piece is off-center; h 13.3). R1REntry new (10.4cm
  body, zOff 16 from bed-cluster measurement). R2Ramp5..45: nine entries
  sharing `sprite: 'R2Ramp'` (labels as ground-truth zOff). Derived seeds
  R1R250/R2R250 dropped (real system downloaded); other seeds remain
  procedural until their zips arrive.
- **sprite: field**: imageFor/preload use `def.sprite || name` — one PNG
  backs all nine ramp heights; height lives in data (z badge, shadow,
  clearance all runtime-driven).
- **Tests**: pieces.test pins "sprite XOR procedural" per rucdoc drawer
  entry (with an fs check on assets/), travel-axis vert centering, and a
  separation-floor exemption scoped to measured non-Tamiya pieces. e2e:
  sprites serve 200, boot-preload wiring (incl. the sprite override)
  with no per-height 404s, and imageFor resolution pinned in-page. The
  corner-chaining spec already covered R1C45I150 — unchanged here.
- **Attribution** (rule 3): index.html credits + README name rucdoc MIT;
  sprites are renders of his published models, catalog data measured
  from the same. ?v=8 (style untouched).
- R1R250 removed entirely; R2R250 dropped from palette/hotkeys only —
  the def is retained so pre-existing saves/links keep parsing
  (procedural: true = no asset requests).

## Validation

70/70 unit · 28/28 e2e · smoke ok. Downloaded-but-unwired: 1L straights
147/150/246 + 10 support pieces (structure, out of catalog scope);
pipeline handles STL (mm) + 3MF (unit-aware) with all frame bugs fixed
(see 6dd837c).

## Addendum — SVG sprites (same day)

Owner feedback: the Cycles top-downs read poorly — rucdoc cuts material
holes in the bed underside (read as voids in ortho) and flat-lit walls
have no contrast; the originals are light-bed/dark-wall illustrations.
Pivot: catalog-driven SVG sprites (tools/render-pipeline/svg.py) in the
sampled original palette (#efeae5 bed, #7a7674 walls, #5d5a57 outline,
white dashed lane separators, chevrons on slopes). Every downloaded
piece is a rectangle in top-down ortho, so catalog vectors are exact;
the 3D render keeps mask/measurement duty (contour tracing for future
corner pieces). sprite: fields now carry full filenames (R2Ramp.svg);
the mesh renders are retired from assets/.

## Addendum 2 — full-catalog SVG redraw

Owner: redraw the Tamiya rips as SVGs too (low-res originals, simple
shapes; lane-changer/rainbow "more complex" but art.js already encodes
their geometry). svg.py now emits the ENTIRE non-procedural catalog —
67 variant files + the 3 rucdoc shared sprites — in the sampled
palette, shape logic ported from art.js: rects for straight-family
kinds with kind markings (start checker, slope chevrons, jump block +
hatch, bank stripes, wave sines, changer diagonals), annular sectors
for corner/hairpin with geometry from solveGeo (via the node dump).

All content in the CENTERED frame matching verts (the first cut drew
rects 0-based into a centered viewBox — half off-canvas; caught by
rasterizing all 67 in Chromium and measuring lit-pixel coverage).
Lan2 reads 24% opaque — geometrically correct (both verts at x=-90).

Loader resolves name.c.svg for every piece; the original PNGs stay in
assets/ untouched as provenance (the artwork-as-is rule bends by owner
decision — loaded art is now the redraw, attribution unchanged).
?v=10.
