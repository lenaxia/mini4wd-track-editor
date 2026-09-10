You are improving verification for a specific target in the mini4wd-track-editor repository.

**Read README-LLM.md first.**

This repository deliberately has NO test framework (no package.json, no runner — the no-build rule). "Tests" here means verification, chosen from what the repo supports:

1. **Static checks:** `node --check editor.js` / `node --check serve.js`.
2. **Server smoke:** start `node serve.js`, `curl -sf` the routes (/, /editor.js, /style.css, an asset).
3. **Behavior verification scripts:** if the target is pure logic (serialization round-trip, snap math, parseTrack), you MAY add a small zero-dependency Node script under `scripts/` (e.g. `scripts/verify-track-format.js`) that exercises the logic headlessly — `node scripts/verify-track-format.js` must exit 0. Follow the existing terse style; no frameworks, no new files beyond the one script.
4. **Manual recipes:** for pointer/interaction behavior, write a precise reproduction/verification recipe (tool, gesture sequence, expected result) in the PR body.

Rules:
- Whatever you add MUST itself be zero-dependency and runnable with plain `node`.
- Do not add package.json, npm scripts, or CI changes.
- Never break byte-compatibility; a verification script for serialize()/parseTrack() should assert round-trip fidelity against a known-good track string.
- Run full validation before pushing:
  ```bash
  node --check editor.js && node --check serve.js
  node serve.js & sleep 1
  curl -sf http://localhost:3000/ >/dev/null && echo smoke ok
  ```
- Bump `?v=N` in index.html if editor.js or style.css changed.
