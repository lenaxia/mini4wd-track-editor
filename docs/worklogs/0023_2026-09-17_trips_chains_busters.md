# 0023 — Tripcodes, version-chain collapsing, buster guard

**Date:** 2026-09-17
**Triggered by:** Owner — "Address 1 2 and cache buster" (stage 2 of the
shared-tracks design, the gallery chain problem, and the recurring
buster-collision process cost).

## Tripcodes (stage 2 of the ownership model)

Optional byline at publish: `Alex#passphrase` in a second dialog field.
The name is the byline; the passphrase is hashed with scrypt + a
per-instance salt (`lib/tripcode.js`; `M4WD_TRIP_SALT` env, else a
generated `data/trip.salt` file) and stored as `author_trip`. Presence
of a hash = the track is **signed**: in-place saves (PUT, POST-update,
restore) require the phrase — wrong or missing phrase is a 403. Copies
(POST + parent_id) are always open and start unsigned — your copy is
yours to sign. Plain `Alex` (no `#`) is an unverified byline, never a
lock. The raw phrase is never stored; a signed save may re-sign under a
different display name with the same phrase (identity = the hash).

Client (`storage.js`): the phrase lives in localStorage (`m4wd.trip`),
remembered always (owner ruling: shared computers are a non-issue); the
server echoes the hash on signed saves and the browser keeps it
(`m4wd.tripcode`) so "locked to someone else" is decidable client-side
(`lockedToOther`). Locked-to-other tracks never mirror autosave; the
Save button and the canvas banner both route to "Save my own copy".
Mine = local id list ∪ rows whose `author_trip` equals my code. Cards
show `by Alex!9f3ab2c1` when signed.

## Version-chain collapsing

Gallery: same-root copies render as one card (the chain's highest-ranked
under the current sort) with "+N earlier versions of this circuit".
A "1 of each" chip toggles it; Mine always shows every one of yours.

## Cache-buster guard

`tools/check-busters.js` in ci (full-checkout fetch so origin/main is
present): src/lib/server/serve/index changes → main.js ?v must exceed
main's burned number; style.css/index changes → style.css ?v likewise.
This PR is its first enforcement (v77/v22 over main's v76/v21) — the
guard would have saved four review rounds this week.

## Tests

unit/tripcode (parse/hash/code), api e2e (403s, holder saves, plain
byline, open copies, signed restore — deterministic via pinned e2e
salt), gallery e2e (chain collapse + expand, `by name!code` byline).
