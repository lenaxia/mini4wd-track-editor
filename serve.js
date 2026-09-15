/* Tiny zero-dependency dev server — serves the editor with cache-aware
 * headers:
 *   - assets/ + src/ ?v=/?h= URLs -> immutable, 1 year (content-addressed
 *     by manifest hash or rule-5 buster); root files like style.css?v=N
 *     are hand-bumped and keep no-cache + ETag (see inline comment)
 *   - /assets/manifest.json -> no-cache (it IS the invalidation signal)
 *   - other /assets/* -> 5 min + ETag revalidation
 *   - html/root + unversioned src -> no-cache + ETag (cheap 304s) */
'use strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = import.meta.dirname;
const PORT = process.env.PORT || 3000;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

http.createServer((req, res) => {
  const onError = (err) => { if (!res.headersSent) { try { res.writeHead(500); } catch (_) {} } try { res.end(); } catch (_) {} };
  res.on('error', onError);
  req.on('error', onError);
  const log = () => console.log(`${new Date().toISOString()} ${req.method} ${req.url} -> ${res.statusCode !== 200 && res.statusCode !== 304 ? res.statusCode : 'ok'} [${req.headers['user-agent'] ? req.headers['user-agent'].slice(0, 40) : '?'}]`);
  const url = decodeURIComponent(req.url.split('?')[0]);
  /* immutable only where the query is content-addressed (?h= manifests)
   * or rule-5-governed (?v= under assets//src/); root files like
   * style.css?v=N are hand-bumped — they keep no-cache + ETag so a
   * forgotten bump can never pin stale content for a year */
  const versioned = /[?&][vh]=[^&]/.test(req.url) &&
                    (url.startsWith('/assets/') || url.startsWith('/src/'));
  let file = path.normalize(path.join(ROOT, url === '/' ? 'index.html' : url));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return log(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404'); return log(); }
  const stat = fs.statSync(file);
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  let cache;
  if (versioned) cache = 'public, max-age=31536000, immutable';
  else if (url === '/assets/manifest.json') cache = 'no-cache';
  else if (url.startsWith('/assets/')) cache = 'public, max-age=300';
  else cache = 'no-cache';
  const headers = {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': cache,
    'ETag': etag,
    'Access-Control-Allow-Origin': '*',
  };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return log(); }
  res.writeHead(200, headers);
  const stream = fs.createReadStream(file);
  stream.on('error', onError);
  stream.pipe(res);
  res.on('finish', log);
}).listen(PORT, '0.0.0.0', () => console.log(`mini4wd-editor dev server on http://localhost:${PORT} (cache-aware)`));

process.on('uncaughtException', (e) => console.error('uncaught:', e.message));
