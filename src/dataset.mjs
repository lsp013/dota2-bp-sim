/**
 * Dataset hydration.
 *
 * ON-DISK FORMAT
 * --------------
 * A matchup pair stores only what was actually OBSERVED:
 *
 *     matchups[heroId][foeId] = { g: gamesPlayed, w: wins }
 *
 * Everything else the engine and UI show — the win rate, the Wilson interval,
 * the confidence tier — is a pure function of those two integers and is
 * recomputed here on load.
 *
 * WHY
 * ---
 * Storing `p`, `lb`, `ub` and `t` alongside `g`/`w` cost roughly 70% of the JSON
 * bytes to memoise a computation that takes microseconds. Dropping them cut the
 * boot payload (OpenDota + STRATZ, both fetched because merged is the default)
 * from 2.13 MB to well under 1 MB, which is the difference between snappy and
 * sluggish on a phone.
 *
 * This is LOSSLESS: `g` and `w` — the raw observations — are preserved exactly
 * and never rewritten, only read. No information is discarded.
 *
 * Hydration is also idempotent, so a legacy file that still carries the derived
 * fields keeps working: they are simply recomputed to the same values.
 */

import { wilson, tierFor } from './wilson.mjs';

const round = (n, dp = 4) => Math.round(n * 10 ** dp) / 10 ** dp;

/** True when a row still lacks the derived fields. */
export function isSlimRow(v) {
  return v != null && (v.p === undefined || v.lb === undefined || v.t === undefined);
}

/** True when any row in the dataset lacks the derived fields. */
export function isSlim(ds) {
  for (const row of Object.values(ds?.matchups ?? {})) {
    for (const v of Object.values(row)) if (isSlimRow(v)) return true;
  }
  return false;
}

/**
 * Fill in the derived fields for every matchup pair, in place.
 *
 * Mutates rather than copying: this runs on a freshly parsed object we own, and
 * copying a 16,000-pair structure would double peak memory for no benefit.
 *
 * @param {object} ds dataset ({ meta, heroes, matchups })
 * @returns {object} the same object, hydrated
 */
export function hydrateDataset(ds) {
  if (!ds?.matchups) return ds;

  let pairs = 0;
  for (const row of Object.values(ds.matchups)) {
    for (const v of Object.values(row)) {
      if (!v) continue;
      const games = Number(v.g);
      if (!Number.isFinite(games) || games <= 0) continue;

      // Never let a corrupt count produce a rate above 1.
      const wins = Math.min(Number(v.w) || 0, games);

      const iv = wilson(wins, games);
      v.g = games;
      v.w = wins;
      v.p = round(iv.point);
      v.lb = round(iv.lower);
      v.ub = round(iv.upper);
      v.t = tierFor(games);
      pairs++;
    }
  }

  ds.meta = {
    ...(ds.meta ?? {}),
    format: 2,
    hydratedAt: new Date().toISOString(),
    hydratedPairs: pairs,
  };
  return ds;
}
