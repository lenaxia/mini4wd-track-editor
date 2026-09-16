# 0017 — Stats metadata popup, mobile topbar polish, reusable tooltips

**Date:** 2026-09-16
**Triggered by:** Owner round on the mobile topbar — "I don't like that
the length and track pieces is hidden. In mobile I'd rather have that
info, and when clicked it brings up a tooltip popup which shows track
metadata like name, length, pieces, corners, straights, creation date,
last modified date, stars etc." Plus: the collapsed lane-width selector
should carry the yellow active accent on mobile, and (follow-up) the
"(waves and slopes count as straights)" value is too long — move such
notes into touch-friendly (?) tooltips that never render off-screen and
are reusable.

---

## Stats bar (mobile model)

- Phones (≤540px, the mode-switch breakpoint) show the NUMBERS only
  (`1.62 m · 1 pcs`); the name span hides (`.stats-name`). Desktop
  unchanged. `updateStats` builds name + numbers as separate spans
  behind the same render-loop guard.
- The mobile cycle button (`#modeCycle`) now always carries the active
  accent — collapsed, it IS the selector, so it matches the yellow
  segment desktop shows (inert on desktop, where it's hidden).

## Metadata popup (stats-bar tap)

- Tapping `#stats` opens `#statsDialog`: name as the title, local
  facets immediately (Length, Pieces, Straights, Corners, Lanes), and
  — when the track is bound — the server row's fields (Published,
  Last modified, ★ stars, ✓/✖ validity) filled in when the fetch
  lands; unreachable server degrades to dashes, never blocks.
- Unpublished: "Not published — this track lives on this device only",
  Rename hidden.
- Rename moved INTO the popup (#32's stats-bar-tap rename would
  collide with the popup tap); same dialog flow, same e2e coverage.
- `trackFacets(sprites)` in gallery.js classifies exactly like the
  server's facet stamping; unit tests cross-check both classifiers
  over a `serializeForSave` round-trip so the popup can never disagree
  with the stored row.

## Reusable tooltips (src/tooltip.js)

- Any `[data-tip]` element gets a tap-triggered bubble (hover-only dies
  on touch): `initTooltips()` installs one delegated listener;
  `tipBtn(text)` builds the (?) affordance for dynamic rows.
- `placeTip()` (pure, unit-pinned) prefers below-center, flips above
  when there's no room, and clamps both axes — the bubble can never
  render off-screen. The bubble mounts INSIDE the anchor's `<dialog>`
  when there is one: showModal dialogs own the top layer and nothing
  outside them can paint above it.
- Straights/Corners/Lanes rows carry the classification notes
  ("waves and slopes count as straights", "hairpins count as corners",
  "widest piece used") as (?) affordances; the values stay clean.

## Tests

- Unit: trackFacets↔facets equivalence fixture; 4 placeTip cases
  (below-center, both-edge clamp, flip-above, never-off-screen
  fuzz-ish inputs).
- e2e: popup spec (facets + async server fields + stars/validity +
  tooltip show/hide/in-viewport/inside-dialog), local-only popup,
  reworked rename path (popup → Rename), mobile numbers-only bar with
  popup carrying the full name, modeCycle accent (class + computed
  background-color).
- Test-infra note: localStorage fixtures now use `addInitScript`
  (pre-boot) — the old evaluate-then-reload pattern raced the first
  load's 350ms debounced autosave overwriting the key (observed flaky
  in full-parallel runs).

## Known follow-ups

- data-tip could annotate gallery facets and validator messages later.
- Tooltip on long-press (instead of tap) would match OS conventions if
  the owner prefers.

## Review round additions

- Dead rename-affordance CSS removed (`#stats[title='Rename published
  track']` could never match once the title became the constant 'Track
  details'); both stale comments refreshed.
- tooltip.js added to the README module map.
- a11y: the bubble gets a unique id and the anchor an
  aria-describedby link while shown, so screen readers read the tip
  instead of a generic "More information" button.
