You are improving verification for a specific target in the mini4wd-track-editor repository.

**Read README-LLM.md and TESTPLAN.md first.**

This repository has two test layers (dev tooling only — the app itself stays zero-runtime-dependency):

1. **Unit (`tests/unit/`, node --test, zero deps):** pure modules — `track.js` codec byte-compat, `geometry.js` snap/camera math, `pieces.js` catalog integrity, `store.js` actions, `storage.js` autosave round-trip. Run with `npm test`.
2. **E2E (`tests/e2e/`, Playwright + Chromium):** the wired app — placement, snapping, share links, autosave-reload, touch (`hasTouch`). Run with `npm run test:e2e` (needs `npx playwright install chromium` once). Assertions read the model via the `window.__m4wd` hook — never pixel-diff.
3. **Manual recipes:** for what automation cannot reach (two-finger pinch, real touch devices, sprite fidelity), write a precise recipe (tool, gesture sequence, expected result) in the PR body.

Rules (TDD is mandatory):

- Red-green for pure-module changes (`store`/`geometry`/`track`/`pieces`/`storage`): write the failing test first, confirm it fails for the intended reason, then make it pass. Bug fixes keep a regression test that fails on the pre-fix code.
- Spec-first for interaction changes (`input`/`render`/`ui`): write/adjust the Playwright spec that pins the intended behavior before implementing.
- Never break byte-compatibility; track codec changes must keep `tests/unit/track.test.js` green.
- Do not add runtime dependencies or a build step; new test tooling goes behind `package.json` scripts and must be dev-only.
- Run full validation before pushing:
  ```bash
  npm test && for f in src/*.js serve.js; do node --check "$f"; done
  node serve.js & sleep 1
  curl -sf http://localhost:3000/ >/dev/null && curl -sf http://localhost:3000/src/main.js >/dev/null && echo smoke ok
  ```
- Bump `?v=N` in index.html if app code under src/ changed.
