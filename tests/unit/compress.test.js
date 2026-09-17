import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptsGzip, compressible, gzipBody } from '../../lib/compress.js';

test('acceptsGzip reads Accept-Encoding (token, not substring)', () => {
  assert.equal(acceptsGzip({ headers: { 'accept-encoding': 'gzip' } }), true);
  assert.equal(acceptsGzip({ headers: { 'accept-encoding': 'br, gzip, deflate' } }), true);
  assert.equal(acceptsGzip({ headers: { 'accept-encoding': 'deflate, br' } }), false);
  assert.equal(acceptsGzip({ headers: {} }), false);            /* absent */
  assert.equal(acceptsGzip({ headers: { 'accept-encoding': 'xgzipz' } }), false);  /* no bare token */
});

test('compressible: text types over 1KB only', () => {
  assert.equal(compressible('application/json; charset=utf-8', 2048), true);
  assert.equal(compressible('image/svg+xml', 2048), true);
  assert.equal(compressible('text/javascript; charset=utf-8', 999), false);   /* under threshold */
  assert.equal(compressible('image/png', 50000), false);                      /* already coded */
  assert.equal(compressible('application/octet-stream', 50000), false);
  assert.equal(compressible(undefined, 50000), false);
});

test('gzipBody compresses eligible buffers, passes the rest through', () => {
  const big = Buffer.from('<svg>'.padEnd(4096, 'x') + '</svg>');
  const gz = gzipBody(big, 'image/svg+xml');
  assert.ok(gz && gz.length < big.length / 2);
  assert.equal(gzipBody(Buffer.from('tiny'), 'application/json'), null);      /* not worth it */
  assert.equal(gzipBody(big, 'image/png'), null);                            /* never for images */
});
