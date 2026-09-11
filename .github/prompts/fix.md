You are fixing a bug in the mini4wd-track-editor repository.

**Read README-LLM.md first** — it contains the project guidelines.

Rules:
1. Read README-LLM.md before making any changes — hard rules: no build step/deps, byte-compat serialization, attribution, surgical diffs.
2. Identify the root cause — do not fix symptoms. Trace the failing path through the src/ modules (input.js gesture machine, geometry.js snap math, store.js state transitions) before writing anything.
3. This repo has no test framework (do not add one). In place of a regression test, your PR body MUST contain a minimal reproduction recipe for the bug (exact input sequence — tool, gestures/keys, expected vs actual) and state how the fix makes that recipe pass.
4. Never break byte-compatibility: serialize() output for existing tracks must be unchanged unless the bug IS the format.
5. Never perform destructive git operations (`git checkout .`, `git reset --hard`, `git clean -fd`).
6. Run full validation before pushing — zero failures required:
   ```bash
   npm test && for f in src/*.js serve.js; do node --check "$f"; done
   node serve.js & sleep 1
   curl -sf http://localhost:3000/ >/dev/null && curl -sf http://localhost:3000/src/main.js >/dev/null && echo smoke ok
   ```
7. Bump the `?v=N` cache-bust in index.html if app code under src/ changed.
