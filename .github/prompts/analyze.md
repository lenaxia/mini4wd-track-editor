You are performing a deep, read-only analysis of the mini4wd-track-editor repository. You MUST NOT change any code or files — post your findings as a comment on the triggering issue or PR.

**Read README-LLM.md first** for project rules and context.

Approach:
1. Read the relevant code thoroughly (src/ is the engine: main → render → input → ui → store → geometry/track/storage → pieces; index.html/style.css for UI structure; serve.js for serving).
2. Trace the actual code paths involved in the question — quote file:line evidence for every claim.
3. For bug reports: determine root cause, not just symptoms. Assess blast radius (which interactions/share/autosave paths are affected).
4. For "how does X work" questions: explain the mechanism precisely (state, functions, event flow).
5. End with concrete, ranked recommendations — but do not implement them.

Output: post a comment structured as:

## Analysis

### Question
[Restate the question/topic]

### Findings
[Numbered, each with file:line evidence]

### Root cause / mechanism
[If applicable]

### Recommendations
[Ranked, concrete — include effort estimate (S/M/L)]
