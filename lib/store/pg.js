/* PostgreSQL driver — lazy: the `pg` package is only required when
 * STORE=postgres, so the default (sqlite/memory) path stays zero-dep.
 * Same schema and interface as the sqlite driver (DOUBLE PRECISION for
 * the REAL facets is the only dialect difference). */

import { REVISION_CAP } from './index.js';
import { keepSet } from './retention.js';

const DDL = `
CREATE TABLE IF NOT EXISTS tracks (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  author      TEXT,
  data        TEXT NOT NULL,
  piece_count INTEGER NOT NULL DEFAULT 0,
  lanes       INTEGER NOT NULL DEFAULT 0,
  length_cm   DOUBLE PRECISION NOT NULL DEFAULT 0,
  bbox_w_cm   DOUBLE PRECISION NOT NULL DEFAULT 0,
  bbox_h_cm   DOUBLE PRECISION NOT NULL DEFAULT 0,
  straights   INTEGER NOT NULL DEFAULT 0,
  corners     INTEGER NOT NULL DEFAULT 0,
  slopes      INTEGER NOT NULL DEFAULT 0,
  stars       INTEGER NOT NULL DEFAULT 0,
  complete    INTEGER NOT NULL DEFAULT 0,
  issues      INTEGER NOT NULL DEFAULT 0,
  validator_version INTEGER NOT NULL DEFAULT 0,
  parent_id   TEXT,
  root_id     TEXT,
  parent_name TEXT,
  created_at  BIGINT NOT NULL,   -- epoch ms; pg int4 would overflow
  updated_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tracks_updated ON tracks (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracks_pieces  ON tracks (piece_count);
CREATE INDEX IF NOT EXISTS idx_tracks_length  ON tracks (length_cm);
CREATE INDEX IF NOT EXISTS idx_tracks_author  ON tracks (author) WHERE author IS NOT NULL;
CREATE TABLE IF NOT EXISTS revisions (
  seq        BIGSERIAL PRIMARY KEY,
  track_id   TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  snapshot   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revisions_track ON revisions (track_id, seq DESC);
`;

const COLS = 'id, name, author, piece_count, lanes, length_cm, bbox_w_cm, bbox_h_cm, straights, corners, slopes, stars, complete, issues, validator_version, parent_id, root_id, parent_name, created_at, updated_at';

const SORTS = {
  'updated_at': 'updated_at', '-updated_at': 'updated_at DESC',
  'created_at': 'created_at', '-created_at': 'created_at DESC',
  'name': 'name', '-name': 'name DESC',
  'pieces': 'piece_count', '-pieces': 'piece_count DESC',
  'length': 'length_cm', '-length': 'length_cm DESC',
  'lanes': 'lanes', '-lanes': 'lanes DESC',
  'bbox': '(bbox_w_cm * bbox_h_cm)', '-bbox': '(bbox_w_cm * bbox_h_cm) DESC',
  'straights': 'straights', '-straights': 'straights DESC',
  'corners': 'corners', '-corners': 'corners DESC',
  'slopes': 'slopes', '-slopes': 'slopes DESC',
  'stars': 'stars', '-stars': 'stars DESC',
  'complete': 'complete', '-complete': 'complete DESC',
};

