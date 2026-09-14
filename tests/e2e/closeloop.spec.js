import { test, expect } from '@playwright/test';

/* Close-the-loop interaction: build a chained straight run, delete the
 * middle piece, select the two ends, press L — the gap is refilled with the
 * minimal two straights. Assertions read the model via the test hook. */

async function st(page) {
  return page.evaluate(() => {
    const s = window.__m4wd.state;
    return {
      sprites: s.sprites,
      tool: s.tool,
      sel: s.selection.size,
    };
  });
}

async function canvasBox(page) {
  return page.locator('#editor').boundingBox();
}

async function toScreen(page, wx, wy) {
  const view = await page.evaluate(() => window.__m4wd.state.view);
  const bb = await canvasBox(page);
  return { x: bb.x + view.x + wx * view.scale, y: bb.y + view.y + wy * view.scale };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('close loop refills a deleted middle piece between two selected ends', async ({ page }) => {
  /* five chained straights: P0 - P1 - [gap] - P3 - P4 after deleting P2 */
  await page.locator('.chip').first().click(); /* Str1 */
  const bb = await canvasBox(page);
  await page.mouse.click(bb.x + bb.width * 0.35, bb.y + bb.height * 0.5);
  const P0 = (await st(page)).sprites[0];
  for (let i = 1; i < 5; i++) {
    await page.locator('.chip').first().click();
    const c = await toScreen(page, P0.x + 50 + 54 * (i - 1), P0.y);
    await page.mouse.click(c.x, c.y);
  }
  let s = await st(page);
  expect(s.sprites).toHaveLength(5);
  const A = s.sprites[1], B = s.sprites[3]; /* P1, P3: one open end each */
  expect(B.x).toBe(P0.x + 162);

  /* delete the middle piece with the Delete tool */
  await page.keyboard.press('w');
  const mid = await toScreen(page, s.sprites[2].x, s.sprites[2].y);
  await page.mouse.click(mid.x, mid.y);
  s = await st(page);
  expect(s.sprites).toHaveLength(4);

  /* press L with nothing selected: advisory toast, no change */
  await page.keyboard.press('l');
  await expect(page.locator('#toast')).toContainText('Select exactly two');
  expect((await st(page)).sprites).toHaveLength(4);

  /* select both ends with the Move tool (held ctrl toggles; empty-tap first
   * because placement left the last piece selected) */
  await page.keyboard.press('q');
  const pa = await toScreen(page, A.x, A.y);
  const pb = await toScreen(page, B.x, B.y);
  await page.mouse.click(pb.x, pb.y + 120 / 1); /* below B: empty space */
  await page.keyboard.down('Control');
  await page.mouse.click(pa.x, pa.y);
  await page.mouse.click(pb.x, pb.y);
  await page.keyboard.up('Control');
  expect((await st(page)).sel).toBe(2);

  /* close the loop: the pulled 54 cm gap refills with exactly one Str1 */
  await page.keyboard.press('l');
  s = await st(page);
  expect(s.sprites).toHaveLength(5);
  await expect(page.locator('#toast')).toContainText('Loop closed');
  const refill = s.sprites[4];
  expect(refill.name).toBe('Str1');
  expect(refill.x).toBe(A.x + 54); /* exact refill of the deleted piece */
  expect(refill.y).toBe(A.y);
  expect(s.sel).toBe(1); /* the new run is selected */
  expect(s.tool).toBe('Move'); /* L keeps the current tool */

  /* undo removes the whole run in one step */
  await page.keyboard.press('r');
  expect((await st(page)).sprites).toHaveLength(4);
});

test('close loop button lives in the menu and routes to the same action', async ({ page }) => {
  await page.locator('#btnMenu').click();
  await expect(page.locator('#btnLoop')).toBeVisible();
  await page.locator('#btnLoop').click();
  await expect(page.locator('#toast')).toContainText('Select exactly two');
});

test('failed close offers step-back as a tappable toast, not a native dialog', async ({ page }) => {
  let nativeDialog = false;
  page.on('dialog', (d) => { nativeDialog = true; d.dismiss(); });

  /* P0 - P1 - [gap] - P3 - P4, gap walled on P3's only open vertex */
  await page.locator('.chip').first().click(); /* Str1 */
  const bb = await canvasBox(page);
  await page.mouse.click(bb.x + bb.width * 0.35, bb.y + bb.height * 0.5);
  const P0 = (await st(page)).sprites[0];
  for (let i = 1; i < 5; i++) {
    await page.locator('.chip').first().click();
    const c = await toScreen(page, P0.x + 50 + 54 * (i - 1), P0.y);
    await page.mouse.click(c.x, c.y);
  }
  const s5 = await st(page);
  const A = s5.sprites[1], B = s5.sprites[3];

  /* delete the middle piece */
  await page.keyboard.press('w');
  const mid = await toScreen(page, s5.sprites[2].x, s5.sprites[2].y);
  await page.mouse.click(mid.x, mid.y);

  /* deselect, then wall B's open vertex with a vertical lane changer */
  await page.keyboard.press('q');
  await page.mouse.click(bb.x + bb.width * 0.8, bb.y + bb.height * 0.2);
  await page.locator('.chip').nth(2).click(); /* Lan1 */
  await page.keyboard.press('x');
  await page.keyboard.press('x'); /* armed angle 90 */
  const w = await toScreen(page, B.x - 27, B.y);
  await page.mouse.click(w.x, w.y);
  expect((await st(page)).sprites).toHaveLength(5); /* P0,P1,P3,P4 + wall */

  /* select the two ends and attempt the close: it must fail with a toast */
  await page.keyboard.press('q');
  await page.mouse.click(bb.x + bb.width * 0.8, bb.y + bb.height * 0.2);
  const pa = await toScreen(page, A.x, A.y);
  const pb = await toScreen(page, B.x, B.y);
  await page.keyboard.down('Control');
  await page.mouse.click(pa.x, pa.y);
  await page.mouse.click(pb.x, pb.y);
  await page.keyboard.up('Control');
  await page.keyboard.press('l');

  const toast = page.locator('#toast');
  await expect(toast).toContainText('Couldn\u2019t close');
  const btn = toast.locator('button');
  await expect(btn).toHaveText('Yes');
  await btn.click();

  await expect(toast).toContainText('Stepped back 1 pc');
  expect(nativeDialog).toBe(false); /* no confirm() anywhere */
  const s = await st(page);
  expect(s.sprites).toHaveLength(5); /* wall removed, 1 straight inserted */
  const refill = s.sprites[4];
  expect(refill.name).toBe('Str1');
  expect(refill.x).toBe(A.x + 54);
});

test('mixed-lane selections are rejected with guidance', async ({ page }) => {
  await page.evaluate(() => {
    const s = window.__m4wd.state;
    s.sprites.push(
      { name: 'Str1', x: -200, y: 0, a: 0, c: 0, z: 0 },
      { name: 'Str4', x: 200, y: 100, a: 0, c: 0, z: 0 },
    );
  });
  await page.keyboard.press('q');
  const p3 = await toScreen(page, -200, 0);
  const p5 = await toScreen(page, 200, 100);
  await page.keyboard.down('Control');
  await page.mouse.click(p3.x, p3.y);
  await page.mouse.click(p5.x, p5.y);
  await page.keyboard.up('Control');
  await page.keyboard.press('l');
  await expect(page.locator('#toast')).toContainText('same lane count');
});

test('Complete tool: intro dialog once, two taps close the gap', async ({ page }) => {
  /* P0 - P1 - [gap] - P3 - P4 */
  await page.locator('.chip').first().click();
  const bb = await canvasBox(page);
  await page.mouse.click(bb.x + bb.width * 0.35, bb.y + bb.height * 0.5);
  const P0 = (await st(page)).sprites[0];
  for (let i = 1; i < 5; i++) {
    await page.locator('.chip').first().click();
    const c = await toScreen(page, P0.x + 50 + 54 * (i - 1), P0.y);
    await page.mouse.click(c.x, c.y);
  }
  const s5 = await st(page);
  const A = s5.sprites[1], B = s5.sprites[3];
  await page.keyboard.press('w');
  const mid = await toScreen(page, s5.sprites[2].x, s5.sprites[2].y);
  await page.mouse.click(mid.x, mid.y);
  await page.keyboard.press('q');
  await page.mouse.click(bb.x + bb.width * 0.8, bb.y + bb.height * 0.2); /* deselect */

  /* arm the tool: intro dialog appears, dismiss with OK */
  await page.locator('#btnComplete').click();
  expect((await st(page)).tool).toBe('Complete');
  await expect(page.locator('#completeDialog')).toBeVisible();
  await expect(page.locator('#completeDialog')).toContainText('remove pieces one at a time');
  await page.locator('#completeOk').click();
  await expect(page.locator('#completeDialog')).not.toBeVisible();

  /* tap the two ends: first is highlighted, second completes */
  const pa = await toScreen(page, A.x, A.y);
  await page.mouse.click(pa.x, pa.y);
  expect((await st(page)).sel).toBe(1);
  const pb = await toScreen(page, B.x, B.y);
  await page.mouse.click(pb.x, pb.y);

  const s = await st(page);
  expect(s.sprites).toHaveLength(5); /* 4 + 1 refill */
  await expect(page.locator('#toast')).toContainText('Loop closed');
  expect(s.sprites[4].x).toBe(A.x + 54);
  expect(s.tool).toBe('Move'); /* Figma-style revert on success */
  expect(s.sel).toBe(1); /* the new run is selected */
});
