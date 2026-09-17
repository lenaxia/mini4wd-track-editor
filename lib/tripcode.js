/* Tripcode identity — worklog 0023, server-side only.
 *
 * A byline is optional: `Alex#secret phrase` at publish time. The name
 * part is stored as the byline; the phrase is hashed with scrypt plus a
 * per-instance salt (never stored raw) and the hash binds the identity:
 * tracks carrying one are editable in place only by whoever presents
 * the phrase again. Everyone else still gets Copy — nothing is ever
 * locked away, editing rights just belong to the author.
 *
 * Salt: M4WD_TRIP_SALT env (tests pin it), else a generated file under
 * the data dir (persisted across restarts), else ephemeral per boot. */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

let cachedSalt = null;

function getSalt() {
  if (process.env.M4WD_TRIP_SALT) return process.env.M4WD_TRIP_SALT;
  if (cachedSalt) return cachedSalt;
  try {
    /* STORE=sqlite writes here anyway; a static-only deploy may not have
     * a data dir — fall through to ephemeral */
    fs.mkdirSync('data', { recursive: true });
    const p = path.join('data', 'trip.salt');
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
export function tripHash(phrase) {
  return crypto.scryptSync(phrase, getSalt(), 16).toString('hex');
}

/* Short display code for bylines: `Alex!9f3ab2c1`. */
export function tripCode(hash) {
  return typeof hash === 'string' ? hash.slice(0, 8) : null;
}
