/* Tiny zero-dependency dev server — serves the editor with no caching. */
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
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = path.normalize(path.join(ROOT, url === '/' ? 'index.html' : url));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('404'); }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store, max-age=0',
    'Access-Control-Allow-Origin': '*',
  });
  const stream = fs.createReadStream(file);
  stream.on('error', onError);
  stream.pipe(res);
  console.log(`${new Date().toISOString()} ${req.method} ${req.url} -> ${res.statusCode !== 200 ? res.statusCode : 'ok'} [${req.headers['user-agent'] ? req.headers['user-agent'].slice(0, 40) : '?'}]`);
}).listen(PORT, '0.0.0.0', () => console.log(`mini4wd-editor dev server on http://localhost:${PORT} (no caching)`));

process.on('uncaughtException', (e) => console.error('uncaught:', e.message));
