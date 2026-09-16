import { test, expect } from '@playwright/test';

/* Track storage API contract (server.js). Tests own their rows: unique
 * id namespace + afterAll cleanup — safe against a shared live server. */

const PREFIX = `e2e-${Date.now()}`;
const ids = [];
const mk = (n, extra = {}) => ({
  name: `e2e ${n}`,
  author: 'playwright',
  data: { track: `Str1;100.000;100.000;0;0;0#Cor1;130.000;100.000;45;1;0#`.repeat(1) + (extra.tail || ''), mode: 3 },
});

test.afterAll(async ({ request }) => {
  for (const id of ids) {
    await request.delete(`/api/tracks/${id}`).catch(() => {});
  }
});

test('health reports a driver', async ({ request }) => {
  const r = await request.get('/api/health');
  expect(r.status()).toBe(200);
  const body = await r.json();
  expect(body.ok).toBe(true);
  expect(['memory', 'sqlite', 'postgres']).toContain(body.driver);
});

test('PUT upserts with derived facets; GET returns the document', async ({ request }) => {
  const id = `${PREFIX}-roundtrip`; ids.push(id);
  const put = await request.put(`/api/tracks/${id}`, { data: mk('roundtrip') });
  expect(put.status()).toBe(200);
  const meta = await put.json();
  expect(meta.piece_count).toBe(2);
  expect(meta.author).toBe('playwright');
  expect(meta.bbox_w_cm).toBeGreaterThan(0);

  const got = await request.get(`/api/tracks/${id}`);
  expect(got.status()).toBe(200);
  const row = await got.json();
  expect(row.data.track).toContain('Str1;100.000');

  /* update: piece count changes, created_at survives */
  const bigger = mk('roundtrip', { tail: 'Str1;200.000;100.000;0;0;0#' });
  const put2 = await request.put(`/api/tracks/${id}`, { data: bigger });
  const meta2 = await put2.json();
  expect(meta2.piece_count).toBe(3);
  expect(meta2.created_at).toBe(meta.created_at);
});

test('POST creates with a server id when none given', async ({ request }) => {
  const r = await request.post('/api/tracks', { data: mk('post') });
  expect(r.status()).toBe(201);
  const meta = await r.json();
  expect(meta.id).toBeTruthy();
  ids.push(meta.id);
});

test('list filters, sorts, and paginates', async ({ request }) => {
  for (let i = 0; i < 3; i++) {
    const id = `${PREFIX}-list${i}`; ids.push(id);
    const r = await request.put(`/api/tracks/${id}`, { data: mk(`list${i}`) });
    expect(r.status()).toBe(200);
  }
  const q = await request.get(`/api/tracks?author=playwright&sort=-updated_at&limit=2`);
  expect(q.status()).toBe(200);
  const page = await q.json();
  expect(page.items.length).toBeLessThanOrEqual(2);
  expect(page.total).toBeGreaterThanOrEqual(3);
  expect(page.items.every(i => i.author === 'playwright')).toBe(true);
  /* no data bodies in list responses — metadata only */
  expect(page.items.every(i => i.data === undefined)).toBe(true);
});

test('validation rejects garbage without crashing the server', async ({ request }) => {
  const bad = [
    ['/api/tracks/has space!', mk('bad id'), 'put'],
    [`/api/tracks/${PREFIX}-ok`, { name: 42, data: mk('ok').data }, 'put'],
    [`/api/tracks/${PREFIX}-ok`, { data: { track: 7 } }, 'put'],
    [`/api/tracks/${PREFIX}-ok`, { data: { track: 'x'.repeat(600 * 1024) } }, 'put'],
    ['/api/tracks?min_pieces=banana', null, 'get'],
  ];
  for (const [url, body, method] of bad) {
    const r = method === 'get'
      ? await request.get(url)
      : await request.put(url, body ? { data: body } : undefined);
    expect([400, 413]).toContain(r.status());
  }
  const inj = await request.put(`/api/tracks/${PREFIX}-inj`, { data: mk(`inj'; DROP TABLE tracks;--`) });
  expect(inj.status()).toBe(200);
  ids.push(`${PREFIX}-inj`);
  const alive = await request.get('/api/health');
  expect(alive.status()).toBe(200);
});

