# Mini4WD Track Editor

Design Mini4WD circuits on your phone. Touch-first, no build step, no
frameworks — open it and lay track.

## The editor

- **Tap to place.** Pick a piece, tap the canvas — it drops in and welds
  to nearby track ends (green dots mean connected). Keep your finger
  down to drag it into exact position first; release to commit.
- **Everything is movable.** Drag single pieces or rubber-band a group;
  groups snap as a unit. Rotate around the joint you're connected to, or
  around the group's center. Undo everything, always.
- **Elevation is real.** Raise and lower in 10 mm steps; slopes chain
  levels automatically; bridges over lower track render see-through with
  a warning when 75 mm clearance isn't met.
- **Complete the loop.** Leave a gap, select the two open ends, tap
  Complete — the shortest run of straights and corners fills it. If nothing
  fits, the tool offers to remove pieces until something does, then
  closes it.
- **Made for thumbs.** Two-finger pan and pinch zoom, bottom toolbar,
  scrollable palette, safe-area aware. On desktop: full keyboard parity
  (1-9 pieces, Q/W/E tools, Z/X rotate, R undo, F fit, Space pan).
- **Two track systems.** Regulation 3-lane and 5-lane Tamiya pieces
  (11.5 cm lanes, official lap lengths) and rucdoc 1/2/3-lane
  3D-printed pieces — every sprite generated as crisp vector art on the
  same grid, so mixed systems align at the joints.

## Sharing and saving

- **Share links** encode the whole track in the URL — no server needed.
- **Local until you publish.** Work stays on your device; publishing
  names it and saves it to the server, and from then on every edit
  auto-saves.
- **Know before you publish.** The save button is a live health check:
  green ring = complete and consistent, red = issues (dangling ends,
  kinked joints), listed when you tap. Incomplete tracks still publish —
  marked Work-in-Progress.
- **Gallery.** Browse every published track: sort by length, lane count,
  footprint (limited room?), straight/corner counts (limited parts?),
  stars, or newest. Filter to finished circuits only, or to the tracks
  this device saved (Mine). Star what you like; tap any track to load it
  and keep editing it. No accounts anywhere.
- **Nothing is ever lost.** Every save of a shared track keeps the old
  version — History lists them and anyone can restore one with a tap.
  **Copy** makes your own version of any track (shown as "based on" it)
  without touching the original, so abandoned tracks never block anyone.

## Running it

```sh
node serve.js        # editor only (port 3000)
node server.js       # editor + track storage (sqlite by default)
```

Self-hosting: `docker compose up` runs the published image
(`ghcr.io/lenaxia/mini4wd-track-editor`, built from `v*` tags, amd64 +
arm64) with a sqlite volume; add `--profile postgres` for postgres.
Storage is a document core with indexed facets (length, lanes, footprint,
piece counts, completeness, stars) — search scales, tracks stay opaque.

Track format: `Name;x;y;angle;color;z#…` (1 px = 1 cm, z in mm);
legacy tracks import unchanged.

## Development
Module map: `pieces.js` catalog · `geometry.js` snap math · `track.js` codec ·
`validate.js` validator · `store.js` model · `solver.js` loop-closing search · `render.js` canvas · `input.js`
gestures · `ui.js`/`gallery.js` DOM · `tooltip.js` position-aware tips ·
`storage.js`/`cache.js`/`assets.js`
persistence+assets · `art.js`/`icons.js` fallback art and icons · `main.js`
boot. `server.js`+`lib/` serve and store; `tools/` generate and verify.

```sh
npm test             # unit (node --test, zero deps)
npm run test:e2e     # Playwright suite
```

`tools/render-pipeline/` regenerates every sprite from the catalog
(`INVARIANTS.md` is the art contract); `tools/verify/` checks lane
geometry and golden rasters. Pure modules run under plain node, which is
also how the server validates tracks. CI runs the suites, a live-postgres
conformance check, and a real docker build-and-boot smoke on every PR.

## Credits

- **Pimentoso (Michele Ferri)** — track format, piece catalog, and
  snapping algorithm derive from his MIT-licensed Mini4WD Online Track
  Editor (© 2016); notices preserved in source headers.
- **rucdoc** — 1/2/3-lane 3D-printed track system, MIT (c) rucdoc;
  sprites are original vector redraws from his published dimensions.
- **Tamiya** — "Mini4WD" and track piece designs are property of Tamiya
  inc. Independent fan tool.
- Icons: [Material Design Icons](https://github.com/Templarian/MaterialDesign-SVG),
  MIT (© 2014-2025 Austin Andrews), vendored inline.
