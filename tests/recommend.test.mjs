import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lookupPair,
  heroBase,
  vsSet,
  recommend,
  shrink,
  verdictTally,
  DEFAULT_WEIGHTS,
  DEFAULT_MODE,
  MODES,
  MODE_KEYS,
  MIN_PAIR_GAMES,
  PRIOR_GAMES,
} from '../src/recommend.mjs';

/** Minimal synthetic dataset: 3 heroes, hand-set matchups. */
function fixture() {
  return {
    meta: {},
    heroes: [
      { id: 1, n: 'A', attr: 'agi', atk: 'Melee', roles: ['Carry'] },
      { id: 2, n: 'B', attr: 'str', atk: 'Melee', roles: ['Support'] },
      { id: 3, n: 'C', attr: 'int', atk: 'Ranged', roles: ['Nuker'] },
    ],
    matchups: {
      // A vs B: 60/100
      1: { 2: { g: 100, w: 60, p: 0.6, lb: 0.5, ub: 0.69, t: 'high' } },
      // A vs C: 30/100 (weak)
      2: {},
      3: {},
    },
  };
}

test('lookupPair reads the direct direction when present', () => {
  const ds = fixture();
  const r = lookupPair(ds.matchups, 1, 2);
  assert.equal(r.g, 100);
  assert.equal(r.w, 60);
  assert.equal(r.reversed, false);
});

test('lookupPair inverts correctly when only the reverse row exists', () => {
  const ds = fixture();
  // Only "1 vs 2" is stored. Asking for "2 vs 1" must invert.
  const r = lookupPair(ds.matchups, 2, 1);
  assert.equal(r.g, 100);
  assert.equal(r.w, 40, 'B beat A 100-60 times');
  assert.equal(r.reversed, true);
  assert.ok(Math.abs(r.p - 0.4) < 1e-9);
});

test('lookupPair returns null for unknown pairs', () => {
  assert.equal(lookupPair(fixture().matchups, 1, 999), null);
  assert.equal(lookupPair(undefined, 1, 2), null);
});

test('vsSet pools only the opponents with enough games', () => {
  const ds = fixture();
  const res = vsSet(ds.matchups, 1, [2, 3]);
  assert.equal(res.total, 2);
  assert.equal(res.covered, 1, 'hero 3 has no data');
  // Pair is 60/100; pooled raw is 0.6 and the shrunk estimate pulls toward 0.5.
  assert.ok(Math.abs(res.raw - 0.6) < 1e-9, 'raw pooled rate');
  assert.ok(res.value < 0.6 && res.value > 0.5, `shrunk toward 0.5, got ${res.value}`);
});

/* ---------------- ranking modes (m02045) ---------------- */

test('verdictTally counts the bands the UI shows', () => {
  const tally = verdictTally([
    { p: 0.60 }, // 非常克制
    { p: 0.55 }, // 非常克制
    { p: 0.51 }, // 克制
    { p: 0.40 }, // 不克制
  ]);
  assert.deepEqual(tally, { strong: 2, mild: 1, weak: 1, covered: 4 });
  assert.deepEqual(verdictTally([]), { strong: 0, mild: 0, weak: 0, covered: 0 });
});

/** Enemies E1/E2 plus four candidates whose verdict mix differs per hero. */
function counterFixture() {
  const hero = (id, n) => ({ id, n, attr: 'agi', atk: 'Melee', roles: [] });
  return {
    meta: {},
    heroes: [
      hero(10, 'E1'),
      hero(11, 'E2'),
      hero(20, 'A'), // strong vs E1, weak vs E2
      hero(21, 'B'), // mildly ahead of both
      hero(22, 'C'), // strongly ahead of both
      hero(23, 'D'), // behind both
    ],
    matchups: {
      20: {
        10: { g: 1000, w: 600, p: 0.6, lb: 0.57, ub: 0.63, t: 'high' },
        11: { g: 1000, w: 450, p: 0.45, lb: 0.42, ub: 0.48, t: 'high' },
      },
      21: {
        10: { g: 1000, w: 510, p: 0.51, lb: 0.48, ub: 0.54, t: 'high' },
        11: { g: 1000, w: 510, p: 0.51, lb: 0.48, ub: 0.54, t: 'high' },
      },
      22: {
        10: { g: 1000, w: 550, p: 0.55, lb: 0.52, ub: 0.58, t: 'high' },
        11: { g: 1000, w: 550, p: 0.55, lb: 0.52, ub: 0.58, t: 'high' },
      },
      23: {
        10: { g: 1000, w: 440, p: 0.44, lb: 0.41, ub: 0.47, t: 'high' },
        11: { g: 1000, w: 430, p: 0.43, lb: 0.40, ub: 0.46, t: 'high' },
      },
    },
  };
}

