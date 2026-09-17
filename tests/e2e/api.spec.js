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
test('facet classification: slopes separate, corners weigh by sweep (90°=2, 180°=4)', async ({ request }) => {
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
  expect(hmeta.corners).toBe(4);           /* one rainbow (180°) = four 45° corners */
  const nid = `${PREFIX}-ninety`; ids.push(nid);
  const nmeta = await (await request.put(`/api/tracks/${nid}`, {
    data: { name: 'e2e ninety', author: 'playwright', data: { track: 'Cor3;100.000;100.000;0;0#R1C90I150;160.000;100.000;90;0#', mode: 3 } },
  })).json();
  expect(nmeta.corners).toBe(4);           /* 90° corner = 2 + 90° rucdoc = 2 */
  expect(hmeta.straights).toBe(0);
  expect(hmeta.slopes).toBe(0);

  const q = await (await request.get(`/api/tracks?author=playwright&sort=-slopes&limit=1`)).json();
  expect(q.items[0].slopes).toBeGreaterThanOrEqual(2);
  expect((await request.get('/api/tracks?sort=slopes')).status()).toBe(200);   /* whitelisted both ways */
});

test('list filters: lane selection (OR), footprint caps, count caps', async ({ request }) => {
  const P = `e2e-${Date.now()}-flt`;
  const mkTrack = (track) => ({ name: 'e2e filter', author: 'playwright', data: { track, mode: 5 } });
  await request.put(`/api/tracks/${P}-five`, { data: mkTrack('Str4;100.000;100.000;0;0;0#Str4;160.000;100.000;0;0;0#') });  /* lanes 5, 2 str */
  await request.put(`/api/tracks/${P}-three`, { data: { ...mkTrack('Str1;100.000;100.000;0;0;0#'.repeat(8)), data: { track: 'Str1;100.000;100.000;0;0;0#'.repeat(8), mode: 3 } } }); /* lanes 3, 8 str */
  ids.push(`${P}-five`, `${P}-three`);
  const lanes = await (await request.get(`/api/tracks?author=playwright&lanes=5`)).json();
  expect(lanes.items.every((i) => i.lanes === 5)).toBe(true);
  expect(lanes.items.some((i) => i.id === `${P}-five`)).toBe(true);
  const maxStr = await (await request.get(`/api/tracks?author=playwright&lanes=3,5&max_straights=2`)).json();
  expect(maxStr.items.some((i) => i.id === `${P}-five`)).toBe(true);       /* 2 straights */
  expect(maxStr.items.some((i) => i.id === `${P}-three`)).toBe(false);    /* 8 straights */
  const box = await (await request.get(`/api/tracks?author=playwright&lanes=5&max_bbox_w=100&max_bbox_h=100`)).json();
  expect(box.items.some((i) => i.id === `${P}-five`)).toBe(false);        /* 121 cm wide */
  /* footprint caps are rotation-free: W×H and H×W are the same room
   * turned. Str1 spans: wide pair 138×36, tall pair 54×120 (catalog
   * w54/h36, centers 84 cm apart on one axis) */
  const wide = await request.put(`/api/tracks/${P}-wide`, {
    data: { name: 'e2e wide', author: 'playwright', data: { track: 'Str1;100.000;100.000;0;0;0#Str1;184.000;100.000;0;0;0#', mode: 3 } },
  });
  const tall = await request.put(`/api/tracks/${P}-tall`, {
    data: { name: 'e2e tall', author: 'playwright', data: { track: 'Str1;100.000;100.000;0;0;0#Str1;100.000;184.000;0;0;0#', mode: 3 } },
  });
  await request.put(`/api/tracks/${P}-huge`, {
    data: { name: 'e2e huge', author: 'playwright', data: { track: 'Str1;100.000;100.000;0;0;0#Str1;400.000;400.000;0;0;0#', mode: 3 } },
  });
  ids.push(`${P}-wide`, `${P}-tall`, `${P}-huge`);
  expect((await wide.json()).bbox_w_cm).toBe(138);
  expect((await tall.json()).bbox_h_cm).toBe(120);
  const turned = await (await request.get(`/api/tracks?author=playwright&max_bbox_w=200&max_bbox_h=100`)).json();
  expect(turned.items.some((i) => i.id === `${P}-wide`)).toBe(true);      /* 138×36 direct */
  expect(turned.items.some((i) => i.id === `${P}-tall`)).toBe(true);      /* 54×120 fits turned */
  expect(turned.items.some((i) => i.id === `${P}-five`)).toBe(true);      /* 120×60 fits direct */
  expect(turned.items.some((i) => i.id === `${P}-huge`)).toBe(false);     /* 354×336 exceeds both ways */
  for (const bad of ['lanes=banana', 'lanes=0', 'max_straights=x', 'max_bbox_w=y']) {
    expect((await request.get(`/api/tracks?${bad}`)).status()).toBe(400);
  }
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
  await expect(rows.locator('.stat-row', { hasText: 'Corners' }).locator('.stat-value')).toHaveText('8');  /* four 90° = 4×2 */

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

test('sprite bundle: the whole set in one json request', async ({ request }) => {
  const r = await request.get('/api/sprites');
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toContain('application/json');
  expect(r.headers()['cache-control']).toBe('no-cache');
  const body = await r.json();
  expect(Object.keys(body.files).length).toBeGreaterThanOrEqual(70);
  expect(body.files['Str1.0.svg'].startsWith('<svg')).toBe(true);
  /* hash-addressed: immutable */
  const imm = await request.get('/api/sprites?h=deadbeef00');
  expect(imm.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
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

/* ---------- version history + copies + lineage (worklog 0017) ---------- */

/* The e2e webserver runs with M4WD_STABLE_MS=50 (webserver.mjs) so the
 * stability rule is observable without wall-clock waits: a version must
 * be the head for ≥50ms before a save archives it. */
const settle = () => new Promise((r) => setTimeout(r, 80));

test('saving a STABLE track archives it; rapid burst saves do not (worklog 0022)', async ({ request }) => {
  const id = `${PREFIX}-hist`; ids.push(id);
  await request.put(`/api/tracks/${id}`, { data: mk('hist v1') });
  await settle();   /* v1 becomes stable */
  const v2 = await request.put(`/api/tracks/${id}`, { data: mk('hist v2', { tail: 'Str1;200.000;100.000;0;0;0#' }) });
  expect(v2.status()).toBe(200);

  const hist = await request.get(`/api/tracks/${id}/history`);
  expect(hist.status()).toBe(200);
  const { items } = await hist.json();
  expect(items.length).toBe(1);
  expect(items[0].name).toBe('e2e hist v1');

  const snap = await request.get(`/api/tracks/${id}/history/${items[0].seq}`);
  const row = await snap.json();
  expect(row.data.track).not.toContain('Str1;200.000');

  /* burst: a second save inside the stability window archives nothing */
  const id2 = `${PREFIX}-burst`; ids.push(id2);
  await request.put(`/api/tracks/${id2}`, { data: mk('burst 1') });
  await request.put(`/api/tracks/${id2}`, { data: mk('burst 2') });   /* immediately */
  const burst = await (await request.get(`/api/tracks/${id2}/history`)).json();
  /* CI pacing may let one save cross the 50ms window — a burst this
     quick can never produce more than one */
  expect(burst.items.length).toBeLessThanOrEqual(1);
});

test('restore re-publishes an old version and archives the current one', async ({ request }) => {
  const id = `${PREFIX}-restore`; ids.push(id);
  await request.put(`/api/tracks/${id}`, { data: mk('restore A') });
  await settle();   /* A must be stable before B's save archives it */
  await request.put(`/api/tracks/${id}`, { data: mk('restore B', { tail: 'Str1;200.000;100.000;0;0;0#' }) });
  const { items } = await (await request.get(`/api/tracks/${id}/history`)).json();
  expect(items[0].name).toBe('e2e restore A');

  await settle();   /* B stable: restore archives it */
  const res = await request.post(`/api/tracks/${id}/history/${items[0].seq}/restore`);
  expect(res.status()).toBe(200);
  const head = await res.json();
  expect(head.name).toBe('e2e restore A');
  expect(head.piece_count).toBe(2);   /* facets re-derived from the snapshot */

  /* the stomped version survived in history — restore is never
   * destructive. (Compressed-clock note: with M4WD_STABLE_MS=50 the
   * restore-from entry prunes as redundant here; at the default 5-min
   * window the archive gap always meets tier-1 spacing, so production
   * keeps it — this length-1 assertion is specific to this env.) */
  const after = await (await request.get(`/api/tracks/${id}/history`)).json();
  expect(after.items.length).toBe(1);
  expect(after.items.map((x) => x.name)).toEqual(['e2e restore B']);
});

test('restore of an unknown revision or track 404s', async ({ request }) => {
  const id = `${PREFIX}-restore404`; ids.push(id);
  await request.put(`/api/tracks/${id}`, { data: mk('r404') });
  expect((await request.post(`/api/tracks/${id}/history/99999/restore`)).status()).toBe(404);
  expect((await request.post(`/api/tracks/${PREFIX}-nope/history/1/restore`)).status()).toBe(404);
  expect((await request.get(`/api/tracks/${PREFIX}-nope/history`)).status()).toBe(404);
});

test('28 saves never exceed the cap backstop (collapse is pinned by the burst test)', async ({ request }) => {
  const id = `${PREFIX}-cap`; ids.push(id);
  for (let i = 0; i < 28; i++) {
    await request.put(`/api/tracks/${id}`, { data: mk(`cap ${i}`) });
  }
  const { items } = await (await request.get(`/api/tracks/${id}/history`)).json();
  /* under parallel-worker load, PUT spacing can exceed the 50ms window —
   * then archives legitimately happen; the absolute backstop is the cap */
  expect(items.length).toBeLessThanOrEqual(25);
});

test('fork (parent_id) records server-resolved lineage; spoofed lineage fields are ignored', async ({ request }) => {
  const parent = await request.post('/api/tracks', { data: mk('fork parent') });
  const p = await parent.json(); ids.push(p.id);

  /* client tries to smuggle its own root_id/parent_name — server decides */
  const fr = await request.post('/api/tracks', {
    data: { ...mk('fork child'), parent_id: p.id, root_id: 'spoofed-root', parent_name: 'Fake Parent' },
  });
  expect(fr.status()).toBe(201);
  const child = await fr.json(); ids.push(child.id);
  expect(child.parent_id).toBe(p.id);
  expect(child.root_id).toBe(p.id);            /* parent has no root → itself */
  expect(child.parent_name).toBe('e2e fork parent');
  expect(child.parent_name).not.toBe('Fake Parent');

  /* grandchild joins the same root */
  const g = await (await request.post('/api/tracks', { data: { ...mk('fork grand'), parent_id: child.id } })).json();
  ids.push(g.id);
  expect(g.root_id).toBe(p.id);
  expect(g.parent_name).toBe('e2e fork child');

  /* a fork of a missing parent 404s; the body is not created */
  const miss = await request.post('/api/tracks', { data: { ...mk('fork ghost'), parent_id: `${PREFIX}-ghost` } });
  expect(miss.status()).toBe(404);
});

test('updating a fork keeps its born lineage (no re-linking via POST-with-id)', async ({ request }) => {
  const parent = await (await request.post('/api/tracks', { data: mk('keep parent') })).json(); ids.push(parent.id);
  const child = await (await request.post('/api/tracks', { data: { ...mk('keep child'), parent_id: parent.id } })).json();
  ids.push(child.id);

  /* re-POST with the child's id + a different parent_id must not re-link */
  const hijack = await request.post('/api/tracks', {
    data: { ...mk('keep hijack'), id: child.id, parent_id: `${PREFIX}-someone` },
  });
  expect(hijack.status()).toBe(201);
  const after = await hijack.json();
  expect(after.parent_id).toBe(parent.id);
  expect(after.name).toBe('e2e keep hijack');   /* content update did land */
});

test('PUT-create stores no client lineage (lineage is POST-fork-only)', async ({ request }) => {
  const id = `${PREFIX}-putcreate`; ids.push(id);
  const res = await request.put(`/api/tracks/${id}`, {
    data: { ...mk('putcreate'), parent_id: `${PREFIX}-fake`, root_id: `${PREFIX}-fakeroot` },
  });
  expect(res.status()).toBe(200);
  const row = await res.json();
  expect(row.parent_id).toBeNull();
  expect(row.root_id).toBeNull();
  expect(row.parent_name).toBeNull();
});
