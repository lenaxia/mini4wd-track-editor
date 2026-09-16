import { test, expect } from '@playwright/test';

/* Gallery (owner spec): brand + Track menu → 🌍 Gallery browses ALL
 * tracks on the server FULL SCREEN — facet rows (pieces/length/lanes/
 * footprint/straights/slopes/corners/stars/updated + ✓/✖ badge),
 * sort select, Complete-only ON BY DEFAULT (always visible), filter
 * drawer (min length slider, lane selection, footprint caps with
 * imperial/metric units, max counts), per-browser star de-dupe, Load
 * more, load-adopts-binding. Tests own their rows: unique per-test id
 * namespace + afterAll cleanup — safe against a shared live server
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

test('the toolbar globe opens the gallery (discoverability, owner round 3)', async ({ page, request }) => {
  const n = nonce();
  await seed(request, `gal-${n}-square`, `E2E Square ${n}`, SQUARE);
  await page.goto('/');
  await page.locator('#btnGalleryBar').click();
  await expect(page.locator('#galleryDialog')).toBeVisible();
  await expect(page.locator('.gal-row', { hasText: `E2E Square ${n}` })).toBeVisible({ timeout: 10_000 });
  await page.locator('#galClose').click();
  await expect(page.locator('#galleryDialog')).not.toBeVisible();
});

test('the brand opens the gallery full screen (no horizontal scroll, desktop or phone)', async ({ page, request }) => {
  const n = nonce();
  await seed(request, `gal-${n}-square`, `E2E Square ${n}`, SQUARE);   /* complete-only default needs one */
  await page.goto('/');
  /* force: the opened full-screen dialog covers the brand, which would
   * send Playwright's actionability retry loop into a spin — one tap is
   * what a user does */
  await page.locator('#brand').click({ force: true });
  const dlg = page.locator('#galleryDialog');
  await expect(dlg).toBeVisible();
  await expect(page.locator('.gal-row').first()).toBeVisible({ timeout: 10_000 });
  for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 780 }]) {
    await page.setViewportSize(vp);
    const box = await dlg.boundingBox();
    expect(Math.round(box.width)).toBe(vp.width);
    expect(Math.round(box.height)).toBeLessThanOrEqual(vp.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
  }
});

test('gallery rows render name, badge and facet line (complete-off shows WIP)', async ({ page, request }) => {
  const n = nonce();
  await seed(request, `gal-${n}-square`, `E2E Square ${n}`, SQUARE);
  await seed(request, `gal-${n}-wip`, `E2E WIP ${n}`, 'Str1;100.000;100.000;0;0;0#Cor1;154.250;100.000;45;3;75#');
  await openGallery(page);
  const row = page.locator('.gal-row', { hasText: `E2E Square ${n}` });
  await expect(row).toBeVisible();
  await expect(row.locator('.gal-badge.ok')).toHaveText('\u2713');          /* server-validated complete */
  const facets = row.locator('.gal-facets');
  await expect(facets).toContainText('4 pcs');
  await expect(facets).toContainText('1.36 m');                            /* 4 × R1C90I150 l=0.34 */
  await expect(facets).toContainText('1 lanes');
  await expect(facets).toContainText('0 straights · 0 slopes · 4 corners');
  await expect(row.locator('.gal-sub')).toContainText('\u2605 0');
  /* complete-only is ON by default — the WIP badge needs the toggle OFF */
  await page.locator('#galComplete').click();
  const wip = page.locator('.gal-row', { hasText: `E2E WIP ${n}` });
  await expect(wip).toBeVisible();
  await expect(wip.locator('.gal-badge.wip')).toContainText('\u2716');
});

test('sort select reorders by length', async ({ page, request }) => {
  const n = nonce();
  await seed(request, `gal-${n}-short`, `E2E Shortest ${n}`, SQUARE);
  await seed(request, `gal-${n}-long`, `E2E Longest ${n}`, LONG);
  await openGallery(page);
  await page.locator('#galComplete').click();   /* the LONG seed dangles = WIP, hidden by the default */
  await page.locator('#galSort').selectOption('-length');
  /* 40 × Str1 = 64.8 m — longer than this spec's short seed; relative
   * order (longest above shortest) is asserted so a shared server's other
   * rows cannot break it */
  await expect.poll(async () => {
    const names = await page.locator('.gal-row .gal-name').allTextContents();
    return names.indexOf(`E2E Longest ${n}`) >= 0 &&
           names.indexOf(`E2E Shortest ${n}`) >= 0 &&
           names.indexOf(`E2E Longest ${n}`) < names.indexOf(`E2E Shortest ${n}`);
  }, { timeout: 10_000 }).toBe(true);
  expect(await page.locator('#galSort').inputValue()).toBe('-length');
});

