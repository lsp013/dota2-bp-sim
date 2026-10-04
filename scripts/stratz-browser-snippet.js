/**
 * STRATZ matchup pull — BROWSER CONSOLE version (v3).
 *
 * WHY A BROWSER
 * -------------
 * api.stratz.com is behind Cloudflare bot protection; plain HTTP clients get a
 * "Just a moment..." page. Verified from a local machine and from the agent
 * sandbox, including with TLS validation disabled — so it is fingerprint-based,
 * not certificate-based. Only a real browser passes.
 *
 * SCHEMA (discovered in probes v1/v2, so nothing here is guessed)
 * ---------------------------------------------------------------
 *   heroStats {
 *     heroVsHeroMatchup(
 *       heroId, week,            // week = epoch timestamp of ONE week; null = current
 *       bracketBasicIds,          // ALL | DIVINE_IMMORTAL | LEGEND_ANCIENT | ...
 *       matchLimit, skip, take
 *     ) {
 *       advantage    { heroId matchCountVs vs { ... } }
 *       disadvantage { heroId matchCountVs vs { ... } }
 *     }
 *   }
 *   vs is a HeroStatsHeroDryadType carrying:
 *     heroId1 heroId2 matchCount winCount winRateHeroId1 winRateHeroId2 week bracketBasicIds
 *
 * WHAT THIS ANSWERS
 * -----------------
 * 1. How large are STRATZ's per-pair samples versus OpenDota's ~47-game median?
 *    (If they are not clearly bigger, STRATZ is not worth the Cloudflare fight.)
 * 2. Does DIVINE_IMMORTAL bracket show Muerta as the top Necrophos counter?
 *    OpenDota cannot answer this at all — it has no bracket filter.
 *
 * HOW TO USE
 * ----------
 * 1. Open https://api.stratz.com/graphiql in your browser and let it load.
 * 2. F12 -> Console.
 * 3. Paste everything between the ---8<--- markers, replace
 *    PASTE_YOUR_TOKEN_HERE, press Enter.
 * 4. It downloads stratz-matchups.json -> move to F:\code\dsh\dota_BP\tmp\
 *
 * The token is a placeholder here on purpose: this file is committed.
 */

