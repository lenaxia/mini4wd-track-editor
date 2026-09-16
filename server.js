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
function normalize({ id, name, author, data }) {
  if (id !== undefined && !ID_RE.test(id)) bad('bad id (want [A-Za-z0-9_-]{1,64})');
  if (data == null || typeof data !== 'object' || Array.isArray(data)) bad('data must be an object');
  if (data.track !== undefined && typeof data.track !== 'string') bad('data.track must be a string');
  if (name !== undefined && name !== null && typeof name !== 'string') bad('name must be a string');
  if (author !== undefined && author !== null && typeof author !== 'string') bad('author must be a string');
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
  t._facets = fullFacets(t.data);
  return t;
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
    min_lanes: num(q.min_lanes),
    lanes: lanes && lanes.length ? lanes : undefined,
    max_bbox_w: num(q.max_bbox_w), max_bbox_h: num(q.max_bbox_h),
    max_straights: num(q.max_straights), max_slopes: num(q.max_slopes), max_corners: num(q.max_corners),
    complete: q.complete === 'true' ? true : q.complete === 'false' ? false : undefined,
    sort: typeof q.sort === 'string' && q.sort ? q.sort : '-updated_at',
    limit: Math.max(1, Math.min(100, Math.round(num(q.limit) ?? 50))),
    offset: Math.max(0, Math.round(num(q.offset) ?? 0)),
  };
  for (const v of [out.min_pieces, out.max_pieces, out.min_length, out.min_lanes,
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
        const t = normalize(JSON.parse(await readBody(req) || '{}'));
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
