import { test, expect } from '@playwright/test';

/* Assertions read the model through the test hook exposed by src/main.js —
 * never pixel-diffed. See TESTPLAN.md for the coverage matrix. */

const FIXTURE = 'Str2;100.000;100.000;0;0#Str1;154.000;100.000;0;0#Cor1;208.000;100.000;0;1#Lan1;216.050;95.750;45;0#';

async function st(page) {
  return page.evaluate(() => {
    const s = window.__m4wd.state;
    return {
      sprites: s.sprites,
      tool: s.tool,
      angle: s.angle,
      sel: s.selection.size,
      view: s.view,
    };
  });
}

async function canvasBox(page) {
  return page.locator('#editor').boundingBox();
}

/* Click at a fraction of the canvas size. */
async function clickCanvas(page, fx, fy) {
  const bb = await canvasBox(page);
  await page.mouse.click(bb.x + bb.width * fx, bb.y + bb.height * fy);
}

/* Screen point of a world coordinate. */
async function toScreen(page, wx, wy) {
  const { view } = await st(page);
  const bb = await canvasBox(page);
  return { x: bb.x + view.x + wx * view.scale, y: bb.y + view.y + wy * view.scale };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('boots with an empty track and Pan as the default tool', async ({ page }) => {
  const s = await st(page);
  expect(s.tool).toBe('Pan');
  expect(s.sprites).toHaveLength(0);
  await expect(page.locator('#stats')).toHaveText('0.00 m · 0 pcs');
  await expect(page.locator('#editor')).toBeVisible();
});

test('placing: palette chip + canvas click places, reverts to Move, selects', async ({ page }) => {
  await page.locator('.chip').first().click(); /* Str1 */
  expect((await st(page)).tool).toBe('Str1');
  await clickCanvas(page, 0.5, 0.5);
  const s = await st(page);
  expect(s.sprites).toHaveLength(1);
  expect(s.sprites[0].name).toBe('Str1');
  expect(s.tool).toBe('Move'); /* Figma: tool reverts after placing */
  expect(s.sel).toBe(1);
  await expect(page.locator('#stats')).toHaveText('1.62 m · 1 pcs');
});

test('chaining: second placement snaps its vertex to the first piece exactly', async ({ page }) => {
  await page.locator('.chip').first().click();
  await clickCanvas(page, 0.4, 0.5);
  const first = (await st(page)).sprites[0];
  expect((await st(page)).tool).toBe('Move');

  /* re-arm the same piece and click near the first piece's far vertex */
  await page.locator('.chip').first().click();
  const v2 = { x: first.x + 27, y: first.y + 0 }; /* Str1 v2 at angle 0 */
  const pt = await toScreen(page, v2.x, v2.y);
  await page.mouse.click(pt.x, pt.y);

  const s = await st(page);
  expect(s.sprites).toHaveLength(2);
  expect(s.sprites[1].x).toBe(first.x + 54); /* v1 landed exactly on v2 */
  expect(s.sprites[1].y).toBe(first.y);
});

test('dragging the placed piece repositions it by the screen delta', async ({ page }) => {
  await page.locator('.chip').first().click();
  await clickCanvas(page, 0.5, 0.5);
  const before = (await st(page)).sprites[0];

  const bb = await canvasBox(page);
  const start = await toScreen(page, before.x, before.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 120, start.y, { steps: 8 });
  await page.mouse.up();

  const after = (await st(page)).sprites[0];
  const { view } = await st(page);
  const expectedDx = 120 / view.scale;
  expect(Math.abs(after.x - before.x - expectedDx)).toBeLessThan(2);
  expect(after.y).toBe(before.y);
});

test('click on empty space deselects', async ({ page }) => {
  await page.locator('.chip').first().click();
  await clickCanvas(page, 0.5, 0.5);
  expect((await st(page)).sel).toBe(1);

  await clickCanvas(page, 0.05, 0.05); /* far from any piece */
  expect((await st(page)).sel).toBe(0);
});

test('Esc dismisses the armed piece tool and returns to Pan', async ({ page }) => {
  await page.locator('.chip').first().click();
  expect((await st(page)).tool).toBe('Str1');
  await page.keyboard.press('Escape');
  const s = await st(page);
  expect(s.tool).toBe('Pan');
  expect(s.sprites).toHaveLength(0);
});

test('X rotates the selection around its centroid', async ({ page }) => {
  await page.locator('.chip').first().click();
  await clickCanvas(page, 0.5, 0.5);
  const before = (await st(page)).sprites[0];

  await page.keyboard.press('x');
  const after = (await st(page)).sprites[0];
  expect(after.a).toBe(45);
  expect(after.x).not.toBe(before.x); /* rotated off the old position */
});

test('R undoes the last change; empty history is a no-op', async ({ page }) => {
  await page.locator('.chip').first().click();
  await clickCanvas(page, 0.5, 0.5);
  expect((await st(page)).sprites).toHaveLength(1);

  await page.keyboard.press('r');
  expect((await st(page)).sprites).toHaveLength(0);

  await page.keyboard.press('r'); /* nothing to undo — must not throw */
  expect((await st(page)).sprites).toHaveLength(0);
});

test('import dialog loads a pasted track', async ({ page }) => {
  await page.locator('#btnMenu').click();
  await page.locator('#btnImportText').click();
  await page.locator('#ioText').fill(FIXTURE);
  await page.locator('#ioAction').click();

  const s = await st(page);
  expect(s.sprites).toHaveLength(4);
  await expect(page.locator('#stats')).toContainText('4 pcs');
});

test('share-link hash restores the track on a fresh load', async ({ page }) => {
  const code = Buffer.from(FIXTURE, 'utf8').toString('base64url');
  await page.goto(`/#t=${code}`);
  const s = await st(page);
  expect(s.sprites).toHaveLength(4);
  expect(s.sprites[3].a).toBe(45);
});

test('keyboard 1 arms the first piece family', async ({ page }) => {
  await page.keyboard.press('1');
  expect((await st(page)).tool).toBe('Str1');
});
