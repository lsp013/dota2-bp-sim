import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wilson, tierFor, isRankable } from '../src/wilson.mjs';

test('tiny sample is pulled toward 0.5 and cannot top a large sample', () => {
  // 2/2 = "100%" but 2 games. 120/200 = 60% on 200 games.
  const tiny = wilson(2, 2);
  const solid = wilson(120, 200);
  assert.equal(tiny.point, 1);
  assert.ok(
    tiny.lower < solid.lower,
    `tiny.lower=${tiny.lower} should be below solid.lower=${solid.lower}`
  );
});

test('a solid 60% on 200 games clearly beats a 3-game perfect record', () => {
  // Wilson's lower bound is what makes this safe: the fluke cannot outrank it.
  assert.ok(wilson(120, 200).lower > wilson(3, 3).lower);
});

test('a coin-flip on many games does NOT automatically beat a 3-game fluke', () => {
  // Documented, intentional Wilson behaviour. 100/200 is exactly 50% so its
  // lower bound (0.4314) sits just under 3/3 (0.4385). This is why ranking
  // must ALSO apply a minimum-sample gate (MIN_RANK_SAMPLE) rather than
  // relying on the interval alone.
  assert.ok(wilson(3, 3).lower > wilson(100, 200).lower);
  assert.ok(wilson(100, 200).lower > 0.4, 'still not catastrophically low');
});

test('lower bound never exceeds point estimate, upper never below', () => {
  for (const [w, n] of [[50, 100], [1, 10], [95, 100], [0, 40], [7, 30]]) {
    const r = wilson(w, n);
    assert.ok(r.lower <= r.point + 1e-12, `lower>point for ${w}/${n}`);
    assert.ok(r.upper >= r.point - 1e-12, `upper<point for ${w}/${n}`);
  }
});

test('bounds stay inside [0,1] at extremes', () => {
  for (const [w, n] of [[0, 1], [1, 1], [0, 500], [500, 500]]) {
    const r = wilson(w, n);
    assert.ok(r.lower >= 0 && r.lower <= 1);
    assert.ok(r.upper >= 0 && r.upper <= 1);
  }
});

test('degenerate input degrades to neutral instead of NaN', () => {
  for (const [w, n] of [[0, 0], [5, -1], [NaN, 10], [3, NaN]]) {
    const r = wilson(w, n);
    assert.ok(Number.isFinite(r.lower) && Number.isFinite(r.upper));
  }
});

test('wins exceeding games are clamped rather than producing >1 probabilities', () => {
  const r = wilson(150, 100);
  assert.ok(r.point <= 1 && r.upper <= 1);
});

test('tiers match the measured OpenDota distribution thresholds', () => {
  assert.equal(tierFor(200), 'high');
  assert.equal(tierFor(100), 'high');
  assert.equal(tierFor(99), 'medium');
  assert.equal(tierFor(30), 'medium');
  assert.equal(tierFor(29), 'low');
  assert.equal(tierFor(2), 'low');
});

test('rankability excludes the low tier only', () => {
  assert.equal(isRankable(30), true);
  assert.equal(isRankable(29), false);
});
