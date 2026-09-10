import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialize, parseTrack, encodeShare, decodeShare } from '../../src/track.js';

/* Byte-compat is a release blocker: parse → serialize must reproduce the
 * input exactly (original pimentoso format, trailing # included). */
const FIXTURE = 'Str2;100.000;100.000;0;0#Str1;154.000;100.000;0;0#Cor1;208.000;100.000;0;1#Lan1;216.050;95.750;45;0#';

test('parseTrack -> serialize round-trips byte-identically', () => {
  assert.equal(serialize(parseTrack(FIXTURE)), FIXTURE);
});

test('parseTrack accepts a /load/CODE.js response body', () => {
  const wrapped = `var text = '${FIXTURE}';`;
  assert.equal(serialize(parseTrack(wrapped)), FIXTURE);
});

test('parseTrack skips malformed segments and unknown pieces', () => {
  const out = parseTrack('garbage#Str1;100;100;0;0#Nope;1;2;3;4#;;#Str1;200;200;0;0#');
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { name: 'Str1', x: 100, y: 100, a: 0, c: 0 });
  assert.deepEqual(out[1], { name: 'Str1', x: 200, y: 200, a: 0, c: 0 });
});

test('parseTrack tolerates empty and non-string input', () => {
  assert.deepEqual(parseTrack(''), []);
  assert.deepEqual(parseTrack(undefined), []);
});

test('parseTrack coerces numeric fields and defaults', () => {
  const [p] = parseTrack('Str1;abc;def;xyz;qqq#');
  assert.deepEqual(p, { name: 'Str1', x: 0, y: 0, a: 0, c: 0 });
});

test('serialize filters out negative coordinates', () => {
  const sprites = parseTrack(FIXTURE);
  sprites.push({ name: 'Str1', x: -50, y: 100, a: 0, c: 0 });
  assert.equal(serialize(sprites), FIXTURE);
});

test('serialize formats coordinates with toFixed(3)', () => {
  const [s] = parseTrack(serialize([{ name: 'Str1', x: 10.5, y: 20.25, a: 0, c: 0 }]));
  assert.equal(s.x, 10.5);
  assert.equal(serialize([{ name: 'Str1', x: 10.5, y: 20.25, a: 0, c: 0 }]), 'Str1;10.500;20.250;0;0#');
});

test('share codec round-trips and matches Node base64url', () => {
  const code = encodeShare(parseTrack(FIXTURE));
  assert.equal(decodeShare(code), FIXTURE);
  assert.equal(code, Buffer.from(FIXTURE, 'utf8').toString('base64url'));
  assert.ok(!code.includes('+') && !code.includes('/') && !code.includes('='));
});
