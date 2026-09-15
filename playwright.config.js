import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  /* cap workers: uncapped, Playwright spawns one per detected CPU and the
   * suite self-DDoSes a single-threaded dev server (observed: 27 workers,
   * every spec starving past the 30s timeout on high-CPU hosts).
   * PW_WORKERS overrides in either direction (NaN falls back to 4). */
  workers: (() => { const w = parseInt(process.env.PW_WORKERS || '', 10); return Number.isFinite(w) && w > 0 ? w : 4; })(),
  timeout: 30_000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
  },
  webServer: {
    /* manifest first so e2e runs the production cache mode (?h= URLs);
     * webserver.mjs sets STORE=memory cross-platform — hermetic per run */
    command: 'node tools/gen-manifest.js && node tests/e2e/webserver.mjs',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
  },
});
