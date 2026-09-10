import { test, expect } from '@playwright/test';

/* Touch-only flows need a hasTouch context — kept in a separate spec so the
 * mouse specs run in plain desktop contexts. */

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

async function st(page) {
  return page.evaluate(() => {
    const s = window.__m4wd.state;
    return { sprites: s.sprites, tool: s.tool, sel: s.selection.size };
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('touch: tap chip then tap canvas places a piece', async ({ page }) => {
  await page.locator('.chip').first().tap();
  expect((await st(page)).tool).toBe('Str1');

  const bb = await page.locator('#editor').boundingBox();
  await page.touchscreen.tap(bb.x + bb.width * 0.5, bb.y + bb.height * 0.5);

  const s = await st(page);
  expect(s.sprites).toHaveLength(1);
  expect(s.tool).toBe('Move'); /* tool reverts after touch placement too */
});

test('touch: tap empty space with Move active deselects', async ({ page }) => {
  await page.locator('.chip').first().tap();
  const bb = await page.locator('#editor').boundingBox();
  await page.touchscreen.tap(bb.x + bb.width * 0.5, bb.y + bb.height * 0.5);
  expect((await st(page)).sel).toBe(1);

  await page.touchscreen.tap(bb.x + bb.width * 0.05, bb.y + bb.height * 0.05);
  expect((await st(page)).sel).toBe(0);
});