/* Owner rulings 2026-09-16: slopes count SEPARATELY from straights (not
 * interchangeable); hairpins/rainbows count as 4 corners (a 180° is
 * four 45° pieces' worth). */
test('facet classification: slopes separate, hairpins are 4 corners, both sortable', async ({ request }) => {
  const id = `${PREFIX}-slope`; ids.push(id);
  const track = 'Bri1;100.000;100.000;0;0;0#Bri1;160.000;100.000;0;0;0#Str1;220.000;100.000;0;0;0#';
  const meta = await (await request.put(`/api/tracks/${id}`, { data: { name: 'e2e slopes', author: 'playwright', data: { track, mode: 3 } } })).json();
  expect(meta.slopes).toBe(2);
  expect(meta.straights).toBe(1);          /* the slopes are NOT straights */
  expect(meta.corners).toBe(0);

  const hid = `${PREFIX}-hairpin`; ids.push(hid);
  const hmeta = await (await request.put(`/api/tracks/${hid}`, {
    data: { name: 'e2e hairpin', author: 'playwright', data: { track: 'Lan2;200.000;200.000;0;0#', mode: 3 } },
  })).json();
  expect(hmeta.corners).toBe(4);           /* one rainbow = four 45° corners */
  expect(hmeta.straights).toBe(0);
  expect(hmeta.slopes).toBe(0);

  const q = await (await request.get(`/api/tracks?author=playwright&sort=-slopes&limit=1`)).json();
  expect(q.items[0].slopes).toBeGreaterThanOrEqual(2);
  expect((await request.get('/api/tracks?sort=slopes')).status()).toBe(200);   /* whitelisted both ways */
});

test('star/unstar endpoint: increments, takes back, floored at 0', async ({ request }) => {
  const id = `${PREFIX}-star`; ids.push(id);
  await request.put(`/api/tracks/${id}`, { data: mk('star') });
  expect((await (await request.post(`/api/tracks/${id}/star`)).json()).stars).toBe(1);
  expect((await (await request.delete(`/api/tracks/${id}/star`)).json()).stars).toBe(0);
  expect((await (await request.delete(`/api/tracks/${id}/star`)).json()).stars).toBe(0);   /* floor */
  expect((await request.post(`/api/tracks/nope/star`)).status()).toBe(404);
  expect((await request.delete(`/api/tracks/nope/star`)).status()).toBe(404);
});

test('DELETE removes; unknown ids 404', async ({ request }) => {
  const id = `${PREFIX}-gone`; ids.push(id);
  await request.put(`/api/tracks/${id}`, { data: mk('gone') });
  const del = await request.delete(`/api/tracks/${id}`);
  expect(del.status()).toBe(204);
  expect((await request.get(`/api/tracks/${id}`)).status()).toBe(404);
  expect((await request.delete(`/api/tracks/${id}`)).status()).toBe(404);
});

/* Track metadata popup (owner model: phones hide the name in the stats
 * bar — everything lives one tap away). Server fields come from the
 * bound row; local facets classify like the server's stamping. */
const SQUARE_CODEC = 'R1C90I150;0.000;0.000;0.000;0;0#R1C90I150;0.000;-21.500;90.000;0;0#'
                   + 'R1C90I150;21.500;-21.500;180.000;0;0#R1C90I150;21.500;0.000;270.000;0;0#';

