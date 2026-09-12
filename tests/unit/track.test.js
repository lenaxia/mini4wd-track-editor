import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialize, serializeForSave, parseTrack, encodeShare, decodeShare } from '../../src/track.js';

/* Serialization v2 (docs/design/orient-elevation.md §3): 6th field z (mm),
 * always emitted. Legacy 5-field strings and /load/CODE.js wrappers parse
 * forever (z=0). The original site has no export, so byte-identity is
 * only pinned within v2 itself. */
const FIXTURE = 'Str2;100.000;100.000;0;0;0#Str1;154.000;100.000;0;0;0#Cor1;208.000;100.000;0;1;0#Lan1;216.050;95.750;45;0;75#';
const LEGACY_5FIELD = 'Str2;100.000;100.000;0;0#Str1;154.000;100.000;0;0#';

test('parseTrack -> serialize round-trips v2 byte-identically', () => {
  assert.equal(serialize(parseTrack(FIXTURE)), FIXTURE);
});

test('legacy 5-field input parses with z=0 and serializes as v2', () => {
  const out = parseTrack(LEGACY_5FIELD);
  assert.ok(out.every((p) => p.z === 0));
  assert.equal(serialize(out), LEGACY_5FIELD.replaceAll(/;(\d)#/g, ';$1;0#'));
});

test('z is integer millimetres, may be negative', () => {
  const out = parseTrack('Str1;1.000;2.000;0;0;-75#');
  assert.equal(out[0].z, -75);
  assert.equal(serialize(out), 'Str1;1.000;2.000;0;0;-75#');
});

test('angle is rounded to 3 decimals on write (float-rotation artifacts)', () => {
  const out = serialize([{ name: 'Str1', x: 1, y: 2, a: 29.999999996, c: 0, z: 0 }]);
  assert.equal(out, 'Str1;1.000;2.000;30;0;0#');
});

test('parseTrack accepts a /load/CODE.js response body (any vintage)', () => {
  assert.equal(serialize(parseTrack(`var text = '${FIXTURE}';`)), FIXTURE);
});

test('parseTrack skips malformed segments and unknown pieces', () => {
  const out = parseTrack('garbage#Str1;100;100;0;0;40#Nope;1;2;3;4;5#;;#Str1;200;200;0;0#');
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { name: 'Str1', x: 100, y: 100, a: 0, c: 0, z: 40 });
  assert.equal(out[1].z, 0);
});

test('parseTrack tolerates empty and non-string input', () => {
  assert.deepEqual(parseTrack(''), []);
  assert.deepEqual(parseTrack(undefined), []);
});

test('parseTrack coerces numeric fields and defaults', () => {
  const [p] = parseTrack('Str1;abc;def;xyz;qqq;zz#');
  assert.deepEqual(p, { name: 'Str1', x: 0, y: 0, a: 0, c: 0, z: 0 });
});

test('serializeForSave is byte-identical to serialize for non-negative tracks', () => {
  const sprites = parseTrack(FIXTURE);
  assert.equal(serializeForSave(sprites), serialize(sprites));
});

test('serializeForSave translates negative-origin tracks instead of dropping pieces', () => {
  const sprites = [
    { name: 'Str1', x: -30, y: -68, a: 0, c: 0, z: 0 },
    { name: 'Str1', x: 100, y: 50, a: 45, c: 2, z: 75 },
  ];
  const out = parseTrack(serializeForSave(sprites));
  assert.equal(out.length, 2);
  assert.deepEqual([out[0].x, out[0].y, out[0].z], [0, 0, 0]);
  assert.deepEqual([out[1].x, out[1].y, out[1].z], [130, 118, 75]);
});

test('serializeForSave never mutates the model', () => {
  const sprites = [{ name: 'Str1', x: -10, y: 5, a: 0, c: 0, z: 3 }];
  serializeForSave(sprites);
  assert.deepEqual(sprites, [{ name: 'Str1', x: -10, y: 5, a: 0, c: 0, z: 3 }]);
});

test('share codec round-trips and matches Node base64url', () => {
  const code = encodeShare(parseTrack(FIXTURE));
  assert.equal(decodeShare(code), FIXTURE);
  assert.equal(code, Buffer.from(FIXTURE, 'utf8').toString('base64url'));
  assert.ok(!code.includes('+') && !code.includes('/') && !code.includes('='));
});

test('share codec survives 5000 pieces (chunked — no spread stack crash)', () => {
  const sprites = Array.from({ length: 5000 }, (_, i) =>
    ({ name: 'Str1', x: (i * 7) % 3000, y: (i * 11) % 2000, a: (i % 8) * 45, c: 0, z: (i % 3) * 75 }));
  const s = serialize(sprites);
  assert.ok(s.length > 90_000); /* the input that crashed the old spread */
  const code = encodeShare(sprites);
  assert.equal(decodeShare(code), s);
});
