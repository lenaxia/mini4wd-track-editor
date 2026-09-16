import { test, expect } from '@playwright/test';

/* Gallery (owner spec): Track menu → 🌍 Gallery browses ALL tracks on the
 * server with facet rows (pieces/length/lanes/footprint/straights/corners/
 * stars/updated + ✓/✖ badge), sorts, a complete-only filter, per-browser
 * star de-dupe, Load more pagination, and the same load-adopts-binding
 * flow as "My published tracks". Tests own their rows: unique per-test
 * id namespace + afterAll cleanup — safe against a shared live server
 * AND against fullyParallel workers re-evaluating this module. */

/* serial: the pagination test floods 26 rows that would push the other
 * tests' fresh rows past the first page under the default -updated_at
 * sort; declaration order keeps the flood last */
test.describe.configure({ mode: 'serial' });

const ids = [];

/* the proven exact-closed square (same codec as api.spec's SQUARE_B64) */
const SQUARE = 'R1C90I150;0.000;0.000;0.000;0;0#R1C90I150;0.000;-21.500;90.000;0;0#'
             + 'R1C90I150;21.500;-21.500;180.000;0;0#R1C90I150;21.500;0.000;270.000;0;0#';
const LONG = Array.from({ length: 40 }, (_, i) => `Str1;${100 + i * 10}.000;${500 + i * 10}.000;0;0;0#`).join('');

/* per-test nonce: unique across workers and retries */
const nonce = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

async function seed(request, id, name, track) {
  const r = await request.put(`/api/tracks/${id}`, { data: { name, author: 'playwright', data: { track, mode: 3 } } });
  expect(r.status()).toBe(200);
  ids.push(id);
  return id;
}

test.afterAll(async ({ request }) => {
  for (const id of ids) await request.delete(`/api/tracks/${id}`).catch(() => {});
});

async function openGallery(page) {
  await page.goto('/');
  await page.locator('#btnMenu').click();
  await page.locator('#btnGallery').click();
  await expect(page.locator('#galleryDialog')).toBeVisible();
}

test('gallery rows render name, badge and facet line', async ({ page, request }) => {
  const n = nonce();
  await seed(request, `gal-${n}-square`, `E2E Square ${n}`, SQUARE);
  await seed(request, `gal-${n}-wip`, `E2E WIP ${n}`, 'Str1;100.000;100.000;0;0;0#Cor1;154.250;100.000;45;3;75#');
  await openGallery(page);
  const row = page.locator('.gal-row', { hasText: `E2E Square ${n}` });
  await expect(row).toBeVisible();
  await expect(row.locator('.gal-badge.ok')).toHaveText('\u2713');          /* server-validated complete */
  await expect(page.locator('.gal-row', { hasText: `E2E WIP ${n}` }).locator('.gal-badge.wip')).toContainText('\u2716');
  const facets = row.locator('.gal-facets');
  await expect(facets).toContainText('4 pcs');
  await expect(facets).toContainText('1.36 m');                            /* 4 × R1C90I150 l=0.34 */
  await expect(facets).toContainText('1 lanes');
  await expect(facets).toContainText('0 str · 4 cor');
  await expect(row.locator('.gal-sub')).toContainText('\u2605 0');
});

test('sort switch reorders by length', async ({ page, request }) => {
  const n = nonce();
  await seed(request, `gal-${n}-square`, `E2E Square ${n}`, SQUARE);
  await seed(request, `gal-${n}-long`, `E2E Longest ${n}`, LONG);
  await openGallery(page);
  await page.locator('#galSorts button', { hasText: 'Length' }).click();
  /* 40 × Str1 = 64.8 m — by far the longest row the parallel specs seed */
  await expect.poll(async () => page.locator('.gal-row .gal-name').first().textContent(),
    { timeout: 10_000 }).toBe(`E2E Longest ${n}`);
  await expect(page.locator('#galSorts button', { hasText: 'Length' })).toHaveAttribute('aria-pressed', 'true');
});

