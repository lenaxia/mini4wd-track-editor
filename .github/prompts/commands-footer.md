## AI Assistant Commands

The following commands are available on this issue/PR thread. Reply with one to trigger the assistant — any text after a command tunes the request (e.g. `/review focus on the pointer event handling`).

| Command | Description |
|---|---|
| `/ai [text]` | General-purpose — context-dependent. On a PR: full re-review. On an issue: analyze and respond. With text: address the specific request. |
| `/review [text]` | Explicit code review of the current PR. Append text to focus on specific areas. |
| `/fix <description>` | Fix a bug. Branch → PR → automated review → iterate → merge. |
| `/implement <description>` | Implement a feature. Branch → PR → automated review → iterate → merge. |
| `/test <target>` | Write or improve verification for a target (this repo has no test framework — see README-LLM.md). |
| `/analyze [text]` | Deep read-only analysis. Posts findings as a comment. No code changes. |
| `/explain <topic>` | Explain code or architecture. Posts a comment. No code changes. |
| `/security [text]` | Security-focused review. |
| `/triage [text]` | Triage an issue — categorize, prioritize, suggest labels. |
| `/design [text]` | Iterate on a design proposal BEFORE implementing. Holds — never auto-merges. |
| `/merge` | Explicitly merge the current PR once approved (squash, delete branch). |
| `/help` | Show the command reference. |

Append `--no-merge` to `/fix`, `/implement`, `/test`, or `/security` to hold the merge for an explicit `/merge`.

Available to owners, members, and collaborators.
