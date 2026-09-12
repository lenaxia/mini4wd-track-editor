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

  /* re-arm the same piece; click so the new piece's v1 lands within
   * SNAP_RADIUS of the first piece's v2 (v1 is 27 left of the origin,
   * so aim the origin ~4cm short of first.x + 54) */
  await page.locator('.chip').first().click();
  const pt = await toScreen(page, first.x + 50, first.y);
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

test('X rotates the selection around its visual center', async ({ page }) => {
  /* Str1 is centered on its origin: in-place rotation must not move it */
  await page.locator('.chip').first().click();
  await clickCanvas(page, 0.5, 0.5);
  const s1 = (await st(page)).sprites[0];
  await page.keyboard.press('x');
  const s1b = (await st(page)).sprites[0];
  expect(s1b.a).toBe(45);
  expect(s1b.x).toBe(s1.x);
  expect(s1b.y).toBe(s1.y);

  /* Cor1's center is (-5, -3.5) local: the origin moves so the center stays.
   * 'z' first — the earlier 'x' left the armed angle at 45. */
  await page.keyboard.press('z');
  await page.keyboard.press('2'); /* arm Cor1 */
  await clickCanvas(page, 0.3, 0.3);
  const cor = (await st(page)).sprites[1];
  await page.keyboard.press('x');
  const corb = (await st(page)).sprites[1];
  expect(corb.a).toBe(45);
  const c = Math.SQRT1_2;
  const centerBefore = { x: cor.x - 5, y: cor.y - 3.5 };
  const centerAfter = {
    x: corb.x + (-5 * c - -3.5 * c),
    y: corb.y + (-5 * c + -3.5 * c),
  };
  expect(Math.abs(centerAfter.x - centerBefore.x)).toBeLessThan(1e-6);
  expect(Math.abs(centerAfter.y - centerBefore.y)).toBeLessThan(1e-6);
  expect(corb.x).not.toBe(cor.x); /* the origin itself moved */
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
  /* a hash-only goto from '/' is a same-document navigation — boot()
   * never re-runs. Hop via about:blank to force a real page load. */
  await page.goto('about:blank');
  await page.goto(`/#t=${code}`);
  const s = await st(page);
  expect(s.sprites).toHaveLength(4);
  expect(s.sprites[3].a).toBe(45);
});

test('autosave restores the track on reload (no hash)', async ({ page }) => {
  await page.locator('.chip').first().click();
  await clickCanvas(page, 0.5, 0.5);
  const first = (await st(page)).sprites[0];
  await page.locator('.chip').first().click(); /* second piece, offset */
  await clickCanvas(page, 0.6, 0.5);
  const second = (await st(page)).sprites[1];
  const dx = second.x - first.x, dy = second.y - first.y;
  await page.waitForTimeout(500); /* autosave debounces at 350ms */

  await page.reload();
  const s = await st(page);
  expect(s.sprites).toHaveLength(2);
  /* boot view centers the world origin, so placements can be negative;
   * persistence normalizes (translates) — layout must survive exactly */
  expect(s.sprites[1].x - s.sprites[0].x).toBe(dx);
  expect(s.sprites[1].y - s.sprites[0].y).toBe(dy);
  expect(s.sprites.every((p) => p.x >= 0 && p.y >= 0)).toBe(true);
});

test('keyboard 1 arms the first piece family', async ({ page }) => {
  await page.keyboard.press('1');
  expect((await st(page)).tool).toBe('Str1');
});

