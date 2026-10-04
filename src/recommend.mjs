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
 *   counterScore(h) = mean over enemies e of  shrunk(h vs e)   // can we fight them?
 *   synergyScore(h) = mean over allies  a of  shrunk(h vs a)   // do we fit together?
 *   baseScore(h)    = shrunk(h's overall win rate)
 *
 *   total = wCounter*counter + wSynergy*synergy + wBase*base
 *
 * SCORING vs FILTERING — an important distinction we got wrong at first:
 *
 * The Wilson LOWER bound is a worst-case estimate. It is the right tool for
 * deciding whether a sample is trustworthy (see wilson.mjs tiers), but it is
 * the WRONG thing to use as a score. Real example from this dataset:
 *
 *   Ancient Apparition vs Necrophos: 22 wins / 35 games = 62.9%
 *   Wilson lower bound of that pair: 0.465  -> "worse than a coin flip"
 *
 * Scoring by the lower bound therefore ranked Ancient Apparition — the 5th
 * strongest counter to Necrophos in the whole dataset — at #16 of 88, with a
 * counter score of 44%. The genuine signal was destroyed by a worst-case bound.
 *
 * We now score with a SHRINKAGE estimate instead: the observed rate pulled
 * toward 50% by a prior worth PRIOR_GAMES pseudo-games. That keeps the useful
 * property (a 2-game fluke cannot top the list) without throwing away real
 * evidence from a 35-game sample.
 */

import { isRankable } from '../src/wilson.mjs';

/**
 * Default term weights. Adjustable in the UI.
 *
 * Counter evidence dominates deliberately. This tool exists to answer "what do
 * I pick into THEIR draft", so the specific matchup is the point; a hero's
 * global win rate is a diffuse signal that largely duplicates information
 * already present in the matchup matrix (heroBase pools the same pairs). Making
 * it co-equal systematically buried matchup specialists — Ancient Apparition
 * sits at 47.9% overall but beats Necrophos 62.9%, and at 50/30/20 it ranked
 * #9 instead of #5.
 *
 * Base is kept as a tiebreaker rather than dropped, because picking a broadly
 * weak hero is still a real cost.
 */
export const DEFAULT_WEIGHTS = {
  counter: 0.7,
  synergy: 0.2,
  base: 0.1,
};

/** Minimum games before a matchup pair may influence a score. */
export const MIN_PAIR_GAMES = 30;

/**
 * Strength of the shrinkage prior, in pseudo-games.
 *
 * A pair observed over n games keeps roughly n/(n+PRIOR_GAMES) of its distance
 * from 50%. At k=15 a 35-game sample keeps ~70% of its edge; a 100-game sample
 * keeps ~87%.
 *
 * Calibrated LIGHT on purpose. Two forces argue for this:
 *
 *  1. MIN_PAIR_GAMES (30) already excludes flukes from scoring, so the prior
 *     does not need to re-do that job. An earlier k=60 double-penalised thin
 *     samples and pushed genuine counters out of the visible list.
 *  2. This is a decision aid for a player who has their own game knowledge.
 *     Heavy shrinkage discards exactly the niche, low-popularity counter-picks
 *     (Ancient Apparition's anti-heal vs Necrophos) that a domain expert is
 *     looking for. The tier labels and the per-pair sample counts on every card
 *     communicate the uncertainty instead of hiding the signal.
 *
 * The statistically conservative alternative would be a much larger prior
 * (empirical Bayes on typical matchup spread suggests k in the 50-100 range),
 * which would rank Ancient Apparition around #11 rather than the top 5. That is
 * a legitimate product choice, not a bug — see README for the tradeoff.
 */
export const PRIOR_GAMES = 15;

/** Prior mean — 50%, i.e. "an unmeasured matchup is a coin flip". */
export const PRIOR_P = 0.5;

/**
 * Shrink an observed win rate toward the prior.
 * @param {number} wins
 * @param {number} games
 */
export function shrink(wins, games, k = PRIOR_GAMES, prior = PRIOR_P) {
  if (!Number.isFinite(wins) || !Number.isFinite(games) || games <= 0) {
    return prior;
  }
  const w = Math.min(wins, games);
  return (w + prior * k) / (games + k);
}

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
 *
 * `shrunk` is what scoring uses; `p` is the raw pooled rate for display. For a
 * hero with thousands of games the two are nearly identical, so this only
 * matters for heroes with very little data.
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
  const p = wins / games;
  return { games, wins, p, shrunk: shrink(wins, games), pooled: true };
}

/**
 * How well `heroId` fares against a set of opponent ids.
 *
 * Counts are POOLED across the opponents and then shrunk once, rather than
 * averaging per-pair rates: pooling keeps the evidence weighting implicit and
 * correct (a 200-game pair outweighs a 40-game one automatically).
 *
 * Returns { value, raw, samples, wins, covered, total } — `covered` is how many
 * opponents had usable data, so the UI can say "based on 3 of 5 enemies".
 */
export function vsSet(matchups, heroId, ids, minGames = MIN_PAIR_GAMES) {
  if (!ids.length) {
    return { value: null, raw: null, samples: 0, wins: 0, covered: 0, total: 0 };
  }
  let wins = 0;
  let games = 0;
  let used = 0;
  for (const id of ids) {
    const row = lookupPair(matchups, heroId, id);
    if (!row || !isRankable(row.g) || row.g < minGames) continue;
    wins += row.w;
    games += row.g;
    used++;
  }
  if (!used) {
    return { value: null, raw: null, samples: 0, wins: 0, covered: 0, total: ids.length };
  }
  return {
    // Shrinkage estimate — this is what the ranking uses.
    value: shrink(wins, games),
    // Unshrunk pooled rate, kept for display and debugging.
    raw: games ? wins / games : null,
    samples: games,
    wins,
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
    if (base.shrunk !== null && base.shrunk !== undefined) {
      parts.base = base.shrunk;
      acc += weights.base * base.shrunk;
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

