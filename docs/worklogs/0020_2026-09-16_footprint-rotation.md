# 0020 — Footprint caps are rotation-free; filter boxes aligned

**Date:** 2026-09-16
**Triggered by:** Owner — "does the WxH filter also check for HxW? also
At Most text boxes arent lined up, please line them up."

---

## Rotation-free footprint caps

A room constraint is the same room turned through 90°: a track now
matches max W×H if EITHER orientation fits — `(w≤W && h≤H) || (w≤H &&
h≤W)` — in all three drivers. A single cap keeps the rotation-free
analog of the old per-axis filter: at least one side ≤ N
(`MIN(w,h) ≤ cap` / `LEAST` / `Math.min`). The footprint tooltip
says so. Pinned in the store-conformance suite (a tall 54×120 track
matches 200×100) and at the HTTP level (138×36 direct, 54×120 turned,
120×60 direct, 354×336 exceeds both ways).

## Filter box alignment

The At Most (and footprint) inputs moved into a grid —
`repeat(auto-fit, minmax(130px, 1fr))` — with each label stacked ABOVE
its input and the unit suffix riding inline with the box; every input
now shares width/x per column (probed at 390 and 1280). Previously the
labels' differing text widths staggered the boxes.
