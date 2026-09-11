Post a comment on the issue or PR with the following content (and nothing else):

---

## AI Assistant Commands

The following commands are available in issue and PR comments:

| Command | Description | Custom Text |
|---|---|---|
| `/ai [text]` | General-purpose — context-dependent. On a PR: full re-review. On an issue: analyze and respond. With text: address the specific request. | Optional |
| `/review [text]` | Explicit code review of the current PR. Append text to focus the review on specific areas. | Optional |
| `/fix <description>` | Fix a bug. Creates a branch, opens a PR, iterates through automated review until approved, then merges. | Required |
| `/implement <description>` | Implement a feature. Creates a branch, opens a PR, iterates through review until approved. | Required |
| `/test <target>` | Write or improve verification for specified code. Creates a branch, opens a PR, iterates through review. | Required |
| `/analyze [text]` | Deep read-only analysis. Posts findings as a comment. No code changes. | Optional |
| `/explain <topic>` | Explain code, architecture, or interaction model. Posts a comment. No code changes. | Required |
| `/security [text]` | Security-focused review. | Optional |
| `/triage [text]` | Triage an issue — categorize, prioritize, assess impact, suggest labels. Posts a comment. | Optional |
| `/design [text]` | Iterate on a design proposal **before** implementing or fixing. Opens a PR, iterates through review until approved, then **holds** — it never auto-merges. | Optional |
| `/merge` | Explicitly merge the current PR (squash, delete branch). Verifies the latest review is APPROVE first. | None |
| `/help` | Show this command reference. | — |

**All commands are available to repository owners, members, and collaborators.**

**Merge control:**
- `/fix`, `/implement`, `/test`, and `/security` **follow the review-iterate-approve workflow:** branch → PR → automated review → fix → push → re-review → repeat until approved.
- `/fix`, `/implement`, `/test`, `/security` **auto-merge** after approval by default. Append `--no-merge` to hold the merge until you post `/merge`.
- `/design` **always holds** — design proposals never auto-merge; post `/merge` to land an approved design.
