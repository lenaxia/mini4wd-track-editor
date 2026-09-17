# 0025 — Publish-dialog Cancel/X + no double-tap zoom off-canvas

**Date:** 2026-09-17
**Triggered by:** Owner — "Clicking cancel or 'x' on rename dialog does
not dismiss. And on mobile if you click too quickly on the cancel (or
other non-canvas areas) the whole browser will zoom in."

## Fixes

1. **Cancel/X were dead buttons.** The publish dialog's `#pubCancel` and
   `#pubClose` lost their click handlers in a merge (every other dialog's
   close button was still wired; these two silently orphaned). Both now
   close the dialog — publish or rename mode. Pinned by an e2e assert.
2. **Double-tap browser zoom off-canvas.** iOS Safari ignores
   `user-scalable=no` (the meta has said it for years), so fast taps on
   UI chrome zoomed the page with no clean way out. `* { touch-action:
   manipulation }` disables double-tap zoom everywhere; the editor
   canvas keeps `touch-action: none` (#editor, ID specificity) — the
   app already owns pan/pinch there.

Also: trip-help copy — "without a byline" (the track keeps its own
name), summary hover lightens instead of dimming (review round 1).

Busters: main.js v79 (src/ui.js changed), style.css v24.
