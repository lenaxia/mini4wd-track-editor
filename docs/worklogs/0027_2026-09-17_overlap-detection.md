# 0027 — Same-level road overlap detection (corridor containment)

**Date:** 2026-09-17
**Triggered by:** Owner pick from the ledger ("2 and 3") — deferred
since 0013: "same-level road overlap is not yet detected; bbox tests
would false-positive on weaves; needs silhouette-true checks."

## Approach

Corridor containment, not bbox and not centerline distance:
- Each piece's road is its true corridor — the rectangle over the
  v1→v2 axis (straight kinds) or the annular sector (corners and
  hairpins via solveGeo), at half-width band/2 or h/2.
- Centerline samples every ~5 cm carry their interpolated z. Two
  roads collide when one's corridor — WIDENED by the other's
  half-width minus a 1 cm touch slack — contains a same-level sample
  of the other, tested BOTH ways (a thin crossing lens may hold
  samples of only one side).
- STRICT ends: a sample past a road's end is not on it. This is what
  separates chains and jump gaps (close centerlines, disjoint
  surfaces) from real overlap — the naive centerline-distance version
  false-flagged both.
- dz compares the guest sample against the HOST's z interpolated at
  the containment point (a ramp only collides where it is actually
  low). dz in the 20–75 mm band stays the paint-rule WARNING's
  domain; LEVEL_EPS (20 mm) is the same-level line.
- Samples within 16 cm of a joint the pair SHARES are the junction
  itself — Y-junctions stay legal (0013's rule).

VALIDATOR_VERSION 3→4: the boot sweep re-stamps stored rows, so
existing tracks converge to the new rule without re-saves.

## Tests

Seven unit fixtures: touching parallel straights clean; 30 cm-squeezed
parallel pair errors; same-level crossing errors; the same crossing
bridged at 75 mm clean; a 40 mm near-miss stays a clearance warning;
chained straights and the closed square clean; a corner overlapping a
straight errors. The pre-existing fixtures (jump pairs, junctions,
kinks, the shared rounded track) all still pass — the full unit suite
(199) and e2e (94) are green.

## Review round

- Waves broke the corridor model: their road wanders inside a TALLER
  footprint (Chi2: 60-wide road in a 72-high box), so the footprint
  rectangle false-flagged legal layouts — the review's fixture (a
  straight 17 cm clear of the surface) errored. roadWidth() now uses
  the lane width for waves (3L=36, 5L=60); the fixture is pinned, and
  a true crossing through a wave still errors.
- The commit claimed "no buster needed (server module graph only)" —
  WRONG: ui.js imports validate.js, the badge runs it in-browser.
  main.js ?v=80. (Rule 7 burn twice in one day; the reviewers keep
  being right.)
- Negative-sweep arcs: t now maps to [0,1] for both sweep signs
  (latent — every current catalog arc solves positive, arcs are flat).
- pieceHalfExtents bbox early-out before the pair sample loop (the
  badge re-validates per settled mutation; far pairs are now free).
- STRICT-ends comment corrected: ends are endpoint-inclusive (welded
  ends are joint-exempt; an unwelded endpoint touch is genuine).
