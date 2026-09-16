# 0019 — Gallery: full screen, brand shortcut, real filters in a drawer

**Date:** 2026-09-16
**Triggered by:** Owner round — "make the Mini4WD Track clickable and it
should bring up the gallery view. Gallery view should be full screen.
The filters are pretty primitive and in desktop it results in a
horizontal scroll bar… Length should be a slider, lanes should select
2, 3, 5. Footprint should allow x and y selection and imperial/metric.
Stars is just sort order. Straights/slopes/corners should be a number
(max). Newest → 'last updated'… Complete only is correct and should be
selected by default. Put filter options in a drawer. Complete only
should always be visible."

---

## Surface

- **Brand = gallery shortcut**: the "Mini4WD Track" wordmark is a real
  button (keyboard focusable) that opens the gallery; the Track-menu
  entry stays.
- **Full screen**: the gallery dialog takes the whole viewport on every
  device (`dialog.gallery-full[open]` flex column — the `[open]` guard
  matters: an unguarded `display:flex` overrides the UA's closed-dialog
  `display:none` and renders an invisible click shield over the app;
  found via e2e, every click app-wide timed out).
- **Toolbar replaces the pill row** (the horizontal-scrollbar
  complaint): a wrapping flex bar — Sort `<select>` · ✓ Complete only
  toggle (ALWAYS visible) · Filters button with an active-count badge.

## Filters (drawer, slides over the gallery from the right)

- **Min length** — slider 0–200 m (+ live "N m+" readout).
- **Lanes** — checkbox selection 2 / 3 / 5 (all on = no filter; any
  subset → `lanes=…` OR semantics).
- **Footprint max** — W and H inputs with a unit select (cm / m / in /
  ft; `lengthToCm` converts, state stores cm, switching units
  re-displays stored caps).
- **At most** — straights / slopes / corners max counts.
- Reset + Done; every control auto-applies (change event, not
  per-keystroke); the badge counts non-default filters.
- **Complete only ON by default** — the owner's expected view; the
  toggle remains outside the drawer.

## Sorts (orderings only now)

Last updated (renamed from Newest) · Length · Lanes · Footprint ·
Stars. The straights/slopes/corners sort chips became the max filters
above ("stars is just sort order" — it stays a sort).

## Server

- `parseListQuery` + all three drivers accept: `lanes=2,3,5` (int list,
  OR), `max_bbox_w` / `max_bbox_h` (cm), `max_straights` /
  `max_slopes` / `max_corners`. Numeric/enum validation like the
  existing params (400s pinned).
- pg's IN-list builds `$n` placeholders the file's push-returns-index
  way; sqlite/memory mirror.

## Client structure

- `gallery.js` (pure): `GALLERY_SORTS` (5), `GALLERY_LANES`,
  `lengthToCm`, `galleryQuery({sort, complete, limit, offset, filter})`
  — pairs, not URLSearchParams (it percent-encodes the lanes comma).
  Unit-pinned incl. defaults-emit-nothing.
- `ui.js`: drawer render/sync (cm canonical, unit-converted display),
  filter-count badge, toolbar wiring, brand listener.

## Tests

- Unit: query serialization with the full filter state + defaults;
  unit conversion; lanes options; the sort-whitelist guard still cross-
  checks every sort against the API.
- e2e: brand opens full screen with no horizontal scroll at 1280/390;
  complete-only default (WIP absent until the toggle) + toggle always
  visible; sort select reorders; drawer (lanes, min length, max
  straights, reset, badge); API contract for the new params incl. 400s.
- Test-notes: brand click uses `force` (the opened overlay breaks
  Playwright's actionability retry loop); fixtures that dangle toggle
  complete off first.

## Known follow-ups

- Footprint filter could get a unit-aware row display too (rows stay
  cm/m heuristic today).
- Saved filter presets per browser if the owner wants them.

## Round 2 + review round (owner feedback on the first cut)

- Cards: **star moved inside the card** (over the thumbnail corner,
  stopPropagation), **card grid** with larger fluid thumbnails
  (400×300 backing, `aspect-ratio 4/3`) — columns via
  `repeat(auto-fill, minmax(250px, 1fr))`, one column on phones.
- Filter panel: **drops DOWN from the Filters button** (not a right
  slide-in — slide-ins leak a horizontal scrollbar). Hiding is
  visibility-based (transform-only hides still occupy scroll width);
  the full-screen dialog clips overflow. The Filters button TOGGLES
  (aria-expanded); filter changes keep the panel open (several
  adjustments in a row); Esc / ✕ / fresh opens reset it (dialog close
  event).
- Units: one segmented control at the panel top — **Metres / Feet**
  only (no cm/in; decimals). Drives the W/H inputs (with unit suffixes
  next to each box), the min-length readout, AND the cards
  (formatLength/formatFootprint follow the unit; cards re-render from
  cache, no refetch).
- Filter labels spelled out (straights/slopes/corners), title rows
  stack above the inputs, (?) tooltips AFTER the title text (reusable
  tipBtn), compact 110px inputs (full-width was excessive on desktop).
- `undefined slp` guard: cards default missing facet columns to 0
  (long-running stores predating a column).
- Review findings: empty lane selection renders "No lanes selected"
  client-side (an omitted lanes param means ALL lanes — the inverse);
  lanes checkboxes build once (rebuilding destroyed the focused
  control mid-interaction); W/H caps clamp like count caps;
  cmToLength joins lengthToCm on one table; the earth glyph back on
  the MDI icon system; min_lanes now NaN-validated (drive-by, noted).
