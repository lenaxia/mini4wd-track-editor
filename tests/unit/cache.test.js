import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spriteUrl, staleKeys } from '../../src/cache.js';

const H = 'a'.repeat(64);   // sha-256 hex length
const H2 = 'b'.repeat(64);
const manifest = { 'Str1.0.svg': H, 'Cor1.0.svg': H2 };

test('spriteUrl: manifest mode keys the file by its content hash', () => {
  assert.equal(spriteUrl('Str1.0.svg', manifest, 27), `assets/Str1.0.svg?h=${H}`);
  assert.equal(spriteUrl('Cor1.0.svg', manifest, 27), `assets/Cor1.0.svg?h=${H2}`);
});

test('spriteUrl: absent manifest falls back to the global buster', () => {
  assert.equal(spriteUrl('Str1.0.svg', null, 27), 'assets/Str1.0.svg?v=27');
});

test('spriteUrl: file missing from the manifest falls back too', () => {
  assert.equal(spriteUrl('New.0.svg', manifest, 27), 'assets/New.0.svg?v=27');
});

test('staleKeys: current hashes are kept, old hashes evicted', () => {
  const keys = [
    `https://host/assets/Str1.0.svg?h=${H}`,    // current -> keep
    `https://host/assets/Str1.0.svg?h=${H2}`,   // updated -> stale
    `https://host/assets/Cor1.0.svg?h=${H2}`,   // current -> keep
    `https://host/assets/Gone.0.svg?h=${H}`,    // deleted piece -> stale
    'https://host/assets/Str1.0.svg?v=27',      // legacy buster entry -> stale
    'https://host/assets/Str1.0.svg',           // no query at all -> stale
  ];
  assert.deepEqual(staleKeys(keys, manifest), [
    `https://host/assets/Str1.0.svg?h=${H2}`,
    'https://host/assets/Gone.0.svg?h=' + H,
    'https://host/assets/Str1.0.svg?v=27',
    'https://host/assets/Str1.0.svg',
  ]);
});

test('staleKeys: subpath deployments evict exactly like root ones', () => {
  const keys = [
    `https://host/repo/assets/Str1.0.svg?h=${H}`,   // current -> keep
    `https://host/repo/assets/Str1.0.svg?h=${H2}`,  // updated -> stale
    `https://host/repo/assets/Gone.0.svg?h=${H}`,   // deleted -> stale
  ];
  assert.deepEqual(staleKeys(keys, manifest), [
    `https://host/repo/assets/Str1.0.svg?h=${H2}`,
    'https://host/repo/assets/Gone.0.svg?h=' + H,
  ]);
});

test('staleKeys: everything is stale when the manifest failed to load', () => {
  const keys = [`https://host/assets/Str1.0.svg?h=${H}`];
  assert.deepEqual(staleKeys(keys, null), keys);
});

test('blobSha: known sha-256 vector', async () => {
  const { blobSha } = await import('../../src/cache.js');
  const blob = new Blob(['abc']);
  assert.equal(await blobSha(blob),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
