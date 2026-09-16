/* SQLite driver — node:sqlite (built into Node 22.5+/24), zero new
 * dependencies. WAL journal for crash safety and concurrent readers.
 * Schema is the portable relational shell: the track body is one JSON
 * document; searchable facets are plain indexed columns. */

import { DatabaseSync } from 'node:sqlite';

const DDL = `
CREATE TABLE IF NOT EXISTS tracks (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  author      TEXT,
  data        TEXT NOT NULL,
  piece_count INTEGER NOT NULL DEFAULT 0,
  lanes       INTEGER NOT NULL DEFAULT 0,
  length_cm   REAL NOT NULL DEFAULT 0,
  bbox_w_cm   REAL NOT NULL DEFAULT 0,
  bbox_h_cm   REAL NOT NULL DEFAULT 0,
  straights   INTEGER NOT NULL DEFAULT 0,
  corners     INTEGER NOT NULL DEFAULT 0,
  slopes      INTEGER NOT NULL DEFAULT 0,
  stars       INTEGER NOT NULL DEFAULT 0,
  complete    INTEGER NOT NULL DEFAULT 0,
  issues      INTEGER NOT NULL DEFAULT 0,
  validator_version INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tracks_updated ON tracks (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracks_pieces  ON tracks (piece_count);
CREATE INDEX IF NOT EXISTS idx_tracks_length  ON tracks (length_cm);
CREATE INDEX IF NOT EXISTS idx_tracks_author  ON tracks (author) WHERE author IS NOT NULL;
`;

const COLS = 'id, name, author, piece_count, lanes, length_cm, bbox_w_cm, bbox_h_cm, straights, corners, slopes, stars, complete, issues, validator_version, created_at, updated_at';

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

