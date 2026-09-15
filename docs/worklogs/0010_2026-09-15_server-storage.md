# 0010 — Server-side track storage: relational shell, document core

**Date:** 2026-09-15
**Triggered by:** Owner request — server.js (sic; final name server.js) storing
tracks locally, both sqlite and postgres, schema stress-tested for
robustness/maintainability/scalability. Storage-model question (NoSQL vs
relational) answered below and in the PR.

---

## The storage ruling

Tracks are documents; the searchable facets are relational. So: one table,
track body as a JSON document (`data`), facets as plain indexed columns
maintained by the server on every write (`piece_count`, `lanes`,
`length_cm`, `bbox_w_cm/h_cm`, `author`). This IS the owner's "just more
GSI" instinct, expressed with real columns: indexed, transactional upserts,
one schema across both engines. NoSQL buys nothing at this scale; if
full-text search ever matters, PG tsvector / SQLite FTS5 bolt on without
redesign.

## Stack

- `server.js` — static (via `lib/static.js`, extracted from serve.js) +
  `/api/tracks` CRUD (GET list with filters/sort/pagination, GET/PUT/DELETE
  by id, POST), `/api/health`. Strict validation: present-but-wrong-typed
  fields are 400s, never silent coercions; ids `[A-Za-z0-9_-]{1,64}`;
  track strings capped at 512 KiB, bodies at 2 MiB.
- Drivers (`lib/store/`): memory (tests), sqlite via **node:sqlite —
  zero new deps, WAL, busy_timeout** (default, `./data/tracks.db`),
  postgres via lazy `pg` (default path never imports it).
- Client mirror (`src/storage.js`): localStorage stays primary; edits
  sync best-effort (350ms + 1500ms debounce) as PUT /api/tracks/:id with
  a stable per-browser uuid. Server absent → silent no-op.
- Docker: server.js entry, `/data` volume (node-owned), healthcheck on
  /api/health, `npm ci --omit=dev` with the new lockfile; compose adds a
  postgres profile.

## Verification

- Unit (`tests/unit/store.test.js`, same suite for every driver): CRUD
  roundtrips with facet correctness; upsert idempotency + created_at
  preservation; unicode/emoji/quotes/SQL-injection strings as inert data;
  filter/sort composition; deterministic pagination under ties; 200-way
  concurrent upserts; 5k-track scale seed with per-query time budgets
  (indexed queries well under); 10k-piece bodies; sqlite reopen
  durability. Postgres runs the identical suite when PG_TEST_URL is set.
- e2e (`tests/e2e/api.spec.js`): health, facet-deriving PUT/GET roundtrip,
  POST with server id, filtered/sorted/paginated list (metadata only —
  no bodies), validation 400/413s incl. DROP TABLE strings, DELETE
  semantics, and live client-mirror sync from a booted page.
- Live on the dev preview: 9 owner boots, 8 served entirely from
  CacheStorage (asset cache from 0009 holding); sync PUTs landing in
  sqlite (WAL).

## Found along the way

- rudoc mode serializes `mode` as the string 'rucdoc' — first strict
  validation rejected it (400s observed live). Mode accepts number or
  string; wrong types still 400.
- `serve.js` remains as the static-only entry; `npm run server` runs the
  full server. Playwright's webServer uses `STORE=memory node server.js`.