test('stats popup shows local facets + the server row (dates, stars, validity)', async ({ page, request }) => {
  const id = `e2e-${Date.now()}-meta`; ids.push(id);
  await request.put(`/api/tracks/${id}`, {
    data: { name: 'E2E Metadata Track', author: 'playwright', data: { track: SQUARE_CODEC, mode: 3 } },
  });
  await request.post(`/api/tracks/${id}/star`);
  await request.post(`/api/tracks/${id}/star`);
  const first = await (await request.get(`/api/tracks/${id}`)).json();

  /* addInitScript (pre-boot storage, no prior empty load racing its
   * debounced autosave write over the key) */
  await page.addInitScript(([id, track]) => {
    localStorage.setItem('m4wd.published', JSON.stringify({ id, name: 'E2E Metadata Track' }));
    localStorage.setItem('m4wd.autosave', JSON.stringify({ mode: 3, tool: 'Pan', angle: 0, track }));
  }, [id, SQUARE_CODEC]);
  await page.goto('/');

  await page.locator('#stats').click();
  await expect(page.locator('#statsDialog')).toBeVisible();
  await expect(page.locator('#statsTitle')).toHaveText('E2E Metadata Track');
  const rows = page.locator('#statsRows');
  await expect(rows).toContainText('1.36 m');            /* 4 × R1C90I150 */
  await expect(rows.locator('.stat-row', { hasText: 'Pieces' }).locator('.stat-value')).toHaveText('4');
  await expect(rows.locator('.stat-row', { hasText: 'Straights' }).locator('.stat-value')).toHaveText('0');
  await expect(rows.locator('.stat-row', { hasText: 'Corners' }).locator('.stat-value')).toHaveText('4');

  /* the (?) affordances carry the classification notes in a
   * position-aware tooltip — never inline, never off-screen */
  const strTip = rows.locator('.stat-row', { hasText: 'Straights' }).locator('.tip-btn');
  await strTip.click();
  const bubble = page.locator('.tip-bubble');
  await expect(bubble).toBeVisible();
  await expect(bubble).toContainText('Waves count as straights');
  const box = await bubble.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height);
  await strTip.click();                                  /* tap toggles off */
  await expect(bubble).toHaveCount(0);
  /* the bubble mounts INSIDE the open dialog (top layer) */
  await page.locator('.stat-row', { hasText: 'Lanes' }).locator('.tip-btn').click();
  await expect(bubble).toBeVisible();
  await expect(bubble).toContainText('widest piece');
  await expect(bubble.locator('xpath=ancestor::dialog')).toHaveId('statsDialog');
  /* server fields land asynchronously */
  await expect(rows).toContainText('\u2605 2');
  await expect(rows).toContainText('\u2713 complete');
  const published = await rows.locator('.stat-row', { hasText: 'Published' }).locator('.stat-value').textContent();
  expect(new Date(published).getTime()).toBeGreaterThan(Date.now() - 3600_000);
  /* not exact-equality against a fresh GET: the page is bound, so its
   * autosave mirror may re-save (bumping updated_at) after the popup
   * fetched — assert the popup parsed a real, recent timestamp instead */
  const modified = await rows.locator('.stat-row', { hasText: 'Last modified' }).locator('.stat-value').textContent();
  expect(new Date(modified).getTime()).toBeGreaterThan(Date.now() - 3600_000);
  expect(first.stars).toBe(2);
  await page.locator('#statsOk').click();
  await expect(page.locator('#statsDialog')).not.toBeVisible();
});

test('unpublished track popup says local-only and hides rename', async ({ page }) => {
  await page.goto('/');
  await page.locator('#stats').click();
  await expect(page.locator('#statsDialog')).toBeVisible();
  await expect(page.locator('#statsRows')).toContainText('Not published');
  await expect(page.locator('#statsRename')).toBeHidden();
  await page.locator('#statsClose').click();
});

/* Owner model (worklogs 0012/0013): unpublished tracks are local-only; the
 * toolbar Publish is gated by the track validator; publishing binds the row
 * and from then on the button becomes Save and edits auto-save. */
const SQUARE_B64 = 'UjFDOTBJMTUwOzAuMDAwOzAuMDAwOzAuMDAwOzA7MCNSMUM5MEkxNTA7MC4wMDA7LTIxLjUwMDs5MC4wMDA7MDswI1IxQzkwSTE1MDsyMS41MDA7LTIxLjUwMDsxODAuMDAwOzA7MCNSMUM5MEkxNTA7MjEuNTAwOzAuMDAwOzI3MC4wMDA7MDswIw';

