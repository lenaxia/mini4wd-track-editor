/* In-memory store — tests, e2e, and STORE=memory. Same interface and
 * facet semantics as the durable drivers; no persistence. */

import { REVISION_CAP } from './index.js';
import { keepSet } from './retention.js';

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
      if (q.max_length != null) out = out.filter(r => r.length_cm <= q.max_length);
      if (q.complete === true) out = out.filter(r => !!r.complete);
      if (q.complete === false) out = out.filter(r => !r.complete);
      if (q.min_lanes != null) out = out.filter(r => r.lanes >= q.min_lanes);
      if (q.lanes) out = out.filter(r => q.lanes.includes(r.lanes));
      /* room caps are rotation-free: a track fits if EITHER orientation
       * fits (owner ruling — W×H and H×W are the same room turned) */
      const fits = (r, W, H) => (r.bbox_w_cm <= W && r.bbox_h_cm <= H) || (r.bbox_w_cm <= H && r.bbox_h_cm <= W);
      if (q.max_bbox_w != null && q.max_bbox_h != null)
        out = out.filter(r => fits(r, q.max_bbox_w, q.max_bbox_h));
      else if (q.max_bbox_w != null) out = out.filter(r => Math.min(r.bbox_w_cm, r.bbox_h_cm) <= q.max_bbox_w);
      else if (q.max_bbox_h != null) out = out.filter(r => Math.min(r.bbox_w_cm, r.bbox_h_cm) <= q.max_bbox_h);
      if (q.max_straights != null) out = out.filter(r => r.straights <= q.max_straights);
      if (q.max_slopes != null) out = out.filter(r => r.slopes <= q.max_slopes);
      if (q.max_corners != null) out = out.filter(r => r.corners <= q.max_corners);
      const sort = q.sort || '-updated_at';
      const dir = sort.startsWith('-') ? -1 : 1;
      const col = sort.replace('-', '');
      const key = { updated_at: r => r.updated_at, created_at: r => r.created_at,
                    name: r => r.name, pieces: r => r.piece_count,
                    length: r => r.length_cm, lanes: r => r.lanes,
                    bbox: r => r.bbox_w_cm * r.bbox_h_cm, straights: r => r.straights,
                    corners: r => r.corners, slopes: r => r.slopes, stars: r => r.stars,
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
      delete row._tripHash;   /* transient (worklog 0023) — never stored */
      rows.set(t.id, row);
      /* meta-only, like the durable drivers' RETURNING — get() carries
       * the body; a uniform upsert shape keeps client code from leaning
       * on a field only one driver happens to include (review, PR #40) */
      const { data, ...meta } = row;
      return meta;
    },
    async remove(id) { const ok = rows.delete(id); revs.delete(id); return ok; },
    /* Version history — worklogs 0020/0022. Same contract as the
     * durable drivers, including tier pruning via keepSet. */
    async archive(id, snapshot) {
      const list = revs.get(id) || [];
      list.push({ seq: ++nextSeq, created_at: now(), snapshot: JSON.parse(JSON.stringify(snapshot)) });
      const keep = keepSet(list.map(({ seq, created_at }) => ({ seq, created_at })));
      const pruned = list.filter((r) => keep.has(r.seq)).slice(-REVISION_CAP);
      revs.set(id, pruned);
      return pruned.length;
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
    async setFacets(id, f) {
      const r = rows.get(id);
      if (!r) return;
      Object.assign(r, { piece_count: f.piece_count, lanes: f.lanes, length_cm: f.length_cm,
        bbox_w_cm: f.bbox_w_cm, bbox_h_cm: f.bbox_h_cm, straights: f.straights, corners: f.corners, slopes: f.slopes });
    },
    async setValidation(id, complete, issues, version) {
      const r = rows.get(id);
      if (!r) return;
      r.complete = complete ? 1 : 0; r.issues = issues; r.validator_version = version;
    },
    async close() {},
  };
}
