/* Dev server — static files only (no API). `node server.js` is the full
 * server with track storage; this entry exists for zero-state contexts. */
'use strict';
import http from 'node:http';
import { createStaticHandler } from './lib/static.js';

const PORT = process.env.PORT || 3000;
const static_ = createStaticHandler(import.meta.dirname);
/* log hygiene: strip C0/C1 controls so a crafted url/user-agent cannot
 * forge or split log lines */
const logSafe = (s) => s.replace(/[\x00-\x1f\x7f-\x9f]/g, '');

http.createServer((req, res) => {
  const onError = (err) => { if (!res.headersSent) { try { res.writeHead(500); } catch (_) {} } try { res.end(); } catch (_) {} };
  res.on('error', onError); req.on('error', onError);
  const log = () => console.log(`${new Date().toISOString()} ${req.method} ${logSafe(req.url)} -> ${res.statusCode !== 200 && res.statusCode !== 304 ? res.statusCode : 'ok'} [${req.headers['user-agent'] ? logSafe(req.headers['user-agent'].slice(0, 40)) : '?'}]`);
  res.on('finish', log);
  /* static dispatch can throw (e.g. malformed URI encoding) — a 400,
   * never a hung socket (mirrors server.js) */
  try {
    if (!static_(req, res)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404'); }
  } catch {
    /* headersSent guard: a late throw must not resurrect the hung
     * socket via a throwing writeHead (review round 1) */
    if (!res.headersSent) res.writeHead(400, { 'Content-Type': 'text/plain' });
    try { res.end('400'); } catch (_) {}
  }
}).listen(PORT, '0.0.0.0', () => console.log(`mini4wd-editor dev server on http://localhost:${PORT} (cache-aware, no API)`));

process.on('uncaughtException', (e) => console.error('uncaught:', e.message));
