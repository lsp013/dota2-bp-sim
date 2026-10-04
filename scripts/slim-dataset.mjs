#!/usr/bin/env node
/**
 * Rewrite a dataset file into the slim on-disk format.
 *
 *   node scripts/slim-dataset.mjs --in public/data/data.json --out public/data/data.json
 *
 * WHY THIS EXISTS
 * ---------------
 * Datasets used to store `p`, `lb`, `ub` and `t` next to the observed counts.
 * Those four fields are pure functions of `g` and `w`, and cost ~70% of the
 * bytes. New fetch/build scripts write the slim form directly; this converts
 * files produced by older ones without needing to re-fetch anything (which
 * matters because the OpenDota re-fetch needs network and the STRATZ re-fetch
 * needs a browser).
 *
 * SAFETY
 * ------
 * It is strictly lossless with respect to the DATA: `g` and `w` — the actual
 * observations — are copied through untouched. Only derived fields are dropped,
 * and `hydrateDataset()` recomputes them exactly on load. The script refuses to
 * run if a pair is missing its counts, rather than silently writing a hole.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const inPath = resolve(arg('--in', 'public/data/data.json'));
  const outPath = resolve(arg('--out', inPath));

  const ds = JSON.parse(await readFile(inPath, 'utf8'));
  if (!ds?.matchups) throw new Error(`${inPath} 不是数据集（缺少 matchups）`);

  const slim = {};
  let pairs = 0;
  let lost = 0;
  let alreadySlim = 0;

  for (const [heroId, row] of Object.entries(ds.matchups)) {
    const out = {};
    for (const [foeId, v] of Object.entries(row || {})) {
      if (!v) continue;
      const g = v.g;
      const w = v.w;
      if (!Number.isFinite(g) || !Number.isFinite(w)) { lost++; continue; }
      out[foeId] = { g, w };
      pairs++;
      if (v.p === undefined) alreadySlim++;
    }
    slim[heroId] = out;
  }

  if (lost) throw new Error(`${lost} 条记录缺少 g/w，拒绝写入以免丢数据`);

  const meta = {
    ...(ds.meta ?? {}),
    format: 2,
    slimmedAt: new Date().toISOString(),
    note: [
      ds.meta?.note,
      'Pairs store only the observed counts { g, w }; win rate, Wilson interval ' +
        'and tier are recomputed on load by src/dataset.mjs.',
    ].filter(Boolean).join(' '),
  };

  const out = JSON.stringify({ ...ds, meta, matchups: slim });
  const before = (await readFile(inPath)).length;
  await writeFile(outPath, out, 'utf8');

  console.log(`读入 ${inPath}`);
  console.log(`  对位 ${pairs.toLocaleString()} 组（其中 ${alreadySlim.toLocaleString()} 条本来就是精简格式）`);
  console.log(`  ${(before / 1024 / 1024).toFixed(2)} MB → ${(out.length / 1024 / 1024).toFixed(2)} MB ` +
    `(${(100 - (out.length / before) * 100).toFixed(0)}% 更小)`);
  console.log(`写出 ${outPath}`);
  console.log('  g/w 原始计数逐一复制，未做任何改动');
}

main().catch((err) => {
  console.error('fatal:', err.message);
  process.exit(1);
});
