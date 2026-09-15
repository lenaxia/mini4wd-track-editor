/* Playwright webServer entry — starts server.js with a hermetic memory
 * store on any platform (no POSIX-only inline `STORE=memory` env in the
 * playwright command). */
process.env.STORE = 'memory';
await import('../../server.js');