test('complete-only is the default; the toggle always stays visible', async ({ page, request }) => {
  const n = nonce();
  await seed(request, `gal-${n}-square`, `E2E Square ${n}`, SQUARE);
  await seed(request, `gal-${n}-wip`, `E2E WIP ${n}`, 'Str1;100.000;100.000;0;0;0#Cor1;154.250;100.000;45;3;75#');
  await seed(request, `gal-${n}-long`, `E2E Dangling ${n}`, LONG);
  await openGallery(page);
  await expect(page.locator('#galComplete')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.gal-row', { hasText: `E2E WIP ${n}` })).toHaveCount(0);
  await expect(page.locator('.gal-row', { hasText: `E2E Dangling ${n}` })).toHaveCount(0); /* dangling = wip */
  await expect(page.locator('.gal-row', { hasText: `E2E Square ${n}` })).toBeVisible();
  await page.locator('#galComplete').click();
  await expect(page.locator('.gal-row', { hasText: `E2E WIP ${n}` })).toBeVisible();
});

test('filter drawer: lanes, min length, reset — Complete stays visible', async ({ page, request }) => {
  const n = nonce();
  const fiveLane = 'Str4;100.000;100.000;0;0;0#Str4;160.000;100.000;0;0;0#';  /* 5-lane, 6 m, 0 str? -> 2 str */
  await seed(request, `gal-${n}-five`, `E2E Five ${n}`, fiveLane);
  await seed(request, `gal-${n}-square`, `E2E Square ${n}`, SQUARE);          /* 1-lane, 1.36 m, 4 cor */
  await openGallery(page);
  await page.locator('#galComplete').click();   /* fixtures dangle — test the filters, not completeness */

  await page.locator('#galFilters').click();
  await expect(page.locator('#galDrawer')).toHaveClass(/open/);
  await expect(page.locator('#galComplete')).toBeVisible();                  /* always visible, panel or not */
  /* the Filters button TOGGLES: second tap dismisses */
  await page.locator('#galFilters').click();
  await expect(page.locator('#galDrawer')).not.toHaveClass(/open/);
  expect(await page.locator('#galFilters').getAttribute('aria-expanded')).toBe('false');
  await page.locator('#galFilters').click();
  await expect(page.locator('#galDrawer')).toHaveClass(/open/);

  /* lanes: only 5-lane rows */
  await page.locator('#galLanes input').nth(0).uncheck();   /* 2 lanes off */
  await page.locator('#galLanes input').nth(1).uncheck();   /* 3 lanes off */
  await expect(page.locator('.gal-row', { hasText: `E2E Square ${n}` })).toHaveCount(0);
  await expect(page.locator('.gal-row', { hasText: `E2E Five ${n}` })).toBeVisible();
  expect(await page.locator('#galFilterCount').textContent()).toBe('1');

  /* min length: 5 m removes the 1.36 m square too (both lanes back on) */
  await page.locator('#galLanes input').nth(0).check();
  await page.locator('#galLanes input').nth(1).check();
  await page.locator('#galMinLen').fill('5');
  /* dragging the slider must NOT dismiss the panel (owner report) */
  await expect(page.locator('#galDrawer')).toHaveClass(/open/);
  await expect(page.locator('.gal-row', { hasText: `E2E Square ${n}` })).toHaveCount(0);
  await expect(page.locator('.gal-row', { hasText: `E2E Five ${n}` })).toBeVisible();
  /* the readout follows the unit choice */
  await page.locator('#galUnitFt').click();
  await expect(page.locator('#galMinLenOut')).toHaveText('16 ft+');
  await page.locator('#galUnitM').click();
  await expect(page.locator('#galMinLenOut')).toHaveText('5 m+');
  /* two-ended: cap the top at 10 m — the 6 m row stays, the 19.4 m row goes */
  const longTrack = 'Str1;100.000;100.000;0;0;0#'.repeat(12);
  await seed(request, `gal-${n}-longer`, `E2E Longer ${n}`, longTrack);
  await page.locator('#galMaxLen').fill('10');
  await expect(page.locator('#galMinLenOut')).toHaveText('5 m\u201310 m');
  await expect(page.locator('.gal-row', { hasText: `E2E Five ${n}` })).toBeVisible();
  await expect(page.locator('.gal-row', { hasText: `E2E Longer ${n}` })).toHaveCount(0);
  await page.locator('#galMaxLen').fill('200');

  /* max straights 0: only zero-straight rows (the square, if visible) */
  await page.locator('#galMinLen').fill('0');
  await page.locator('#galMinLen').blur();
  await page.locator('#galMaxStraights').fill('0');
  await page.locator('#galMaxStraights').blur();
  await expect(page.locator('.gal-row', { hasText: `E2E Five ${n}` })).toHaveCount(0);
  await expect(page.locator('.gal-row', { hasText: `E2E Square ${n}` })).toBeVisible();

  /* unchecking ALL lanes is "no matches" client-side — the server param
   * cannot express the empty set (omitting it means every lane) */
  await page.locator('#galLanes input').nth(0).uncheck();
  await page.locator('#galLanes input').nth(1).uncheck();
  await page.locator('#galLanes input').nth(2).uncheck();
  await expect(page.locator('.gal-empty')).toHaveText('No lanes selected — tick at least one in Filters.');
  expect(await page.locator('#galList .gal-row').count()).toBe(0);

  await page.locator('#galReset').click();
  await expect(page.locator('.gal-row', { hasText: `E2E Five ${n}` })).toBeVisible();
  await expect(page.locator('.gal-row', { hasText: `E2E Square ${n}` })).toBeVisible();
  await expect(page.locator('#galFilterCount')).toBeHidden();

  /* Esc closes the gallery; a stale open panel must not survive it
   * (the panel is still open from the filter interactions above) */
  await expect(page.locator('#galDrawer')).toHaveClass(/open/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#galleryDialog')).not.toBeVisible();
  await page.locator('#brand').click({ force: true });
  await expect(page.locator('#galDrawer')).not.toHaveClass(/open/);
});

test('unit switch re-renders cards: metres <-> feet (length + footprint)', async ({ page, request }) => {
  const n = nonce();
  await seed(request, `gal-${n}-square`, `E2E Square ${n}`, SQUARE);   /* 1.36 m, 59x59 cm bbox */
  await openGallery(page);
  const card = page.locator('.gal-row', { hasText: `E2E Square ${n}` });
  const facets = card.locator('.gal-facets');
  await expect(facets).toContainText('1.36 m');
  await expect(facets).toContainText('0.58\u00D70.58 m');   /* 58.5 cm bbox, trimmed */
  await page.locator('#galFilters').click();
  await page.locator('#galUnitFt').click();
  /* the footprint inputs carry the unit suffix too */
  await expect(page.locator('#galMaxW').locator('..')).toContainText('ft');
  await expect(facets).toContainText('4.5 ft');                        /* 1.36 m */
  await expect(facets).toContainText('1.9\u00D71.9 ft');               /* 58.5 cm */
  await page.locator('#galUnitM').click();
  await expect(facets).toContainText('1.36 m');
});

test('stars toggle per browser: POST stars, DELETE unstars, localStorage gates', async ({ page, request }) => {
  const n = nonce();
  const id = await seed(request, `gal-${n}-square`, `E2E Square ${n}`, SQUARE);
  await openGallery(page);
  const row = page.locator('.gal-row', { hasText: `E2E Square ${n}` });
  const star = row.locator('.gal-star');
  await expect(star).toHaveText('\u2606');                                  /* un-starred glyph */
  await star.click();                                                       /* star */
  await expect(row.locator('.gal-sub')).toContainText('\u2605 1');
  await expect(star).toHaveText('\u2605');
  expect(await page.evaluate((k) => JSON.parse(localStorage.getItem('m4wd.starred')).includes(k), id)).toBe(true);
  expect((await (await request.get(`/api/tracks/${id}`)).json()).stars).toBe(1);
  await star.click();                                                       /* un-star */
  await expect(row.locator('.gal-sub')).toContainText('\u2605 0');
  await expect(star).toHaveText('\u2606');
  expect(await page.evaluate((k) => !JSON.parse(localStorage.getItem('m4wd.starred') || '[]').includes(k), id)).toBe(true);
  expect((await (await request.get(`/api/tracks/${id}`)).json()).stars).toBe(0);
  await star.click();                                                       /* re-star works */
  await expect(row.locator('.gal-sub')).toContainText('\u2605 1');
  expect((await (await request.get(`/api/tracks/${id}`)).json()).stars).toBe(1);
  /* the un-starred state survives a gallery reopen */
  await star.click();
  await page.locator('#galClose').click();
  await page.locator('#btnMenu').click();
  await page.locator('#btnGallery').click();
  await expect(page.locator('.gal-row', { hasText: `E2E Square ${n}` }).locator('.gal-star')).toHaveText('\u2606');
});

test('each card renders a thumbnail of the actual track', async ({ page, request }) => {
  const n = nonce();
  await seed(request, `gal-${n}-square`, `E2E Square ${n}`, SQUARE);
  await openGallery(page);
  const row = page.locator('.gal-row', { hasText: `E2E Square ${n}` });
  /* the thumb canvas paints real pixels once the lazy row fetch lands */
  await expect.poll(async () => await row.locator('.gal-thumb').evaluate((cv) => {
    if (!cv.width) return false;
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;   /* any non-transparent pixel */
    return false;
  }), { timeout: 10_000 }).toBe(true);
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
  /* published: the save-check icon replaces the cloud-upload glyph */
  await expect(page.locator('#btnPublishBar svg path')).toHaveAttribute('d', /^M17 3H5C3\.9 3 3 3\.9/);
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

test('double-tapping Load more never appends a page twice', async ({ page, request }) => {
  const n = nonce();
  for (let i = 25; i >= 0; i--) {
    await seed(request, `gal-${n}-more${String(i).padStart(2, '0')}`, `E2E More ${String(i).padStart(2, '0')} ${n}`, SQUARE);
  }
  await openGallery(page);
  await expect.poll(async () => page.locator('#galList .gal-row').count(), { timeout: 10_000 }).toBe(25);
  /* two clicks back-to-back: the second must not fire a duplicate page
   * fetch while the first is in flight (touch is the primary target) */
  await page.locator('.gal-more').dblclick();
  await expect(page.locator('.gal-row', { hasText: `E2E More 25 ${n}` })).toBeVisible();
  const names = await page.locator('.gal-row .gal-name').allTextContents();
  expect(new Set(names).size).toBe(names.length);   /* no duplicated page */
});

/* ---------- worklog 0017: Copy, History, Mine ---------- */

test('Copy forks the row: your copy appears with a "based on" line; the original is untouched', async ({ page, request }) => {
  const n = nonce();
  const parentId = await seed(request, `gal-${n}-orig`, `E2E CopyOrig ${n}`, SQUARE);
  await openGallery(page);
  const row = page.locator('.gal-row', { hasText: `E2E CopyOrig ${n}` });
  await row.locator('.gal-kebab').click();
  await row.locator('.gal-menu button', { hasText: 'Save my own copy' }).click();
  await expect(page.locator('#toast')).toContainText('your own copy');

  /* kebab behavior: reopens, a tap elsewhere closes it — including a
   * star (which stops propagation; the closer runs in capture phase) */
  await row.locator('.gal-kebab').click();
  await expect(row.locator('.gal-menu')).toBeVisible();
  await page.locator('#galMeta').click();
  await expect(row.locator('.gal-menu')).toBeHidden();
  await row.locator('.gal-kebab').click();
  await expect(row.locator('.gal-menu')).toBeVisible();
  await row.locator('.gal-star').click();
  await expect(row.locator('.gal-menu')).toBeHidden();
  await expect(row.locator('.gal-star')).toHaveClass(/starred/);   /* the tap still starred */
  /* Esc layers: closes the menu, the gallery itself stays open */
  await row.locator('.gal-kebab').click();
  await expect(row.locator('.gal-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(row.locator('.gal-menu')).toBeHidden();
  await expect(page.locator('#galleryDialog')).toBeVisible();

  /* the fork exists server-side, carries server-resolved lineage, and the
   * original still holds its own track body */
  const list = await (await request.get('/api/tracks?sort=-created_at&limit=5')).json();
  const fork = list.items.find((x) => x.parent_id === parentId);
  expect(fork).toBeTruthy();
  expect(fork.parent_name).toBe(`E2E CopyOrig ${n}`);
  expect(fork.root_id).toBe(parentId);
  ids.push(fork.id);
  const orig = await (await request.get(`/api/tracks/${parentId}`)).json();
  expect(orig.parent_id).toBeNull();          /* the original was not re-linked */

  /* the fresh copy shows in the gallery with the based-on line and is mine */
  await page.reload();
  await page.locator('#btnMenu').click();
  await page.locator('#btnGallery').click();
  const forkRow = page.locator('.gal-row', { hasText: `E2E CopyOrig ${n}` }).filter({ has: page.locator('.gal-based') });
  await expect(forkRow).toBeVisible();
  await expect(forkRow.locator('.gal-based')).toContainText(`based on “E2E CopyOrig ${n}”`);
});

test('History dialog restores an older version onto the head', async ({ page, request }) => {
  const n = nonce();
  const id = await seed(request, `gal-${n}-hist`, `E2E HistA ${n}`, SQUARE);
  /* a second save archives HistA as a version, head becomes HistB (an
   * open chain = WIP — the default complete-only filter must come off) */
  await request.put(`/api/tracks/${id}`, { data: { name: `E2E HistB ${n}`, data: { track: LONG, mode: 3 } } });
  await openGallery(page);
  await page.locator('#galComplete').click();
  const row = page.locator('.gal-row', { hasText: `E2E HistB ${n}` });
  /* load it onto the canvas first — restore-while-bound is the path
   * that once crashed on meta-only upsert rows (PR #40 review) */
  await row.locator('.gal-main').click();
  await expect(page.locator('#toast')).toContainText('Loaded');
  await page.locator('#btnMenu').click();
  await page.locator('#btnGallery').click();
  /* gal.complete persists across opens — only toggle if it's on */
  if (await page.locator('#galComplete').getAttribute('aria-pressed') === 'true') {
    await page.locator('#galComplete').click();
  }
  const hrow = page.locator('.gal-row', { hasText: `E2E HistB ${n}` });
  await hrow.locator('.gal-kebab').click();
  await hrow.locator('.gal-menu button', { hasText: 'History' }).click();
  await expect(page.locator('#historyDialog')).toBeVisible();
  const hisRow = page.locator('.his-row', { hasText: `E2E HistA ${n}` });
  await expect(hisRow).toBeVisible();
  await hisRow.locator('button').click();
  await expect(page.locator('#toast')).toContainText('Restored');
  /* the bound canvas shows the restored version immediately — the stats
   * bar reports the square's 4 pieces (HistB had 40) */
  await expect(page.locator('#stats')).toContainText('4 pcs');
  /* head is the restored square again (4 pieces, original name) */
  const head = await (await request.get(`/api/tracks/${id}`)).json();
  expect(head.name).toBe(`E2E HistA ${n}`);
  expect(head.piece_count).toBe(4);
});

test('Mine chip narrows the list to tracks this browser saved', async ({ page, request }) => {
  const n = nonce();
  await seed(request, `gal-${n}-mine`, `E2E MineYes ${n}`, SQUARE);
  await seed(request, `gal-${n}-other`, `E2E MineNo ${n}`, SQUARE);
  await openGallery(page);
  /* copy MineYes — the browser's Mine list then holds the fork, not the seed */
  const row = page.locator('.gal-row', { hasText: `E2E MineYes ${n}` });
  await row.locator('.gal-kebab').click();
  await row.locator('.gal-menu button', { hasText: 'Save my own copy' }).click();
  await expect(page.locator('#toast')).toContainText('your own copy');
  /* the fork joins the list on the next gallery open */
  await page.reload();
  await page.locator('#btnMenu').click();
  await page.locator('#btnGallery').click();
  await expect(page.locator('#galleryDialog')).toBeVisible();
  await page.locator('#galMine').click();
  await expect(page.locator('#galMine')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.gal-list .gal-row', { hasText: `E2E MineNo ${n}` })).toHaveCount(0);
  await expect(page.locator('.gal-list .gal-row', { hasText: `E2E MineYes ${n}` })).toBeVisible();
  await expect(page.locator('#galMeta')).toContainText('of yours');
});