export async function open(connectionString) {
  let pg;
  try { pg = await import('pg'); }
  catch { throw new Error('STORE=postgres requires the pg package (npm install)'); }
  const pool = new pg.Pool({ connectionString, max: 10 });
  await pool.query(DDL);
  /* additive migration for pre-facet databases */
  for (const col of ['straights INTEGER NOT NULL DEFAULT 0', 'corners INTEGER NOT NULL DEFAULT 0', 'slopes INTEGER NOT NULL DEFAULT 0',
                     'stars INTEGER NOT NULL DEFAULT 0', 'complete INTEGER NOT NULL DEFAULT 0',
                     'issues INTEGER NOT NULL DEFAULT 0', 'validator_version INTEGER NOT NULL DEFAULT 0',
                     'parent_id TEXT', 'root_id TEXT', 'parent_name TEXT']) {
    await pool.query(`ALTER TABLE tracks ADD COLUMN IF NOT EXISTS ${col}`).catch(() => {});
  }

  /* int8 (BIGINT) arrives as string from node-pg — normalize to number */
  const row = (r) => r && ({ ...r, data: JSON.parse(r.data), created_at: Number(r.created_at), updated_at: Number(r.updated_at) });

  return {
    driver: 'postgres',
    async get(id) {
      const res = await pool.query(`SELECT ${COLS}, data FROM tracks WHERE id = $1`, [id]);
      return res.rows[0] ? row(res.rows[0]) : null;
    },
    async list(q) {
      const where = [], params = [];
      if (q.author) { where.push(`author = $${params.push(q.author)}`); }
      if (q.min_pieces != null) { where.push(`piece_count >= $${params.push(q.min_pieces)}`); }
      if (q.max_pieces != null) { where.push(`piece_count <= $${params.push(q.max_pieces)}`); }
      if (q.min_length != null) { where.push(`length_cm >= $${params.push(q.min_length)}`); }
      if (q.max_length != null) { where.push(`length_cm <= $${params.push(q.max_length)}`); }
      if (q.complete === true) where.push('complete = 1');
      if (q.complete === false) where.push('complete = 0');
      if (q.min_lanes != null) { where.push(`lanes >= $${params.push(q.min_lanes)}`); }
      if (q.lanes) { const marks = q.lanes.map((v) => `$${params.push(v)}`); where.push(`lanes IN (${marks.join(',')})`); }
      /* room caps are rotation-free (either orientation fits) */
      if (q.max_bbox_w != null && q.max_bbox_h != null) {
        where.push(`((bbox_w_cm <= $${params.push(q.max_bbox_w)} AND bbox_h_cm <= $${params.push(q.max_bbox_h)})`
          + ` OR (bbox_w_cm <= $${params.push(q.max_bbox_h)} AND bbox_h_cm <= $${params.push(q.max_bbox_w)}))`);
      } else if (q.max_bbox_w != null) { where.push(`LEAST(bbox_w_cm, bbox_h_cm) <= $${params.push(q.max_bbox_w)}`); }
      else if (q.max_bbox_h != null) { where.push(`LEAST(bbox_w_cm, bbox_h_cm) <= $${params.push(q.max_bbox_h)}`); }
      if (q.max_straights != null) { where.push(`straights <= $${params.push(q.max_straights)}`); }
      if (q.max_slopes != null) { where.push(`slopes <= $${params.push(q.max_slopes)}`); }
      if (q.max_corners != null) { where.push(`corners <= $${params.push(q.max_corners)}`); }
      const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const total = Number((await pool.query(`SELECT COUNT(*) c FROM tracks ${w}`, params)).rows[0].c);
      const order = SORTS[q.sort] || 'updated_at DESC';
      const limit = Math.min(q.limit || 50, 100);
      params.push(limit, q.offset || 0);
      const res = await pool.query(
        `SELECT ${COLS} FROM tracks ${w} ORDER BY ${order}, id LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
      /* int8 columns (timestamps) arrive as strings — normalize like row() */
      const items = res.rows.map(({ data, ...m }) =>
        ({ ...m, created_at: Number(m.created_at), updated_at: Number(m.updated_at) }));
      return { total, items };
    },
    async upsert(t) {
      const ts = Date.now();
      const f = t._facets;
      const res = await pool.query(`
        INSERT INTO tracks (id, name, author, data, piece_count, lanes, length_cm, bbox_w_cm, bbox_h_cm,
                            straights, corners, slopes, complete, issues, validator_version, parent_id, root_id, parent_name, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
        ON CONFLICT (id) DO UPDATE SET
          name = excluded.name, author = excluded.author, data = excluded.data,
          piece_count = excluded.piece_count, lanes = excluded.lanes,
          length_cm = excluded.length_cm, bbox_w_cm = excluded.bbox_w_cm,
          bbox_h_cm = excluded.bbox_h_cm, straights = excluded.straights,
          corners = excluded.corners, slopes = excluded.slopes, complete = excluded.complete,
          issues = excluded.issues, validator_version = excluded.validator_version,
          parent_id = excluded.parent_id, root_id = excluded.root_id, parent_name = excluded.parent_name,
          updated_at = excluded.updated_at
        RETURNING ${COLS}`,
        [t.id, t.name, t.author ?? null, JSON.stringify(t.data),
         f.piece_count, f.lanes, f.length_cm, f.bbox_w_cm, f.bbox_h_cm,
         f.straights, f.corners, f.slopes, f.complete ? 1 : 0, f.issues ?? 0, f.validator_version ?? 0,
         t.parent_id ?? null, t.root_id ?? null, t.parent_name ?? null, ts, ts]);
      const { data, ...m } = res.rows[0];
      return { ...m, created_at: Number(m.created_at), updated_at: Number(m.updated_at),
               stars: Number(m.stars), complete: !!m.complete, issues: Number(m.issues),
               validator_version: Number(m.validator_version),
               straights: Number(m.straights), corners: Number(m.corners), slopes: Number(m.slopes) };
    },
    async star(id) {
      const res = await pool.query('UPDATE tracks SET stars = stars + 1 WHERE id = $1 RETURNING stars', [id]);
      return res.rows[0] ? Number(res.rows[0].stars) : null;
    },
    async unstar(id) {
      const res = await pool.query('UPDATE tracks SET stars = GREATEST(0, stars - 1) WHERE id = $1 RETURNING stars', [id]);
      return res.rows[0] ? Number(res.rows[0].stars) : null;
    },
    async staleIds(cutoffMs, currentVersion) {
      const res = await pool.query('SELECT id FROM tracks WHERE updated_at > $1 OR validator_version != $2',
                                   [cutoffMs, currentVersion]);
      return res.rows.map((r) => r.id);
    },
    /* sweep: converge facet columns when classification rules change
     * (VALIDATOR_VERSION bump) without anyone re-saving */
    async setFacets(id, f) {
      await pool.query('UPDATE tracks SET piece_count = $1, lanes = $2, length_cm = $3, bbox_w_cm = $4, bbox_h_cm = $5,'
                       + ' straights = $6, corners = $7, slopes = $8 WHERE id = $9',
                       [f.piece_count, f.lanes, f.length_cm, f.bbox_w_cm, f.bbox_h_cm, f.straights, f.corners, f.slopes, id]);
    },
    async setValidation(id, complete, issues, version) {
      await pool.query('UPDATE tracks SET complete = $1, issues = $2, validator_version = $3 WHERE id = $4',
                       [complete ? 1 : 0, issues, version, id]);
    },
    async remove(id) {
      await pool.query('DELETE FROM revisions WHERE track_id = $1', [id]);
      const res = await pool.query('DELETE FROM tracks WHERE id = $1', [id]);
      return (res.rowCount || 0) > 0;
    },
    /* Version history — worklogs 0020/0022: same tier pruning as sqlite. */
    async archive(id, snapshot) {
      await pool.query('INSERT INTO revisions (track_id, created_at, snapshot) VALUES ($1,$2,$3)',
                       [id, Date.now(), JSON.stringify(snapshot)]);
      const res = await pool.query('SELECT seq, created_at FROM revisions WHERE track_id = $1 ORDER BY seq DESC', [id]);
      const rows = res.rows.map((r) => ({ seq: Number(r.seq), created_at: Number(r.created_at) }));
      const keep = keepSet(rows);
      if (rows.length > REVISION_CAP) for (const r of rows.slice(REVISION_CAP)) keep.delete(r.seq);
      if (keep.size < rows.length) {
        const list = [...keep];
        await pool.query(`DELETE FROM revisions WHERE track_id = $1 AND seq NOT IN (${list.map((_, i) => `$${i + 2}`).join(',')})`,
                         [id, ...list]);
      }
      return keep.size;
    },
    async history(id) {
      const res = await pool.query('SELECT seq, created_at, snapshot FROM revisions WHERE track_id = $1 ORDER BY seq DESC', [id]);
      return res.rows.map((r) => ({ seq: Number(r.seq), created_at: Number(r.created_at), name: JSON.parse(r.snapshot).name }));
    },
    async revision(id, seq) {
      const res = await pool.query('SELECT snapshot FROM revisions WHERE track_id = $1 AND seq = $2', [id, seq]);
      return res.rows[0] ? JSON.parse(res.rows[0].snapshot) : null;
    },
    async close() { await pool.end(); },
  };
}
