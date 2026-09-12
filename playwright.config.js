import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  /* cap workers: uncapped, Playwright spawns one per detected CPU and the
   * suite self-DDoSes a single-threaded dev server (observed: 27 workers,
   * every spec starving past the 30s timeout on high-CPU hosts) */
  workers: Math.min(4, parseInt(process.env.PW_WORKERS || '4', 10)),
  timeout: 30_000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
  },
  webServer: {
    command: 'node serve.js',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
  },
});