/* Owner model (worklogs 0012/0013/0015): completeness is a facet, not a
 * gate — incomplete tracks publish as Work-in-Progress with a warning;
 * the published button becomes a live validity badge. */
test('an incomplete track publishes as Work-in-Progress; the button badges validity', async ({ page, request }) => {
  await page.goto('/');
  await page.locator('.chip').first().click();   /* Str1 — two dangling ends */
  await page.click('canvas', { position: { x: 200, y: 200 } });
  await expect.poll(async () => await page.evaluate(() =>
    window.__m4wd.state.sprites.length), { timeout: 10_000 }).toBe(1);

  await page.locator('#btnPublishBar').click();
  await expect(page.locator('#pubStatus')).toContainText('Dangling end');
  await expect(page.locator('#pubStatus')).toContainText('Work-in-Progress');   /* warn, not lock */
  expect(await page.locator('#pubOk').isDisabled()).toBe(false);
  await expect(page.locator('#pubTipComplete')).toBeVisible();      /* suggest the Complete tool */
  await page.locator('#pubTipComplete').click();   /* tip arms Complete */
  expect(await page.evaluate(() => window.__m4wd.state.tool)).toBe('Complete');
  await page.keyboard.press('Escape');   /* dismiss the intro dialog */
});

test('a complete track publishes from the toolbar; the button becomes Save', async ({ page, request }) => {
  const apiCalls = [];
  page.on('request', (r) => { if (r.url().includes('/api/tracks')) apiCalls.push(r.method()); });

  await page.goto(`/#t=${SQUARE_B64}`);       /* exact closed square */
  await expect.poll(async () => await page.evaluate(() =>
    window.__m4wd.state.sprites.length), { timeout: 10_000 }).toBe(4);

  await page.locator('#btnPublishBar').click();
  await expect(page.locator('#pubStatus')).toContainText('complete and consistent');
  await page.locator('#pubName').fill('E2E Square Circuit');
  await page.locator('#pubOk').click();
  await expect.poll(async () => await page.evaluate(() =>
    localStorage.getItem('m4wd.published')), { timeout: 10_000 }).toBeTruthy();
  /* the badge must show content-save-check specifically — cloud-upload forever would be the regression */
  await expect(page.locator('#btnPublishBar svg path')).toHaveAttribute('d', /^M17 3H5C3\.9 3 3 3\.9/);

  const id = (await page.evaluate(() => JSON.parse(localStorage.getItem('m4wd.published')).id));
  ids.push(id);
  const row = await (await request.get(`/api/tracks/${id}`)).json();
  expect(row.name).toBe('E2E Square Circuit');
  expect(row.piece_count).toBe(4);
  /* a fast publish can beat the boot autosave's debounce: the mirror PUT
   * of the identical snapshot may land after the POST — quiesce, then
   * assert shape (POST first, no DELETE) rather than strict equality */
  await page.waitForTimeout(350 + 1500 + 500);
  expect(apiCalls[0]).toBe('POST');
  expect(apiCalls.includes('DELETE')).toBe(false);
});

test('library lists published tracks and loads one onto a fresh browser', async ({ page, browser, request }) => {
  /* publish a complete track from the primary context */
  await page.goto(`/#t=${SQUARE_B64}`);
  await expect.poll(async () => await page.evaluate(() =>
    window.__m4wd.state.sprites.length), { timeout: 10_000 }).toBe(4);
  await page.locator('#btnPublishBar').click();
  await page.locator('#pubName').fill('E2E Library Track');
  await page.locator('#pubOk').click();
  await expect.poll(async () => await page.evaluate(() =>
    localStorage.getItem('m4wd.published')), { timeout: 10_000 }).toBeTruthy();
  const id = (await page.evaluate(() => JSON.parse(localStorage.getItem('m4wd.published')).id));
  ids.push(id);

  /* a FRESH browser (empty localStorage) sees it in the library and loads it */
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await p2.goto('/');
  await p2.locator('#btnMenu').click();
  await p2.locator('#btnLibrary').click();
  await p2.locator('.lib-row', { hasText: 'E2E Library Track' }).click();
  await expect.poll(async () => await p2.evaluate(() =>
    window.__m4wd.state.sprites.length), { timeout: 10_000 }).toBe(4);
  expect(await p2.evaluate(() => JSON.parse(localStorage.getItem('m4wd.published')).name))
    .toBe('E2E Library Track');
  await ctx.close();
});

