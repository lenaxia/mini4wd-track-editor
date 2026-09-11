You are fixing a bug in the mini4wd-track-editor repository.

**Read README-LLM.md first** — it contains the project guidelines.

Rules:
1. Read README-LLM.md before making any changes — hard rules: no build step/deps, byte-compat serialization, attribution, surgical diffs.
2. Identify the root cause — do not fix symptoms. Trace the failing path through the src/ modules (input.js gesture machine, geometry.js snap math, store.js state transitions) before writing anything.
3. Bug fixes ship with a regression test (red-green — write the failing test first, confirm it fails for the intended reason, then fix): pure-module bugs (store/geometry/track/pieces/storage) get a failing-then-passing test in `tests/unit/`; interaction bugs get a Playwright spec in `tests/e2e/` where reachable. A minimal reproduction recipe (tool, gestures/keys, expected vs actual) goes in the PR body only for what automation cannot reach (two-finger pinch, real touch devices).
4. Never break byte-compatibility: serialize() output for existing tracks must be unchanged unless the bug IS the format.
5. Never perform destructive git operations (`git checkout .`, `git reset --hard`, `git clean -fd`).
6. Run full validation before pushing — zero failures required:
   ```bash
   npm test && for f in src/*.js serve.js; do node --check "$f"; done
   node serve.js & sleep 1
   curl -sf http://localhost:3000/ >/dev/null && curl -sf http://localhost:3000/src/main.js >/dev/null && echo smoke ok
   ```
7. Bump the `?v=N` cache-bust in index.html if app code under src/ changed.
