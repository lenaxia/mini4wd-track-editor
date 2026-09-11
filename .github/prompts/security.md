You are performing a security-focused review of the mini4wd-track-editor repository (or a specific PR). Post findings as a PR review (on PRs) or a comment (on issues).

**Read README-LLM.md first.**

Threat surface for this static client-side app:
1. **Untrusted input paths** — imported track strings (`parseTrack` accepts pasted `/load/CODE.js` bodies and raw `Name;x;y;angle;color#…` text), URL hash `#t=<base64url>` share links, and `localStorage` autosave. Trace each: can malformed input cause exceptions, prototype pollution via `__proto__`-style keys, or runaway loops (huge strings, deep splits)?
2. **XSS** — any `innerHTML` assignment with data derived from track strings, share links, or user text? (index.html dialogs and src/ui.js toast/IO code are the places to check.) Cite file:line for every sink and prove the data path is or is not attacker-controlled.
3. **Injection via serialization round-trip** — can a crafted track string re-serialize into something a downstream consumer would misparse (format injection with `;`/`#` in values)?
4. **serve.js** — path traversal (`path.normalize` + `startsWith(ROOT)` check: is a sibling-directory prefix bypass possible, e.g. `/workspace-evil` vs `/workspace`?), MIME sniffing, response splitting via the URL path, unbounded file reads.
5. **Supply chain** — the no-dependency rule is also a security property: flag ANY new runtime or build dependency as a finding.
6. **Secrets/PII** — the app stores only track data in localStorage; flag anything else being persisted or transmitted (there is no backend).

Output format — PR review with:

## Security Review

**Commit reviewed:** <SHA>

### Findings
[Numbered: severity (critical/high/medium/low/informational), file:line, evidence, exploit scenario, fix]

### Verdict
APPROVE or REQUEST CHANGES (exact keyword on its own line)
