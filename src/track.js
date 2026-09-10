/* Track codec — serialization is byte-compatible with the original format:
 * "Name;x;y;angle;color#Name;x;y;angle;color#..." (1 px = 1 cm).
 * Format derived from the MIT-licensed original editor (see src/main.js). */

import { PIECES } from './pieces.js';

export function serialize(sprites) {
  return sprites
    .filter((p) => p.x >= 0 && p.y >= 0)
    .map((p) => [p.name, p.x.toFixed(3), p.y.toFixed(3), p.a, p.c].join(';') + '#')
    .join('');
}

export function parseTrack(text) {
  /* accept either the raw format or a pasted /load/CODE.js response */
  const m = String(text).match(/var\s+text\s*=\s*'([^']*)'/);
  if (m) text = m[1];
  const out = [];
  for (const elem of String(text).split('#')) {
    const attrs = elem.split(';');
    if (attrs[0] && PIECES[attrs[0]]) {
      out.push({
        name: attrs[0],
        x: parseFloat(attrs[1]) || 0,
        y: parseFloat(attrs[2]) || 0,
        a: parseFloat(attrs[3]) || 0,
        c: parseInt(attrs[4], 10) || 0,
      });
    }
  }
  return out;
}

/* ---------- share links (#t=base64url of the serialized track) ---------- */

/* The wire format drops negative-origin pieces (original editor worked in
 * a positive-quadrant room). This fork has a free canvas, so persistence
 * paths (autosave/export/share) normalize first: translate by the minimal
 * amount that makes every origin non-negative. Pure — never mutates. */
export function normalizeForSave(sprites) {
  let dx = 0, dy = 0;
  for (const p of sprites) {
    if (p.x < dx) dx = p.x;
    if (p.y < dy) dy = p.y;
  }
  if (dx === 0 && dy === 0) return sprites;
  return sprites.map((p) => ({ ...p, x: p.x - dx, y: p.y - dy }));
}

/* Persistence-safe serialization: byte-identical to serialize() for
 * non-negative tracks, lossless (translated) otherwise. */
export function serializeForSave(sprites) {
  return serialize(normalizeForSave(sprites));
}

export function encodeShare(sprites) {
  const s = serializeForSave(sprites);
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeShare(b64) {
  const norm = b64.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(norm);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
