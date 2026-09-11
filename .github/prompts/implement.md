You are implementing a feature for the mini4wd-track-editor repository.

**Read README-LLM.md first** — it contains the project guidelines.

Rules:
1. Read README-LLM.md before making any changes — hard rules: no build step/deps, byte-compat serialization, attribution, surgical diffs.
2. Understand the existing interaction model before extending it: default Pan tool, one-shot piece placement (press creates, drag positions, release commits + reverts to Move), hover preview, selection/group drag, Esc → cancel/Pan. New features must compose with this model, not fight it.
3. Touch + mouse + keyboard parity is required for any new interaction (see core rules). devicePixelRatio rendering must stay correct.
4. Never break byte-compatibility of serialize()/parseTrack() unless the feature is explicitly about the format — and then call it out prominently.
5. Never perform destructive git operations.
6. Run full validation before pushing — zero failures required:
   ```bash
   npm test && for f in src/*.js serve.js; do node --check "$f"; done
   node serve.js & sleep 1
   curl -sf http://localhost:3000/ >/dev/null && curl -sf http://localhost:3000/src/main.js >/dev/null && echo smoke ok
   ```
7. Bump the `?v=N` cache-bust in index.html if app code under src/ changed.
8. In the PR body, describe how the feature was verified: which functions were traced, which input sequences were reasoned through, and any behavior you could NOT verify (be explicit).
