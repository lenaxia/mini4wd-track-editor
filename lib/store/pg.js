/* PostgreSQL driver — lazy: the `pg` package is only required when
 * STORE=postgres, so the default (sqlite/memory) path stays zero-dep.
 * Same schema and interface as the sqlite driver (DOUBLE PRECISION for
 * the REAL facets is the only dialect difference). */

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
  created_at  BIGINT NOT NULL,   -- epoch ms; pg int4 would overflow
  updated_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tracks_updated ON tracks (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracks_pieces  ON tracks (piece_count);
CREATE INDEX IF NOT EXISTS idx_tracks_length  ON tracks (length_cm);
CREATE INDEX IF NOT EXISTS idx_tracks_author  ON tracks (author) WHERE author IS NOT NULL;
`;

const COLS = 'id, name, author, piece_count, lanes, length_cm, bbox_w_cm, bbox_h_cm, created_at, updated_at';

const SORTS = {
  'updated_at': 'updated_at', '-updated_at': 'updated_at DESC',
  'created_at': 'created_at', '-created_at': 'created_at DESC',
  'name': 'name', '-name': 'name DESC',
  'pieces': 'piece_count', '-pieces': 'piece_count DESC',
  'length': 'length_cm', '-length': 'length_cm DESC',
};

export async function open(connectionString) {
  let pg;
  try { pg = await import('pg'); }
  catch { throw new Error('STORE=postgres requires the pg package (npm install)'); }
  const pool = new pg.Pool({ connectionString, max: 10 });
  await pool.query(DDL);

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
      const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const total = (await pool.query(`SELECT COUNT(*) c FROM tracks ${w}`, params)).rows[0].c;
      const order = SORTS[q.sort] || 'updated_at DESC';
      const limit = Math.min(q.limit || 50, 100);
      params.push(limit, q.offset || 0);
      const res = await pool.query(
        `SELECT ${COLS} FROM tracks ${w} ORDER BY ${order}, id LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
      const items = res.rows.map(({ data, ...m }) => m);
      return { total, items };
    },
    async upsert(t) {
      const ts = Date.now();
      const f = t._facets;
      const res = await pool.query(`
        INSERT INTO tracks (id, name, author, data, piece_count, lanes, length_cm, bbox_w_cm, bbox_h_cm, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (id) DO UPDATE SET
          name = excluded.name, author = excluded.author, data = excluded.data,
          piece_count = excluded.piece_count, lanes = excluded.lanes,
          length_cm = excluded.length_cm, bbox_w_cm = excluded.bbox_w_cm,
          bbox_h_cm = excluded.bbox_h_cm, updated_at = excluded.updated_at
        RETURNING ${COLS}`,
        [t.id, t.name, t.author ?? null, JSON.stringify(t.data),
         f.piece_count, f.lanes, f.length_cm, f.bbox_w_cm, f.bbox_h_cm, ts, ts]);
      return res.rows[0];
    },
    async remove(id) {
      const res = await pool.query('DELETE FROM tracks WHERE id = $1', [id]);
      return (res.rowCount || 0) > 0;
    },
    async close() { await pool.end(); },
  };
}