test('优先克制 orders by verdict, not by blended score', () => {
  const ds = counterFixture();
  const out = recommend(ds, { enemyPicks: [10, 11], limit: 10 });
  const order = out.map((x) => x.name);
  // C: 非常克制 x2, no 不克制.  B: 克制 x2, no 不克制.
  // A: has a 不克制, so it cannot sit above B no matter how good its score is.
  // D: 不克制 x2, last.
  assert.deepEqual(order, ['C', 'B', 'A', 'D']);
});

test('the counter-first rule actually changes the order (it has teeth)', () => {
  const ds = counterFixture();
  // A's blended score is higher than B's (it wins big against one enemy), so a
  // plain weighted sort puts A second. 优先克制 demotes it behind B because it
  // loses to the other enemy — that is the whole point of the mode.
  const weighted = recommend(ds, {
    enemyPicks: [10, 11],
    weights: { counter: 1, synergy: 0, base: 0 },
    limit: 10,
  }).map((x) => x.name);
  assert.deepEqual(weighted, ['C', 'A', 'B', 'D']);

  const counterFirst = recommend(ds, {
    enemyPicks: [10, 11],
    weights: { counter: 1, synergy: 0, base: 0 },
    counterFirst: true,
    limit: 10,
  }).map((x) => x.name);
  assert.deepEqual(counterFirst, ['C', 'B', 'A', 'D']);
});

test('a hero with no matchup evidence sinks below measured heroes', () => {
  const ds = counterFixture();
  // `recommend` drops heroes with no usable data at all, so to reach the
  // "no enemy evidence" branch the hero needs a measurable ally pairing.
  ds.heroes.push({ id: 12, n: 'Ours', attr: 'str', atk: 'Melee', roles: [] });
  ds.heroes.push({ id: 24, n: 'Blind', attr: 'int', atk: 'Ranged', roles: [] });
  // Blind has 500 games against our hero and NONE against either enemy.
  ds.matchups[24] = { 12: { g: 500, w: 300, p: 0.6, lb: 0.55, ub: 0.65, t: 'high' } };

  const out = recommend(ds, { enemyPicks: [10, 11], ourPicks: [12], limit: 10 });
  const names = out.map((x) => x.name);
  assert.ok(names.includes('Blind'), 'still listed: it has synergy evidence');
  assert.equal(names[names.length - 1], 'Blind', 'no enemy evidence ranks last');
});

test('优先胜率 leads on the version win rate, 优先克制 on the matchup', () => {
  // X beats the enemy but is weak overall; Y is strong overall but even vs the
  // enemy. Z exists only to give both a second matchup, so base != counter.
  const ds = {
    meta: {},
    heroes: [
      { id: 10, n: 'E', attr: 'agi', atk: 'Melee', roles: [] },
      { id: 30, n: 'Z', attr: 'str', atk: 'Melee', roles: [] },
      { id: 40, n: 'X', attr: 'int', atk: 'Ranged', roles: [] },
      { id: 41, n: 'Y', attr: 'int', atk: 'Ranged', roles: [] },
    ],
    matchups: {
      40: {
        10: { g: 500, w: 300, p: 0.6, lb: 0.55, ub: 0.65, t: 'high' },
        30: { g: 500, w: 200, p: 0.4, lb: 0.35, ub: 0.45, t: 'high' },
      },
      41: {
        10: { g: 500, w: 250, p: 0.5, lb: 0.45, ub: 0.55, t: 'high' },
        30: { g: 500, w: 300, p: 0.6, lb: 0.55, ub: 0.65, t: 'high' },
      },
    },
  };
  const opts = { enemyPicks: [10], banned: [30], limit: 10 };

  const counter = recommend(ds, { ...opts, mode: 'counter' });
  assert.equal(counter[0].name, 'X', '优先克制 takes the hero that beats E');
  assert.ok(counter[0].base.shrunk < counter[1].base.shrunk, 'even though X is weaker overall');

  const winrate = recommend(ds, { ...opts, mode: 'winrate' });
  assert.equal(winrate[0].name, 'Y', '优先胜率 takes the stronger hero overall');
});

