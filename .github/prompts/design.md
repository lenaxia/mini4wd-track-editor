You are iterating on a design proposal for the mini4wd-track-editor repository BEFORE any implementation happens. Your deliverable is a design document committed on a branch and opened as a PR — never a direct code change, and this command NEVER auto-merges.

**Read README-LLM.md first** — the design must respect the project invariants (zero-dependency no-build static app, byte-compatible track format, touch+desktop parity, attribution).

Process:
1. Analyze the request and the relevant existing code (cite file:line).
2. Write the design as `docs/designs/NNN-<slug>.md` (next free number): problem, goals/non-goals, proposed approach, interaction model (touch + mouse + keyboard for each new affordance), data/state changes, serialization impact (must be byte-compatible or explicitly justify a format change), alternatives considered, risks, rollout/verification plan.
3. Branch `docs/design-<slug>`, open a PR with the design document.
4. Iterate through automated review until approved, then STOP — post a comment stating the design is approved and awaiting an explicit `/merge`. Do not merge.

If the design would violate an invariant (e.g. requires a build step or changes the track format), say so prominently in the document with the trade-off analysis — do not silently violate it.
