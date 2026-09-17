import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import stream from 'node:stream';
import { once } from 'node:events';
import { createStaticHandler, isServable } from '../../lib/static.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const handler = createStaticHandler(ROOT);

/* Minimal mock res: a Writable the file stream can pipe into, with
 * writeHead captured. finish fires on end() — 200 and 304 alike. */
function mockRes() {
  const out = { status: 0, headers: null, chunks: [] };
  out.res = new stream.Writable({ write(c, _enc, cb) { out.chunks.push(c); cb(); } });
  out.res.writeHead = (status, headers) => {
    out.status = status;
    out.headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  };
  return out;
}

async function get(urlPath, headers = {}) {
  const r = mockRes();
  const handled = handler({ url: urlPath, headers }, r.res);
  if (handled) await once(r.res, 'finish');
  return { handled, ...r };
}

test('isServable: exactly the shipped app surface', () => {
  for (const p of ['/', '/index.html', '/style.css', '/src/main.js', '/src/',
                   '/assets/Str1.0.svg', '/assets/manifest.json'])
    assert.equal(isServable(p), true, p);
  /* the live-probed disclosures (issue #62) plus the rest of the repo */
  for (const p of ['/data/tracks.db', '/data/trip.salt', '/.git/HEAD', '/.git/config',
                   '/docker-compose.yml', '/server.js', '/serve.js', '/package.json',
                   '/package-lock.json', '/lib/static.js', '/tools/gen-manifest.js',
                   '/tests/unit/static.test.js', '/README.md', '/node_modules/pg/package.json'])
    assert.equal(isServable(p), false, p);
});

test('isServable: dot-dot segments cannot smuggle a denied path past a prefix', () => {
  for (const p of ['/src/../server.js', '/src/../lib/static.js', '/src/./../data/trip.salt',
                   '/assets/../docker-compose.yml', '/../etc/passwd'])
    assert.equal(isServable(p), false, p);
});

test('non-allowlisted paths are refused before any response is written', async () => {
  for (const p of ['/data/tracks.db', '/data/trip.salt', '/.git/HEAD',
                   '/docker-compose.yml', '/server.js', '/lib/static.js',
                   '/tools/gen-manifest.js', '/package.json']) {
    const r = await get(p);
    assert.equal(r.handled, false, p);   /* caller 404s — like a missing file */
    assert.equal(r.status, 0, p);        /* nothing served, nothing leaked */
  }
});

test('index.html serves with the hardening headers (issue #67)', async () => {
  const r = await get('/');
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
  const csp = r.headers['content-security-policy'];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /style-src 'self' 'unsafe-inline'/);   /* inline style= attrs, ui.js */
  assert.match(csp, /img-src [^;]*blob:/);                 /* sprite object URLs, cache.js */
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(r.headers['access-control-allow-origin'], '*');
});

test('cache tiers are unchanged by the allowlist', async () => {
  assert.equal((await get('/src/main.js?v=84')).headers['cache-control'],
               'public, max-age=31536000, immutable');
  assert.equal((await get('/assets/Str1.0.svg?v=27')).headers['cache-control'],
               'public, max-age=31536000, immutable');
  assert.equal((await get('/assets/Str1.0.svg')).headers['cache-control'],
               'public, max-age=300');
  for (const p of ['/', '/index.html', '/src/main.js', '/style.css', '/style.css?v=8'])
    assert.equal((await get(p)).headers['cache-control'], 'no-cache', p);
});

test('assets/manifest.json stays no-cache when generated', async (t) => {
  if (!fs.existsSync(path.join(ROOT, 'assets/manifest.json'))) return t.skip('manifest not generated in this checkout');
  assert.equal((await get('/assets/manifest.json')).headers['cache-control'], 'no-cache');
});

test('served bytes are the file, byte for byte', async () => {
  const r = await get('/src/main.js');
  assert.equal(r.status, 200);
  assert.deepEqual(Buffer.concat(r.chunks), fs.readFileSync(path.join(ROOT, 'src/main.js')));
});

test('ETag revalidation still returns 304', async () => {
  const etag = (await get('/src/main.js')).headers.etag;
  const r = await get('/src/main.js', { 'if-none-match': etag });
  assert.equal(r.status, 304);
  assert.equal(Buffer.concat(r.chunks).length, 0);
  assert.equal(r.headers.etag, etag);
});

test('gzip still rides compressible types with Vary', async () => {
  const r = await get('/src/main.js', { 'accept-encoding': 'gzip' });
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-encoding'], 'gzip');
  assert.equal(r.headers.vary, 'Accept-Encoding');
  const plain = await get('/src/main.js');
  assert.ok(Buffer.concat(r.chunks).length < Buffer.concat(plain.chunks).length);
});

test('m4wd_hard cookie: still set on hard reload, SameSite=Lax, readable by the client', async () => {
  const r = await get('/', { 'cache-control': 'no-cache' });
  const sc = r.headers['set-cookie'];
  assert.ok(sc && sc.includes('m4wd_hard=1'), 'cookie set');
  assert.ok(sc.includes('SameSite=Lax'), 'SameSite tightened (issue #67)');
  /* NOT HttpOnly: src/cache.js reads and clears it via document.cookie
   * (pinned by tests/e2e/caching.spec.js — the hard-refresh wipe) */
  assert.ok(!sc.includes('HttpOnly'), 'HttpOnly would blind the client wipe');
  const soft = await get('/');
  assert.equal(soft.headers['set-cookie'], undefined);   /* soft reload: no cookie */
});
