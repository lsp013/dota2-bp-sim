/**
 * STRATZ FULL MATRIX pull — BROWSER CONSOLE version (v4).
 *
 * WHY THIS EXISTS
 * ---------------
 * v3 proved STRATZ is worth it: per-pair samples are 15-50x larger than
 * OpenDota's (median 688 vs 44 games against Necrophos), and with that much
 * data the ranking changes completely — OpenDota's top counter (Shadow Demon
 * at 65.0% over 40 games) is actually neutral at 49.8% over 203 games.
 *
 * But v3 only queried ONE hero (Necrophos), because that was the case under
 * investigation. A data-source toggle needs the WHOLE 127x127 matrix, so this
 * version loops over every hero.
 *
 * SCHEMA, CORRECTED (three things v3 got wrong)
 * ---------------------------------------------
 *  1. advantage/disadvantage are arrays of HeroDryadType, and the opponents
 *     live in a NESTED array: advantage[0].vs[] — not advantage[].vs.
 *  2. bracketBasicIds: [ALL] returns ZERO rows. Use concrete enum values
 *     (HERALD_GUARDIAN, CRUSADER_ARCHON, LEGEND_ANCIENT, DIVINE_IMMORTAL).
 *  3. `week` is a WEEK INDEX (2961 = current), not an epoch timestamp.
 *
 * DIRECTION, VERIFIED EMPIRICALLY
 * -------------------------------
 * winCount is heroId1's wins: the sample-weighted average of winCount/matchCount
 * across all 126 opponents came out at 48.29%, matching Necrophos's own win rate
 * of 48.3%. This script still derives the orientation per row rather than
 * assuming it, and stores wins for the QUERIED hero.
 *
 * HOW TO USE
 * ----------
 * 1. Open https://api.stratz.com/graphiql and let it load.
 * 2. F12 -> Console.
 * 3. Paste everything between the ---8<--- markers, replace
 *    PASTE_YOUR_TOKEN_HERE, press Enter.
 * 4. Leave the tab open; it logs progress every 10 heroes (~1-3 minutes).
 * 5. It downloads stratz-matrix.json -> move to F:\code\dsh\dota_BP\tmp\
 *
 * The token is a placeholder here on purpose: this file is committed.
 */

/* ---8<--- everything below this line goes into the browser console ---8<---

(async () => {
  const TOKEN = 'PASTE_YOUR_TOKEN_HERE';

  // All calibrated brackets, so the population matches OpenDota's (which does
  // not filter by rank) and the two sources can be compared and merged.
  const BRACKETS = '[HERALD_GUARDIAN, CRUSADER_ARCHON, LEGEND_ANCIENT, DIVINE_IMMORTAL]';

  const HERO_IDS = [
    1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,25,26,27,28,29,30,
    31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,
    57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,
    83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,
    107,108,109,110,111,112,113,114,119,120,121,123,126,128,129,131,135,136,137,138,
    145,155,
  ];

  const q = (query) => fetch('/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({ query }),
  }).then((r) => r.json());

  const out = { pulledAt: new Date().toISOString(), via: 'browser console v4',
                brackets: BRACKETS, heroes: {}, orientation: { heroId1: 0, heroId2: 0, other: 0 } };

  // ---- auth ----
  const smoke = await q('query { constants { gameModes { id } } }');
  if (smoke.errors) { console.error('认证失败：', smoke.errors); return; }
  console.log('✔ token 可用');

  const buildQuery = (h, bracketArgs) => `{
    heroStats {
      heroVsHeroMatchup(heroId: ${h}, matchLimit: 0, take: 200${bracketArgs}) {
        advantage { heroId matchCountVs vs { heroId1 heroId2 matchCount winCount week bracketBasicIds } }
      }
    }
  }`;

  const vsRows = (resp) => (resp?.data?.heroStats?.heroVsHeroMatchup?.advantage ?? [])
    .flatMap((o) => o.vs ?? []);

  // ---- pick a bracket argument that actually returns rows ----
  const candidates = [', bracketBasicIds: ' + BRACKETS, ', bracketBasicIds: [DIVINE_IMMORTAL]', ''];
  let bracketArgs = null;
  for (const cand of candidates) {
    const res = await q(buildQuery(36, cand));
    if (res.errors) { console.warn(`分段参数 ${cand || '(不传)'} 报错: ${res.errors[0].message}`); continue; }
    const n = vsRows(res).length;
    console.log(`分段参数 ${cand || '(不传)'} → ${n} 行`);
    if (n > 0) { bracketArgs = cand; out.bracketsUsed = cand || '(none)'; break; }
  }
  if (bracketArgs === null) { console.error('所有分段参数都返回空，无法继续'); return; }
  console.log(`采用分段参数: ${bracketArgs || '(不传)'}\n`);

  // ---- loop every hero ----
  const t0 = Date.now();
  let done = 0, empty = 0;
  for (const h of HERO_IDS) {
    const res = await q(buildQuery(h, bracketArgs));
    if (res.errors) { console.warn(`hero ${h} ❌ ${res.errors[0].message}`); continue; }

    const compact = {};
    for (const v of vsRows(res)) {
      const foe = v.heroId1 === h ? v.heroId2 : v.heroId2 === h ? v.heroId1 : null;
      if (foe == null || !v.matchCount) { out.orientation.other++; continue; }
      if (v.heroId1 === h) out.orientation.heroId1++;
      else out.orientation.heroId2++;
      // wins for the QUERIED hero, whichever side it appears on
      const wins = v.heroId1 === h ? v.winCount : v.matchCount - v.winCount;
      compact[foe] = [v.matchCount, wins];
    }
    if (Object.keys(compact).length) out.heroes[h] = compact;
    else empty++;

    done++;
    if (done % 10 === 0 || done === HERO_IDS.length) {
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(`  ${done}/${HERO_IDS.length} 英雄 (${secs}s)${empty ? ` | ${empty} 个空` : ''}`);
    }
    await new Promise((r) => setTimeout(r, 250)); // be polite to the API
  }

  // ---- summary ----
  const allCounts = [];
  for (const foes of Object.values(out.heroes)) for (const [, [mc]] of Object.entries(foes)) allCounts.push(mc);
  allCounts.sort((a, b) => a - b);
  out.summary = {
    heroesWithData: Object.keys(out.heroes).length,
    pairs: allCounts.length,
    median: allCounts[Math.floor(allCounts.length / 2)],
    max: allCounts[allCounts.length - 1],
    total: allCounts.reduce((a, b) => a + b, 0),
    orientation: out.orientation,
  };
  console.log('\n=== 完成 ===');
  console.log(`英雄 ${out.summary.heroesWithData}/${HERO_IDS.length} | 对位 ${out.summary.pairs} 组`);
  console.log(`样本量 中位 ${out.summary.median} / 最大 ${out.summary.max} / 总 ${out.summary.total.toLocaleString()}`);
  console.log(`方向统计 heroId1=${out.orientation.heroId1} heroId2=${out.orientation.heroId2} 其他=${out.orientation.other}`);

  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'stratz-matrix.json';
  a.click();
  console.log('✔ 已下载 stratz-matrix.json —— 移到 F:\\code\\dsh\\dota_BP\\tmp\\');
})();

---8<--- end of snippet ---8<--- */
