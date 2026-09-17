/* Cache-buster guard — worklog 0023.
 *
 * Rule (README-LLM hard rule 5): whenever app code changes, the ?v=N on
 * the affected entry points must exceed the number main has already
 * burned — equal numbers on different bytes strand updated clients on
 * year-long immutable caches (this PR series burned v70, v71, v74 and
 * v76 the hard way).
 *
 * Usage (CI, on a full checkout of the PR): node tools/check-busters.js
 * Compares against origin/main:
 *   - src/, lib/, server.js, serve.js, index.html changed → main.js
 *     buster must be strictly greater than main's
 *   - style.css or index.html changed → style.css buster strictly greater
 * Docs/tests/fixtures alone never trip it. */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const sh = (cmd) => execFileSync('/bin/sh', ['-c', cmd], { encoding: 'utf8' }).trim();

const busters = (html) => {
  const js = /main\.js\?v=(\d+)/.exec(html);
  const css = /style\.css\?v=(\d+)/.exec(html);
  if (!js || !css) throw new Error('index.html is missing a ?v= buster');
  return { js: +js[1], css: +css[1] };
};

const changed = sh('git diff --name-only origin/main...HEAD').split('\n').filter(Boolean);
const ours = busters(fs.readFileSync('index.html', 'utf8'));
const mainHtml = sh('git show origin/main:index.html');
const theirs = busters(mainHtml);

const jsTouched = changed.some((f) => f.startsWith('src/') || f.startsWith('lib/') || f === 'server.js' || f === 'serve.js' || f === 'index.html');
const cssTouched = changed.includes('style.css') || changed.includes('index.html');

const fail = [];
if (jsTouched && ours.js <= theirs.js) fail.push(`main.js buster v${ours.js} must exceed main's v${theirs.js} (app code changed)`);
if (cssTouched && ours.css <= theirs.css) fail.push(`style.css buster v${ours.css} must exceed main's v${theirs.css}`);

if (fail.length) {
  console.error('buster guard: ' + fail.join('; '));
  process.exit(1);
}
console.log(`buster guard ok: main.js v${ours.js} > v${theirs.js}, style.css v${ours.css} > v${theirs.css}` +
  (jsTouched || cssTouched ? '' : ' (no app-code changes; nothing required)'));
