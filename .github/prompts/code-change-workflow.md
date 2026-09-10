## Code Change Workflow (MANDATORY)

Every code change MUST follow this review-iterate-approve cycle without exception:

1. **Read README-LLM.md** — all project rules apply (no build step, byte-compatibility, validation, style).
2. **Branch:** Create a feature branch (`feat/`, `fix/`, `test/`, `security/`, or `docs/` prefix). Never commit to main.
3. **Implement** the change surgically; bump the `?v=N` cache-bust in index.html if editor.js or style.css changed.
4. **PR:** Open a pull request with a clear description (what, why, how verified). Reference the triggering issue or comment.
5. **Wait for review:** The automated PR review triggers on every PR open and push. Wait for it to complete before proceeding.
6. **Address feedback:** Read every finding. Fix ALL real issues. Push to the same branch — this triggers automatic re-review.
7. **Iterate:** Repeat steps 5–6 until the automated reviewer posts APPROVE.
8. **Merge:** After approval only — merge with squash method, **unless this run was invoked with `--no-merge`** (see Hold below) or it is a `/design` run (which always holds).
9. **Report:** Post a comment on the original issue/PR confirming completion with a summary of changes.

**Merge control (`--no-merge` and `/merge`):**
- By default `/fix`, `/implement`, `/test`, and `/security` auto-merge after approval (step 8).
- Append `--no-merge` to any of those commands to hold the merge: the run iterates to approval but does NOT merge — it stops and waits for an explicit `/merge`.
- `/design` **always holds** — design docs never auto-merge.
- `/merge` is the explicit finalize command: it verifies the latest review is APPROVE and required CI is green, then squash-merges and deletes the branch.

**Hard rules:**
- NEVER merge before the automated review approves — no exceptions
- NEVER dismiss review findings — fix them or document with evidence why they are false alarms
- NEVER commit directly to main
- NEVER perform destructive git ops (`git checkout .`, `git reset --hard`, `git clean -fd`)
- **Full validation required before pushing:**
  ```bash
  node --check editor.js
  node --check serve.js
  node serve.js & sleep 1
  curl -sf http://localhost:3000/ >/dev/null && curl -sf http://localhost:3000/editor.js >/dev/null && echo smoke ok
  ```
- If the review cycle exceeds 3 iterations, step back and reassess the approach — something is wrong
