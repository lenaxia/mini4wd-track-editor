/* In-memory store — tests, e2e, and STORE=memory. Same interface and
 * facet semantics as the durable drivers; no persistence. */

import { REVISION_CAP } from './index.js';

export function open() {
  const rows = new Map();   // id -> row
  const revs = new Map();   // track id -> [{seq, created_at, snapshot}]
  let nextSeq = 0;
  const now = () => Date.now();

  const meta = (r) => {
    const { data, ...m } = r;
    return m;
  };

  return {
    driver: 'memory',
    async get(id) { return rows.get(id) ? { ...rows.get(id) } : null; },
    async list(q) {
      let out = [...rows.values()];
      if (q.author) out = out.filter(r => r.author === q.author);
      if (q.min_pieces != null) out = out.filter(r => r.piece_count >= q.min_pieces);
      if (q.max_pieces != null) out = out.filter(r => r.piece_count <= q.max_pieces);
      if (q.min_length != null) out = out.filter(r => r.length_cm >= q.min_length);
      if (q.complete === true) out = out.filter(r => !!r.complete);
      if (q.complete === false) out = out.filter(r => !r.complete);
      if (q.min_lanes != null) out = out.filter(r => r.lanes >= q.min_lanes);
      const sort = q.sort || '-updated_at';
      const dir = sort.startsWith('-') ? -1 : 1;
      const col = sort.replace('-', '');
      const key = { updated_at: r => r.updated_at, created_at: r => r.created_at,
                    name: r => r.name, pieces: r => r.piece_count,
                    length: r => r.length_cm, lanes: r => r.lanes,
                    bbox: r => r.bbox_w_cm * r.bbox_h_cm, straights: r => r.straights,
                    corners: r => r.corners, stars: r => r.stars,
                    complete: r => (r.complete ? 1 : 0) }[col] || (r => r.updated_at);
      out.sort((a, b) => { const ka = key(a), kb = key(b);
        return (ka < kb ? -1 : ka > kb ? 1 : 0) * dir || (a.id < b.id ? -1 : 1); });
      const total = out.length;
      const offset = q.offset || 0;
      return { total, items: out.slice(offset, offset + (q.limit || 50)).map(meta) };
    },
    async upsert(t) {
      const prev = rows.get(t.id);
      const ts = now();
      const row = {
        ...t, ...t._facets,
        stars: prev ? prev.stars : 0,   /* column default like sqlite/pg; re-saves keep the count */
        created_at: prev ? prev.created_at : ts, updated_at: ts,
      };
      delete row._facets;
      rows.set(t.id, row);
      return { ...row };
    },
    async remove(id) { const ok = rows.delete(id); revs.delete(id); return ok; },
    /* Version history: archive the row as it stood, prune past cap.
     * Same contract as the durable drivers. */
    async archive(id, snapshot) {
      const list = revs.get(id) || [];
      list.push({ seq: ++nextSeq, created_at: now(), snapshot: JSON.parse(JSON.stringify(snapshot)) });
      revs.set(id, list.length > REVISION_CAP ? list.slice(list.length - REVISION_CAP) : list);
      return revs.get(id).length;
    },
    async history(id) {
      const rowsMeta = [...(revs.get(id) || [])].reverse()
        .map(({ seq, created_at, snapshot }) => ({ seq, created_at, name: snapshot.name }));
      return rowsMeta;
    },
    async revision(id, seq) {
      const r = (revs.get(id) || []).find(x => x.seq === seq);
      return r ? JSON.parse(JSON.stringify(r.snapshot)) : null;
    },
    async star(id) {
      const r = rows.get(id);
      if (!r) return null;
      r.stars += 1;
      return r.stars;
    },
    async unstar(id) {
      const r = rows.get(id);
      if (!r) return null;
      r.stars = Math.max(0, r.stars - 1);   /* floor: the counter never goes negative */
      return r.stars;
    },
    async staleIds(cutoffMs, currentVersion) {
      return [...rows.values()].filter(r => r.updated_at > cutoffMs || r.validator_version !== currentVersion).map(r => r.id);
    },
    async setValidation(id, complete, issues, version) {
      const r = rows.get(id);
      if (!r) return;
      r.complete = complete ? 1 : 0; r.issues = issues; r.validator_version = version;
    },
    async close() {},
  };
}
