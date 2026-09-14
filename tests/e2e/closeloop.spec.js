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
  /* three chained straights: A - S - B (click ~4cm short of each next joint) */
  await page.locator('.chip').first().click(); /* Str1 */
  const bb = await canvasBox(page);
  await page.mouse.click(bb.x + bb.width * 0.4, bb.y + bb.height * 0.5);
  let A = (await st(page)).sprites[0];
  let click;
  for (let i = 1; i < 3; i++) {
    await page.locator('.chip').first().click();
    click = await toScreen(page, A.x + 50 + 54 * (i - 1), A.y);
    await page.mouse.click(click.x, click.y);
  }
  let s = await st(page);
  expect(s.sprites).toHaveLength(3);
  const [,, B] = s.sprites;
  expect(B.x).toBe(A.x + 108); /* chained exactly: 2 x 54 cm */
  const S = s.sprites[1];

  /* delete the middle piece with the Delete tool */
  await page.keyboard.press('w');
  const mid = await toScreen(page, S.x, S.y);
  await page.mouse.click(mid.x, mid.y);
  s = await st(page);
  expect(s.sprites).toHaveLength(2);

  /* press L with nothing selected: advisory toast, no change */
  await page.keyboard.press('l');
  await expect(page.locator('#toast')).toContainText('Select exactly two');
  expect((await st(page)).sprites).toHaveLength(2);

  /* select both ends with the Move tool (ctrl+click toggles; the modifier
   * must be held — click()'s modifiers option doesn't reach pointer events).
   * Tap empty space first: placement left the last piece selected. */
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
  expect(s.sprites).toHaveLength(3);
  await expect(page.locator('#toast')).toContainText('Loop closed');
  const refill = s.sprites[2];
  expect(refill.name).toBe('Str1');
  expect(refill.x).toBe(A.x + 54); /* exact refill of the deleted piece */
  expect(refill.y).toBe(A.y);
  expect(s.sel).toBe(1); /* the new run is selected */

  /* undo removes the whole run in one step */
  await page.keyboard.press('r');
  expect((await st(page)).sprites).toHaveLength(2);
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

  /* A - [gap] - B - B2 (B's far end chained: only B.v0 is open) */
  await page.locator('.chip').first().click(); /* Str1 */
  const bb = await canvasBox(page);
  await page.mouse.click(bb.x + bb.width * 0.4, bb.y + bb.height * 0.5);
  const A = (await st(page)).sprites[0];
  for (let i = 1; i < 4; i++) {
    await page.locator('.chip').first().click();
    const c = await toScreen(page, A.x + 50 + 54 * (i - 1), A.y);
    await page.mouse.click(c.x, c.y);
  }
  const s4 = await st(page);
  const B = s4.sprites[2], B2 = s4.sprites[3];
  expect(B2.x).toBe(A.x + 162); /* chain continues past the gap */

  /* delete the second piece: one-straight gap between A and B */
  await page.keyboard.press('w');
  const mid = await toScreen(page, s4.sprites[1].x, s4.sprites[1].y);
  await page.mouse.click(mid.x, mid.y);
  expect((await st(page)).sprites).toHaveLength(3);

  /* deselect, then wall B's only open vertex (27 left of B's center) */
  await page.keyboard.press('q');
  await page.mouse.click(bb.x + bb.width * 0.8, bb.y + bb.height * 0.2);
  await page.locator('.chip').nth(2).click(); /* Lan1 */
  await page.keyboard.press('x');
  await page.keyboard.press('x'); /* armed angle 90 */
  const w = await toScreen(page, B.x - 27, B.y);
  await page.mouse.click(w.x, w.y);
  expect((await st(page)).sprites).toHaveLength(4);

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
  expect(s.sprites).toHaveLength(4); /* wall removed, 1 straight inserted */
  const refill = s.sprites[3];
  expect(refill.name).toBe('Str1');
  expect(refill.x).toBe(A.x + 54); /* exact refill of the deleted piece */
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
