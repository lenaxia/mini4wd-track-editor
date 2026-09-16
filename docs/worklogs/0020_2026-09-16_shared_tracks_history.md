# 0020 — Shared tracks: version history, copy button, Mine list

**Date:** 2026-09-16
**Triggered by:** Owner design session on identity and ownership for
published tracks. Constraints set across the conversation: no accounts,
no email, no signup — and no permanent locks that rot into cruft.

## The decision (owner-approved)

1. **Anyone can edit any published track** (the wiki default we already
   had — gallery load binds the row, save overwrites it).
2. **Version history protects everyone.** Every save of an existing
   track archives the previous version (~25 kept per track, a server
   setting). Anyone can view history and restore an old version with
   one button — restore appends (never rewrites), so history itself is
   safe to use. This replaces locks as the safety mechanism: ruined
   work is one tap from undone, by anyone, with no moderator.
3. **"Save as my own copy"** branches: a new track carrying `parent_id`
   (and `root_id` = parent's root or parent id, `parent_name` embedded
   at fork time). Cards show "based on *X*". Copying is always allowed —
   an abandoned track is a frozen original, not dead weight; the
   community continues on the copy. No expiry, no sweeps.
4. **Mine list is local.** The browser remembers which track ids it
   published/forked/edited (`m4wd.mine`, capped 500). Gallery "Mine"
   chip filters the loaded page client-side. No identity involved.
5. **Stage 2 (next PR): optional tripcodes.** `name#phrase` at publish
   → byline `name!hash`; may lock the track to the phrase (copy stays
   open); phrase remembered by the browser; salt + scrypt server-side,
   per-instance salt; Mine extended by "tracks matching my phrase".
   No accounts, no cookies, no sessions — the phrase remembered by
   your own browser is the login (owner: shared computer is a non-issue).

## This PR (stage 1 — identity-free)

**Store** (all three drivers, same interface):
- `archive(trackId, snapshot)` — append a revision, prune past 25.
- `history(trackId)` — newest-first `{seq, name, created_at}`.
- `revision(trackId, seq)` — full snapshot row.
- tracks rows gain `parent_id`, `root_id`, `parent_name` columns
  (sqlite: CREATE + try/catch ALTER for existing DBs; pg: ADD COLUMN
  IF NOT EXISTS; memory: plain fields).

**API** (`server.js`):
- Every upsert of an existing id archives the previous row first
  (trigger logic in routes, storage ops in drivers).
- `POST /api/tracks` accepts `parent_id`; server resolves the parent
  (404 if missing), injects `parent_name` + `root_id` — clients cannot
  spoof lineage.
- `GET /api/tracks/:id/history`, `GET /api/tracks/:id/history/:seq`,
  `POST /api/tracks/:id/history/:seq/restore` (archives current head,
  re-normalizes snapshot facets, returns the new head).

**Client:**
- Gallery card actions: **Copy** (one-tap fork of the row as-is — no
  canvas round-trip) and **History** (dialog listing versions with
  Restore). Cards show a muted "based on *X*" when `parent_name` set.
- Editor banner when the bound track is not in the local Mine list:
  plain-language "You're editing a shared track — Save updates it for
  everyone; or save your own copy." with the copy button (fork with the
  current canvas).
- Mine chip in the gallery filter row.
- UI words: "your version", "based on", "History", "Copy" — no git
  vocabulary in chrome.

**Not changed:** facets/sweep (heads only), publish binding, WIP warn,
stars. Busters: main.js v72, style.css v20 — v70/v18 burned by main's b71946b, v71/v19 by 6cc1091; each union bumps past whatever main has burned.

## Tests

- api.spec: save→revision created; history list/get; restore round-trip
  (head becomes old data, count grows); cap at 25; fork lineage fields;
  fork of missing parent → 404; restore of unknown seq → 404; parent
  spoof fields (client-sent root_id/parent_name) ignored.
- gallery.spec: Copy button forks (card gains "based on"), History
  dialog restores, Mine chip filters.
- unit: memory-driver archive/prune/history invariants.
