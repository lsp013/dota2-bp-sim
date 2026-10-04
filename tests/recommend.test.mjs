import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lookupPair,
  heroBase,
  vsSet,
  recommend,
  DEFAULT_WEIGHTS,
  MIN_PAIR_GAMES,
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

test('vsSet averages only over opponents with enough games', () => {
  const ds = fixture();
  const res = vsSet(ds.matchups, 1, [2, 3]);
  assert.equal(res.total, 2);
  assert.equal(res.covered, 1, 'hero 3 has no data');
  assert.ok(Math.abs(res.value - 0.5) < 1e-9, 'uses the lb of the one usable pair');
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

