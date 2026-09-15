/* Static file serving with the cache policy — shared by serve.js (dev
 * entry) and server.js (full server: static + track storage API).
 * Extracted verbatim from serve.js; behavior is pinned by
 * tests/e2e/caching.spec.js. */

import fs from 'node:fs';
import path from 'node:path';

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

export function createStaticHandler(root) {
  return (req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    /* immutable only where the query is content-addressed (?h= manifests)
     * or rule-5-governed (?v= under assets//src/); root files like
     * style.css?v=N are hand-bumped — they keep no-cache + ETag so a
     * forgotten bump can never pin stale content for a year */
    const versioned = /[?&][vh]=[^&]/.test(req.url) &&
                      (url.startsWith('/assets/') || url.startsWith('/src/'));
    let file = path.normalize(path.join(root, url === '/' ? 'index.html' : url));
    /* root + sep: a bare startsWith(root) would admit sibling dirs that
     * merely share the prefix (e.g. /app-evil next to /app) */
    if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403); res.end('forbidden'); return true; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return false;   /* caller may handle (API) */
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
    /* hard-refresh tag: hard reloads send Cache-Control: no-cache on the
     * document (soft reloads send max-age=0 + conditionals). The client
     * wipes its CacheStorage when it sees the cookie (owner rule: asset
     * caching survives soft refreshes only). Must precede the 304 return —
     * a 304 may carry Set-Cookie, and hard reloads can send If-None-Match. */
    if (path.basename(file) === 'index.html' &&
        (req.headers['cache-control'] === 'no-cache' || req.headers.pragma === 'no-cache')) {
      headers['Set-Cookie'] = 'm4wd_hard=1; Max-Age=10; Path=/';
    }
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return true; }
    res.writeHead(200, headers);
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());   /* TOCTOU unlink/EACCES: never hang the socket */
    stream.pipe(res);
    return true;
  };
}