test('the synergy mode weights our own picks above the enemy matchup', () => {
  assert.ok(MODES.synergy.weights.synergy > MODES.synergy.weights.counter);
  assert.ok(MODES.synergy.weights.synergy > MODES.synergy.weights.base);
  assert.ok(MODES.winrate.weights.base > MODES.winrate.weights.counter);
});

test('mode metadata is complete and consistent', () => {
  assert.deepEqual(MODE_KEYS, Object.keys(MODES), 'every mode is listed in the UI order');
  assert.equal(DEFAULT_MODE, 'counter', '优先克制 is the default');
  assert.equal(DEFAULT_WEIGHTS, MODES.counter.weights, 'the default weights ARE the counter preset');
  for (const key of MODE_KEYS) {
    assert.equal(typeof MODES[key].label, 'string', `${key} has a label`);
    assert.equal(typeof MODES[key].hint, 'string', `${key} has a hint`);
    assert.ok(MODES[key].hint.length > 4, `${key} hint is descriptive`);
    const w = MODES[key].weights;
    const sum = w.counter + w.synergy + w.base;
    assert.ok(Math.abs(sum - 1) < 1e-9, `${key} weights sum to 1`);
  }
  assert.equal(MODES.counter.counterFirst, true);
  assert.equal(MODES.winrate.counterFirst, false);
  assert.equal(MODES.synergy.counterFirst, false);
});

test('an unknown mode falls back to the default instead of throwing', () => {
  const out = recommend(counterFixture(), { enemyPicks: [10, 11], mode: 'nonsense', limit: 5 });
  assert.ok(out.length > 0);
  assert.equal(out[0].name, 'C');
});

test('a single enemy pick still separates 克制 from 不克制', () => {
  const ds = counterFixture();
  const out = recommend(ds, { enemyPicks: [10], limit: 10 });
  const names = out.map((x) => x.name);
  // vs E1: C 0.55 strong, A 0.60 strong, B 0.51 mild, D 0.44 weak.
  assert.equal(names[names.length - 1], 'D', 'the 不克制 hero is last');
  assert.ok(!names.slice(0, 3).includes('D'));
});


/* ---------------- shrinkage: the scoring fix ---------------- */

test('REGRESSION: a strong counter on a small sample is NOT scored below 50%', () => {
  // Real case that motivated the change: Ancient Apparition vs Necrophos is
  // 22 wins / 35 games = 62.9%, the 5th strongest counter in the dataset.
  // Scoring by the Wilson LOWER bound gave 0.465 — i.e. "worse than average" —
  // which ranked it #16 of 88 against a Necrophos draft. Shrinkage fixes that.
  const p = { g: 35, w: 22, p: 22 / 35, lb: 0.465, ub: 0.78, t: 'medium' };
  const v = vsSet({ 1: { 2: p } }, 1, [2], MIN_PAIR_GAMES);
  assert.ok(v.value > 0.5, `must stay above a coin flip, got ${v.value}`);
  assert.ok(v.value > p.lb, 'shrinkage is more optimistic than the lower bound');
});

test('shrink pulls small samples toward the prior, large samples stay put', () => {
  assert.equal(shrink(0, 0), 0.5, 'no data -> prior');
  assert.ok(shrink(2, 2) < 0.6, 'a 2-game sweep is heavily damped');
  assert.ok(shrink(22, 35) > 0.5, 'a real 35-game signal survives');
  // At 100x the prior, the estimate is essentially the observed rate.
  assert.ok(Math.abs(shrink(6000, 10000) - 0.6) < 0.01);
});

test('shrink keeps roughly n/(n+k) of the distance from 50%', () => {
  const k = PRIOR_GAMES;
  const n = 180;
  const observed = 0.7;
  const expected = 0.5 + (observed - 0.5) * (n / (n + k));
  const actual = shrink(observed * n, n);
  assert.ok(Math.abs(actual - expected) < 1e-9);
});

test('a fluke sweep cannot outrank a well-measured good counter', () => {
  // 2/2 = "100%" must not beat 65% over 200 games.
  assert.ok(shrink(2, 2) < shrink(130, 200));
});

test('shrink never returns a value outside [0,1]', () => {
  for (const [w, g] of [[0, 1], [1, 1], [0, 500], [500, 500], [150, 100]]) {
    const v = shrink(w, g);
    assert.ok(v >= 0 && v <= 1, `shrink(${w},${g}) = ${v}`);
  }
});

test('vsSet respects a raised minGames threshold', () => {
  const ds = fixture();
  const strict = vsSet(ds.matchups, 1, [2], 500);
  assert.equal(strict.covered, 0);
  assert.equal(strict.value, null);
});

