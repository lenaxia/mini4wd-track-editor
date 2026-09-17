# 0029 — Junction pardon radius is per-pair (T-junctions were flagged)

**Date:** 2026-09-17
**Triggered by:** The overlap detector (#58) met the real world: the
seeded pimentoso originals re-stamped with 2–48 issues each, and
hand-verifying Featured K8EC79 showed three straights welded at a
T-junction (vertical end at (359,170), horizontal pair meeting there)
flagged 20 cm away — inside the junction's genuine surface-merge zone,
outside my fixed 16 cm pardon.

## Fix

The pardon radius for a SHARED joint is per-pair:
`roadWidth(host)/2 + roadWidth(guest)/2` — exactly how far two welded
roads' surfaces can legitimately overlap from the joint point. The
pardon still applies ONLY to pairs that share that joint (an unjoined
piece crossing near someone else's junction is a real collision).

## Pins

- The exact T-junction geometry from the seed (3× Str1) stays clean.
- An unjoined horizontal crossing the same vertical still errors.
- All 21 validator pins green; npm test 206.
