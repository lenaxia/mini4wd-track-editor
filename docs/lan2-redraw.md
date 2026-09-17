# Lan2.0 ("Rainbow") — measured geometry, for the redraw

Rip: `assets/Lan2.0.png`, 180×144, 1 px = 1 cm. Canvas center (0,0);
piece coords x ∈ [−90, 90], y ∈ [−72, 72]. All values below are piece
coords unless noted. Probes: dark-run centroids (±0.5 px), alpha
silhouettes, radial ray-casts.

## Catalog (layout truth — the redraw must agree with this)

- `w:180 h:144 lanes:3 band:36 R:54`, verts `[(−90,−54),(−90,54)]`
- `solveGeo`: center **(−90, 0)**, R 54, a1 −90°, sweep +180°
  (semicircle bulging RIGHT of the left edge; entry tangent +x at
  (−90,−54), exit tangent −x at (−90,+54))
- Road centerline: straight y=−54 from the right edge to the tangent
  point x=−36 (center − 18? no: −90 + 54 = −36), then r=54
  semicircle about (−90,0) through (−36,0)… see Arc below, then
  straight y=+54 back to the right edge. **The 180×144 canvas is the
  exact bounding box of this path** (with walls at r±18: max x =
  −36+72=36? no — see Arc; the r=72 outer wall reaches x=−18+90…
  re-derive at draw time from the radii table).

## Entry straight (left half, travel +x)

- Road occupies y ∈ [−72, −36] at the left edge; **walls at y = −72
  and −36 flat from x=−90 to at least x=−88 (probe) — the straight
  runs the full canvas height top-to-bottom hugging the left edge**;
  dividers flat at **y = −60 and −48** from x=−90 to x=−58 (probe:
  −48 present from x=−76; the −60 line appears from x=−76 in
  top-half scans but reads as decoration further left — treat both
  as flat −60/−48 from −90).
- Regulation grid on this straight: walls −72/−36, dividers −60/−48
  ⇒ lanes [−72,−60] [−60,−48] [−48,−36], 12 pitch (the rip is a
  12-pitch artifact era piece; current emitter uses 11.5 by owner
  ruling — **redraw keeps the 11.5 grid, levels at
  −71.25/−59.75/−48.25/−36.75** as shipped).

## The weave (on the entry straight, x ≈ [−58, +14])

Three identical S-curves, one per boundary (owner-approved Lan1
vocabulary). From the fine trace (top-half lines):

- x=−58..−46: dividers still flat (−48, −37…−36.5 drifting) — the
  **weave zone starts ≈ x = −52** (first departure from flat at the
  −48 divider, x=−52 reads −42.5 = weave ramp-in artifact).