test('vsSet on empty input is null rather than 0', () => {
  const res = vsSet(fixture().matchups, 1, []);
  assert.equal(res.value, null);
  assert.equal(res.total, 0);
});

test('heroBase pools raw counts across all matchups', () => {
  const ds = fixture();
  const b = heroBase(ds.matchups, 1);
  assert.equal(b.games, 100);
  assert.equal(b.wins, 60);
  assert.ok(Math.abs(b.p - 0.6) < 1e-9);
  assert.ok(b.shrunk > 0.5 && b.shrunk < 0.6, 'base is shrunk too');
});

test('recommend excludes heroes already picked or banned', () => {
  const ds = fixture();
  const out = recommend(ds, { enemyPicks: [2], ourPicks: [], limit: 10 });
  const ids = out.map((x) => x.heroId);
  assert.ok(!ids.includes(2), 'enemy pick must be excluded');
  // Hero 1 has data; hero 3 has none at all so cannot be scored.
  assert.ok(ids.includes(1));
});

test('recommend rewards a hero that counters the enemy', () => {
  const ds = fixture();
  // Hero 1 beats hero 2 (lb 0.5). Nothing beats hero 3.
  const out = recommend(ds, { enemyPicks: [2], limit: 10 });
  const top = out[0];
  assert.equal(top.heroId, 1);
  assert.ok(top.counter.value > 0.4);
});

test('recommend renormalises weights when a term is unmeasurable', () => {
  const ds = fixture();
  const out = recommend(ds, { enemyPicks: [2], ourPicks: [], limit: 10 });
  const cand = out.find((x) => x.heroId === 1);
  assert.ok(Number.isFinite(cand.total), 'score must be finite');
  assert.ok(cand.total >= 0 && cand.total <= 1, `score ${cand.total} in range`);
});

test('recommend is deterministic and sorted descending', () => {
  const ds = fixture();
  const a = recommend(ds, { enemyPicks: [2] });
  const b = recommend(ds, { enemyPicks: [2] });
  assert.deepEqual(a.map((x) => x.heroId), b.map((x) => x.heroId));
  for (let i = 1; i < a.length; i++) {
    assert.ok(a[i - 1].total >= a[i].total, 'must be sorted desc');
  }
});

test('recommend handles an empty draft without throwing', () => {
  const out = recommend(fixture(), {});
  assert.ok(Array.isArray(out));
});

test('default weights sum to 1 so scores stay interpretable', () => {
  const s = DEFAULT_WEIGHTS.counter + DEFAULT_WEIGHTS.synergy + DEFAULT_WEIGHTS.base;
  assert.ok(Math.abs(s - 1) < 1e-9);
});

test('counter evidence carries the most weight by default', () => {
  // Locks in a deliberate product decision: this is a counter-pick tool, so the
  // specific matchup outranks the hero's diffuse global win rate. Co-equal
  // weighting ranked Ancient Apparition (47.9% overall, 62.9% vs Necrophos)
  // below heroes with no particular edge against that draft.
  assert.ok(
    DEFAULT_WEIGHTS.counter > DEFAULT_WEIGHTS.synergy,
    'counter must outweigh synergy'
  );
  assert.ok(
    DEFAULT_WEIGHTS.synergy > DEFAULT_WEIGHTS.base,
    'base is a tiebreaker, not a driver'
  );
});

test('MIN_PAIR_GAMES matches the low-tier boundary', () => {
  assert.equal(MIN_PAIR_GAMES, 30);
});

