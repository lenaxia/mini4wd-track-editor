/* Store front door — picks the driver from env and normalizes config.
 *   STORE=memory (default for tests) | sqlite (default) | postgres
 *   SQLITE_PATH (default ./data/tracks.db) | DATABASE_URL (postgres) */

import path from 'node:path';
import fs from 'node:fs';

/* Max archived versions kept per track — server policy shared by all
 * drivers (worklog 0017). Drivers prune past this on every archive. */
export const REVISION_CAP = 25;

export async function openStore(env = process.env) {
  const kind = env.STORE || 'sqlite';
  if (kind === 'memory') {
    const m = await import('./memory.js');
    return m.open();
  }
  if (kind === 'sqlite') {
    const p = env.SQLITE_PATH || path.join('data', 'tracks.db');
    /* existsSync gate: recursive mkdir can spin on ENOENT-lying mounts
     * (see lib/tripcode.js) — never call it for a dir we already have */
    if (!fs.existsSync(path.dirname(p))) fs.mkdirSync(path.dirname(p), { recursive: true });
    const s = await import('./sqlite.js');
    return s.open(p);
  }
  if (kind === 'postgres') {
    if (!env.DATABASE_URL) throw new Error('STORE=postgres requires DATABASE_URL');
    const p = await import('./pg.js');
    return p.open(env.DATABASE_URL);
  }
  throw new Error(`unknown STORE "${kind}" (memory|sqlite|postgres)`);
}