- The three stepped curves (values traced every 6 px, y):
  - boundary A (top): −72 flat → diving from x≈−22 (−71) through
    −67 (x=−10), −64 (−4), −62 (2), −61 (8..14) → settles
  - boundary B (mid): −48 flat → −47.5 (−40), −45.5 (−34), −43
    (−28), −40 (−22), −36 (−16), −30.5 (−10), −24 (−4), −14 (2)
  - boundary C: −37/−36.5 flat → −35.5 (−40), −33.5 (−34), −30.5
    (−28), −26 (−22), −25.5 (−16), −11.5 (−10)
  - crossing marks near y −20..−11 at x −16..2 (the weave's X)
- **Weave completes ≈ x = +14** (all three back to parallel: −61,
  −49, −37 at x=14; shifted down one lane = 12 in rip pitch).
- The bottom lane is NOT part of the weave (owner: leave for later)
  — only the top two lanes step down.

## Section delineators (piece boundaries in the rip)

- **x = −35.5**: vertical line on the entry straight spanning the
  two weaving lanes (y −71..−48 rip / −71.25..−48.25 grid).
- **x = +18** (the turn's tangent): full-height delineator, measured
  in the rip on entry AND exit bands.
- Radial marks at −45°, 0°, +45° across the band (the 180° turn is
  4×45° pieces): r 36.75 → 71.25 on the 11.5 grid.

## The 180° arc (right side)

Ray-cast radii from the arc's true center **(18, 0)** (canvas
(108,72)) — NOT the catalog's solveGeo center; the rip's art center
sits at x=+18:

| angle | dark radii (cm) |
|---|---|
| −75° | 48–49, 60, 72 |
| −45° | 36–37, 48–49, 59–62, 70–71 |
| −15° | 36–37, 47–48, 60, 71–72 |
| +15° | 36–37, 47–48, 58–60, 71 |
| +45° | 36–71 (dense crossing texture) |
| +75° | 36–37, 47–48, 58–60, 71 |

⇒ **walls r ≈ 36 and 72, dividers r ≈ 48 and 60** about (18,0):
lanes [36,48] [48,60] [60,72] — 12 pitch in the rip; redraw uses the
11.5 grid **r = 36.75, 48.25, 59.75, 71.25** (owner-approved from
the Lan2 rounds: "radii exact … ray-verified"). Outer wall max x =
18+72 = 90 = canvas edge ✓; inner wall min y at top = x=18 vertical
tangent — the arc's ends land on the vertical line x=18 where the
straight/turn delineator sits.

## Exit straight (bottom, travel −x)

- Mirror of the entry: road y ∈ [+36, +72], walls +36/+72, dividers
  +48/+60, running from the arc's exit tangent (x=18) to the right
  edge x=90. Exit edge probe (x=87): two lines only at ±17 — the
  exit runs to the RIGHT edge (the piece's second weld is at
  (−90,+54)? — catalog verts say both verts on the LEFT edge;
  travel exits at (−90,+54) heading −x after the semicircle. The
  exit straight occupies the bottom band y∈[36,72] from x=18 right,
  and the arc brings it back to the left vert — geometry per
  solveGeo, art per the radii table above).

## Styling tokens (Bri2 vocabulary, per INVARIANTS)

- All line-work OUTLINE #5d5a57, 1.1–1.2; dividers same color
  (owner ruling on Lan2: lanes are dark-lined, no dashes)
- Walls unstroked-fill boundary; bed traces the road exactly
- Bank-gray BANK_GRAY #c0bcb8 only where physical meaning (none
  measured on Lan2's rip beyond the deferred decorations)
- Deferred (owner scope): arc spiral ribbon, hatch fan, exit-side
  weave details

## Redraw checklist

1. Entry straight on the 11.5 grid (levels −71.25/−59.75/−48.25/−36.75)
2. Weave zone x ∈ [−52, +14]: three identical flat-ended S-curves
   stepping the top two lanes down one slot; bottom lane untouched
3. Delineators: x=−35.5 (weaving lanes), x=+18 full height
   (straight|turn piece boundary), radials at ∓45°/0°
4. Semicircle about (18,0): walls r 36.75/71.25, dividers 48.25/59.75,
   endpoints exactly 2r apart (centers on the axis)
5. Exit straight mirrored
6. Inspector green + goldens re-frozen

---

## OWNER RULING — construction model (supersedes "custom recipe" framing)

The Rainbow is a kit-bash, confirmed: **two Bri2.0s in parallel,
both facing the same direction** (entry straight on one side of the
180°, exit on the other). Assembly:

| subsystem | pieces | joins |
|---|---|---|
| entry straight | 1× Bri2.0 (3-lane, bottom-lane ramp → elevated) | — |
| exit straight | 1× Bri2.0, same orientation | — |
| ground 180° | 4× stock 2-lane 45° corners | Bri2 #1's two ground lanes → Bri2 #2's two ground lanes |
| elevated 180° | 4× rucdoc 1-lane 45° corners | Bri2 #1's bridge lane → Bri2 #2's bridge lane (different radius ⇒ grade crossing mid-turn; inside lane exits outside) |

**Presentation ruling: ship it as ONE piece** — users place a
single "Rainbow", not eight parts. The redraw reuses the existing
art vocabulary verbatim: bri2_art for the two straights (ramp
gradient, face, weave per the approved Lan1/Lan2 work), stock 2L
corner bands for the ground arcs, rucdoc 1-lane band style for the
bridge arcs, crossing rendered where the 1-lane bridge passes over
the ground lanes (the rip's X texture). Delineators at the 45°
joints are literally the piece boundaries of the corner sets.

Editor implication (recorded for the lane-bundle design): this is
the canonical use case — 2-lane corner bundles snapping to the two
ground lanes, a 1-lane bundle to the elevated lane.