/* ---8<--- everything below this line goes into the browser console ---8<---

(async () => {
  const TOKEN = 'PASTE_YOUR_TOKEN_HERE';
  const HERO = 36; // Necrophos

  const NAMES = { 5:'Crystal Maiden', 21:'Windranger', 36:'Necrophos', 60:'Night Stalker',
                  68:'Ancient Apparition', 69:'Doom', 79:'Shadow Demon', 101:'Skywrath Mage',
                  123:'Hoodwink', 138:'Muerta' };

  const q = (query) => fetch('/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({ query }),
  }).then((r) => r.json());

  const out = { pulledAt: new Date().toISOString(), via: 'browser console v3', heroId: HERO };

  // ---- auth ----
  const smoke = await q('query { constants { gameModes { id } } }');
  if (smoke.errors) { console.error('认证失败：', smoke.errors); return; }
  console.log('✔ token 可用\n');

  // ---- one matchup query for a given bracket ----
  const FIELDS = 'heroId1 heroId2 matchCount winCount winRateHeroId1 winRateHeroId2 week bracketBasicIds';
  const buildQuery = (extraArgs) => `{
    heroStats {
      heroVsHeroMatchup(heroId: ${HERO}, matchLimit: 0, take: 200${extraArgs}) {
        advantage    { heroId matchCountVs vs { ${FIELDS} } }
        disadvantage { heroId matchCountVs vs { ${FIELDS} } }
      }
    }
  }`;

  const rowsOf = (data) => {
    const m = data?.heroStats?.heroVsHeroMatchup;
    if (!m) return [];
    // Normalise both lists into one shape.
    //
    // DIRECTION MATTERS: HeroStatsHeroDryadType is a PAIR record with
    // heroId1/heroId2, and we do not know in advance which side Necrophos is.
    // Guessing wrong inverts every win rate, so work it out from the ids and
    // report the FOE's win rate against Necrophos.
    const norm = (arr) => (arr || []).map((r) => {
      const vs = r.vs || {};
      const mineIs1 = vs.heroId1 === HERO;
      const foeId = r.heroId ?? (mineIs1 ? vs.heroId2 : vs.heroId1);
      const matchCount = vs.matchCount ?? 0;
      // wins credited to heroId1; flip when Necrophos is heroId1
      const foeWins = mineIs1 ? matchCount - (vs.winCount ?? 0) : (vs.winCount ?? 0);
      let p = matchCount ? foeWins / matchCount : null;
      // Prefer the API's own rate field when present and sane. Decimal scale is
      // undocumented, so treat anything above 1.5 as a percentage.
      const raw = mineIs1 ? vs.winRateHeroId2 : vs.winRateHeroId1;
      if (raw != null) {
        let v = Number(raw);
        if (v > 1.5) v /= 100;
        if (v >= 0 && v <= 1) p = v;
      }
      return { foeId, matchCount, foeWins, p, week: vs.week, bracket: vs.bracketBasicIds, heroId1: vs.heroId1, heroId2: vs.heroId2 };
    });
    return [...norm(m.advantage), ...norm(m.disadvantage)];
  };

  const run = async (label, extraArgs) => {
    const res = await q(buildQuery(extraArgs));
    out[label] = res;
    if (res.errors) { console.warn(`${label} ❌ ${res.errors.map((e) => e.message).join(' | ')}`); return null; }
    const rows = rowsOf(res.data);
    const counts = rows.map((r) => r.matchCount).filter((n) => n > 0).sort((a, b) => b - a);
    const med = counts.length ? counts[Math.floor(counts.length / 2)] : 0;
    console.log(`${label}: ${rows.length} 行 | 样本量 最大 ${counts[0] ?? 0} / 中位 ${med} / 最小 ${counts[counts.length - 1] ?? 0}`);
    const sample = rows.find((r) => r.heroId1 != null);
    if (sample) console.log(`  方向检查: heroId1=${sample.heroId1} heroId2=${sample.heroId2} → NEC 是 heroId${sample.heroId1 === HERO ? 1 : 2}`);
    return rows;
  };

  // ---- compare brackets, current week ----
  console.log('=== 当前周 · 不同分段 ===');
  const all    = await run('all',    ', bracketBasicIds: [ALL]');
  const divine = await run('divine', ', bracketBasicIds: [DIVINE_IMMORTAL]');
  const legend = await run('legend', ', bracketBasicIds: [LEGEND_ANCIENT]');

  const show = (rows, title) => {
    if (!rows?.length) return;
    console.log(`\n--- ${title}: 打 Necrophos 胜率最高的 10 个（≥30 场）---`);
    rows.slice()
      .filter((r) => r.matchCount >= 30 && r.p != null)
      .sort((a, b) => b.p - a.p)
      .slice(0, 10)
      .forEach((r, i) => console.log(`  ${i + 1}. ${(NAMES[r.foeId] || ('#' + r.foeId)).padEnd(20)} ${(r.p * 100).toFixed(1)}%  ${r.matchCount} 场`));
  };
  show(all, 'ALL 分段');
  show(divine, 'DIVINE_IMMORTAL 分段');

  // ---- pointed check on the heroes in question ----
  console.log('\n=== 点名英雄（当前周 · ALL）===');
  for (const id of [68, 138, 69, 101, 79, 60, 5, 21]) {
    const r = (all || []).find((x) => x.foeId === id);
    if (!r || r.p == null) { console.log(`  ${(NAMES[id] || id).padEnd(20)} 无数据`); continue; }
    console.log(`  ${(NAMES[id] || id).padEnd(20)} ${(r.p * 100).toFixed(1)}%  ${r.matchCount} 场`);
  }

  // ---- one week may be thin: walk back up to 8 weeks and sum ----
  const wkSample = (all || []).find((r) => typeof r.week === 'number')?.week;
  out.weekSample = wkSample;
  console.log(`\n响应中的 week 值: ${wkSample} (${wkSample ? new Date(wkSample > 1e11 ? wkSample : wkSample * 1000).toISOString().slice(0,10) : 'n/a'})`);

  if (typeof wkSample === 'number') {
    const step = wkSample > 1e11 ? 604800000 : 604800; // ms or seconds
    console.log('\n=== 往前翻 8 周，累加样本 ===');
    out.weeks = {};
    const totals = new Map();
    const add = (rows) => {
      for (const r of rows) {
        if (!r.foeId || !r.matchCount) continue;
        const cur = totals.get(r.foeId) || { matchCount: 0, foeWins: 0 };
        cur.matchCount += r.matchCount;
        cur.foeWins += r.foeWins ?? 0;
        totals.set(r.foeId, cur);
      }
    };
    add(all || []);
    for (let i = 1; i <= 8; i++) {
      const wk = wkSample - i * step;
      const res = await q(buildQuery(`, week: ${wk}, bracketBasicIds: [ALL]`));
      if (res.errors) { console.warn(`  -${i}周 ❌ ${res.errors[0].message}`); out.weeks['m' + i] = res; break; }
      out.weeks['m' + i] = res;
      const rows = rowsOf(res.data);
      add(rows);
      console.log(`  -${i}周: ${rows.length} 行`);
    }
    out.aggregate = [...totals.entries()].map(([foeId, v]) => ({
      foeId, matchCount: v.matchCount, foeWins: v.foeWins,
      wr: v.matchCount ? v.foeWins / v.matchCount : null,
    }));
    console.log('\n=== 9 周累加后（样本量 / 打 NEC 胜率）===');
    out.aggregate.slice().sort((a, b) => b.wr - a.wr).filter((r) => r.matchCount >= 30).slice(0, 12)
      .forEach((r, i) => console.log(`  ${i + 1}. ${(NAMES[r.foeId] || ('#' + r.foeId)).padEnd(20)} ${(r.wr * 100).toFixed(1)}%  ${r.matchCount} 场`));
  }

  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'stratz-matchups.json';
  a.click();
  console.log('\n✔ 已下载 stratz-matchups.json —— 移到 F:\\code\\dsh\\dota_BP\\tmp\\');
})();

---8<--- end of snippet ---8<--- */