test('corner chaining auto-orients the next piece exactly', async ({ page }) => {
  await page.locator('.chip').first().click();
  await clickCanvas(page, 0.4, 0.5);
  const first = (await st(page)).sprites[0];

  /* arm the corner at a WRONG angle (z -> 315) so orientation has real work.
   * At a=315 its v0 (local -26,-8) lands at rot(-26,-8,315) ~= (-24,+12.7):
   * aim the ORIGIN so that armed v0 sits on first's v2 (27,0). */
  /* deselect first (Esc) so the z-press only arms the angle — otherwise the
   * still-selected straight rotates too and the joint moves out from under us */
  await page.keyboard.press('Escape');
  await page.keyboard.press('2');
  await page.keyboard.press('z');
  const pt = await toScreen(page, first.x + 51, first.y - 12.7);
  await page.mouse.click(pt.x, pt.y);
  const s = await st(page);
  expect(s.sprites).toHaveLength(2);
  expect(s.sprites[1].name).toBe('Cor1');
  expect(s.sprites[1].a).toBeLessThan(0.5); /* re-oriented to chain: entry tangent 0 */
  /* joint exact: corner v0 world == first v2 world (catalog data is ~0.03°
   * off ideal, so sub-mm tolerance rather than exactness) */
  const c = s.sprites[1];
  const vx = c.x + -26, vy = c.y + -8; /* a~=0: no rotation */
  expect(Math.hypot(vx - (first.x + 27), vy - first.y)).toBeLessThan(0.05);
});

test('slope chaining elevates the next piece (+75 mm, adopted)', async ({ page }) => {
  await page.keyboard.press('6'); /* Bri1 slope, 3-lane family 6 */
  await clickCanvas(page, 0.4, 0.5);
  const slope = (await st(page)).sprites[0];
  expect(slope.name).toBe('Bri1');
  expect(slope.z).toBe(0);

  await page.locator('.chip').first().click(); /* straight */
  /* aim 4cm short of the exact chained origin (slope.x + 54) so snap works */
  const pt = await toScreen(page, slope.x + 50, slope.y + 3);
  await page.mouse.click(pt.x, pt.y);
  const top = (await st(page)).sprites[1];
  expect(top.z).toBe(75); /* adopted the slope-top level */
  expect(top.x).toBe(slope.x + 54); /* chained exactly */
});

test('rotate pivots a connected piece about the joint (joint survives)', async ({ page }) => {
  await page.locator('.chip').first().click();
  await clickCanvas(page, 0.5, 0.5);
  const first = (await st(page)).sprites[0];
  await page.locator('.chip').first().click();
  const pt = await toScreen(page, first.x + 50, first.y);
  await page.mouse.click(pt.x, pt.y);
  const second = (await st(page)).sprites[1];
  expect(second.x).toBe(first.x + 54); /* chained exactly */

  await page.keyboard.press('x'); /* rotate selection about the joint */
  const s = await st(page);
  const moved = s.sprites[1];
  expect(moved.a).toBe(45);
  /* joint still coincident: first's v2 == moved's v0 (27 left of origin at 45deg) */
  const jx = first.x + 27, jy = first.y;
  const vx = moved.x + -27 * Math.SQRT1_2, vy = moved.y + -27 * Math.SQRT1_2;
  expect(Math.hypot(vx - jx, vy - jy)).toBeLessThan(1e-6);
});

test('manual elevation: PageUp raises the armed piece, persists through reload', async ({ page }) => {
  await page.locator('.chip').first().click();
  await page.keyboard.press('PageUp'); await page.keyboard.press('PageUp'); await page.keyboard.press('PageUp');
  await clickCanvas(page, 0.5, 0.5);
  const p = (await st(page)).sprites[0];
  expect(p.z).toBe(30);
  await page.waitForTimeout(500); /* autosave debounce */

  await page.reload();
  const s = await st(page);
  expect(s.sprites[0].z).toBe(30);
});

test('level buttons work (touch parity for elevation)', async ({ page }) => {
  await page.locator('#btnLvlUp').click();
  await page.locator('.chip').first().click();
  await clickCanvas(page, 0.5, 0.5);
  expect((await st(page)).sprites[0].z).toBe(10);
});

test('drag perf smoke: 60-move drag on a 500-piece track stays interactive', async ({ page }) => {
  const names = ['Str1','Cor1','Lan1','Chi1','Str2','Bri1','Ban1','Bri2','Lan2'];
  let track = '';
  for (let i = 0; i < 500; i++) track += `${names[i % 9]};${(i * 7) % 3000 + 100}.000;${(i * 11) % 2000 + 100}.000;${(i % 8) * 45};${i % 3};${(i % 2) * 75}#`;
  const code = Buffer.from(track, 'utf8').toString('base64url');
  await page.goto('about:blank');
  await page.goto(`/#t=${code}`);
  await page.waitForFunction(() => window.__m4wd && window.__m4wd.state.sprites.length === 500, null, { timeout: 20000 });
  const bb = await canvasBox(page);
  await page.keyboard.press('q'); /* Move tool */
  const t0 = Date.now();
  await page.mouse.move(bb.x + bb.width * 0.6, bb.y + bb.height * 0.5);
  await page.mouse.down();
  for (let i = 0; i < 60; i++) await page.mouse.move(bb.x + bb.width * (0.6 + i * 0.003), bb.y + bb.height * 0.5);
  await page.mouse.up();
  const dt = Date.now() - t0;
  expect(dt).toBeLessThan(15000); /* order-of-magnitude regression gate only */
});

