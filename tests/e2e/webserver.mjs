/* Playwright webServer entry — starts server.js with a hermetic memory
 * store on any platform (no POSIX-only inline `STORE=memory` env in the
 * playwright command). */
process.env.STORE = 'memory';
/* short stability window so burst-coalescing is observable in e2e (worklog 0022) */
process.env.M4WD_STABLE_MS = process.env.M4WD_STABLE_MS || '50';
/* pinned tripcode salt: hash assertions stay deterministic (worklog 0023) */
process.env.M4WD_TRIP_SALT = process.env.M4WD_TRIP_SALT || 'e2e-salt';
await import('../../server.js');
