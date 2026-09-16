# 0022 — Snapshot retention: stability rule + age tiers

**Date:** 2026-09-16
**Triggered by:** Owner — history spam from debounced autosaves ("if we
have a 350ms debounce we should not have a history entry every 350ms"),
plus a proposed tier ladder; "proceed. that is the correct approach."
Off-the-shelf: none fits (backup tools are standalone binaries; TTL
helpers target caches) — rolled our own, zero new deps.

## Policy (lib/store/retention.js — pure functions, shared everywhere)

1. **Stability rule** (`shouldArchive`): the outgoing head is archived
   only if it had been the head for ≥ STABLE_MS (5 min default,
   `M4WD_STABLE_MS` env override). Work-in-progress instants never
   become snapshots: a 40-minute editing burst leaves ONE entry — the
   state right before it started. This is the owner's "roll into the
   most recent snapshot", expressed as "skip transients" so entries keep
   their burst-start timestamps and no rows are rewritten. Unknown age
   (missing/NaN updated_at) always archives — never lose by default.
2. **Tier ladder** (`keepSet`): newest always survives; an entry needs a
   gap of ≥ its tier's spacing below the newest KEPT entry —
   5 min spacing inside 30 min, hourly inside 4 h, daily inside 7 d,
   older dropped. Worst case ≈ 17 entries; REVISION_CAP (25) stays as
   the absolute backstop. Pruning runs inside every driver `archive()`
   — no timers; vandalism scenarios always involve an archive, so
   prune-at-write is sufficient.

Server routes (POST-update, PUT, restore) gate `store.archive` on
`shouldArchive(prev.updated_at)`. Drivers insert then prune to
`keepSet(rows)` (+cap).

## UI

History rows show real timestamps: time-only today ("14:32"), weekday +
time within the week ("Wed 14:05"), date + time beyond ("Sep 12 16:00")
— `formatVersionTime` in gallery.js, pinned in unit tests.

## Tests

- tests/unit/retention.test.js: stability window boundaries; burst
  collapse; 5-min/hourly/daily spacing; week cutoff; worst-case ≈17;
  tier table shape.
- driver suite: rapid archives coalesce to one entry; delete cascade.
- e2e (webserver sets M4WD_STABLE_MS=50): stable save → snapshot;
  back-to-back saves → ≤1; restore still archives; history row shows a
  HH:MM timestamp.

Busters: main.js v74 (ui/gallery changed; style.css untouched at v21).
