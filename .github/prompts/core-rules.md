## Core Rules

These rules apply to every response. They are non-negotiable. The authoritative source is README-LLM.md (read it in full before making changes).

### 1. Zero-runtime-dependency, no-build is sacred

No bundler, no frameworks, no new npm packages in the app's import graph. The app is vanilla ES modules served statically. Dev-only tooling (Node's built-in test runner, Playwright) is allowed and lives behind `package.json` scripts — `package.json` never ships a runtime dependency. Keep the module graph acyclic: `main → render → input → ui → store → geometry/track/storage → pieces`.

### 2. Track format byte-compatibility is a hard requirement

`src/track.js` `serialize()` / `parseTrack()` speak `Name;x;y;angle;color#…` exactly as the original pimentoso editor does. Any change that alters the serialized output of existing tracks is a bug. Coordinates are `toFixed(3)`, angle in degrees, color index integer. Round-trip fidelity is pinned by `tests/unit/track.test.js` — `npm test` must stay green.

### 3. Validation before every push

The mandatory validation is (see README-LLM.md for the canonical block):

```bash
npm test                              # unit — must be green (node --test)
for f in src/*.js serve.js; do node --check "$f"; done   # per file
node serve.js & sleep 1               # dev server on :3000
curl -sf http://localhost:3000/ >/dev/null && echo index ok
curl -sf http://localhost:3000/src/main.js >/dev/null && echo js ok
curl -sf http://localhost:3000/style.css >/dev/null && echo css ok
```

`node --check a b` validates only the first file — check per file. Behavior changes in `input.js`/`render.js`/`ui.js` that unit tests cannot reach must state in the PR how they were verified (e2e spec via `npm run test:e2e`, or an exact recipe: tool, input sequence, expected result). If you cannot verify a behavior from code reading alone, say so explicitly rather than claiming it works.

### 4. Preserve attribution and license headers

`src/main.js` carries the full MIT notice derived from the original editor (Michele Ferri / Pimentoso) at the top, with short derived-data notices in `pieces.js`/`geometry.js`/`track.js` — all stay. "Mini4WD" and the piece artwork are Tamiya's; never add Tamiya assets beyond the existing set, and keep the credits/mentions in index.html and README.md accurate.

### 5. Cache-bust when changing app code

index.html loads `src/main.js?v=N`. Bump the version query whenever app code under `src/` changes.

### 6. Touch-first parity

Every interaction must work with: (a) touch (single finger, two-finger pan/zoom), (b) mouse + keyboard (1-9, Q/W/E/H, Z/X, R, F, Esc, Del, Shift). A feature that only works on desktop is incomplete. devicePixelRatio-correct rendering must be preserved.

### 7. Style: self-documenting, minimal comments

The codebase uses short section-banner comments and few inline comments. Do not add inline comments unless timeless and necessary. Keep the existing terse style; no semicolon-free reformatting, no renames unrelated to the task.

### 8. No unverified claims

Never state that something exists without showing it (file path + source text). Never state that something does not exist without proving its absence (show the grep command and its empty output).

### 9. Surgical changes

Keep diffs minimal and focused on the request. No drive-by refactors, no reformatting untouched code, no removing attribution "clutter".
