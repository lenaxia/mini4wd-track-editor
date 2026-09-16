# 0018 — Facet reclassification: slopes separate, hairpins ×4

**Date:** 2026-09-16
**Triggered by:** Owner rulings on the classification shown in the
gallery rows and the metadata popup — "slopes should not count as
straights. They are not interchangeable with straight pieces. Slopes
count separately" and "hairpins and rainbows should count as 4 pieces
as it takes 4× 45° pieces to make a 180".

---

## Rules (both classifiers, one truth)

- **straights** = straight + wave (waves are flat straights with a bump
  — unchanged).
- **slopes** = NEW facet: the slope kind alone. A slope changes
  elevation; it is not interchangeable with a straight.
- **corners** = corner + hairpin, where a hairpin/rainbow (180°)
  contributes **4** — four 45° corners' worth.
- specials (changers, jumps, banks, starts) stay excluded; lanes = max.
- `src/gallery.js#trackFacets` and `lib/store/facets.js` implement the
  identical switch; the unit cross-check (serialize → facets) pins
  equivalence so the popup can never disagree with the stored row.

## Server

- New `slopes` column (memory: row field; sqlite/pg: DDL + additive
  ALTER migration) — list rows carry it, `sort=±slopes` whitelisted and
  mapped in every driver.
- `VALIDATOR_VERSION` 1→2 (stamped on writes): the boot sweep re-stamps
  every existing row — validation as before, plus a NEW
  `store.setFacets(id, facets)` so old rows converge to the new
  classification without anyone re-saving (conformance-pinned for all
  drivers). `updated_at` is untouched by the sweep, so gallery ordering
  does not shuffle on deploy.
- Note: 90° corners still count 1 each — the ruling covers only
  hairpins/rainbows (180°). Flagged for the owner; the same setFacets
  sweep converges any future ruling.

## Client

- Gallery rows: `N str · N slp · N cor`; Slopes joins the sort chips.
- Metadata popup: Slopes gets its own row; tooltips reworded —
  Straights "Waves count as straights…", Slopes "…NOT interchangeable…
  count separately", Corners "…hairpin or rainbow… counts as 4".

## Tests

- Unit: cross-check fixture (Bri1 slope → slopes 1/straights 2, Lan2 →
  +4 corners); store conformance — slopes facet on write, `-slopes`
  sort, setFacets convergence for the sweep path (memory + sqlite, pg
  via the shared suite in CI).
- e2e: HTTP contract (slopes=2/straights=1 for a 2-slope+straight
  track; corners=4 for a rainbow; `sort=slopes` whitelisted); gallery
  row shows `slp`; popup tooltip copy updated.
- The sort-whitelist guard test caught the missing `slopes` entry
  during development — exactly its job.

## Known follow-ups

- 90° corners: 1 or 2? Owner call; the sweep converges whichever way.
- Popup could surface the sweep-stamped facets for parity checking.

## Review round additions

- BLOCKING: pg.js was missing setFacets (the sweep would have thrown
  under STORE=postgres on the first stale row — after stamping the
  version, permanently skipping it). Added, mirroring sqlite.
- Sweep ordering is now crash-safe: setFacets first, the
  VALIDATOR_VERSION stamp last — a crash between the two leaves the
  row still-stale (retried next boot) instead of converged-with-
  stale-facets forever.
- Corners tooltip names the actual catalog pieces ("a 180° piece
  (rainbow, burning changer) counts as 4") instead of a label that
  does not exist in the catalog.
