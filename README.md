# Mini4WD Track Editor — mobile-friendly fork (proof of concept)

A touch-first reimplementation of [Mini4WD Online Track Editor](https://mini4wd-track-editor.pimentoso.com)
by Pimentoso. **No server, no build step, no dependencies** — open `index.html` and draw.

## What this proves

### a) Replicating / forking the original — YES

| Component | Original | Status for a fork |
|---|---|---|
| Editor logic (`editor.js`) | JavaScript, **MIT licensed** (© 2016 Michele Ferri) | ✅ Legally reusable — piece catalog, snapping, serialization all extracted |
| Track format | `Name;x;y;angle;color#…` (1 px = 1 cm) | ✅ Fully decoded; this fork is **byte-compatible** (verified against real track `CMNPX6`) |
| Save/Load | Rails: `POST /save` → 6-char code, `GET /load/CODE.js` | ✅ Trivial to re-implement; this PoC replaces it with URL-hash sharing + localStorage + file export |
| Gallery / API | `GET /api/tracks/:code` JSON | ✅ Easy to add later; original API has no CORS headers, so live import needs a tiny proxy |
| Piece artwork | PNGs of Tamiya track pieces | ✅ Reused (`assets/`) with attribution — © Tamiya inc. |
| Server source (Rails app) | **Closed** (no public repo) | 🔁 Rewritten from observed behavior; only ~4 endpoints exist |

### b) Mobile-friendly editor — YES (the original is not)

The original is desktop-only: `onmousemove`/`onclick`/`mousewheel`, no touch handlers,
fixed 800×600 canvas, 190 px sidebar — you literally cannot place a piece on a phone.
This PoC implements:

- **Tap to place**, drag to preview the ghost piece (with live snap vertices)
- **Two-stage placement (touch-safe)**: tapping empty space only *aims* the ghost —
  pieces are placed by tapping **on the track or the ghost**, so you can never
  place a piece by accident while looking around; chained taps on the track
  extend the layout one tap per piece
- **Pan tool ✋ / <kbd>H</kbd>**: drag to look around without placing anything
- **Multi-select & group move**: rubber-band drag on empty space, ctrl/cmd+click to
  toggle pieces, drag any selected piece to move the group (with group snapping),
  ⟲/⟳ rotate the selection around its centroid, <kbd>Del</kbd> deletes it
- **Two-finger pan & pinch-zoom**, zoom buttons, auto-fit (`⤢`)
- Bottom toolbar + horizontally scrollable piece palette, safe-area aware, `100dvh`
- Rotate ⟲⟳ buttons (mouse-wheel/Z/X on desktop), Move / Delete / Color tools with
  visible tap targets, undo history, desktop keyboard parity (1-9, Q/W/E, Z/X, R, F)
- devicePixelRatio-correct canvas rendering

## Piece catalog (from the MIT source)

All 3-lane (Japan Cup) and 5-lane (WIDE) pieces with exact footprints, official lap
lengths, color counts and snap vertices: Str1/2, Cor1, Lan1/2, Chi1, Bri1/2, Ban1 and
Str3-6, Cor2-5, Lan3/4, Chi2, Bri3/4, Ban2.

## Compatibility

- `serialize()` / `parseTrack()` speak the original format exactly.
  Test: importing `/load/CMNPX6.js` content and re-exporting reproduces the same string
  (58 pieces, 86.88 m — the site reports "58 pieces, 87 m").
- Import dialog also accepts a pasted `/load/CODE.js` response body.
- Share links: `#t=<base64url>` — the whole track lives in the URL, no server needed.

## Run it

```sh
cd mini4wd-editor
python3 -m http.server 3000   # or: npx serve
# open http://localhost:3000 (works great in Chrome DevTools device mode)
```

## Attribution & credits

- **[Mini4WD Online Track Editor](https://mini4wd-track-editor.pimentoso.com)**
  by **Pimentoso (Michele Ferri)** — the original website this project is based on.
  This fork reuses its concept, track data format, and piece catalog, and is a
  touch-friendly reimplementation of its editor. The original client code is
  **MIT licensed (© 2016 Michele Ferri)**; the license notice is preserved at the
  top of `editor.js`.
- **Tamiya** — "Mini4WD" and all track piece designs and artwork are property of
  Tamiya inc. The sprites in `assets/` originate from the original editor.

## Legal notes

- The original editor JS is MIT (notice preserved at the top of `editor.js`).
- "Mini4WD" and track piece designs/artwork are Tamiya's. The sprite PNGs in
  `assets/` come from the original editor's assets and are used for a personal
  evaluation fork; replace them if you plan to redistribute.
- This is an independent fan tool, same spirit as the original's footer.

## Roadmap to full parity

1. Tiny backend (any stack) for short codes + gallery: `POST /save {track}` → code,
   `GET /load/:code.js`, view counter, `GET /api/tracks/:code` JSON
2. CORS proxy for importing existing pimentoso tracks by code
3. Print/PDF view page, piece-count breakdown panel
4. PWA manifest + offline (it's already a single-page static app)