test('a hero covering only part of the enemy team is shrunk toward neutral', () => {
  // Regression: Lone Druid topped a Medusa+Axe+Tidehunter draft at 62% while
  // having evidence for only 1 of the 3 enemies. Coverage must damp that.
  //
  // Layout: EnemyA and EnemyB are on the enemy team.
  //   - Partial has evidence vs EnemyA only  -> coverage 1/2
  //   - Full    has evidence vs EnemyA AND EnemyB -> coverage 2/2
  // Both are strong vs EnemyA; Partial additionally looks amazing vs EnemyB
  // only through its own row, which must NOT count as counter evidence.
  const ds = {
    meta: {},
    heroes: [
      { id: 1, n: 'EnemyA', attr: 'agi', atk: 'Melee', roles: [] },
      { id: 2, n: 'EnemyB', attr: 'str', atk: 'Melee', roles: [] },
      { id: 3, n: 'Partial', attr: 'agi', atk: 'Melee', roles: [] },
      { id: 4, n: 'Full', attr: 'int', atk: 'Ranged', roles: [] },
    ],
    matchups: {
      // EnemyA's row: how EnemyA fares vs each candidate.
      // Partial beats EnemyA hard (EnemyA only wins 30%). Full is even-ish.
      1: {
        3: { g: 500, w: 150, p: 0.30, lb: 0.26, ub: 0.34, t: 'high' },
        4: { g: 500, w: 250, p: 0.50, lb: 0.46, ub: 0.54, t: 'high' },
      },
      // EnemyB's row: Full beats EnemyB (EnemyB wins 40%). NO entry for Partial.
      2: { 4: { g: 500, w: 200, p: 0.40, lb: 0.36, ub: 0.44, t: 'high' } },
      // Candidate own rows (used only for heroBase).
      3: { 1: { g: 500, w: 350, p: 0.70, lb: 0.66, ub: 0.74, t: 'high' } },
      4: {
        1: { g: 500, w: 250, p: 0.50, lb: 0.46, ub: 0.54, t: 'high' },
        2: { g: 500, w: 300, p: 0.60, lb: 0.56, ub: 0.64, t: 'high' },
      },
    },
  };

  const out = recommend(ds, {
    enemyPicks: [1, 2],
    weights: { counter: 1, synergy: 0, base: 0 },
    limit: 10,
  });

  const partial = out.find((x) => x.heroId === 3);
  const full = out.find((x) => x.heroId === 4);

  assert.ok(partial && full, 'both candidates scored');
  assert.equal(partial.counter.covered, 1, 'Partial knows only EnemyA');
  assert.equal(partial.counter.total, 2);
  assert.equal(partial.coverage, 0.5);

  assert.equal(full.counter.covered, 2, 'Full knows both enemies');
  assert.equal(full.coverage, 1);

  // The core property: coverage shrinks the estimate toward 0.5, quadratically.
  assert.ok(
    Math.abs(partial.parts.counterAdj - 0.5) <
      Math.abs(partial.parts.counter - 0.5),
    'adjusted counter must be pulled toward 0.5'
  );
  assert.ok(
    Math.abs(partial.parts.counterAdj - 0.5) <
      Math.abs(partial.parts.counter - 0.5) * 0.5,
    'half coverage must remove at least half the edge (quadratic damping)'
  );
  // Full coverage must leave the estimate exactly as measured.
  assert.ok(
    Math.abs(full.parts.counterAdj - full.parts.counter) < 1e-9,
    'full coverage is not damped'
  );
  // And damping must be strictly monotonic in coverage: a hero with less
  // coverage loses more of its edge. This is the property that matters; the
  // absolute ranking depends on how extreme the raw numbers are (a hero with a
  // huge edge on half the enemy team can still be a legitimate pick).
  const rawEdgePartial = Math.abs(partial.parts.counter - 0.5);
  const keptEdgePartial = Math.abs(partial.parts.counterAdj - 0.5);
  const rawEdgeFull = Math.abs(full.parts.counter - 0.5);
  const keptEdgeFull = Math.abs(full.parts.counterAdj - 0.5);

  const keepRatioPartial = keptEdgePartial / rawEdgePartial; // coverage 0.5 -> 0.25
  const keepRatioFull = rawEdgeFull < 1e-9 ? 1 : keptEdgeFull / rawEdgeFull; // coverage 1 -> 1

  assert.ok(
    Math.abs(keepRatioPartial - 0.25) < 1e-6,
    `half coverage should keep 25% of the edge, kept ${keepRatioPartial}`
  );
  assert.ok(
    keepRatioFull > keepRatioPartial,
    'more coverage must preserve a larger share of the measured edge'
  );
});

test('full coverage leaves the counter estimate untouched', () => {
  const ds = {
    meta: {},
    heroes: [
      { id: 1, n: 'E', attr: 'agi', atk: 'Melee', roles: [] },
      { id: 2, n: 'C', attr: 'int', atk: 'Ranged', roles: [] },
    ],
    matchups: {
      1: { 2: { g: 400, w: 160, p: 0.4, lb: 0.35, ub: 0.45, t: 'high' } },
      2: { 1: { g: 400, w: 240, p: 0.6, lb: 0.55, ub: 0.65, t: 'high' } },
    },
  };
  const out = recommend(ds, { enemyPicks: [1], limit: 5 });
  const c = out.find((x) => x.heroId === 2);
  assert.equal(c.coverage, 1);
  assert.ok(Math.abs(c.parts.counterAdj - c.parts.counter) < 1e-9);
});

