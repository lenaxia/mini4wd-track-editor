import { test, expect } from '@playwright/test';

/* Cache policy contract (serve.js):
 * - assets//src/ ?v=/?h= URLs are immutable for a year (content-addressed
 *   manifest hashes or rule-5 busters); hand-bumped root files are NOT
 * - unversioned /assets/* get a short cache
 * - html and src modules always revalidate (ETag makes it a 304) */

test('versioned assets are immutable for a year', async ({ request }) => {
  const r = await request.get('/assets/Str1.0.svg?v=27');
  expect(r.status()).toBe(200);
  expect(r.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
});

test('unversioned assets get the short cache', async ({ request }) => {
  const r = await request.get('/assets/Str1.0.svg');
  expect(r.status()).toBe(200);
  expect(r.headers()['cache-control']).toBe('public, max-age=300');
});

test('html and src modules always revalidate', async ({ request }) => {
  for (const p of ['/', '/src/main.js', '/style.css']) {
    const r = await request.get(p);
    expect(r.status()).toBe(200);
    expect(r.headers()['cache-control']).toBe('no-cache');
    expect(r.headers()['etag']).toBeTruthy();
  }
  /* hand-bumped ?v= on root files must NOT earn the immutable pin —
   * only content-addressed (?h=) and rule-5-governed paths do */
  const r = await request.get('/style.css?v=8');
  expect(r.headers()['cache-control']).toBe('no-cache');
});

test('ETag revalidation returns 304 with empty body', async ({ request }) => {
  const r1 = await request.get('/src/main.js');
  const etag = r1.headers()['etag'];
  const r2 = await request.get('/src/main.js', { headers: { 'if-none-match': etag } });
  expect(r2.status()).toBe(304);
  expect(await r2.text()).toBe('');
});

/* Manifest mode (production cache): the manifest is the first asset down,
 * always fresh, and the client caches sprites under per-file ?h= keys. */
test('manifest serves no-cache with a hash for every sprite on disk', async ({ request }) => {
  const r = await request.get('/assets/manifest.json');
  expect(r.status()).toBe(200);
  expect(r.headers()['cache-control']).toBe('no-cache');
  const manifest = await r.json();
  const sprites = Object.keys(manifest).filter(k => k.endsWith('.svg'));
  expect(sprites.length).toBeGreaterThanOrEqual(75);
  for (const v of Object.values(manifest)) expect(v).toMatch(/^[0-9a-f]{64}$/);
});

test('booted page populates the cache under per-file hash keys', async ({ page }) => {
  await page.goto('/');
  /* expect.poll + one-shot evaluates: the async-predicate waitForFunction
   * pattern is unreliable under parallel load (see worklog 0009) */
  await expect.poll(async () => await page.evaluate(async () => {
    const keys = await caches.keys();
    if (!keys.length) return false;
    const c = await caches.open(keys[0]);
    const reqs = await c.keys();
    return reqs.length >= 75 && reqs.every(r => /[?&]h=[0-9a-f]{64}/.test(r.url));
  }), { timeout: 15_000 }).toBe(true);
});

test('corrupt cached entries self-heal on the next boot', async ({ page, request }) => {
  await page.goto('/');
  const manifest = await (await request.get('/assets/manifest.json')).json();
  const key = `assets/Str1.0.svg?h=${manifest['Str1.0.svg']}`;
  /* poison one entry with a truncated body */
  await expect.poll(async () => await page.evaluate(async (u) => {
    const keys = await caches.keys();
    if (!keys.length) return false;
    const c = await caches.open(keys[0]);
    await c.put(u, new Response('truncated garbage'));
    return true;
  }, key), { timeout: 15_000 }).toBe(true);
  await page.reload();
  /* the corrupt entry must be replaced by verified bytes (hash-checked on
   * hit: mismatch -> evict + refetch + re-store) */
  await expect.poll(async () => await page.evaluate(async (u) => {
    const keys = await caches.keys();
    const c = await caches.open(keys[0]);
    const hit = await c.match(u);
    return hit ? (await hit.text()).startsWith('<svg') : false;
  }, key), { timeout: 15_000 }).toBe(true);
});

/* Hard refresh wipes the client cache; soft refresh keeps it (owner rule).
 * The hard-reload signature is Cache-Control: no-cache on the document. */
test('hard refresh clears the asset cache; soft refresh keeps it', async ({ page, request }) => {
  await page.goto('/');
  await expect.poll(async () => await page.evaluate(async () => {
    const keys = await caches.keys();
    if (!keys.length) return 0;
    return (await (await caches.open(keys[0])).keys()).length;
  }), { timeout: 15_000 }).toBeGreaterThanOrEqual(75);

  /* soft reload: no no-cache header on the document -> cache untouched */
  await page.reload();
  await expect.poll(async () => await page.evaluate(async () => {
    const keys = await caches.keys();
    return keys.length && (await (await caches.open(keys[0])).keys()).length;
  }), { timeout: 15_000 }).toBeGreaterThanOrEqual(75);

  /* simulate the hard reload: document fetched with no-cache gets the
   * wipe cookie; the next boot empties the cache and boots network-only */
  const hard = await request.get('/', { headers: { 'cache-control': 'no-cache' } });
  expect(hard.headers()['set-cookie']).toContain('m4wd_hard=1');
  await page.context().addCookies([{ name: 'm4wd_hard', value: '1', url: 'http://localhost:3000' }]);
  await page.reload();
  await expect.poll(async () => await page.evaluate(async () => {
    if (!document.cookie.includes('m4wd_hard=1')) return true;   /* cookie consumed */
    return false;
  }), { timeout: 15_000 }).toBe(true);
  await expect.poll(async () => await page.evaluate(async () => {
    const keys = await caches.keys();
    if (!keys.length) return 0;
    return (await (await caches.open(keys[0])).keys()).length;
  }), { timeout: 15_000 }).toBe(0);
  /* and the page still renders sprites (network fallback boot) */
  await expect.poll(async () => await page.evaluate(async () => {
    const a = await import('/src/assets.js');
    const img = a.imageFor('Str1', 0);
    return !!img && !!img.src && img.naturalWidth > 0;
  }), { timeout: 15_000 }).toBe(true);
});

/* The motivating proxy bugs as a regression pin, in the NEW threat model:
 * the preview proxy (a) empties svg-typed fetch() responses and (b) injects
 * ~56 bytes into svg image responses — corrupting every <img> load. Sprites
 * must render anyway: loads go through the json-typed /api/sprites endpoint
 * (proven proxy-clean), verified by hash, rendered as object URLs.
 *
 * NOTE: page.route disables the browser cache, which makes the DOCUMENT
 * request carry cache-control: no-cache — the server tags it m4wd_hard=1
 * and the app (correctly) wipes+boots network-only. So the spec drives the
 * transport directly post-boot instead of fighting the wipe: clear the
 * cookie, init the cache, load through cachedSpriteUrl, and require a
 * rendered blob — while every /assets svg response is corrupted. */
test('sprite transport survives corrupted /assets responses (proxy pin)', async ({ page }) => {
  await page.route('**/assets/*.svg*', (route) => {
    const fetchy = route.request().resourceType() === 'fetch';
    return route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: fetchy ? '' : '<svg xmlns="http://www.w3.org/2000/svg"></svg>injected-garbage-by-proxy',
    });
  });
  await page.goto('/');
  await expect.poll(async () => await page.evaluate(async () => {
    document.cookie = 'm4wd_hard=; Max-Age=0; Path=/';
    const c = await import('/src/cache.js');
    if (!await c.initCache()) return { ok: false, why: 'init' };
    const url = await c.cachedSpriteUrl('Str1.0.svg', 27);
    if (!url.startsWith('blob:')) return { ok: false, why: url.slice(0, 40) };
    /* the returned object URL must decode to the real sprite */
    const img = await new Promise((res) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = () => res(null);
      i.src = url;
    });
    return { ok: !!img && img.naturalWidth > 0 };
  }), { timeout: 15_000 }).toEqual({ ok: true });
});


