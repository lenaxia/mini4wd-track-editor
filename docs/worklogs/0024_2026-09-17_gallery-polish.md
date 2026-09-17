# 0024 — Gallery polish: single-request thumbs, inline library
# rename/delete, MDI stars, view persistence

**Date:** 2026-09-17
**Triggered by:** Owner triage of the follow-up ledger — "address the
others as well" (minus the parked items: star identity = product
decision; canvas weld-dot flags = deferred by the #30 ruling).

---

- **Thumbnails ride the page request**: `include=track` (opt-in list
  param; the default metadata-only contract is unchanged and still
  pinned) carries bodies with the page; the client primes its
  thumbnail cache from the same response — one request instead of 25
  per-row GETs. The lazy per-row pump stays as the fallback.
- **Library rename/delete inline**: each row gains ✏ (targeted rename
  of ANY row via GET+PUT — the publish-dialog flow renames only the
  bound track) and 🗑 (confirm → DELETE → unbind if it was the working
  track → list refresh). New MDI `pencil` path joins the vendored set.
- **☆/★ → MDI**: star/star-outline icons on the cards (svg + aria
  labels; the old text-glyph assertions moved to aria), the count
  line, and the popup's Stars row.
- **Slider touch targets**: 28px thumbs (webkit + moz), track inset to
  match — #42's review follow-up.
- **View persistence**: sort/complete/unit/filters persist to
  `m4wd.gallery` per browser, validated on restore (stale sorts/units
  can't poison state); Reset writes the defaults.
- Deliberately left: author/identity for stars (needs a product
  decision — accounts vs magic links); canvas flag unification (hot
  render path, own PR per #30).

## Tests

- e2e: zero per-row GETs until a row tap (exactly one after); filters
  survive reload (toggle, slider, badge); library rename keeps the row
  id and delete 404s + refreshes; all star assertions aria-based.
- unit: include=track query pin; everything existing unchanged.

## Review round

- BLOCKING: a stale `pubRenameTarget` could rename the WRONG row —
  Esc and the Complete-tip closed the dialog without clearing it, so
  the next publish renamed the old target instead of publishing (and
  the stats rename armed without a target). The dialog's `close`
  event now clears it (covers Esc + every closeDialog), arming paths
  set it explicitly, and the regression is pinned: arm → Esc →
  publish creates the new row and leaves the target untouched.
- Unit switches persist immediately (they were saved only on the next
  gallery open).
- Filter restore validates per field (numbers-or-defaults, lanes
  intersected with the known set, empty set never restored) — a
  stale payload can no longer break the gallery open.
- Star buttons carry title alongside aria-label (desktop hover hint).
- Ledger note: the rename GET→PUT race can resurrect a concurrently
  deleted row (PUT-create); accepted as noted.

## Review round 2

- The regression block itself broke the serial suite: the document
  Esc closes BOTH stacked dialogs (publishDialog first in DOM order,
  then the library beneath) — the test reopens the library before the
  inline steps. The Esc layering itself is pre-existing and noted as
  a deliberate-decision item ("cancel leaves the library").
- A FAILED rename cleared its target before the check — the retry
  would silently publish the bound canvas under the prefilled name.
  The target now survives failure (the dialog still reads as a
  rename, so retry retries); it clears on any close.