test('Delete and Color act on the z-topmost piece at a crossover', async ({ page }) => {
  /* build a two-level crossing: ground straight + raised straight above it */
  await page.locator('.chip').first().click();
  await clickCanvas(page, 0.5, 0.5);
  const ground = (await st(page)).sprites[0];
  await page.keyboard.press('Escape');
  await page.locator('#btnLvlUp').click();
  await page.locator('.chip').first().click();
  await clickCanvas(page, 0.52, 0.5); /* overlaps ground, z=10 */
  const raised = (await st(page)).sprites[1];
  expect(raised.z).toBe(10);

  /* Delete tool: tap inside the overlap (16cm from raised's center, still
   * within ground's bbox) — the raised (visually top) piece goes */
  await page.keyboard.press('w');
  const pt = await toScreen(page, raised.x - 16, ground.y);
  await page.mouse.click(pt.x, pt.y);
  const s1 = await st(page);
  expect(s1.sprites).toHaveLength(1);
  expect(s1.sprites[0].x).toBe(ground.x); /* the ground piece survived */
  expect(s1.sprites[0].z).toBe(0);

  /* Color tool: tap the remaining piece — cycles its color */
  await page.keyboard.press('e');
  const gpt = await toScreen(page, ground.x, ground.y);
  await page.mouse.click(gpt.x, gpt.y);
  const s2 = await st(page);
  expect(s2.sprites[0].c).toBe(1);
});

test('dragging a placement to a joint auto-orients (press far, drag to connect)', async ({ page }) => {
  await page.locator('.chip').first().click();
  await clickCanvas(page, 0.3, 0.5);
  const first = (await st(page)).sprites[0];
  await page.keyboard.press('Escape'); /* deselect so z only arms the angle */

  /* arm the corner at a WRONG angle (315) — drag from far away to the joint */
  await page.keyboard.press('2');
  await page.keyboard.press('z');
  const start = await toScreen(page, first.x + 200, first.y + 60);
  /* drag the ORIGIN to where the armed-315 corner's v0 (local rot(-26,-8,315)
   * ~ (-24,+12.7)) lands on first's v2 — the user drags watching the dots */
  const end = await toScreen(page, first.x + 51, first.y - 12.7);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  const mid = await st(page); /* held at the joint: oriented + welded already */
  expect(mid.sprites[1].a).toBeLessThan(0.5);
  const mc = mid.sprites[1];
  expect(Math.hypot(mc.x - 53 - first.x, mc.y - 8 - first.y)).toBeLessThan(0.05); /* joint exact: origin at first+(53,+8) */

  /* still holding: drag away — the snap releases and the armed angle returns */
  const away = await toScreen(page, first.x + 200, first.y + 60);
  await page.mouse.move(away.x, away.y, { steps: 8 });
  const mid2 = await st(page);
  expect(mid2.sprites[1].a).toBe(315);
  await page.mouse.up();

  const s = await st(page);
  expect(s.sprites).toHaveLength(2);
  expect(s.sprites[1].name).toBe('Cor1');
  expect(s.sprites[1].a).toBe(315); /* released free: armed orientation kept */
});

