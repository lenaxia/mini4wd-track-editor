/* Snapshot retention policy — worklog 0022. Pure functions, no state:
 * every driver and the server route layer share these decisions, and
 * the unit suite pins them without touching storage.
 *
 * Two rules:
 * 1. STABILITY: a version that lived under STABLE_MS as the head was a
 *    work-in-progress instant, not a version — it is never archived.
 *    A 40-minute editing burst therefore leaves ONE snapshot: the state
 *    right before it started, timestamped at burst start.
 * 2. TIERS: as snapshots age they thin out — at most one per 5-minute
 *    gap inside the last 30 minutes, one per hour inside the last 4
 *    hours, one per day inside the last week; older than that, dropped.
 *    Worst case ≈ 17 per track; REVISION_CAP stays as the absolute
 *    backstop. Pruning runs on every archive — no timers. */

const MIN = 60 * 1000, H = 60 * MIN, D = 24 * H;

/* Overridable for tests/self-hosters (env: M4WD_STABLE_MS). */
export const STABLE_MS = Number(process.env.M4WD_STABLE_MS) > 0
  ? Number(process.env.M4WD_STABLE_MS)
  : 5 * MIN;

export const TIERS = [
  { maxAge: 30 * MIN, spacing: 5 * MIN },
  { maxAge: 4 * H, spacing: 1 * H },
  { maxAge: 7 * D, spacing: 1 * D },
];

/* Rule 1 — archive the outgoing head only if it had been stable. */
export function shouldArchive(prevUpdatedAt, now = Date.now()) {
  if (!Number.isFinite(prevUpdatedAt)) return true;   /* unknown age: keep, never lose */
  return now - prevUpdatedAt >= STABLE_MS;
}

/* Rule 2 — which of `entries` ([{seq, created_at}], any order) survive.
 * Within the ladder the newest always survives; each older one needs a gap
 * tier's spacing below the newest KEPT entry; past the last tier it is
 * gone. Gaps measured against kept entries make the set converge as
 * entries age and later archives re-prune. */
export function keepSet(entries, now = Date.now()) {
  const kept = new Set();
  /* newest first; seq breaks same-millisecond ties so the latest write
   * wins a bucket (the most recent snapshot absorbs the burst) */
  const sorted = [...entries].sort((a, b) => (b.created_at - a.created_at) || (b.seq - a.seq));
  let lastKept = Infinity;
  for (const e of sorted) {
    const age = now - e.created_at;
    const spacing = TIERS.find((t) => age < t.maxAge)?.spacing;
    if (spacing === undefined) continue;                       /* older than the ladder */
    if (lastKept - e.created_at >= spacing || lastKept === Infinity) {
      kept.add(e.seq);
      lastKept = e.created_at;
    }
  }
  return kept;
}