export function open(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(DDL);
  /* additive migration for pre-facet databases */
  for (const col of ['straights INTEGER NOT NULL DEFAULT 0', 'corners INTEGER NOT NULL DEFAULT 0', 'slopes INTEGER NOT NULL DEFAULT 0',
                     'stars INTEGER NOT NULL DEFAULT 0', 'complete INTEGER NOT NULL DEFAULT 0',
                     'issues INTEGER NOT NULL DEFAULT 0', 'validator_version INTEGER NOT NULL DEFAULT 0']) {
    try { db.exec(`ALTER TABLE tracks ADD COLUMN ${col}`); } catch (_) { /* already exists */ }
  }

  const row = (r) => r && ({ ...r, data: JSON.parse(r.data) });
  const meta = (r) => { const { data, ...m } = r; return m; };

  return {
    driver: 'sqlite',
    async get(id) {
      const r = db.prepare(`SELECT ${COLS}, data FROM tracks WHERE id = ?`).get(id);
      return r ? row(r) : null;
    },
    async list(q) {
      const where = [], params = [];
      if (q.author) { where.push('author = ?'); params.push(q.author); }
      if (q.min_pieces != null) { where.push('piece_count >= ?'); params.push(q.min_pieces); }
      if (q.max_pieces != null) { where.push('piece_count <= ?'); params.push(q.max_pieces); }
      if (q.min_length != null) { where.push('length_cm >= ?'); params.push(q.min_length); }
      if (q.max_length != null) { where.push('length_cm <= ?'); params.push(q.max_length); }
      if (q.complete === true) where.push('complete = 1');
      if (q.complete === false) where.push('complete = 0');
      if (q.min_lanes != null) { where.push('lanes >= ?'); params.push(q.min_lanes); }
      if (q.lanes) { where.push(`lanes IN (${q.lanes.map(() => '?').join(',')})`); params.push(...q.lanes); }
      /* room caps are rotation-free (either orientation fits) */
      if (q.max_bbox_w != null && q.max_bbox_h != null) {
        where.push('((bbox_w_cm <= ? AND bbox_h_cm <= ?) OR (bbox_w_cm <= ? AND bbox_h_cm <= ?))');
        params.push(q.max_bbox_w, q.max_bbox_h, q.max_bbox_h, q.max_bbox_w);
      } else if (q.max_bbox_w != null) { where.push('MIN(bbox_w_cm, bbox_h_cm) <= ?'); params.push(q.max_bbox_w); }
      else if (q.max_bbox_h != null) { where.push('MIN(bbox_w_cm, bbox_h_cm) <= ?'); params.push(q.max_bbox_h); }
      if (q.max_straights != null) { where.push('straights <= ?'); params.push(q.max_straights); }
      if (q.max_slopes != null) { where.push('slopes <= ?'); params.push(q.max_slopes); }
      if (q.max_corners != null) { where.push('corners <= ?'); params.push(q.max_corners); }
      const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const total = db.prepare(`SELECT COUNT(*) c FROM tracks ${w}`).get(...params).c;
      const order = SORTS[q.sort] || 'updated_at DESC';
      const limit = Math.min(q.limit || 50, 100);
      const offset = q.offset || 0;
      /* sort + id tiebreak keeps pagination deterministic */
      const items = db.prepare(
        `SELECT ${COLS} FROM tracks ${w} ORDER BY ${order}, id LIMIT ? OFFSET ?`
      ).all(...params, limit, offset).map(meta);
      return { total, items };
    },
    async upsert(t) {
      const ts = Date.now();
      const f = t._facets;
      return db.prepare(`
        INSERT INTO tracks (id, name, author, data, piece_count, lanes, length_cm, bbox_w_cm, bbox_h_cm,
                            straights, corners, slopes, complete, issues, validator_version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          name = excluded.name, author = excluded.author, data = excluded.data,
          piece_count = excluded.piece_count, lanes = excluded.lanes,
          length_cm = excluded.length_cm, bbox_w_cm = excluded.bbox_w_cm,
          bbox_h_cm = excluded.bbox_h_cm, straights = excluded.straights,
          corners = excluded.corners, slopes = excluded.slopes, complete = excluded.complete,
          issues = excluded.issues, validator_version = excluded.validator_version,
          updated_at = excluded.updated_at
        RETURNING ${COLS}`).get(t.id, t.name, t.author ?? null,
        JSON.stringify(t.data), f.piece_count, f.lanes, f.length_cm,
        f.bbox_w_cm, f.bbox_h_cm, f.straights, f.corners, f.slopes,
        f.complete ? 1 : 0, f.issues ?? 0, f.validator_version ?? 0, ts, ts);
    },
    async star(id) {
      db.prepare('UPDATE tracks SET stars = stars + 1 WHERE id = ?').run(id);
      return db.prepare('SELECT stars FROM tracks WHERE id = ?').get(id)?.stars ?? null;
    },
    async unstar(id) {
      db.prepare('UPDATE tracks SET stars = MAX(0, stars - 1) WHERE id = ?').run(id);
      return db.prepare('SELECT stars FROM tracks WHERE id = ?').get(id)?.stars ?? null;
    },
    /* sweep: rows changed recently or stamped by an older validator */
    async staleIds(cutoffMs, currentVersion) {
      return db.prepare(
        'SELECT id FROM tracks WHERE updated_at > ? OR validator_version != ?'
      ).all(cutoffMs, currentVersion).map((r) => r.id);
    },
    /* sweep: converge facet columns when classification rules change
     * (VALIDATOR_VERSION bump) without anyone re-saving */
    async setFacets(id, f) {
      db.prepare('UPDATE tracks SET piece_count = ?, lanes = ?, length_cm = ?, bbox_w_cm = ?, bbox_h_cm = ?,'
                 + ' straights = ?, corners = ?, slopes = ? WHERE id = ?')
        .run(f.piece_count, f.lanes, f.length_cm, f.bbox_w_cm, f.bbox_h_cm, f.straights, f.corners, f.slopes, id);
    },
    async setValidation(id, complete, issues, version) {
      db.prepare('UPDATE tracks SET complete = ?, issues = ?, validator_version = ? WHERE id = ?')
        .run(complete ? 1 : 0, issues, version, id);
    },
    async remove(id) {
      const r = db.prepare('DELETE FROM tracks WHERE id = ?').run(id);
      return r.changes > 0;
    },
    async close() { db.close(); },
  };
}
