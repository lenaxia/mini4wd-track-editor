#!/usr/bin/env node
/* Thangs reverse proxy + session capture — dev tooling (zero-dep).
 *
 * You browse thangs.com THROUGH this server (on the dev preview origin):
 *   /            landing (status + link)
 *   /p/<path>    proxied thangs.com/<path>
 *
 * Every Set-Cookie thangs emits is mirrored to the browser AND stored to
 * /tmp/opencode/session-cookies.json for the render-pipeline downloader.
 * CSP/XFO stripped so widgets run normally in YOUR browser — token
 * generation happens on your real device, the one thing a sandbox cannot
 * fake. Root-absolute URLs are rewritten with the preview prefix
 * (discovered from Referer — the platform strips it before forwarding). */
'use strict';
import http from 'node:http';
import fs from 'node:fs';

const PORT = process.env.PORT || 3100;
const HOST = process.env.HOST || '127.0.0.1'; // loopback: holds a live session; env-override only for the dev-preview origin
const UP = 'https://thangs.com';
const COOKIE_STORE = '/tmp/opencode/session-cookies.json';

function prefixOf(req) {
  const ref = req.headers.referer || '';
  const m = ref.match(/^(https?:\/\/[^/]+)(\/api\/v1\/workspaces\/[^/]+\/dev-preview\/\d+)/);
  return m ? m[1] + m[2] : '';
}

function storeCookies(setCookies) {
  let jars = {};
  try { jars = JSON.parse(fs.readFileSync(COOKIE_STORE, 'utf8')); } catch {}
  for (const sc of setCookies) {
    const [pair] = sc.split(';');
    const i = pair.indexOf('=');
    if (i < 1) continue;
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    jars[name] = { name, value, domain: '.thangs.com', path: '/', setAt: new Date().toISOString() };
  }
  fs.writeFileSync(COOKIE_STORE, JSON.stringify(jars, null, 1));
  return Object.keys(jars).length;
}

function rewrite(body, ct, prefix) {
  if (!/text\/html|javascript|application\/json|text\/css/.test(ct || '')) return body;
  let s = body.toString('utf8');
  const P = prefix + '/p';
  s = s.replaceAll('https://thangs.com', P).replaceAll('https://www.thangs.com', P);
  s = s.replaceAll('"//thangs.com', '"' + P).replaceAll("'//thangs.com", "'" + P);
  s = s.replace(/href="\/(?!\/)/g, 'href="' + P + '/').replace(/src="\/(?!\/)/g, 'src="' + P + '/');
  s = s.replace(/action="\/(?!\/)/g, 'action="' + P + '/');
  s = s.replaceAll('"/_next/', '"' + P + '/_next/').replaceAll('"/api/', '"' + P + '/api/');
  s = s.replaceAll("'_next/", "'" + P + '/_next/').replaceAll("'/api/", "'" + P + '/api/');
  return s;
}

function landing(prefix) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Thangs proxy — mini4wd pipeline</title>
<style>
 body{font:16px system-ui;max-width:600px;margin:48px auto;padding:0 16px;background:#16181d;color:#e8e8e8}
 a.big{display:block;text-align:center;padding:16px;margin:18px 0;background:#4f8fdd;color:#fff;border-radius:10px;text-decoration:none;font-weight:700}
 .ok{color:#7CE38B}.dim{color:#9aa}
</style></head><body>
<h1>Open Thangs through here</h1>
<p>Log in with your account, open any rucdoc model, tap <b>Download</b>.
Everything flows through this sandbox; the session lands in the pipeline
automatically. (Captcha widgets run on your real device — that's the point.)</p>
<a class="big" href="p/">Continue to Thangs →</a>
<p class="dim" id="st"></p>
<script>fetch('status').then(r=>r.json()).then(s=>{document.getElementById('st').textContent=s.captured?'session captured: '+s.count+' cookies — pipeline has it':'no session captured yet';});</script>
</body></html>`;
}

http.createServer(async (req, res) => {
  const t0 = Date.now();
  res.on('finish', () => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url.slice(0, 90)} -> ${res.statusCode} (${Date.now() - t0}ms) [ua=${(req.headers['user-agent'] || '?').slice(0, 24)} ref=${(req.headers.referer || '-').slice(0, 60)}]`);
  });
  try {
    const prefix = prefixOf(req);
    if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(landing(prefix));
    }
    const pathPrefix0 = prefix.replace(/^https?:\/\/[^/]+/, '');
    if (req.url === '/status' || req.url === pathPrefix0 + '/status') {
      let n = 0;
      try { n = Object.keys(JSON.parse(fs.readFileSync(COOKIE_STORE, 'utf8'))).length; } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ captured: fs.existsSync(COOKIE_STORE), count: n }));
    }
    const pathPrefix = prefix.replace(/^https?:\/\/[^/]+/, '');
    if (!req.url.startsWith('/p/') && req.url !== '/p' && !req.url.startsWith(pathPrefix + '/p')) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('404 — proxy paths start at /p/');
    }
    const stripped = req.url.startsWith('/p') ? req.url.slice(2) : req.url.slice(pathPrefix.length + 2);
    const target = new URL(UP + stripped);

    const fwd = {};
    if (req.headers.cookie) fwd.cookie = req.headers.cookie;
    else {
      try {
        const jar = JSON.parse(fs.readFileSync(COOKIE_STORE, 'utf8'));
        fwd.cookie = Object.values(jar).map((c) => `${c.name}=${c.value}`).join('; ');
      } catch {}
    }
    for (const k of ['content-type', 'x-csrftoken', 'accept', 'user-agent', 'accept-language',
                     'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform']) {
      if (req.headers[k]) fwd[k] = req.headers[k];
    }
    fwd.referer = UP + '/';

    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks);
    const up = await fetch(target, {
      method: req.method, headers: fwd, body: body && body.length ? body : undefined,
      redirect: 'manual',
    });

    const setCookies = up.headers.getSetCookie ? up.headers.getSetCookie() : [];
    if (setCookies.length) {
      const n = storeCookies(setCookies);
      console.log(`${new Date().toISOString()} captured cookies (${n} total) via ${stripped.slice(0, 50)}`);
    }

    const h = {
      'Content-Type': up.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': 'no-store',
    };
    const loc = up.headers.get('location');
    if (loc) h.location = loc.startsWith('/') ? prefix + '/p' + loc : loc.replace(UP, prefix + '/p');
    const buf = Buffer.from(await up.arrayBuffer());
    res.writeHead(up.status, h);
    res.end(rewrite(buf, h['Content-Type'], prefix));
  } catch (e) {
    console.error('proxy error:', e.message);
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('proxy error: ' + e.message);
  }
}).listen(PORT, HOST, () => console.log(`thangs proxy + receiver on ${HOST}:${PORT}`));
