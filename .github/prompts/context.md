Repository: mini4wd-track-editor — a touch-first, zero-dependency, no-build static web app for designing Tamiya Mini4WD race tracks (`github.com/lenaxia/mini4wd-track-editor`). A mobile-friendly fork of the Mini4WD Online Track Editor by Pimentoso; the track data format is byte-compatible with the original. Single maintainer: @lenaxia.

The entire app is four files plus sprites — there is no bundler, no package.json, no framework, and that is a design constraint, not an accident:

- index.html — app shell: topbar, canvas stage, bottom toolbar + piece palette, dialogs (menu / import-export / help)
- editor.js — ALL editor logic (~1100 lines vanilla JS): piece catalog (PIECES), camera, Pointer Events input model, snapping, selection, undo history, serialization, localStorage autosave, share links
- style.css — layout (100dvh, safe-area aware)
- serve.js — zero-dependency Node dev server (port 3000, no caching)
- assets/ — 67 Tamiya track-piece sprite PNGs (Name.color.png)

Domain model:
- Scale: 1 px = 1 cm; one grid square = 1 m
- Track format (byte-compatibility is a hard requirement): `Name;x;y;angle;color#Name;…` — serialize() / parseTrack() in editor.js
- Piece catalog: 3-lane (Japan Cup) and 5-lane (WIDE) pieces, each with footprint (w/h cm), connection vertices (v1/v2), official lap length, color count
- Snapping: SNAP_RADIUS = 10 cm between connection vertices

Interaction model (Figma-style, recently reworked — keep consistent):
- Default tool is Pan; picking a palette piece arms a one-shot placement tool
- Press on canvas creates the piece immediately (snapped); drag positions it; release commits and the tool reverts to Move with the piece selected
- Hover preview (translucent piece + snap vertices) follows the cursor on desktop while a piece tool is armed
- Move tool: drag to move (group snap), rubber-band select, ctrl/cmd+click multi-select, tap empty space to deselect
- Esc: cancel in-progress placement / return to Pan tool; two-finger pan & pinch-zoom on touch

---

## Before doing anything else: read README-LLM.md at the repo root

It contains the critical guidelines (no build step, byte-compatibility, attribution, validation commands, style rules). Every response must be consistent with it.

---

## Commands

Post a comment on the issue or PR using any of these commands:

- `/ai` — re-assess the current issue or PR in full (issue responder or full PR re-review)
- `/ai <text>` — address a specific request, e.g. `/ai make the hint bar update when the tool changes`
- `/review [text]` — explicit PR code review, optionally focused on a specific area
- `/fix <description>` — fix a bug: branch, verify, PR, iterate through review until approved, merge
- `/implement <description>` — implement a feature: verify, PR, iterate until approved, merge
- `/test <target>` — write or improve verification for a target: PR, iterate until approved, merge
- `/analyze [text]` — deep read-only analysis, posts findings as a comment (no code changes)
- `/explain <topic>` — explain code or architecture, posts explanation as a comment (no code changes)
- `/security [text]` — security-focused review
- `/triage [text]` — categorize and prioritize an issue
- `/design [text]` — iterate on a design proposal BEFORE implementing; holds (never auto-merges)
- `/merge` — explicitly merge the current PR (squash, delete branch) once approved
- `/help` — show this command reference

Commands are available to owners, members, and collaborators. Append `--no-merge` to `/fix`, `/implement`, `/test`, or `/security` to hold the merge for an explicit `/merge`.
