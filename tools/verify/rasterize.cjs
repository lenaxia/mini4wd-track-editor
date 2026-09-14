// Rasterize an SVG sprite at 1 unit = 1 px via chromium screenshot.
const { chromium } = require(require('path').join(__dirname, '..', '..', 'node_modules', 'playwright'));
const fs = require('fs');
(async () => {
  const svg = fs.readFileSync(process.argv[2], 'utf8');
  const vb = svg.match(/viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/);
  const vw = Math.round(+vb[3]), vh = Math.round(+vb[4]);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: vw, height: vh } });
  await page.goto('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
  await page.evaluate(() => document.querySelector('svg').setAttribute('style', 'position:fixed;left:0;top:0'));
  await page.screenshot({ path: process.argv[3], omitBackground: true });
  await browser.close();
  console.log(`raster ${vw}x${vh} -> ${process.argv[3]}`);
})().catch(e => { console.error(e); process.exit(1); });
