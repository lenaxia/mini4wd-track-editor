/* Full server — static editor + track storage API.
 *
 * Storage: relational shell, document core (docs/worklogs/0010): the
 * track body is one JSON document; the searchable facets (author, piece
 * count, lanes, length, bbox) are plain indexed columns maintained by
 * the server on every write. Drivers: memory (tests), sqlite via
 * node:sqlite (default, zero-dep), postgres via lazy `pg`.
 *
 * Env: STORE (memory|sqlite|postgres, default sqlite), SQLITE_PATH
 * (default ./data/tracks.db), DATABASE_URL, PORT (default 3000). */
'use strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createStaticHandler } from './lib/static.js';
import { openStore } from './lib/store/index.js';
import { shouldArchive } from './lib/store/retention.js';
import { parseTrip, tripHash } from './lib/tripcode.js';
import { facets, MAX_TRACK_BYTES_EXPORTED, VALIDATOR_VERSION } from './lib/store/facets.js';
import { validateTrack } from './src/validate.js';
import { parseTrack } from './src/track.js';

/* Full facets: cheap derived columns + server-side validation (complete /
 * issues) computed on every write. Browser-computed validity is UI-only;
 * the stored facet is authoritative. */
function fullFacets(data) {
  const f = facets(data);
  let complete = false, issues = 0;
  try {
    const v = validateTrack(parseTrack(data.track));
    complete = v.ok;
    issues = v.errors.length;
  } catch { /* unparsable reads as incomplete */ }
  return { ...f, complete, issues, validator_version: VALIDATOR_VERSION };
}

/* Daily sweep (owner spec): re-validate rows modified in the last 24h OR
 * stamped by an older validator — tightened rules converge through old
 * rows without anyone re-saving. Runs at boot and every 6 hours. */
async function sweepValidation(store) {
  try {
    const ids = await store.staleIds(Date.now() - 24 * 3600 * 1000, VALIDATOR_VERSION);
    for (const id of ids) {
      const row = await store.get(id);
      if (!row) continue;
      let complete = false, issues = 0;
      try {
        const v = validateTrack(parseTrack(row.data.track));
        complete = v.ok; issues = v.errors.length;
      } catch { /* keep defaults */ }
      /* facets FIRST, version stamp LAST: a crash between the two
       * leaves the row still-stale (retried next sweep) instead of
       * stamped-with-stale-facets forever */
      await store.setFacets(id, fullFacets(row.data));
      await store.setValidation(id, complete, issues, VALIDATOR_VERSION);
    }
    if (ids.length) console.log(`[sweep] revalidated ${ids.length} track(s)`);
  } catch (e) { console.error('[sweep] failed:', e.message); }
}

const PORT = process.env.PORT || 3000;
const MAX_BODY = 2 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

/* Validation errors → 400 with a useful message; anything else → 500
 * generic (driver internals never leak into responses). */
class ValidationError extends Error {}
const bad = (msg) => { throw new ValidationError(msg); };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* Validate + normalize a write. Returns the track row or throws.
 * Strict types: a present-but-wrong-typed field is a 400, never a
 * silent coercion — silent coercions are how junk accumulates. */
