/* In-memory store — tests, e2e, and STORE=memory. Same interface and
 * facet semantics as the durable drivers; no persistence. */

export function open() {
  const rows = new Map();   // id -> row
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
    async remove(id) { return rows.delete(id); },
    async star(id) {
      const r = rows.get(id);
      if (!r) return null;
      r.stars += 1;
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
