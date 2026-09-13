# Mini4WD Track Editor — mobile-friendly fork (proof of concept)

A touch-first reimplementation of [Mini4WD Online Track Editor](https://mini4wd-track-editor.pimentoso.com)
by Pimentoso. **No build step, no runtime dependencies** — vanilla ES modules
served statically (ES modules require http, so use `serve.js`; `file://` no
longer works).

## What this proves

### a) Replicating / forking the original — YES

| Component | Original | Status for a fork |
|---|---|---|
| Editor logic (`editor.js`) | JavaScript, **MIT licensed** (© 2016 Michele Ferri) | ✅ Legally reusable — piece catalog, snapping, serialization all extracted |
| Track format | `Name;x;y;angle;color;z#…` (1 px = 1 cm) | ✅ Fully decoded; legacy tracks import unchanged (5-field parses to z=0); writes add the elevation field — see `docs/design/orient-elevation.md` §3 |
| Save/Load | Rails: `POST /save` → 6-char code, `GET /load/CODE.js` | ✅ Trivial to re-implement; this PoC replaces it with URL-hash sharing + localStorage + file export |
| Gallery / API | `GET /api/tracks/:code` JSON | ✅ Easy to add later; original API has no CORS headers, so live import needs a tiny proxy |
| Piece artwork | PNGs of Tamiya track pieces | ✅ Reused (`assets/`) with attribution — © Tamiya inc. |
| Server source (Rails app) | **Closed** (no public repo) | 🔁 Rewritten from observed behavior; only ~4 endpoints exist |

### b) Mobile-friendly editor — YES (the original is not)

The original is desktop-only: `onmousemove`/`onclick`/`mousewheel`, no touch handlers,
fixed 800×600 canvas, 190 px sidebar — you literally cannot place a piece on a phone.
This PoC implements:

- **Tap to place**: pick a piece in the palette, then tap the canvas — the piece is
  placed immediately and snaps to nearby track ends (green dots = connected).
  Keep the finger/mouse down and drag to fine-position it before releasing.
- **Figma-style flow — place → move → click away to deselect**: after each placement
  the tool reverts to ✥ Move with the new piece selected; drag it to adjust, tap
  empty space to deselect. Hold <kbd>Shift</kbd> on release to keep the piece armed
  for rapid stamping.
- **Pan tool ✋ / <kbd>H</kbd>** is the default tool (drag to look around without placing
  anything); <kbd>Esc</kbd> always returns to it
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

## Architecture

```
index.html            app shell (entry: <script type="module" src="src/main.js">)
src/
  pieces.js           piece catalog + constants (pure data)
  geometry.js         rot/vertex/snap/fit math (pure, DOM-free)
  track.js            serialize/parseTrack/share codec (v2 writes, legacy import, pure)
  art.js              procedural sprite fallback (pure canvas ops)
  assets.js           sprite preloading
  storage.js          localStorage autosave/restore
  store.js            model: state + actions + subscriptions (DOM-free)
  render.js           canvas view (subscribes to the store)
  input.js            Pointer Events gesture machine + keyboard
  ui.js               DOM shell: palette, toolbar, dialogs, stats
  main.js             boot/wiring (+ window.__m4wd test hook)
serve.js              zero-dependency dev server (no caching)
tests/
  unit/               node --test (track codec, geometry, pieces, store)
  e2e/                Playwright specs (see TESTPLAN.md)
playwright.config.js
package.json          dev tooling only — the app itself has no deps, no build
```

Dependency direction (acyclic): `main → render → input → ui → store →
geometry/track/storage → pieces`. Pure modules (`pieces`, `geometry`,
`track`, `store`) import nothing DOM-bound and run under plain node — that
is what makes the unit layer possible.

## Test plan & framework

See [TESTPLAN.md](TESTPLAN.md). Two automated layers:

- **Unit** — Node's built-in runner (`node --test`), zero dependencies:
  codec-v2 round-trips + legacy import, snapping math, catalog integrity, store actions.
- **E2E** — Playwright (dev-only dependency): gesture flows (place → move →
  click-away deselect), chaining/snapping, undo, rotate, import, share
  links, touch placement. Assertions read the model via `window.__m4wd`,
  never pixel-diffed. Multi-touch pinch stays manual (see plan).

## Run it

```sh
node serve.js              # or: npm run serve  (port 3000)
npm test                   # unit tests (node --test)
npx playwright install chromium   # once
npm run test:e2e           # e2e (auto-starts/reuses serve.js)
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
## Credits

- rucdoc track system (1L/2L/3L 3D-printed pieces): MIT (c) rucdoc —
  thangs.com/designer/rucdoc. Sprites are top-down orthographic renders of
  his published models; catalog data measured from the same.
