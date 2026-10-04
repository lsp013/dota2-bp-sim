/**
 * Wilson score interval — the statistical core of this project.
 *
 * Why this exists:
 * OpenDota's /heroes/{id}/matchups returns a rolling recent window. Measured
 * distribution over 1008 matchups: median 45 games, p25 = 24, p90 = 138.
 * Raw win-rate ranking on samples that small is garbage — a 2-game pair with
 * 2 wins shows "100%" and would top every recommendation list.
 *
 * The Wilson score lower bound fixes this the principled way: it asks
 * "given this sample, what is the pessimistic estimate of the true win rate?"
 * Small samples get pulled toward 0.5, so they cannot outrank a genuinely
 * strong matchup that was measured properly. This is the same technique
 * Reddit famously used for comment ranking.
 *
 * We sort by the LOWER bound (not the point estimate) so that evidence
 * quantity and evidence quality both matter.
 */

/** 95% two-sided confidence. */
export const Z_95 = 1.959963984540054;

/**
 * Wilson score interval for a binomial proportion.
 *
 * @param {number} wins   successes observed
 * @param {number} total  trials observed
 * @param {number} [z]    z-score for desired confidence (default 95%)
 * @returns {{point:number, lower:number, upper:number}}
 */
export function wilson(wins, total, z = Z_95) {
  if (!Number.isFinite(wins) || !Number.isFinite(total) || total <= 0) {
    return { point: 0.5, lower: 0, upper: 1 };
  }
  // Guard against upstream data where wins > games_played.
  const n = total;
  const p = Math.min(1, Math.max(0, wins / n));
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  const lower = (center - spread) / denom;
  const upper = (center + spread) / denom;
  return {
    point: p,
    lower: Math.max(0, lower),
    upper: Math.min(1, upper),
  };
}

/**
 * Confidence tier from raw sample size.
 * Thresholds chosen from the measured OpenDota distribution so the UI can be
 * honest: at >=100 games only ~18.7% of pairs qualify, so anything stricter
 * would blank out most of the tool.
 */
export function tierFor(total) {
  if (total >= 100) return 'high';   // green  — trustworthy
  if (total >= 30) return 'medium';  // yellow — indicative
  return 'low';                      // red    — archived, never ranked
}

/** Low tier is excluded from ranking entirely. */
export function isRankable(total) {
  return total >= 30;
}