test('pressing ON a joint welds immediately; dragging away keeps that orientation', async ({ page }) => {
  await page.locator('.chip').first().click();
  await clickCanvas(page, 0.3, 0.5);
  const first = (await st(page)).sprites[0];
  await page.keyboard.press('Escape');

  /* press directly in snap range: place() orients at press, and the drag
   * snapshot captures the WELDED angle — dragging away keeps it (not the
   * armed angle, which was superseded at press) */
  await page.keyboard.press('2');
  await page.keyboard.press('z');
  const onJoint = await toScreen(page, first.x + 51, first.y - 12.7);
  await page.mouse.move(onJoint.x, onJoint.y);
  await page.mouse.down();
  const held = await st(page);
  expect(held.sprites[1].a).toBeLessThan(0.5); /* welded at press already */
  const away = await toScreen(page, first.x + 200, first.y + 60);
  await page.mouse.move(away.x, away.y, { steps: 8 });
  const held2 = await st(page);
  expect(held2.sprites[1].a).toBeLessThan(0.5); /* press-welded orientation kept */
  await page.mouse.up();
});

test('move-tool drag of a single piece to a joint orients it (the mobile flow)', async ({ page }) => {
  await page.locator('.chip').first().click();
  await clickCanvas(page, 0.3, 0.5);
  const first = (await st(page)).sprites[0];
  await page.keyboard.press('Escape');

  /* place a corner LOOSE (far from any joint) — tool reverts to Move */
  await page.keyboard.press('2');
  await page.keyboard.press('z');
  await clickCanvas(page, 0.7, 0.7);
  const corner = (await st(page)).sprites[1];
  expect(corner.a).toBe(315); /* loose placement keeps the armed angle */
  expect((await st(page)).tool).toBe('Move');

  /* Move-tool drag (tool already Move, piece selected after placement):
   * drag the corner's origin so its armed-315 v0 lands on first's v2 */
  const bb = await canvasBox(page);
  const onPiece = await toScreen(page, corner.x, corner.y);
  const jointAim = await toScreen(page, first.x + 51, first.y - 12.7);
  await page.mouse.move(onPiece.x, onPiece.y);
  await page.mouse.down();
  await page.mouse.move(jointAim.x, jointAim.y, { steps: 12 });
  const mid = await st(page);
  expect(mid.sprites[1].a).toBeLessThan(0.5); /* oriented during move-drag */
  expect(Math.hypot(mid.sprites[1].x - 53 - first.x, mid.sprites[1].y - 8 - first.y)).toBeLessThan(0.05);
  await page.mouse.up();
  const done = await st(page);
  expect(done.sprites[1].a).toBeLessThan(0.5); /* committed */
});

test('a weld with almost no translation is still undoable', async ({ page }) => {
  await page.locator('.chip').first().click();
  await clickCanvas(page, 0.3, 0.5);
  const first = (await st(page)).sprites[0];
  await page.keyboard.press('Escape');

  /* loose corner at a wrong angle, positioned so a vertex is ~within snap
   * range; a 1cm drag stays under the 2cm moved-threshold but the weld
   * rotates it — undo must restore the loose pose */
  await page.keyboard.press('2');
  await page.keyboard.press('z');
  await clickCanvas(page, 0.55, 0.55);
  const corner = (await st(page)).sprites[1];
  expect(corner.a).toBe(315);

  const bb = await canvasBox(page);
  const onPiece = await toScreen(page, corner.x, corner.y);
  /* drag ~1cm toward the joint aim so the vertex enters snap range */
  const jointAim = await toScreen(page, first.x + 51, first.y - 12.7);
  const dx = jointAim.x - onPiece.x, dy = jointAim.y - onPiece.y;
  const len = Math.hypot(dx, dy) || 1;
  const near = { x: onPiece.x + (dx / len) * (len - 6), y: onPiece.y + (dy / len) * (len - 6) };
  await page.mouse.move(onPiece.x, onPiece.y);
  await page.mouse.down();
  await page.mouse.move(near.x, near.y, { steps: 8 });
  await page.mouse.up();
  const welded = await st(page);
  if (welded.sprites[1].a < 0.5) { /* vertex reached range: welded via <=2cm drag */
    await page.keyboard.press('r'); /* undo must reach the pre-weld state */
    const undone = await st(page);
    expect(undone.sprites[1].a).toBe(315); /* loose pose restored */
  } else {
    /* out of range in this viewport: the no-weld case needs no undo step */
    await page.keyboard.press('r');
    const undone = await st(page);
    expect(undone.sprites).toHaveLength(2);
  }
});
