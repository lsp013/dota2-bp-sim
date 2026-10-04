/**
 * BP recommendation engine — runs entirely client-side.
 *
 * The core problem: given what each side has already picked, which hero should
 * we pick next?
 *
 * Naive approach (what DotaBuff-style lists do) is to sort by win rate. That is
 * nearly useless during a draft because it ignores who you are playing against.
 *
 * Our model is deliberately simple and explainable — every number the UI shows
 * traces back to an observed matchup sample:
 *
 *   counterScore(h) = mean over enemies e of  lb(h vs e)      // can we fight them?
 *   synergyScore(h) = mean over allies  a of  lb(h vs a)      // do we fit together?
 *   baseScore(h)    = lb of h's overall win rate
 *
 *   total = wCounter*counter + wSynergy*synergy + wBase*base
 *
 * Everything uses the Wilson LOWER bound, so thin evidence is automatically
 * discounted rather than needing ad-hoc penalties.
 *
 * A caveat we surface in the UI rather than hide: `lb(h vs a)` is measured from
 * games where h and a were on OPPOSITE teams. Using it as a synergy signal is a
 * heuristic — teams that pick well tend to pick heroes that are strong against
 * each other's weaknesses. We label it "synergy" but the tooltip is honest that
 * it is a co-occurrence proxy, not a measured same-team win rate. OpenDota's
 * public endpoints do not expose same-team pair win rates, so a true synergy
 * term would need parsed replay data.
 */

import { isRankable } from '../src/wilson.mjs';

export const DEFAULT_WEIGHTS = {
  counter: 0.5,
  synergy: 0.3,
  base: 0.2,
};

/** Minimum games before a matchup pair may influence a score. */
export const MIN_PAIR_GAMES = 30;

/**
 * Read a matchup row for (attacker vs defender), trying both directions.
 * OpenDota's matrix is not perfectly symmetric, so we prefer the direction
 * actually observed and only fall back to the reverse when needed.
 */
export function lookupPair(matchups, aId, bId) {
  const direct = matchups?.[aId]?.[bId];
  if (direct) return { ...direct, reversed: false };
  const rev = matchups?.[bId]?.[aId];
  if (rev) {
    // Reverse direction: win rate for b vs a == loss rate for a vs b.
    return {
      g: rev.g,
      w: rev.g - rev.w,
      p: 1 - rev.p,
      lb: 1 - rev.ub,
      ub: 1 - rev.lb,
      t: rev.t,
      reversed: true,
    };
  }
  return null;
}

/**
 * Overall strength of a hero = win rate across all its matchups, pooled.
 * Pooling raw counts (rather than averaging rates) weights by evidence.
 */
export function heroBase(matchups, heroId) {
  const row = matchups?.[heroId];
  if (!row) return null;
  let games = 0;
  let wins = 0;
  for (const v of Object.values(row)) {
    games += v.g;
    wins += v.w;
  }
  if (games === 0) return null;
  // Re-derive the interval from pooled counts.
  const p = wins / games;
  return { games, wins, p, lb: p, ub: p, pooled: true };
}

/**
 * Average Wilson lower bound of `heroId` against a set of opponent ids.
 * Returns { value, samples, covered } — `covered` is how many opponents had
 * usable data, so the UI can say "based on 3 of 5 enemies".
 */
export function vsSet(matchups, heroId, ids, minGames = MIN_PAIR_GAMES) {
  if (!ids.length) return { value: null, samples: 0, covered: 0, total: 0 };
  let sum = 0;
  let used = 0;
  let samples = 0;
  for (const id of ids) {
    const row = lookupPair(matchups, heroId, id);
    if (!row || !isRankable(row.g) || row.g < minGames) continue;
    sum += row.lb;
    samples += row.g;
    used++;
  }
  return {
    value: used ? sum / used : null,
    samples,
    covered: used,
    total: ids.length,
  };
}

