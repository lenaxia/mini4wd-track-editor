# 0021 — Two-ended length slider (min–max)

**Date:** 2026-09-16
**Triggered by:** Owner — "should the min length be a two ended slider
to select min and max length?" Yes: min-only can't express "something
around 20–30 m", which is how people shop for a track that matches
their parts bin.

---

## Server

- `max_length` joins `min_length` in `parseListQuery` + all three
  drivers (`length_cm <= cap`); conformance-pinned (min+max compose,
  each alone).

## Client

- The panel's length field becomes a **two-ended slider**: two native
  `<input type="range">` overlaid (zero-dep; tracks are
  click-through, thumbs catch the pointer; both keyboard-operable),
  with an accent fill between the thumbs. Thumbs push each other so
  min ≤ max always holds. Readout: `any` / `20 m+` / `≤ 40 m` /
  `20 m–40 m`, feet under imperial. galleryQuery carries `maxLength`
  (m→cm like min; unit-pinned incl. max-only).

## Sidebar (owner question, answered with evidence)

- No rate limiting was ever hit: the track server has none; the two
  "429" grep hits in the dev log are UUID substrings on `-> ok`
  requests; GitHub quota untouched (5000/5000 core remaining, 0 used
  at check time). The workflow oddities we saw were dropped
  `synchronize` deliveries and one 18s infra fail — both self-resolved.