test('sprite endpoint serves verified bytes proxy-safely (json transport)', async ({ request }) => {
  const manifest = await (await request.get('/assets/manifest.json')).json();
  const name = 'Str1.0.svg';
  const r = await request.get(`/api/sprites/${name}?h=${manifest[name]}`);
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toContain('application/json');
  expect(r.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  const body = await r.json();
  expect(typeof body.svg).toBe('string');
  expect(body.svg.startsWith('<svg')).toBe(true);
  /* hash-true: identical bytes to the manifest */
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.svg));
  expect(Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')).toBe(manifest[name]);
  /* unversioned: revalidating, not immutable */
  const plain = await request.get(`/api/sprites/${name}`);
  expect(plain.headers()['cache-control']).toBe('no-cache');
  /* traversal + missing are refused */
  expect((await request.get('/api/sprites/..%2F..%2Fserver.js')).status()).toBe(404);
  expect((await request.get('/api/sprites/Nope.0.svg')).status()).toBe(404);
});

/* WIP publishing end-to-end: incomplete publishes (complete=0), the badge
 * shows the red ring, tapping reports the verdict, and the stats-bar name
 * renames in place (same row id). */
test('WIP publishes; badge flags issues; stats-bar rename keeps the row', async ({ page, request }) => {
  await page.goto('/');
  await page.locator('.chip').first().click();   /* one lone straight: WIP */
  await page.click('canvas', { position: { x: 200, y: 200 } });
  await expect.poll(async () => await page.evaluate(() =>
    window.__m4wd.state.sprites.length), { timeout: 10_000 }).toBe(1);

  await page.locator('#btnPublishBar').click();
  await expect(page.locator('#pubStatus')).toContainText('Work-in-Progress');
  await page.locator('#pubName').fill('E2E WIP Track');
  await page.locator('#pubOk').click();
  await expect.poll(async () => await page.evaluate(() =>
    localStorage.getItem('m4wd.published')), { timeout: 10_000 }).toBeTruthy();
  const id = (await page.evaluate(() => JSON.parse(localStorage.getItem('m4wd.published')).id));
  ids.push(id);
  const row = await (await request.get(`/api/tracks/${id}`)).json();
  expect(row.complete).toBe(false);          /* the facet, not a gate */
  expect(row.issues).toBeGreaterThan(0);

  /* badge: save-check icon with the red ring (debounced 600ms after the last edit) */
  /* the badge must show content-save-check specifically — cloud-upload forever would be the regression */
  await expect(page.locator('#btnPublishBar svg path')).toHaveAttribute('d', /^M17 3H5C3\.9 3 3 3\.9/);
  await expect.poll(async () => page.evaluate(() =>
    document.getElementById('btnPublishBar').classList.contains('pub-bad')),
    { timeout: 5_000 }).toBe(true);
  /* status tap reports the verdict (no dialog opens) */
  await page.locator('#btnPublishBar').click();
  await expect(page.locator('#toast')).toContainText('WIP');
  await expect(page.locator('#publishDialog')).not.toBeVisible();

  /* rename via the stats popup: same row id, new name */
  await page.locator('#stats').click();
  await expect(page.locator('#statsDialog')).toBeVisible();
  await page.locator('#statsRename').click();
  await expect(page.locator('#pubOk')).toHaveText('Save name');
  await expect(page.locator('#pubStatus')).toContainText('saved as Work-in-Progress');
  await page.locator('#pubName').fill('E2E WIP Renamed');
  await page.locator('#pubOk').click();
  await expect.poll(async () => (await (await request.get(`/api/tracks/${id}`)).json()).name,
    { timeout: 10_000 }).toBe('E2E WIP Renamed');
});
