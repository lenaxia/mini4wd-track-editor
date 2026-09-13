/* Waits for captured session cookies, then downloads the rucdoc seed set. */
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const STORE = '/tmp/opencode/session-cookies.json';
let waited = 0;
while (!fs.existsSync(STORE) && waited < 3600) { fs.writeFileSync('/tmp/opencode/watch-pulse', String(Date.now())); await new Promise((r) => setTimeout(r, 3000)); waited += 3; }
if (!fs.existsSync(STORE)) { console.log('no session after 1h'); process.exit(1); }
const jar = JSON.parse(fs.readFileSync(STORE, 'utf8'));
const cookies = Object.values(jar).map((c) => ({ name: c.name, value: c.value, domain: '.thangs.com', path: '/' }));
console.log(`session: ${cookies.length} cookies (${cookies.map((c) => c.name).slice(0, 8).join(', ')}…)`);

const MODELS = JSON.parse(fs.readFileSync('/tmp/opencode/dl-list.json', 'utf8'));
const b = await chromium.launch({ channel: 'chromium', args: ['--disable-blink-features=AutomationControlled'] });
const ctx = await b.newContext({ acceptDownloads: true, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36' });
await ctx.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  window.chrome = window.chrome || { runtime: {} };
});
await ctx.addCookies(cookies);
const p = await ctx.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await p.goto('https://thangs.com/', { timeout: 45000, waitUntil: 'domcontentloaded' });
await sleep(5000);
const logged = await p.evaluate(() => [...document.querySelectorAll('button,[role=button]')].some((e) => e.textContent.trim() === 'Log in'));
console.log('logged in:', !logged);
if (logged) process.exit(1);

fs.mkdirSync('/tmp/opencode/models', { recursive: true });
for (const m of MODELS) {
  try {
    await p.goto('https://thangs.com/designer/rucdoc/3d-model/' + m.slug, { timeout: 45000, waitUntil: 'domcontentloaded' });
    await sleep(6000);
    const dlPromise = p.waitForEvent('download', { timeout: 30000 }).catch(() => null);
    await p.evaluate(() => {
      const s = [...document.querySelectorAll('span')].find((x) => x.textContent.trim() === 'Download');
      const btn = s ? (s.closest('button,[role=button],a') || s.parentElement) : document.querySelector('button[class*=ownload i]');
      if (btn) btn.click();
    });
    const dl = await dlPromise;
    if (dl) {
      const fname = dl.suggestedFilename() || 'model.bin';
      const path = `/tmp/opencode/models/${m.name}_${fname}`;
      await dl.saveAs(path);
      console.log('OK', m.name, '->', fname, fs.statSync(path).size, 'bytes');
    } else console.log('FAIL', m.name, '(no download event)');
    await sleep(1500);
  } catch (e) { console.log('ERR', m.name, e.message.split('\n')[0].slice(0, 60)); }
}
await b.close();
