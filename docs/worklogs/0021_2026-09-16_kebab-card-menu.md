# 0021 — Card actions behind a kebab menu

**Date:** 2026-09-16
**Triggered by:** Owner — "move history and copy into a kebab menu inside
the card." (Same session: the preview-port question — 3000 is simply
server.js's `PORT` default, overridable; unchanged.)

## What changed

The per-card Copy/History row (under each gallery card since 0020) moves
behind a ⋮ kebab button floating on the thumbnail, beside the star.
Tap ⋮ → a small menu: **Save my own copy** / **History**.

- The card is a `<button>`, so the kebab is a sibling overlay like the
  star (`.gal-row` is the positioning context) — never nested.
- `dots-vertical` added to the vendored MDI set (27 paths now).
- One menu open at a time; closes on any outside tap (document click),
  list scroll, or item activation. `aria-expanded` on the kebab,
  `aria-label` "Actions for *name*", `aria-hidden` icons inside.
- Menu wording: "Save my own copy" (plainer than "Copy" on its own).

## Tests

- gallery.spec updated to open the kebab before the item; new assertions:
  reopen after use, outside tap closes (`toBeHidden`).

Busters: main.js v73, style.css v21 (past main's v72/v20).