function normalize({ id, name, author, data, parent_id, root_id, parent_name, trip }) {
  if (id !== undefined && !ID_RE.test(id)) bad('bad id (want [A-Za-z0-9_-]{1,64})');
  if (data == null || typeof data !== 'object' || Array.isArray(data)) bad('data must be an object');
  if (data.track !== undefined && typeof data.track !== 'string') bad('data.track must be a string');
  if (name !== undefined && name !== null && typeof name !== 'string') bad('name must be a string');
  if (author !== undefined && author !== null && typeof author !== 'string') bad('author must be a string');
  if (trip !== undefined && trip !== null && typeof trip !== 'string') bad('trip must be a string');
  if (data.mode !== undefined && typeof data.mode !== 'number' && typeof data.mode !== 'string')
    bad('data.mode must be a number or a string');
  if (data.angle !== undefined && typeof data.angle !== 'number') bad('data.angle must be a number');
  const raw = typeof data.track === 'string' ? data.track : '';
  if (raw.length > MAX_TRACK_BYTES_EXPORTED) throw new Error('data.track too large (max 512 KiB)');
  const t = {
    id: id || crypto.randomUUID(),
    name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 200) : 'Untitled',
    author: typeof author === 'string' && author.trim() ? author.trim().slice(0, 100) : null,
    data: { track: raw, ...(data.mode !== undefined ? { mode: data.mode } : {}), ...(data.angle !== undefined ? { angle: data.angle } : {}) },
  };
  /* Lineage (worklog 0017): present-but-malformed values are a 400,
   * never a silent drop; absent lineage is always null (uniform across
   * drivers). Real values are decided server-side at fork time — a
   * client-sent parent_name is never stored (an orphan "based on" line). */
  for (const [k, v] of [['parent_id', parent_id], ['root_id', root_id]]) {
    if (v !== undefined && v !== null && (typeof v !== 'string' || !ID_RE.test(v))) bad(`bad ${k}`);
  }
  if (parent_name !== undefined && parent_name !== null && typeof parent_name !== 'string') bad('parent_name must be a string');
  t.parent_id = parent_id ?? null;
  t.root_id = root_id ?? null;
  t.parent_name = null;
  /* Tripcode byline (worklog 0023): `Alex#phrase` → byline Alex + a
   * scrypt hash; the hash locks in-place editing to the phrase holder.
   * A plain `Alex` is an unverified byline; nothing is a plain track.
   * The raw phrase never leaves this function. */
  const tripped = parseTrip(trip);
  if (tripped.name) t.author = tripped.name;
  t._tripHash = tripped.phrase ? tripHash(tripped.phrase) : null;
  t._facets = fullFacets(t.data);
  return t;
}

/* Worklog 0023 — in-place edits of a tripcode-locked track require the
 * phrase. Returns the new row's author_trip (adopting or keeping the
 * lock), or throws a LockError when the presented phrase misses. */
class LockError extends Error {}
const wrongTrip = () => { throw new LockError('track is locked to its author'); };
function resolveTrip(prev, t) {
  if (prev && prev.author_trip && prev.author_trip !== t._tripHash) wrongTrip();   /* locked and not the holder */
  return t._tripHash ?? (prev ? prev.author_trip ?? null : null);   /* keep the existing lock on plain saves */
}

function parseListQuery(u) {
  const q = Object.fromEntries(new URL(u, 'http://x').searchParams);
  const num = (v) => v === undefined || v === '' ? undefined : (Number.isFinite(+v) ? +v : NaN);
  /* lanes=2,3,5 — the gallery's lane selector (OR semantics) */
  const lanes = typeof q.lanes === 'string' && q.lanes
    ? q.lanes.split(',').map((s) => num(s.trim()))
    : undefined;
  const out = {
    author: typeof q.author === 'string' && q.author ? q.author.slice(0, 100) : undefined,
    min_pieces: num(q.min_pieces), max_pieces: num(q.max_pieces), min_length: num(q.min_length),
    max_length: num(q.max_length),
    min_lanes: num(q.min_lanes),
    lanes: lanes && lanes.length ? lanes : undefined,
    max_bbox_w: num(q.max_bbox_w), max_bbox_h: num(q.max_bbox_h),
    max_straights: num(q.max_straights), max_slopes: num(q.max_slopes), max_corners: num(q.max_corners),
    complete: q.complete === 'true' ? true : q.complete === 'false' ? false : undefined,
    sort: typeof q.sort === 'string' && q.sort ? q.sort : '-updated_at',
    limit: Math.max(1, Math.min(100, Math.round(num(q.limit) ?? 50))),
    offset: Math.max(0, Math.round(num(q.offset) ?? 0)),
  };
  for (const v of [out.min_pieces, out.max_pieces, out.min_length, out.max_length, out.min_lanes,
    ...(out.lanes ?? []), out.max_bbox_w, out.max_bbox_h,
    out.max_straights, out.max_slopes, out.max_corners,
    q.limit !== undefined ? out.limit : 0, q.offset !== undefined ? out.offset : 0])
    if (Number.isNaN(v)) bad('non-numeric query value');
  if (out.lanes && !out.lanes.every((v) => Number.isInteger(v) && v > 0 && v <= 10)) bad('bad lanes');
  if (!/^-?(updated_at|created_at|name|pieces|length|lanes|bbox|straights|corners|slopes|stars|complete)$/.test(out.sort)) bad('bad sort');
  return out;
}

