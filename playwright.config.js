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
    /* generate the asset manifest first so e2e runs the production
     * cache mode (per-file ?h= URLs), not just the buster fallback.
     * memory store: hermetic per run — no disk state, no stray data */
    command: 'node tools/gen-manifest.js && STORE=memory node server.js',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
  },
});
