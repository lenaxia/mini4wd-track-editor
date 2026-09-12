# README-LLM — rules for AI agents working on mini4wd-track-editor

Read this before making any change. It is the authoritative rules document
referenced by `.github/prompts/` (lenaxia/ai-workflows consumer).

## What this repo is

A touch-first, **zero-runtime-dependency, no-build static web app** for
designing Tamiya Mini4WD race tracks — a mobile-friendly fork of the Mini4WD
Online Track Editor by Pimentoso. Vanilla ES modules served statically; see
the module map in README.md. `package.json` exists for **dev tooling only**
(test runners); the app itself must run from a plain static file server with
zero installs. ES modules require http — `file://` does not work; use
`serve.js`.

## Hard rules

1. **No build step, no runtime dependencies — ever.** No bundler, no
   frameworks, no new npm packages in the app's import graph. Dev-only
   tooling (node --test, Playwright) is allowed and lives behind
   `package.json` scripts. Keep the module graph acyclic:
   `main → render → input → ui → store → geometry/track/storage → pieces`.
2. **Track format: v2 writes, legacy imports.** `src/track.js`
   `serialize()` speaks `Name;x;y;angle;color;z#` (1 px = 1 cm, x/y
   `toFixed(3)`, angle 3-dp, z integer mm) — the z field is the
   owner-approved breaking change (docs/design/orient-elevation.md §3;
   the original site has no export to stay byte-identical with).
   `parseTrack()` must keep accepting 5-field legacy strings, 6-field
   v2, and `/load/CODE.js` wrappers forever. v2 round-trip fidelity is
   a release blocker (pinned by `tests/unit/track.test.js`).
3. **Attribution is load-bearing.** The MIT notice (© 2016 Michele Ferri)
   at the top of `src/main.js` stays, with the short derived-data notices
   in `pieces.js`/`geometry.js`/`track.js`. "Mini4WD" and the piece
   artwork are Tamiya's — never add assets, keep credits in `index.html`
   and `README.md` accurate.
4. **Touch + desktop parity.** Every interaction must work with touch
   (single finger, two-finger pan/pinch), mouse, and keyboard (1-9, Q/W/E,
   H, Z/X, R, F, Esc, Del, Shift). devicePixelRatio-correct rendering must
   be preserved.
5. **Cache-bust.** Bump `?v=N` on the `src/main.js` reference in
   `index.html` whenever app code changes.
6. **Surgical diffs.** No drive-by refactors, no reformatting untouched
   code, no comment churn. Section-banner comment style; inline comments
   only when timeless and necessary.
7. **No unverified claims.** Show evidence (file:line, command output).
   If a behavior cannot be verified from code reading, say so.

## Interaction model (keep consistent)

- Default tool is **Pan**; picking a palette piece arms a **one-shot**
  placement tool.
- **Press** on canvas creates the piece immediately (floored coords +
  vertex snap); **drag** positions it with live snapping (green dots);
  **release** commits and reverts the tool to Move with the piece selected.
- Hover preview (translucent piece + snap vertices) follows the cursor on
  desktop while a piece tool is armed.
- Move tool: group drag with snapping, rubber-band select,
  ctrl/cmd+click toggle, tap empty space to deselect.
- **Esc**: cancel in-progress placement / return to Pan.
- Undo history (80 levels), localStorage autosave, share links
  `#t=<base64url>` of the serialized track.

## Testing (see TESTPLAN.md)

Two automated layers plus a manual matrix:

- **Unit — mandatory before every push:** `npm test` (Node's built-in
  runner; zero deps). Covers the pure modules: track codec (byte-compat),
  geometry/snap math, catalog integrity, store actions.
- **E2E:** `npm run test:e2e` (Playwright, dev-only). Gesture flows, boot,
  import, share links, touch. Requires `npx playwright install chromium`
  once, and system libs for Chromium (not available in every sandbox —
  specs are still valid and run in CI / locally).
- **Manual:** two-finger pinch, real touch devices, sprite fidelity.

### TDD (mandatory)

- **Red-green for pure-module changes** (`store.js`, `geometry.js`,
  `track.js`, `pieces.js`, `storage.js`): write the failing unit test
  first, confirm it fails for the intended reason, then make it pass.
  Bug fixes additionally keep a test that fails on the pre-fix code
  (regression pin). `serialize()` byte-compat is never traded away.
- **Spec-first for interaction changes** (`input.js`, `render.js`,
  `ui.js`): write/adjust the Playwright spec that pins the intended
  behavior before implementing, and state in the PR how it was verified
  (e2e spec, or an exact recipe: tool, input sequence, expected result).
  Specs encode intentions — when a spec and the interaction model in this
  README disagree, resolve in favor of this README and fix the spec.

Behavior changes in `input.js`/`render.js`/`ui.js` that unit tests cannot
reach must state in the PR how they were verified (e2e spec, or an exact
recipe: tool, input sequence, expected result).

## Validation (mandatory before every push)

```bash
npm test                              # unit — must be green
for f in src/*.js serve.js; do node --check "$f"; done   # per file —
                                      # 'node --check a b' checks only a
node serve.js & sleep 1
curl -sf http://localhost:3000/ >/dev/null \
  && curl -sf http://localhost:3000/src/main.js >/dev/null \
  && echo smoke ok
```

## Git workflow

Never commit to `main`. Branch prefixes: `feat/`, `fix/`, `test/`,
`security/`, `docs/`. Every change goes through a PR and the automated
review (`/fix`, `/implement`, etc. follow the review-iterate-approve
cycle in `.github/prompts/code-change-workflow.md`). Merge via squash.
