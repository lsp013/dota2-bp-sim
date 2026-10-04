/**
 * Dataset merging — powers the "OpenDota + STRATZ" mode.
 *
 * A dataset is `{ meta, heroes, matchups }` where
 * `matchups[heroId][foeId] = { g, w, p, lb, ub, t }`.
 *
 * Merging pools the raw counts per pair and re-derives the interval, rather
 * than averaging percentages. That is the statistically meaningful operation:
 * two samples of the same matchup, however differently sized, combine by adding
 * games and wins.
 *
 * Caveat worth keeping in mind (and surfaced in the UI): the two sources are
 * not drawn from identical populations — OpenDota is a rolling recent window
 * across all ranks, STRATZ here is one week across the calibrated brackets. So
 * a merged figure is "everything we know", not a single clean estimate. In
 * practice STRATZ is 15-50x larger, so the merge lands very close to STRATZ and
 * mainly fills pairs that one source happens to miss.
 */

import { wilson, tierFor } from './wilson.mjs';

const round = (n, dp = 4) => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * Combine two datasets.
 *
 * @param {object|null} a
 * @param {object|null} b
 * @param {{label?:string}} [opts]
 * @returns {object} a new dataset; inputs are not modified
 */
export function mergeDatasets(a, b, opts = {}) {
  if (!a) return b ?? null;
  if (!b) return a ?? null;

  // Same hero list in both (STRATZ borrows OpenDota's), but union defensively.
  const heroes = [...(a.heroes ?? [])];
  const seen = new Set(heroes.map((h) => h.id));
  for (const h of b.heroes ?? []) if (!seen.has(h.id)) heroes.push(h);

  const matchups = {};
  let pairs = 0;
  let fromAOnly = 0;
  let fromBOnly = 0;
  let both = 0;
  const sampleSizes = [];

  const heroIds = new Set([
    ...Object.keys(a.matchups ?? {}),
    ...Object.keys(b.matchups ?? {}),
  ]);

  for (const heroId of heroIds) {
    const rowA = a.matchups?.[heroId] ?? {};
    const rowB = b.matchups?.[heroId] ?? {};
    const row = {};
    const foeIds = new Set([...Object.keys(rowA), ...Object.keys(rowB)]);

    for (const foeId of foeIds) {
      const x = rowA[foeId];
      const y = rowB[foeId];
      let g = 0;
      let w = 0;

      if (x && y) { g = x.g + y.g; w = x.w + y.w; both++; }
      else if (x) { g = x.g; w = x.w; fromAOnly++; }
      else { g = y.g; w = y.w; fromBOnly++; }

      if (g <= 0) continue;
      if (w > g) w = g; // guard against upstream inconsistency

      const iv = wilson(w, g);
      row[foeId] = {
        g,
        w,
        p: round(iv.point),
        lb: round(iv.lower),
        ub: round(iv.upper),
        t: tierFor(g),
      };
      pairs++;
      sampleSizes.push(g);
    }

    matchups[heroId] = row;
  }

  sampleSizes.sort((x, y) => x - y);
  const q = (p) => (sampleSizes.length ? sampleSizes[Math.floor(sampleSizes.length * p)] : 0);

  const meta = {
    ...(a.meta ?? {}),
    source: opts.label ?? `${a.meta?.source ?? '?'}+${b.meta?.source ?? '?'}`,
    sources: [a.meta?.source, b.meta?.source].filter(Boolean),
    builtAt: new Date().toISOString(),
    merged: {
      pairsInBoth: both,
      pairsFromAOnly: fromAOnly,
      pairsFromBOnly: fromBOnly,
    },
    pairs,
    rankablePairs: sampleSizes.filter((n) => n >= 30).length,
    sampleStats: {
      p25: q(0.25),
      median: q(0.5),
      p75: q(0.75),
      p90: q(0.9),
      max: sampleSizes.length ? sampleSizes[sampleSizes.length - 1] : 0,
    },
    note:
      'Merged by pooling raw games/wins per matchup, so larger samples dominate. ' +
      'The two sources cover different populations (OpenDota: rolling recent, all ' +
      'ranks; STRATZ: one week, calibrated brackets), so treat this as "all ' +
      'evidence available" rather than one clean estimate.',
  };

  return { meta, heroes, matchups };
}
