#!/usr/bin/env node
/**
 * Inject/refresh the official Chinese hero names in an existing dataset.
 *
 *   node scripts/patch-hero-names.mjs                     # public/data/data.json
 *   node scripts/patch-hero-names.mjs --in <path> --out <path>
 *
 * WHY
 * ---
 * The `zh` field is normally written by scripts/fetch-data.mjs, which needs
 * OpenDota. If the dataset is already built and only the names are missing or
 * stale, re-fetching a million matchup rows to add a name field would be silly
 * — this patches just the `heroes` array.
 *
 * TOUCHES NAMES ONLY. The `matchups` object (the observed counts) is copied
 * through byte-for-byte.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fetchChineseHeroNames } from './lib/valveNames.mjs';

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const inPath = resolve(arg('--in', 'public/data/data.json'));
  const outPath = resolve(arg('--out', inPath));

  const ds = JSON.parse(await readFile(inPath, 'utf8'));
  if (!Array.isArray(ds?.heroes)) throw new Error(`${inPath} 没有 heroes 数组`);

  const official = await fetchChineseHeroNames();
  console.log(`Valve feed: ${official.size} 个英雄`);

  let added = 0;
  let changed = 0;
  let unknown = 0;

  for (const hero of ds.heroes) {
    const o = official.get(hero.id);
    if (!o) { unknown++; continue; }
    if (hero.zh === undefined) added++;
    else if (hero.zh !== o.zh) {
      changed++;
      console.log(`  更正 ${hero.n}: ${hero.zh} -> ${o.zh}`);
    }
    hero.zh = o.zh;
  }

  const matchupsBefore = JSON.stringify(ds.matchups ?? {});
  await writeFile(outPath, JSON.stringify(ds), 'utf8');
  const written = JSON.parse(await readFile(outPath, 'utf8'));
  const matchupsAfter = JSON.stringify(written.matchups ?? {});

  console.log(`  新增 zh 字段 ${added} 个 | 更正 ${changed} 个 | feed 里没有的 ${unknown} 个`);
  console.log(`  matchups 未改动: ${matchupsBefore === matchupsAfter ? '✅ 完全一致' : '❌ 不一致！'}`);
  console.log(`写出 ${outPath}`);
}

main().catch((err) => {
  console.error('fatal:', err.message);
  process.exit(1);
});
