#!/usr/bin/env node
/* Temp sprite comparison gallery — original PNG rips next to SVG redraws.
 * Zero-dep dev tooling; port 3200. NO JavaScript: server-side pagination
 * (the preview path-proxy mangles inline scripts; native lazy loading). */
'use strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT || 3200;
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const PER_PAGE = 12;

const page = (svgs, pageNum) => {
  const pages = Math.ceil(svgs.length / PER_PAGE);
  const slice = svgs.slice(pageNum * PER_PAGE, (pageNum + 1) * PER_PAGE);
  const nav = [];
  if (pageNum > 0) nav.push(`<a class="btn" href="?p=${pageNum - 1}">&#8592; Prev</a>`);
  nav.push(`<span class="pg">page ${pageNum + 1} / ${pages} &middot; ${svgs.length} pairs</span>`);
  if (pageNum < pages - 1) nav.push(`<a class="btn" href="?p=${pageNum + 1}">Load 12 more &#8594;</a>`);
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sprite comparison — originals vs SVG redraws</title>
<style>
 body{font:14px system-ui;background:#1b1e24;color:#e8e8e8;margin:0;padding:16px}
 h1{font-size:18px}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
 .card{background:#23262d;border:1px solid #3d434d;border-radius:8px;padding:8px;text-decoration:none}
 .card .row{display:flex;gap:8px;align-items:center;justify-content:center;background:#111;
   border-radius:6px;padding:6px}
 .card img{max-width:48%;max-height:120px;object-fit:contain;image-rendering:pixelated}
 .card .lbl{font:11px monospace;color:#7dd3fc;margin-top:6px;text-align:center}
 .nav{display:flex;gap:16px;align-items:center;justify-content:center;margin:20px 0}
 .btn{padding:10px 22px;border-radius:8px;background:#4f8fdd;color:#fff;text-decoration:none;font-weight:600}
 .pg{color:#9aa}
</style></head><body>
<h1>Original PNG rips vs SVG redraws</h1>
<p style="color:#9aa">Left = PNG rip (pixel-upscaled), right = SVG redraw. Native lazy loading; 12 per page.</p>
<div class="grid">
${slice.map((f) => `<a class="card" href="assets/${f}.svg" target="_blank">
  <div class="row"><img loading="lazy" src="assets/${f}.png"><img loading="lazy" src="assets/${f}.svg"></div>
  <div class="lbl">${f}</div></a>`).join('\n  ')}
</div>
<div class="nav">${nav.join(' ')}</div>
</body></html>`;
};

http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/' || rel === '') {
    const m = req.url.match(/[?&]p=(\d+)/);
    const pageNum = m ? Math.max(0, parseInt(m[1], 10)) : 0;
    const svgs = fs.readdirSync(path.join(ROOT, 'assets')).filter((f) => f.endsWith('.svg'))
      .map((f) => f.replace('.svg', ''))
      .filter((n) => fs.existsSync(path.join(ROOT, 'assets', n + '.png')))
      .sort();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(page(svgs, Math.min(pageNum, Math.ceil(svgs.length / PER_PAGE) - 1)));
  }
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  const ext = path.extname(file).toLowerCase();
  const mime = { '.png': 'image/png', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.css': 'text/css' }[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(file));
}).listen(PORT, '0.0.0.0', () => console.log(`sprite compare on :${PORT}`));