/**
 * Score every candidate hero given the draft state.
 *
 * @param {object} dataset  parsed data.json
 * @param {object} opts
 * @param {number[]} opts.ourPicks    hero ids already on our team
 * @param {number[]} opts.enemyPicks  hero ids already on the enemy team
 * @param {number[]} opts.banned      hero ids unavailable
 * @param {object}   [opts.weights]
 * @param {number}   [opts.minPairGames]
 * @param {number}   [opts.limit]
 * @returns {Array<object>} ranked recommendations with full breakdown
 */
export function recommend(dataset, opts = {}) {
  const {
    ourPicks = [],
    enemyPicks = [],
    banned = [],
    weights = DEFAULT_WEIGHTS,
    minPairGames = MIN_PAIR_GAMES,
    limit = 12,
  } = opts;

  const { matchups, heroes } = dataset;
  const unavailable = new Set([...ourPicks, ...enemyPicks, ...banned]);

  const wSum = weights.counter + weights.synergy + weights.base || 1;

  const scored = [];

  for (const hero of heroes) {
    if (unavailable.has(hero.id)) continue;

    const counter = vsSet(matchups, hero.id, enemyPicks, minPairGames);
    const synergy = vsSet(matchups, hero.id, ourPicks, minPairGames);
    const base = heroBase(matchups, hero.id);
    if (!base) continue;

    // A hero with no usable data at all is not worth recommending.
    if (counter.value === null && synergy.value === null) continue;

    // Coverage is the fraction of enemies we actually have evidence for.
    // Without this penalty a hero measured against 1 of 3 enemies outranks a
    // hero measured against all 3 — observed as Lone Druid topping a
    // Medusa+Axe+Tidehunter draft on 1/3 coverage at 62%.
    const coverage = counter.total > 0 ? counter.covered / counter.total : 0;

    let acc = 0;
    let wUsed = 0;
    const parts = {};

    if (counter.value !== null) {
      // Shrink the counter term toward neutral (0.5) by coverage.
      //
      // Coverage is squared deliberately. Linear shrinkage was too weak in
      // practice: a hero measured against 1 of 2 enemies kept 50% of its edge
      // and still outranked a fully-measured hero (observed 0.58 vs 0.53).
      // Squaring makes partial evidence decay faster, so "I beat everyone I
      // could measure" cannot masquerade as "I beat their whole draft".
      const damp = coverage * coverage;
      const confident = 0.5 + (counter.value - 0.5) * damp;
      parts.counter = counter.value;
      parts.counterAdj = confident;
      parts.coverage = coverage;
      parts.damp = damp;
      acc += weights.counter * confident;
      wUsed += weights.counter;
    }
    if (synergy.value !== null) {
      parts.synergy = synergy.value;
      acc += weights.synergy * synergy.value;
      wUsed += weights.synergy;
    }
    if (base.lb !== null) {
      parts.base = base.lb;
      acc += weights.base * base.lb;
      wUsed += weights.base;
    }

    const total = wUsed > 0 ? acc / (wUsed / wSum) : 0;

    scored.push({
      heroId: hero.id,
      name: hero.n,
      attr: hero.attr,
      atk: hero.atk,
      roles: hero.roles,
      total,
      coverage,
      parts,
      counter,
      synergy,
      base,
      /** Which enemies this hero is notably strong/weak into. */
      threats: threatBreakdown(matchups, hero.id, enemyPicks, minPairGames),
    });
  }

  scored.sort((a, b) => b.total - a.total);
  return scored.slice(0, limit);
}

/**
 * Per-enemy detail so the UI can explain a recommendation:
 * "strong vs Medusa (56% over 320 games), weak vs Axe (44% over 210)".
 */
export function threatBreakdown(matchups, heroId, enemyIds, minGames = MIN_PAIR_GAMES) {
  const rows = [];
  for (const id of enemyIds) {
    const row = lookupPair(matchups, heroId, id);
    if (!row || row.g < minGames) continue;
    rows.push({ heroId: id, ...row });
  }
  rows.sort((a, b) => b.lb - a.lb);
  return rows;
}

