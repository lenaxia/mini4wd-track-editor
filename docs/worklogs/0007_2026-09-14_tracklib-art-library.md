# 0007 — Tracklib art library, verification harness, and the #13 marker incident

**Date:** 2026-09-14
**Triggered by:** Owner direction — typed track schema long-term; recipes as the
only extension point; verification as first-class. The shapes library extraction
was approved work from a parallel session (feat/tracklib-art). This entry also
records the conflict-marker incident that dominated the day.

---

## The #13 incident (PR #14)

The #13 squash-merge shipped literal git conflict markers inside 22 SVGs
(Cor1.0–5.0, Lan1.0/1.1) plus one stray `>>>>>>> origin/main` line in
`index.html`. Root cause: the merge was taken in the *output* files, not the
generator. The generator (`tools/render-pipeline/svg.py`) was unconflicted the
whole time.

Fix (PR #14, squash-merged as 14ef059): regenerate the 22 files from main's own
generator, delete the stray HTML line, bump cache busters (sprites v25,
main.js v40). Verified: repo-wide marker grep clean; all 67 committed SVGs
byte-identical to a fresh scratch regen; 111 unit / 37 e2e green.

Lesson re-learned: **regen into a scratch dir and diff — never merge generated
output by hand.** Also: scope greps repo-wide, not by directory (the first
review round caught the index.html marker my scoped grep missed).

## Shapes library

`tools/render-pipeline/shapes.py` now owns the `rect_family` / `arc_family`
recipes; `svg_globals.py` holds the shared palette. `svg.py` delegates. Output
proven byte-identical (empty regen diff + golden rasters) before any behavior
was added on top.

Slope auto-ramp (owner ruling: slopes are straights with elevation): pieces
with rise render bed→bank-gray gradients automatically (Bri1.1, R1REntry,
R2Ramp); variant-colored slopes keep their sampled gradients.

## Verification harness (tools/verify)

- `inspect.py` — lane-gap probes on flat families, silhouette containment,
  2%-tolerance golden diff
- `rasterize.cjs` — Playwright chromium screenshot at 1 unit = 1 px
- `decode.py` — pure-python PNG decode (no imaging deps)
- `golden/` — 67 frozen reference rasters (67 checked, 0 failures)

## Follow-up fixed here

#15: `changer_art` emitted the identical `<defs>` (approach/exit gradients)
twice in Lan1.0/Lan1.1 — duplicate IDs, harmless only because both copies were
byte-identical. Deduped; rendering unchanged (goldens still pass); only
Lan1.0/1.1 bytes changed.

## Branch hygiene note

feat/tracklib-art's history pre-dated the #11–#13 squashes and contained a
merge of feat/close-loop; rebasing it literally would have relitigated landed
work. Rebuilt instead as a clean branch off post-#14 main carrying only the
true delta (verified by two-dot diff before the rebuild).