test('complete-only filter hides work-in-progress rows', async ({ page, request }) => {
  const n = nonce();
  await seed(request, `gal-${n}-square`, `E2E Square ${n}`, SQUARE);
  await seed(request, `gal-${n}-wip`, `E2E WIP ${n}`, 'Str1;100.000;100.000;0;0;0#Cor1;154.250;100.000;45;3;75#');
  await seed(request, `gal-${n}-long`, `E2E Dangling ${n}`, LONG);
  await openGallery(page);
  await page.locator('#galComplete').click();
  await expect(page.locator('#galComplete')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.gal-row', { hasText: `E2E WIP ${n}` })).toHaveCount(0);
  await expect(page.locator('.gal-row', { hasText: `E2E Dangling ${n}` })).toHaveCount(0); /* dangling = wip */
  await expect(page.locator('.gal-row', { hasText: `E2E Square ${n}` })).toBeVisible();
});

test('star increments once per browser (localStorage de-dupe)', async ({ page, request }) => {
  const n = nonce();
  const id = await seed(request, `gal-${n}-square`, `E2E Square ${n}`, SQUARE);
  await openGallery(page);
  const row = page.locator('.gal-row', { hasText: `E2E Square ${n}` });
  const star = row.locator('.gal-star');
  await expect(star).toHaveText('\u2606');                                  /* un-starred glyph */
  await star.click();
  await expect(row.locator('.gal-sub')).toContainText('\u2605 1');
  await expect(star).toHaveText('\u2605');
  await star.click();                                                       /* second tap: no POST */
  await expect(row.locator('.gal-sub')).toContainText('\u2605 1');
  expect(await page.evaluate((k) => JSON.parse(localStorage.getItem('m4wd.starred')).includes(k), id)).toBe(true);
  const serverRow = await (await request.get(`/api/tracks/${id}`)).json();
  expect(serverRow.stars).toBe(1);                                          /* counter bumped once */
  /* the starred state survives a gallery reopen */
  await page.locator('#galClose').click();
  await page.locator('#btnMenu').click();
  await page.locator('#btnGallery').click();
  await expect(page.locator('.gal-row', { hasText: `E2E Square ${n}` }).locator('.gal-star')).toHaveText('\u2605');
});

test('tapping a row loads it and adopts the publication binding', async ({ page, request }) => {
  const n = nonce();
  await seed(request, `gal-${n}-square`, `E2E Square ${n}`, SQUARE);
  await openGallery(page);
  await page.locator('.gal-row', { hasText: `E2E Square ${n}` }).locator('.gal-main').click();
  await expect.poll(async () => page.evaluate(() =>
    window.__m4wd.state.sprites.length), { timeout: 10_000 }).toBe(4);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('m4wd.published')).name))
    .toBe(`E2E Square ${n}`);
  await expect(page.locator('#btnPublishBar')).toHaveText('\uD83D\uDCBE');  /* 💾 Save */
  await expect(page.locator('#galleryDialog')).not.toBeVisible();
});

test('load more paginates through the whole catalog', async ({ page, request }) => {
  const n = nonce();
  /* seed oldest-first: More 00 ends up newest … More 25 oldest, so More 25
   * always sits past the first page (25 of our own rows are newer than it,
   * whatever parallel specs add on top) */
  for (let i = 25; i >= 0; i--) {
    await seed(request, `gal-${n}-more${String(i).padStart(2, '0')}`, `E2E More ${String(i).padStart(2, '0')} ${n}`, SQUARE);
  }
  await openGallery(page);
  await expect.poll(async () => page.locator('#galList .gal-row').count(), { timeout: 10_000 }).toBe(25);
  expect(await page.locator('#galMeta').textContent()).toMatch(/^25 of \d+ tracks?$/);
  await expect(page.locator('.gal-row', { hasText: `E2E More 25 ${n}` })).toHaveCount(0);
  await page.locator('.gal-more').click();
  await expect(page.locator('.gal-row', { hasText: `E2E More 25 ${n}` })).toBeVisible();
  const m = /^(\d+) of (\d+) tracks?$/.exec(await page.locator('#galMeta').textContent());
  expect(+m[1]).toBe(Math.min(50, +m[2]));   /* second page loaded, nothing skipped */
});
