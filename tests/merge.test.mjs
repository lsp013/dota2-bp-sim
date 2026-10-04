import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeDatasets } from '../src/merge.mjs';

/** Dataset with one hero (1) and the given opponent rows. */
function ds(matchups, source = 'X') {
  return {
    meta: { source, patch: '7.41' },
    heroes: [{ id: 1, n: 'A' }, { id: 2, n: 'B' }, { id: 3, n: 'C' }],
    matchups,
  };
}

test('pairs present in both sources have their counts pooled', () => {
  // 60/100 and 100/200 -> 160/300
  const a = ds({ 1: { 2: { g: 100, w: 60, p: 0.6, lb: 0.5, ub: 0.69, t: 'high' } } }, 'A');
  const b = ds({ 1: { 2: { g: 200, w: 100, p: 0.5, lb: 0.43, ub: 0.57, t: 'high' } } }, 'B');
  const m = mergeDatasets(a, b);
  assert.equal(m.matchups[1][2].g, 300);
  assert.equal(m.matchups[1][2].w, 160);
  // rates are stored rounded to 4 decimals, hence the tolerance
  assert.ok(
    Math.abs(m.matchups[1][2].p - 160 / 300) < 1e-4,
    `rate re-derived from pooled counts, got ${m.matchups[1][2].p}`
  );
  assert.equal(m.meta.merged.pairsInBoth, 1);
});

test('a pair present in only one source is carried over unchanged', () => {
  const a = ds({ 1: { 2: { g: 50, w: 30, p: 0.6, lb: 0.46, ub: 0.73, t: 'medium' }, 3: { g: 10, w: 5, p: 0.5, lb: 0.24, ub: 0.76, t: 'low' } } }, 'A');
  const b = ds({ 1: { 2: { g: 100, w: 50, p: 0.5, lb: 0.4, ub: 0.6, t: 'high' } } }, 'B');
  const m = mergeDatasets(a, b);
  assert.equal(m.matchups[1][3].g, 10, 'A-only pair kept');
  assert.equal(m.matchups[1][2].g, 150, 'shared pair pooled');
  assert.equal(m.meta.merged.pairsFromAOnly, 1);
  assert.equal(m.meta.merged.pairsFromBOnly, 0);
});

test('B-only pairs are included too', () => {
  const a = ds({ 1: {} }, 'A');
  const b = ds({ 1: { 3: { g: 400, w: 220, p: 0.55, lb: 0.5, ub: 0.6, t: 'high' } } }, 'B');
  const m = mergeDatasets(a, b);
  assert.equal(m.matchups[1][3].g, 400);
  assert.equal(m.meta.merged.pairsFromBOnly, 1);
});

test('a much larger source dominates the merged rate', () => {
  // OpenDota-style 40 games at 65% vs STRATZ-style 4000 games at 50%
  const small = ds({ 1: { 2: { g: 40, w: 26, p: 0.65, lb: 0.49, ub: 0.78, t: 'medium' } } }, 'small');
  const big = ds({ 1: { 2: { g: 4000, w: 2000, p: 0.5, lb: 0.485, ub: 0.515, t: 'high' } } }, 'big');
  const m = mergeDatasets(small, big);
  // 2026/4040, compared with the 4-decimal storage rounding in mind
  assert.ok(
    Math.abs(m.matchups[1][2].p - 2026 / 4040) < 1e-4,
    `expected ~${(2026 / 4040).toFixed(4)}, got ${m.matchups[1][2].p}`
  );
  assert.ok(m.matchups[1][2].p < 0.52, `large sample must dominate, got ${m.matchups[1][2].p}`);
});

test('wins are clamped so the rate can never exceed 1', () => {
  const a = ds({ 1: { 2: { g: 10, w: 12, p: 1, lb: 1, ub: 1, t: 'low' } } }, 'A'); // corrupt
  const m = mergeDatasets(a, null);
  assert.ok(m.matchups[1][2].p <= 1);
});

test('tiers are recomputed from the pooled sample size', () => {
  const a = ds({ 1: { 2: { g: 20, w: 12, p: 0.6, lb: 0.39, ub: 0.78, t: 'low' } } }, 'A');
  const b = ds({ 1: { 2: { g: 200, w: 110, p: 0.55, lb: 0.48, ub: 0.62, t: 'high' } } }, 'B');
  const m = mergeDatasets(a, b);
  assert.equal(m.matchups[1][2].g, 220);
  assert.equal(m.matchups[1][2].t, 'high', '20+200 games is now high confidence');
});

test('merging with null returns the other side unchanged', () => {
  const a = ds({ 1: { 2: { g: 5, w: 3, p: 0.6, lb: 0.23, ub: 0.88, t: 'low' } } }, 'A');
  assert.equal(mergeDatasets(a, null), a);
  assert.equal(mergeDatasets(null, a), a);
  assert.equal(mergeDatasets(null, null), null);
});

test('inputs are not mutated', () => {
  const a = ds({ 1: { 2: { g: 100, w: 60, p: 0.6, lb: 0.5, ub: 0.69, t: 'high' } } }, 'A');
  const b = ds({ 1: { 2: { g: 100, w: 40, p: 0.4, lb: 0.31, ub: 0.5, t: 'high' } } }, 'B');
  const snapA = JSON.stringify(a);
  const snapB = JSON.stringify(b);
  mergeDatasets(a, b);
  assert.equal(JSON.stringify(a), snapA);
  assert.equal(JSON.stringify(b), snapB);
});

test('heroes are unioned without duplicates', () => {
  const a = ds({ 1: {} }, 'A');
  const b = { meta: { source: 'B' }, heroes: [{ id: 1, n: 'A' }, { id: 9, n: 'Z' }], matchups: {} };
  const m = mergeDatasets(a, b);
  const ids = m.heroes.map((h) => h.id);
  assert.deepEqual(ids, [1, 2, 3, 9], 'no duplicate hero 1');
});

test('meta records provenance and the merge breakdown', () => {
  const a = ds({ 1: { 2: { g: 10, w: 5, p: 0.5, lb: 0.24, ub: 0.76, t: 'low' } } }, 'OpenDota');
  const b = ds({ 1: { 3: { g: 10, w: 5, p: 0.5, lb: 0.24, ub: 0.76, t: 'low' } } }, 'STRATZ');
  const m = mergeDatasets(a, b);
  assert.equal(m.meta.source, 'OpenDota+STRATZ');
  assert.deepEqual(m.meta.sources, ['OpenDota', 'STRATZ']);
  assert.equal(m.meta.merged.pairsInBoth, 0);
  assert.equal(m.meta.pairs, 2);
});
