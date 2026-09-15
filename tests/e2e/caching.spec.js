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
 * (proven proxy-clean — the manifest rides it every boot), verified by hash,
 * rendered as object URLs. Corrupt BOTH /assets svg transports here and the
 * sprite must still render. */
test('sprites render even when every /assets svg response is corrupted', async ({ page }) => {
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
    const a = await import('/src/assets.js');
    const img = a.imageFor('Str1', 0);
    return !!img && !!img.src && img.naturalWidth > 0;
  }), { timeout: 15000 }).toBe(true);
});
