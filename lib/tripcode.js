/* Tripcode identity — worklog 0023, server-side only.
 *
 * A byline is optional: `Alex#secret phrase` at publish time. The name
 * part is stored as the byline; the phrase is hashed with scrypt plus a
 * per-instance salt (never stored raw) and the hash binds the identity:
 * tracks carrying one are editable in place only by whoever presents
 * the phrase again. Everyone else still gets Copy — nothing is ever
 * locked away, editing rights just belong to the author.
 *
 * Salt: M4WD_TRIP_SALT env (tests pin it), else a generated file beside
 * the store's database (dirname of SQLITE_PATH — the persisted /data
 * volume in Docker; ./data under the CWD when unset), else ephemeral
 * per boot. */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

let cachedSalt = null;

/* Test seam: drop the memoized salt so a fresh env re-resolves. */
export function _resetSaltCache() { cachedSalt = null; }

/* Boot-time entry (server.js): resolve the salt once up front so its
 * sync file IO happens at startup — a pathological data dir (a mount
 * where recursive mkdir can spin) fails loud there instead of wedging
 * the first signed save mid-request. */
export function initSalt(env = process.env) { return getSalt(env); }

function getSalt(env = process.env) {
  if (env.M4WD_TRIP_SALT) return env.M4WD_TRIP_SALT;
  if (cachedSalt) return cachedSalt;
  try {
    /* Beside the store's database so the salt rides the same persisted
     * location as the data (a static-only or memory deploy without
     * SQLITE_PATH falls back to ./data under the CWD) — fall through
     * to ephemeral where even that fails */
    const dir = path.dirname(env.SQLITE_PATH || path.join('data', 'tracks.db'));
    /* existsSync gate: never recursive-mkdir a dir we already have —
     * on ENOENT-lying mounts (some /proc, FUSE) that call never
     * returns and would freeze the event loop */
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, 'trip.salt');
    if (fs.existsSync(p)) cachedSalt = fs.readFileSync(p, 'utf8').trim();
    else {
      cachedSalt = crypto.randomBytes(16).toString('hex');
      fs.writeFileSync(p, cachedSalt + '\n');
    }
    return cachedSalt;
  } catch { return cachedSalt = crypto.randomBytes(16).toString('hex'); }
}

/* `Alex#secret` → { name: 'Alex', phrase: 'secret' }; `Alex` → name only;
 * `#secret` → anonymous identity; empty → no byline at all. */
export function parseTrip(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { name: null, phrase: null };
  const i = raw.indexOf('#');
  if (i < 0) return { name: raw.trim().slice(0, 100) || null, phrase: null };
  const name = raw.slice(0, i).trim().slice(0, 100) || null;
  const phrase = raw.slice(i + 1).trim();
  return { name, phrase: phrase || null };
}

/* Full hex hash — what the database stores and what verification
 * compares. Never throws on odd input (scrypt handles any string). */
export function tripHash(phrase, env) {
  return crypto.scryptSync(phrase, getSalt(env), 16).toString('hex');
}

/* Short display code for bylines: `Alex!9f3ab2c1`. */
export function tripCode(hash) {
  return typeof hash === 'string' ? hash.slice(0, 8) : null;
}

/* Lock gate (issue 64): does the presented byline open this stored
 * hash? Accepts the raw `name#phrase` form (the phrase is what hashes).
 * A null stored hash is no lock at all — freely open, per the no-auth
 * model; a present hash opens ONLY for the exact phrase. */
export function tripMatches(storedHash, raw) {
  if (!storedHash) return true;
  const { phrase } = parseTrip(raw);
  return phrase ? tripHash(phrase) === storedHash : false;
}
