/* Bounded recursive mkdir — server-side.
 *
 * Node's recursive mkdir retries forever on mounts that answer
 * mkdir(2) with a lying ENOENT (some /proc, FUSE): the sync variant
 * freezes the event loop outright and no try/catch bounds it. The
 * promises variant retries step-by-step across the event loop, so
 * racing it against a timer turns the hang into a loud error. */
import fs from 'node:fs';

export async function mkdirBounded(dir, { timeoutMs = 5000, label = '', mkdir = fs.promises.mkdir } = {}) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(
      new Error(`giving up creating "${dir}"${label ? ` [${label}]` : ''}: mkdir did not answer within ${timeoutMs}ms (ENOENT-lying mount?)`),
      { code: 'M4WD_MKDIR_TIMEOUT' },
    )), timeoutMs);
  });
  try {
    await Promise.race([mkdir(dir, { recursive: true }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