/* gzip transport (lib/compress.js): compressible text rides gzip when
 * the client asks, identity otherwise; Vary keys caches on the
 * encoding; images never compress. Asserted over RAW http — Playwright
 * auto-decompresses and strips Content-Encoding for some types, so its
 * header view is not the wire truth. */
import http from 'node:http';

const rawGet = (port, pathName, acceptEncoding) => new Promise((resolve, reject) => {
  const req = http.get({ host: '127.0.0.1', port, path: pathName, headers: acceptEncoding ? { 'Accept-Encoding': acceptEncoding } : {} }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks).length }));
  });
  req.on('error', reject);
  req.setTimeout(4000, () => req.destroy(new Error('timeout')));
});

test('gzip: bundle, HTML, JS compress; identity without the header; PNG never; 304 intact', async () => {
  const port = Number(process.env.PW_PORT || 3000);
  const base = { 'Accept-Encoding': 'gzip' };

  for (const p of ['/api/sprites', '/', '/src/main.js', '/style.css']) {
    const r = await rawGet(port, p, 'gzip');
    expect(r.status, p).toBe(200);
    expect(r.headers['content-encoding'], p).toBe('gzip');
    expect(r.headers.vary, p).toContain('Accept-Encoding');
    const identity = await rawGet(port, p, 'identity');
    expect(identity.headers['content-encoding'], p).toBeUndefined();
    expect(r.bytes, `${p} should shrink`).toBeLessThan(identity.bytes);
  }

  const png = await rawGet(port, '/assets/Ban1.0.png', 'gzip');
  expect(png.status).toBe(200);
  expect(png.headers['content-encoding']).toBeUndefined();   /* already entropy-coded */

  const html = await rawGet(port, '/', 'gzip');
  const re = await new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', headers: { 'Accept-Encoding': 'gzip', 'If-None-Match': html.headers.etag } }, resolve);
    req.on('error', reject);
  });
  expect(re.statusCode).toBe(304);                            /* ETag path survives gzip */
});
