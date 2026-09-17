/* Playwright webServer entry — starts server.js with a hermetic memory
 * store on any platform (no POSIX-only inline `STORE=memory` env in the
 * playwright command). */
process.env.STORE = 'memory';
/* short stability window so burst-coalescing is observable in e2e (worklog 0022) */
process.env.M4WD_STABLE_MS = process.env.M4WD_STABLE_MS || '50';
await import('../../server.js');
