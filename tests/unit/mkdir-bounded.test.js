import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdirBounded } from '../../lib/mkdir-bounded.js';

test('mkdirBounded: creates nested dirs and resolves (happy path)', async () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'm4wd-mb-')), 'a', 'b');
  await mkdirBounded(dir);
  assert.ok(fs.existsSync(dir));
});

test('mkdirBounded: a mkdir that never settles rejects as M4WD_MKDIR_TIMEOUT naming dir + label', async () => {
  const hang = () => new Promise(() => {});
  await assert.rejects(
    mkdirBounded('/proc/nowhere', { timeoutMs: 20, mkdir: hang, label: 'SQLITE_PATH=/proc/nowhere/tracks.db' }),
    (e) => e.code === 'M4WD_MKDIR_TIMEOUT'
      && e.message.includes('/proc/nowhere')
      && e.message.includes('SQLITE_PATH=/proc/nowhere/tracks.db'),
  );
});

test('mkdirBounded: honest mkdir errors propagate untouched (no timeout masking)', async () => {
  const eacc = Object.assign(new Error("EACCES: permission denied, mkdir '/x'"), { code: 'EACCES' });
  await assert.rejects(
    mkdirBounded('/x', { timeoutMs: 1000, mkdir: () => Promise.reject(eacc) }),
    (e) => e === eacc,
  );
});
