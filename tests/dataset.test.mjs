import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hydrateDataset, isSlim, isSlimRow } from '../src/dataset.mjs';
import { wilson, tierFor } from '../src/wilson.mjs';

const slim = () => ({
  meta: { source: 'test' },
  heroes: [{ id: 1, n: 'A' }, { id: 2, n: 'B' }],
  matchups: {
    1: { 2: { g: 200, w: 120 } },
    2: { 1: { g: 200, w: 80 } },
  },
});

test('hydration fills every derived field from the raw counts alone', () => {
  const ds = hydrateDataset(slim());
  const row = ds.matchups[1][2];
  assert.equal(row.g, 200, 'raw games untouched');
  assert.equal(row.w, 120, 'raw wins untouched');
  assert.ok(Math.abs(row.p - 0.6) < 1e-6, `win rate, got ${row.p}`);
  const iv = wilson(120, 200);
  assert.ok(Math.abs(row.lb - iv.lower) < 1e-4);
  assert.ok(Math.abs(row.ub - iv.upper) < 1e-4);
  assert.equal(row.t, tierFor(200));
});

test('hydration leaves the raw observations byte-identical', () => {
  const ds = slim();
  const before = JSON.stringify(ds.matchups);
  hydrateDataset(ds);
  const after = JSON.parse(JSON.stringify(ds.matchups));
  for (const heroId of Object.keys(before ? JSON.parse(before) : {})) {
    for (const foeId of Object.keys(JSON.parse(before)[heroId])) {
      const orig = JSON.parse(before)[heroId][foeId];
      assert.equal(after[heroId][foeId].g, orig.g, 'g must not change');
      assert.equal(after[heroId][foeId].w, orig.w, 'w must not change');
    }
  }
});

test('hydration is idempotent, so legacy files with derived fields still work', () => {
  const once = hydrateDataset(slim());
  const snapshot = JSON.stringify(once.matchups);
  const twice = hydrateDataset(once);
  assert.equal(JSON.stringify(twice.matchups), snapshot, 'second pass changes nothing');
});

test('a fat (legacy) dataset is recomputed to the same values', () => {
  const fat = {
    meta: {},
    heroes: [],
    matchups: { 1: { 2: { g: 200, w: 120, p: 0.999, lb: 0.999, ub: 0.999, t: 'low' } } },
  };
  const ds = hydrateDataset(fat);
  assert.ok(Math.abs(ds.matchups[1][2].p - 0.6) < 1e-6, 'stale derived values are corrected');
  assert.equal(ds.matchups[1][2].t, 'high');
});

test('isSlim detects un-hydrated datasets', () => {
  assert.equal(isSlim(slim()), true);
  assert.equal(isSlim(hydrateDataset(slim())), false);
  assert.equal(isSlimRow({ g: 10, w: 5 }), true);
  assert.equal(isSlimRow({ g: 10, w: 5, p: 0.5, lb: 0.3, ub: 0.7, t: 'low' }), false);
});

test('corrupt counts are clamped rather than producing a rate above 1', () => {
  const ds = hydrateDataset({
    meta: {}, heroes: [],
    matchups: { 1: { 2: { g: 10, w: 99 } } },
  });
  assert.equal(ds.matchups[1][2].w, 10, 'wins clamped to games');
  assert.ok(ds.matchups[1][2].p <= 1);
});

test('zero-game and malformed rows are skipped without breaking the rest', () => {
  const ds = hydrateDataset({
    meta: {}, heroes: [],
    matchups: { 1: { 2: { g: 0, w: 0 }, 3: { g: 100, w: 60 }, 4: null } },
  });
  assert.equal(ds.matchups[1][2].p, undefined, 'zero-game row left alone');
  assert.ok(ds.matchups[1][3].p > 0.5, 'valid row still hydrated');
});

test('hydration records the format version and a pair count', () => {
  const ds = hydrateDataset(slim());
  assert.equal(ds.meta.format, 2);
  assert.equal(ds.meta.hydratedPairs, 2);
  assert.equal(ds.meta.source, 'test', 'existing meta is preserved');
});

test('a dataset with no matchups is returned unchanged', () => {
  const empty = { meta: {} };
  assert.equal(hydrateDataset(empty), empty);
  assert.equal(isSlim(empty), false);
});
