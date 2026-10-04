#!/usr/bin/env node
/**
 * Convert a STRATZ matrix dump into the same dataset shape as data.json, so the
 * recommendation engine can run on it unchanged.
 *
 *   node scripts/build-stratz.mjs                     # tmp/stratz-matrix.json
 *   node scripts/build-stratz.mjs --in <path> --out <path>
 *
 * Input (from scripts/stratz-matrix-snippet.js, pasted into a browser console
 * because api.stratz.com is behind Cloudflare bot protection):
 *
 *   { heroes: { "<heroId>": { "<foeId>": [matchCount, queriedHeroWins], ... } } }
 *
 * Output: public/data/data-stratz.json
 *   { meta, heroes, matchups: { "<heroId>": { "<foeId>": {g,w,p,lb,ub,t} } } }
 *
 * WHY CONVERT AT ALL
 * ------------------
 * The engine, the Wilson tiers and the UI all already work on one shape. Rather
 * than teach every consumer about a second format, normalise STRATZ into it at
 * build time.
 *
 * Note on counts: the two directions of a pair can differ by a fraction of a
 * percent (STRATZ counts each side separately). We keep each hero's own row as
 * given — the engine's lookupPair already prefers the direct direction and
 * falls back to the reverse, so a small asymmetry is harmless.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { wilson, tierFor } from '../src/wilson.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const round = (n, dp = 4) => Math.round(n * 10 ** dp) / 10 ** dp;

async function main() {
  const inPath = resolve(ROOT, arg('--in', 'tmp/stratz-matrix.json'));
  const outPath = resolve(ROOT, arg('--out', 'public/data/data-stratz.json'));
  // Hero names/ids/roles come from the OpenDota dataset so both sources line up
  // exactly; STRATZ's ids are the same Valve ids.
  const referencePath = resolve(ROOT, 'public/data/data.json');

  console.log(`读入 ${inPath}`);
  const dump = JSON.parse(await readFile(inPath, 'utf8'));
  const reference = JSON.parse(await readFile(referencePath, 'utf8'));

  if (!dump.heroes || typeof dump.heroes !== 'object') {
    throw new Error('dump 里没有 heroes 字段 —— 这不是 stratz-matrix.json');
  }

  const knownIds = new Set(reference.heroes.map((h) => h.id));
  const matchups = {};
  let pairs = 0;
  let rankedPairs = 0;
  let dropped = 0;
  const sampleSizes = [];

  for (const [heroIdStr, foes] of Object.entries(dump.heroes)) {
    const heroId = Number(heroIdStr);
    if (!knownIds.has(heroId)) continue;
    const row = {};

    for (const [foeIdStr, value] of Object.entries(foes || {})) {
      const foeId = Number(foeIdStr);
      if (!knownIds.has(foeId) || foeId === heroId) continue;

      // Accept both [matchCount, wins] arrays and {g,w} objects.
      const games = Array.isArray(value) ? value[0] : value?.g;
      const wins = Array.isArray(value) ? value[1] : value?.w;
      if (!Number.isFinite(games) || games <= 0) { dropped++; continue; }
      const w = Math.min(Number.isFinite(wins) ? wins : 0, games);

      const iv = wilson(w, games);
      row[foeId] = {
        g: games,
        w,
        p: round(iv.point),
        lb: round(iv.lower),
        ub: round(iv.upper),
        t: tierFor(games),
      };
      pairs++;
      sampleSizes.push(games);
      if (games >= 30) rankedPairs++;
    }

    matchups[heroId] = row;
  }

  sampleSizes.sort((a, b) => a - b);
  const q = (p) => (sampleSizes.length ? sampleSizes[Math.floor(sampleSizes.length * p)] : 0);

  const heroesWithData = Object.values(matchups).filter((r) => Object.keys(r).length).length;

  const dataset = {
    meta: {
      builtAt: new Date().toISOString(),
      source: 'STRATZ',
      sourcePulledAt: dump.pulledAt ?? null,
      bracket: dump.bracketsUsed ?? null,
      patch: reference.meta.patch ?? null,
      patchDate: reference.meta.patchDate ?? null,
      heroesOk: heroesWithData,
      heroesTotal: reference.heroes.length,
      pairs,
      rankablePairs: rankedPairs,
      droppedPairs: dropped,
      sampleStats: {
        p25: q(0.25),
        median: q(0.5),
        p75: q(0.75),
        p90: q(0.9),
        max: sampleSizes.length ? sampleSizes[sampleSizes.length - 1] : 0,
      },
      thresholds: { high: 100, medium: 30 },
      note:
        'STRATZ heroVsHeroMatchup, pulled via a browser console (api.stratz.com ' +
        'is behind Cloudflare bot protection; plain HTTP clients are challenged). ' +
        'Per-pair samples are roughly 15-50x OpenDota\'s, so the shrinkage prior ' +
        'barely moves these numbers — which is the point.',
    },
    heroes: reference.heroes,
    patches: reference.patches ?? [],
    matchups,
  };

  await mkdir(dirname(outPath), { recursive: true });
  const json = JSON.stringify(dataset);
  await writeFile(outPath, json, 'utf8');

  console.log(`  英雄 ${heroesWithData}/${reference.heroes.length} | 对位 ${pairs.toLocaleString()} 组 | 可排序 ${rankedPairs.toLocaleString()}`);
  console.log(`  样本量 中位 ${q(0.5).toLocaleString()} / 最大 ${(sampleSizes.at(-1) ?? 0).toLocaleString()}`);
  if (dropped) console.log(`  丢弃 ${dropped} 条无效记录`);
  console.log(`写出 ${outPath} (${(json.length / 1024 / 1024).toFixed(2)} MB)`);

  if (!pairs) {
    console.error('ERROR: 没有生成任何对位数据');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('fatal:', err.message);
  process.exit(1);
});
