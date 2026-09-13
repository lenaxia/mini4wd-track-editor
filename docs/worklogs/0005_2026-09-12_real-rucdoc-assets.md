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
