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

## Round 2 — the "T-junction" was a crossing all along (owner correction)

Hand-verifying K8EC79's flagged point showed Bri1 slopes at (224,170)
and (440,170) flanking the horizontal run: the horizontal line is a
BRIDGE DECK passing over the vertical one. The four coincident
endpoints are not a 4-way junction — the original codec has no
elevation, and crossings there are bridges by construction ("does an
F1 track have a 4-way stop?").

Semantics rebuilt on that ruling:

- WELDED pairs (tangential out-in at the shared vertex — the kink
  check's own test) keep the per-pair merge-zone pardon, silently.
- Endpoint-coincident but PERPENDICULAR pairs are not connected at
  all: they are plan CROSSINGS. Flat data cannot prove same-level
  (legacy decks read z=0), so their surface contact is a WARNING —
  "no level difference recorded; raise the deck's level" — never an
  error. Legacy imports validate; our editor's users get told.
- Mid-piece same-level crossings (no shared endpoints, the v2 editor
  where z is expressible and unset) remain ERRORS.

Pins: the K8EC79 signature now expects the warning; a welded chain
stays fully silent; a mid-piece crossing still errors. The seeds:
K8EC79 → 0 errors + 4 crossing warnings; PV9PJ7 → 14 genuine
same-level errors (spot-verified: a ~4 cm surface intersection the
original never validated — it had no validator).
