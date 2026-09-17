/* HTTP compression — gzip for compressible text payloads when the
 * client advertises Accept-Encoding. Shared by the static handler and
 * the JSON API (the sprite bundle alone drops ~196 KB → ~40 KB on the
 * wire). Images and sub-threshold bodies pass through uncompressed —
 * gzip on a PNG is wasted CPU and a 300-byte body gains nothing. */

import zlib from 'node:zlib';

const THRESHOLD = 1024;

/* Content types worth compressing (everything text-ish the app serves;
 * png/gif/jpeg/webp are already entropy-coded). */
const COMPRESSIBLE = /^(?:text\/|application\/(?:json|javascript|xml)|image\/svg)/;

export function acceptsGzip(req) {
  return /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
}

export function compressible(contentType, byteLength) {
  return byteLength >= THRESHOLD && COMPRESSIBLE.test(String(contentType || ''));
}

/* Compress a buffer synchronously when worthwhile; null = send as-is.
 * Synchronous is fine at these sizes (gzip of 200 KB ≈ 2 ms) and keeps
 * the response writing single-path. */
export function gzipBody(body, contentType) {
  if (!compressible(contentType, body.length)) return null;
  return zlib.gzipSync(body, { level: 6 });
}