async function main() {
  const store = await openStore();
  const static_ = createStaticHandler(import.meta.dirname);
  console.log(`mini4wd-editor server on http://localhost:${PORT} (store: ${store.driver})`);

  const server = http.createServer(async (req, res) => {
    const log = () => console.log(`${new Date().toISOString()} ${req.method} ${req.url} -> ${res.statusCode !== 200 && res.statusCode !== 304 ? res.statusCode : 'ok'} [${req.headers['user-agent'] ? req.headers['user-agent'].slice(0, 40) : '?'}]`);
    res.on('finish', log);
    req.on('error', () => {}); res.on('error', () => {});

    const u = req.url.split('?')[0];
    if (!u.startsWith('/api/')) {
      /* static dispatch can throw (e.g. malformed URI encoding) — a 400,
       * never a hung socket */
      try {
        if (!static_(req, res)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404'); }
      } catch { res.writeHead(400, { 'Content-Type': 'text/plain' }); res.end('400'); }
      return;
    }
    try {
      if (u === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, driver: store.driver });

      /* The whole sprite set in ONE json request (boot used to fire
       * ~75 per-file fetches — request-rate-limited previews throttled
       * that burst to placeholders before it ever reached us, HAR
       * evidence 2026-09-16). ?h=<digest of the manifest> makes it
       * immutable-cacheable; the client verifies every file's sha
       * against its manifest and self-heals to the per-file path. */
      if (u === '/api/sprites' && req.method === 'GET') {
        const files = {};
        for (const f of fs.readdirSync(path.join(import.meta.dirname, 'assets'))) {
          if (f.endsWith('.svg')) files[f] = fs.promises.readFile(path.join(import.meta.dirname, 'assets', f), 'utf8');
        }
        const out = {};
        for (const [f, p] of Object.entries(files)) out[f] = await p;
        const hashAddr = /[?&]h=[0-9a-f]{8,64}/.test(req.url);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': hashAddr ? 'public, max-age=31536000, immutable' : 'no-cache',
          'Access-Control-Allow-Origin': '*',
        });
        return res.end(JSON.stringify({ files: out }));
      }

      /* Sprites over json: the preview proxy empties svg-typed fetch()
       * responses and injects bytes into svg image responses (HAR evidence,
       * worklog 0011) while json passes untouched — the manifest proves it
       * every boot. Same bytes, hash-addressed via ?h=. */
      {
        const m = /^\/api\/sprites\/([A-Za-z0-9._-]+\.svg)$/.exec(u);
        if (m && req.method === 'GET') {
          const name = m[1];
          if (name.includes('..')) return json(res, 403, { error: 'forbidden' });
          const file = path.join(import.meta.dirname, 'assets', name);
          let body;
          try { body = await fs.promises.readFile(file, 'utf8'); }
          catch { return json(res, 404, { error: 'not found' }); }
          /* genuine JSON envelope — the transport must survive proxies
           * that parse (not just type-match) json responses */
          const hashAddr = /[?&]h=[0-9a-f]{8,64}/.test(req.url);
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': hashAddr ? 'public, max-age=31536000, immutable' : 'no-cache',
            'Access-Control-Allow-Origin': '*',
          });
          return res.end(JSON.stringify({ svg: body }));
        }
      }

      const m = /^\/api\/tracks\/([^/]+)$/.exec(u);
      if (u === '/api/tracks' && req.method === 'GET') {
        const q = parseListQuery(req.url);
        return json(res, 200, { ...await store.list(q), limit: q.limit, offset: q.offset });
      }
      if (u === '/api/tracks' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}');
        const t = normalize(body);
        const prev = await store.get(t.id);
        if (prev) {
          /* POST-to-existing is an update: version it and keep the
           * lineage it was born with — body lineage is never trusted.
           * Only a head that was STABLE gets a snapshot (worklog 0022) —
           * rapid-fire saves coalesce into the burst-start entry.
           * A tripcode lock survives plain saves (worklog 0023). */
          t.author_trip = resolveTrip(prev, t);
          if (shouldArchive(prev.updated_at)) await store.archive(t.id, prev);
          Object.assign(t, { parent_id: prev.parent_id ?? null, root_id: prev.root_id ?? null, parent_name: prev.parent_name ?? null });
        } else if (body.parent_id) {
          /* Fork: lineage resolved server-side from the parent row */
          if (typeof body.parent_id !== 'string' || !ID_RE.test(body.parent_id)) bad('bad parent_id');
          const parent = await store.get(body.parent_id);
          if (!parent) return json(res, 404, { error: 'parent track not found' });
          Object.assign(t, { parent_id: parent.id, root_id: parent.root_id || parent.id, parent_name: parent.name });
        }
        /* new row: the fork's own trip (a locked parent copies OPEN —
         * your copy is yours, unbound until you sign it) */
        t.author_trip = t._tripHash ?? null;
        return json(res, 201, await store.upsert(t));
      }
      if (u === '/api/tracks' && req.method === 'PUT') {
        return json(res, 405, { error: 'PUT to /api/tracks/:id; POST creates' });
      }
      if (m && req.method === 'GET') {
        const row = await store.get(decodeURIComponent(m[1]));
        return row ? json(res, 200, row) : json(res, 404, { error: 'not found' });
      }
      if (m && req.method === 'PUT') {
        const body = JSON.parse(await readBody(req) || '{}');
        if (!ID_RE.test(decodeURIComponent(m[1]))) bad('bad id');
        const t = normalize({ ...body, id: decodeURIComponent(m[1]) });
        const prev = await store.get(t.id);
        if (prev) {
          t.author_trip = resolveTrip(prev, t);   /* worklog 0023 */
          if (shouldArchive(prev.updated_at)) await store.archive(t.id, prev);   /* stability rule, worklog 0022 */
          /* lineage never changes on update — the track keeps the
           * parent it was born with (copies are new tracks, not re-links) */
          Object.assign(t, { parent_id: prev.parent_id ?? null, root_id: prev.root_id ?? null, parent_name: prev.parent_name ?? null });
        } else {
          /* PUT-create: lineage is decided exclusively by the POST fork
           * path — a client-sent parent_id/root_id is never stored.
           * The trip IS adopted: signing on create locks it (0023). */
          t.parent_id = null;
          t.root_id = null;
          t.parent_name = null;
          t.author_trip = t._tripHash ?? null;
        }
        return json(res, 200, await store.upsert(t));
      }
      /* Version history (worklog 0017): list + fetch + restore.
       * Restore archives the current head first — history only grows. */
      const mh = /^\/api\/tracks\/([^/]+)\/history$/.exec(u);
      if (mh && req.method === 'GET') {
        if (!ID_RE.test(decodeURIComponent(mh[1]))) bad('bad id');
        if (!(await store.get(decodeURIComponent(mh[1])))) return json(res, 404, { error: 'not found' });
        return json(res, 200, { items: await store.history(decodeURIComponent(mh[1])) });
      }
      const mhr = /^\/api\/tracks\/([^/]+)\/history\/(\d+)$/.exec(u);
      if (mhr && req.method === 'GET') {
        const snap = await store.revision(decodeURIComponent(mhr[1]), Number(mhr[2]));
        return snap ? json(res, 200, snap) : json(res, 404, { error: 'not found' });
      }
      const mres = /^\/api\/tracks\/([^/]+)\/history\/(\d+)\/restore$/.exec(u);
      if (mres && req.method === 'POST') {
        const id = decodeURIComponent(mres[1]);
        const cur = await store.get(id);
        if (!cur) return json(res, 404, { error: 'not found' });
        const snap = await store.revision(id, Number(mres[2]));
        if (!snap) return json(res, 404, { error: 'revision not found' });
        /* restoring IS an in-place edit: the lock applies (worklog 0023);
         * the snapshot's lock rides along to the restored head */
        const rb = JSON.parse(await readBody(req) || '{}');
        const tripped = parseTrip(typeof rb.trip === 'string' ? rb.trip : null);
        if (cur.author_trip && cur.author_trip !== (tripped.phrase ? tripHash(tripped.phrase) : null)) wrongTrip();
        if (shouldArchive(cur.updated_at)) await store.archive(id, cur);
        const t = normalize({ id, name: snap.name, author: snap.author, data: snap.data });
        /* snapshot lineage is server-stored data — restore carries it home */
        t.parent_id = snap.parent_id ?? null;
        t.root_id = snap.root_id ?? null;
        t.parent_name = typeof snap.parent_name === 'string' ? snap.parent_name.slice(0, 200) : null;
        t.author_trip = snap.author_trip ?? null;
        return json(res, 200, await store.upsert(t));
      }
      /* star: anonymous one-tap rating; the client de-dupes per browser */
      const ms = /^\/api\/tracks\/([^/]+)\/star$/.exec(u);
      if (ms && req.method === 'POST') {
        if (!ID_RE.test(decodeURIComponent(ms[1]))) bad('bad id');
        const stars = await store.star(decodeURIComponent(ms[1]));
        if (stars === null) return json(res, 404, { error: 'not found' });
        return json(res, 200, { id: decodeURIComponent(ms[1]), stars });
      }
      /* un-star: takes back this browser's star (floor at 0) */
      if (ms && req.method === 'DELETE') {
        if (!ID_RE.test(decodeURIComponent(ms[1]))) bad('bad id');
        const stars = await store.unstar(decodeURIComponent(ms[1]));
        if (stars === null) return json(res, 404, { error: 'not found' });
        return json(res, 200, { id: decodeURIComponent(ms[1]), stars });
      }
      if (m && req.method === 'DELETE') {
        const ok = await store.remove(decodeURIComponent(m[1]));
        if (ok) { res.writeHead(204); return res.end(); }
        return json(res, 404, { error: 'not found' });
      }
      return json(res, 404, { error: 'no such route' });
    } catch (e) {
      if (e instanceof ValidationError) return json(res, 400, { error: e.message });
      if (e instanceof LockError) return json(res, 403, { error: e.message });
      if (e instanceof URIError) return json(res, 400, { error: 'bad encoding' });
      if (typeof e.message === 'string' && e.message.includes('too large')) return json(res, 413, { error: e.message });
      if (e instanceof SyntaxError) return json(res, 400, { error: 'invalid JSON body' });
      console.error('api error:', e.message);
      return json(res, 500, { error: 'internal' });
    }
  });
  server.on('clientError', (_, s) => s.end('HTTP/1.1 400 bad request\r\n\r\n'));
  server.listen(PORT, '0.0.0.0');

  sweepValidation(store);
  const sweepTimer = setInterval(() => sweepValidation(store), 6 * 3600 * 1000);
  sweepTimer.unref();

  const shutdown = async () => { clearInterval(sweepTimer); await store.close(); process.exit(0); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  process.on('uncaughtException', (e) => console.error('uncaught:', e.message));
}

main().catch((e) => { console.error('fatal:', e.message); process.exit(1); });
