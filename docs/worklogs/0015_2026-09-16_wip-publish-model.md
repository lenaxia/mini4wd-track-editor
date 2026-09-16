# 0015 — Completeness as a facet: WIP publishing, badge, rename

**Date:** 2026-09-16
**Triggered by:** Owner rulings — publish incomplete tracks (completeness
is a searchable facet, not a gate); the save button shouldn't be a dialog;
browser computes validity for the UI while the server owns the stored
facet; sweep revalidates recently-changed rows plus anything stamped by an
older validator_version.

## Model

- **Unpublished = local only** (0012 unchanged). Publishing an incomplete
  track is ALLOWED: the dialog warns ("will publish as Work-in-Progress")
  instead of locking; the server stamps complete=0 + issue count.
- **Published = live badge.** The toolbar button shows 💾 with a green
  (complete) or red (issues) ring, recomputed debounced after edits;
  tapping reports the verdict as a toast — no dialog (autosave already
  persists). Rename moved to the stats-bar track name (opens the dialog in
  rename mode).
- Server-side validation on every write (fullFacets runs the shared
  src/validate.js through parseTrack) + boot/6h sweep over rows updated
  within 24h OR carrying an older VALIDATOR_VERSION.

## Notes

- Purged 937 legacy auto-mirror "Untitled" rows from the dev sqlite
  (named/starred rows kept); the gallery sort spec now asserts relative
  order so shared servers can't break it.
- updatePublishBadge is hoisted module-level like refreshPublishUi —
  onStoreChange's debounced call crosses scopes.
