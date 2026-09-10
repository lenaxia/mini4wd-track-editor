## Core Rules

These rules apply to every response. They are non-negotiable. The authoritative source is README-LLM.md (read it in full before making changes).

### 1. Zero-dependency, no-build is sacred

No package.json, no bundler, no imports, no npm install, no frameworks. Vanilla JS + CSS + HTML only, loaded by a plain `<script>` tag. Never introduce a build step or a runtime dependency.

### 2. Track format byte-compatibility is a hard requirement

`serialize()` / `parseTrack()` speak `Name;x;y;angle;color#…` exactly as the original pimentoso editor does. Any change that alters the serialized output of existing tracks is a bug. Coordinates are `toFixed(3)`, angle in degrees, color index integer. If a change touches these functions, verify round-trip fidelity.

### 3. Validation before every push (no test framework exists)

This repo has NO test suite — do not add one without an explicit request. The mandatory validation is:

```bash
node --check editor.js     # syntax must pass
node --check serve.js
node serve.js & sleep 1    # dev server on :3000
curl -sf http://localhost:3000/ >/dev/null && echo index ok
curl -sf http://localhost:3000/editor.js >/dev/null && echo js ok
curl -sf http://localhost:3000/style.css >/dev/null && echo css ok
```

For behavior changes in editor.js: trace the affected code path in the source and state precisely how you verified it (which functions, which input sequences). If you cannot verify a behavior from code reading alone, say so explicitly rather than claiming it works.

### 4. Preserve attribution and license headers

editor.js carries an MIT license notice derived from the original editor (Michele Ferri / Pimentoso) — it must remain at the top of the file. "Mini4WD" and the piece artwork are Tamiya's; never add Tamiya assets beyond the existing set, and keep the credits/mentions in index.html and README.md accurate.

### 5. Cache-bust when changing editor.js or style.css

index.html references `editor.js?v=N` and `style.css?v=N`. Bump the version query when their content changes.

### 6. Touch-first parity

Every interaction must work with: (a) touch (single finger, two-finger pan/zoom), (b) mouse + keyboard (1-9, Q/W/E/H, Z/X, R, F, Esc, Del, Shift). A feature that only works on desktop is incomplete. devicePixelRatio-correct rendering must be preserved.

### 7. Style: self-documenting, minimal comments

The codebase uses short section-banner comments and few inline comments. Do not add inline comments unless timeless and necessary. Keep the existing terse style; no semicolon-free reformatting, no renames unrelated to the task.

### 8. No unverified claims

Never state that something exists without showing it (file path + source text). Never state that something does not exist without proving its absence (show the grep command and its empty output).

### 9. Surgical changes

Keep diffs minimal and focused on the request. No drive-by refactors, no reformatting untouched code, no removing attribution "clutter".
