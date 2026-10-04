#!/usr/bin/env node
/**
 * Build the static dataset consumed by the frontend.
 *
 *   node scripts/fetch-data.mjs
 *
 * Output: public/data/data.json
 *
 * Design notes
 * ------------
 * 1. OpenDota's /heroes/{id}/matchups already returns a ROLLING RECENT window
 *    (measured: Crystal Maiden totals 9,750 matchup games vs 536,319 lifetime
 *    pub picks ≈ 1.8%). There is no `?date=` parameter — it is ignored.
 *    So "only keep recent data" is satisfied by the upstream source itself and
 *    costs us zero maintenance. We still record the build time for the UI.
 *
 * 2. We store the FULL 126x126-ish matrix rather than pruning by sample size.
 *    Thresholds live in the UI so the user can see, and judge, thin evidence
 *    instead of the data silently vanishing. Pruning at 200 games would delete
 *    ~96% of pairs (measured) and make the tool useless.
 *
 * 3. Every pair carries a Wilson lower bound. The UI ranks on that, which is
 *    what stops 2-game flukes from topping the recommendation list.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  fetchHeroes,
  fetchMatchups,
  fetchPatchList,
  mapPool,
} from './lib/opendota.mjs';
import { wilson, tierFor } from '../src/wilson.mjs';

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'public/data/data.json');

const MIN_GAMES_KEPT = 1; // keep everything; tiers handle trustworthiness

/** Keep public/lib/ in step with src/ so the deployed site never goes stale. */
async function syncLib() {
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [resolve(__dirname, 'sync-lib.mjs')],
      { cwd: ROOT }
    );
    process.stdout.write(`      ${stdout.trim()}\n`);
  } catch (err) {
    // Non-fatal: the site still works if lib/ was already synced.
    console.warn(`      sync-lib warning: ${err.message}`);
  }
}

function round(n, dp = 4) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

async function main() {
  const startedAt = new Date();
  console.log('[0/4] syncing src/ -> public/lib/...');
  await syncLib();

  console.log('[1/4] fetching hero list...');
  const heroesRaw = await fetchHeroes();
  const heroes = heroesRaw
    .filter((h) => h && h.id)
    .sort((a, b) => a.id - b.id);
  console.log(`      ${heroes.length} heroes`);

  console.log('[2/4] fetching patch list...');
  const patches = await fetchPatchList();
  const currentPatch = patches.length ? patches[patches.length - 1] : null;
  console.log(`      current patch: ${currentPatch?.name ?? 'unknown'}`);

  console.log(`[3/4] fetching matchups for ${heroes.length} heroes...`);
  const byId = new Map(heroes.map((h) => [h.id, h]));

  const settled = await mapPool(heroes, (h) => fetchMatchups(h.id));

  const failed = settled.filter((r) => !r.ok);
  if (failed.length) {
    console.warn(`      ${failed.length} hero fetches failed:`);
    for (const f of failed.slice(0, 10)) {
      console.warn(`        hero ${f.item.id} (${f.item.localized_name}): ${f.error}`);
    }
  }

  // Build a symmetric-ish sparse matrix.
  // matchups[attackerId][defenderId] = stats
  const matchups = {};
  let pairCount = 0;
  let rankedPairCount = 0;
  const sampleSizes = [];

  settled.forEach((res, idx) => {
    const hero = heroes[idx];
    if (!res.ok) return;
    const rows = Array.isArray(res.value) ? res.value : [];
    const out = {};

    for (const row of rows) {
      const oppId = row.hero_id ?? row.heroId;
      const games = row.games_played ?? row.gamesPlayed ?? 0;
      const wins = row.wins ?? 0;
      if (!oppId || !byId.has(oppId)) continue;
      if (games < MIN_GAMES_KEPT) continue;

      const w = wilson(wins, games);
      out[oppId] = {
        g: games,
        w: wins,
        p: round(w.point),
        lb: round(w.lower),
        ub: round(w.upper),
        t: tierFor(games),
      };
      pairCount++;
      sampleSizes.push(games);
      if (games >= 30) rankedPairCount++;
    }

    matchups[hero.id] = out;
  });

  sampleSizes.sort((a, b) => a - b);
  const q = (p) =>
    sampleSizes.length ? sampleSizes[Math.floor(sampleSizes.length * p)] : 0;

  console.log(
    `      ${pairCount} pairs, ${rankedPairCount} rankable (>=30 games), ` +
      `${settled.length - failed.length}/${heroes.length} heroes ok`
  );
  console.log(
    `      sample size p25=${q(0.25)} median=${q(0.5)} p75=${q(0.75)} p90=${q(0.9)}`
  );

  console.log('[4/4] writing dataset...');
  const dataset = {
    meta: {
      builtAt: startedAt.toISOString(),
      source: 'OpenDota',
      patch: currentPatch?.name ?? null,
      patchDate: currentPatch?.date ?? null,
      heroesOk: settled.length - failed.length,
      heroesTotal: heroes.length,
      pairs: pairCount,
      rankablePairs: rankedPairCount,
      sampleStats: {
        p25: q(0.25),
        median: q(0.5),
        p75: q(0.75),
        p90: q(0.9),
        max: sampleSizes.length ? sampleSizes[sampleSizes.length - 1] : 0,
      },
      thresholds: { high: 100, medium: 30 },
      note:
        'OpenDota /matchups is already a rolling recent window, so per-pair ' +
        'samples are small by nature (median ~47 games). t/lb/ub are a Wilson ' +
        'interval, kept for judging trustworthiness. Scoring shrinks the ' +
        'observed rate toward 50% (PRIOR_GAMES in src/recommend.mjs) instead of ' +
        'using lb, because a worst-case bound destroyed real signal from ' +
        'thin-but-genuine samples.',
    },
    heroes: heroes.map((h) => ({
      id: h.id,
      name: h.name,
      n: h.localized_name,
      attr: h.primary_attr,
      atk: h.attack_type,
      roles: h.roles ?? [],
    })),
    patches: patches.slice(-8).map((p) => ({ name: p.name, date: p.date, id: p.id })),
    matchups,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(dataset), 'utf8');

  const bytes = JSON.stringify(dataset).length;
  console.log(`      wrote ${OUT} (${(bytes / 1024).toFixed(1)} KB)`);
  console.log(`done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

  // Non-zero exit if too many heroes failed, so CI surfaces real breakage.
  if (failed.length > heroes.length * 0.1) {
    console.error(`ERROR: ${failed.length} hero fetches failed (>10%)`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
