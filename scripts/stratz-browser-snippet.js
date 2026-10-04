/**
 * STRATZ probe + matchup pull — BROWSER CONSOLE version (v2).
 *
 * WHY A BROWSER IS REQUIRED
 * -------------------------
 * api.stratz.com is behind Cloudflare bot protection. Plain HTTP clients get a
 * "Just a moment..." challenge instead of data. Reproduced from a local dev
 * machine AND from the agent sandbox — including with TLS certificate
 * validation disabled, which rules out the sandbox's TLS interception as the
 * cause. The block is client-fingerprint based, so node/curl/python/CI runners
 * are all out. A real browser passes, because it can run the challenge.
 *
 * WHY THIS IS v2
 * --------------
 * The v1 probe found the schema entry points but not their arguments or field
 * names, and STRATZ's docs warn that field names must match exactly. So this
 * version is self-adapting: it introspects the arguments and fields first, then
 * builds the data query from what actually exists instead of guessing.
 *
 * What we are looking for (the only things that would justify using STRATZ):
 *   - bracketBasicIds -> per-rank-bracket filtering. OpenDota has NONE, which
 *     is why "is Muerta the top Necrophos counter?" cannot be answered today.
 *   - matchCount      -> sample size per matchup pair. OpenDota's median is
 *     only ~47 games, which is the whole reason counters like Ancient
 *     Apparition (35 games) are hard to distinguish from noise.
 *
 * HOW TO USE
 * ----------
 * 1. Open  https://api.stratz.com/graphiql  in your browser; wait for it to load.
 *    (Must be that origin so the request is same-origin and carries
 *    Cloudflare's clearance cookie.)
 * 2. F12 -> Console.
 * 3. Paste everything between the ---8<--- markers, replace
 *    PASTE_YOUR_TOKEN_HERE, press Enter.
 * 4. It downloads stratz-probe2.json -> move to F:\code\dsh\dota_BP\tmp\
 *
 * The token is a placeholder here on purpose: this file is committed.
 */

/* ---8<--- everything below this line goes into the browser console ---8<---

(async () => {
  const TOKEN = 'PASTE_YOUR_TOKEN_HERE';
  const HERO_ID = 36; // Necrophos — the case we are trying to resolve

  const q = (query, variables) => fetch('/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify(variables ? { query, variables } : { query }),
  }).then((r) => r.json());

  const out = { probedAt: new Date().toISOString(), via: 'browser console v2' };

  // ---- 1. sanity: does the token work at all? ----
  const smoke = await q('query { constants { gameModes { id name } } }');
  if (smoke.errors) { console.error('认证失败：', smoke.errors); return; }
  console.log('✔ token 可用');

  // ---- 2. introspect HeroStatsQuery WITH arguments ----
  const fmt = (t) => t?.name || t?.ofType?.name || t?.ofType?.ofType?.name || t?.kind;
  const hsq = await q(`query { __type(name:"HeroStatsQuery"){ fields {
      name description
      args { name description type { name kind ofType { name kind } } }
      type { name kind ofType { name } }
    } } }`);
  const hsqFields = hsq.data?.__type?.fields ?? [];
  out.heroStatsQuery = hsqFields;
  const hvh = hsqFields.find((f) => f.name === 'heroVsHeroMatchup');
  console.log('heroVsHeroMatchup 参数:', (hvh?.args || []).map((a) => `${a.name}: ${fmt(a.type)}`).join(', ') || '(无)');

  // ---- 3. introspect the two Dryad types + bracket enum ----
  const dryad = async (name) => {
    const d = await q(`query($n:String!){ __type(name:$n){ name fields { name type { name kind ofType { name } } } } }`, { n: name });
    return d.data?.__type?.fields ?? [];
  };
  out.heroDryadType = await dryad('HeroDryadType');
  out.heroStatsHeroDryadType = await dryad('HeroStatsHeroDryadType');
  console.log('HeroDryadType 字段:', out.heroDryadType.map((f) => f.name).join(', '));

  const be = await q('query { __type(name:"RankBracketBasicEnum"){ enumValues { name description } } }');
  out.brackets = be.data?.__type?.enumValues ?? [];
  console.log('分段位枚举:', out.brackets.map((b) => b.name).join(', '));

  // ---- 4. build the data query from what actually exists ----
  const wanted = ['heroId1','heroId2','matchCount','winCount','winRateHeroId1','winRateHeroId2','synergy','bracketBasicIds','week'];
  const available = new Set(out.heroDryadType.map((f) => f.name));
  const sel = wanted.filter((w) => available.has(w));
  console.log('将请求的字段:', sel.join(', '));

  if (!sel.length) {
    console.warn('HeroDryadType 里没有预期字段，跳过数据查询');
  } else {
    const selStr = sel.join(' ');
    const tryQ = async (label, query) => {
      const res = await q(query);
      out[label] = res;
      if (res.errors) { console.warn(label, '失败:', res.errors.map((e) => e.message).join(' | ')); return null; }
      const rows = res.data?.heroStats?.heroVsHeroMatchup?.advantage?.length ?? 0;
      console.log(`✔ ${label}: advantage ${rows} 行`);
      return res.data;
    };

    // minimal form first — most likely signature
    await tryQ('necAll', `{ heroStats { heroVsHeroMatchup(heroId: ${HERO_ID}) {
        advantage { ${selStr} } disadvantage { ${selStr} } } } }`);

    // then try adding a bracket filter, if the argument exists and we know a value
    const bracketArg = (hvh?.args || []).find((a) => /bracket/i.test(a.name));
    const weekArg = (hvh?.args || []).find((a) => /week/i.test(a.name));
    if (bracketArg && out.brackets.length) {
      const vals = out.brackets.map((b) => b.name).filter((n) => !/UNKNOWN|INVALID/i.test(n));
      const extra = [`${bracketArg.name}: [${vals.map((v) => `"${v}"`).join(', ')}]`];
      if (weekArg) extra.push(`${weekArg.name}: 1`);
      await tryQ('necBracketed', `{ heroStats { heroVsHeroMatchup(heroId: ${HERO_ID}, ${extra.join(', ')}) {
          advantage { ${selStr} } disadvantage { ${selStr} } } } }`);
    }

    // how big are STRATZ's samples overall? (compare with OpenDota's ~47 median)
    const wk = await q('query { heroStats { winWeek(week: 1) { heroId matchCount winCount } } }');
    out.winWeek = wk;
    if (wk.errors) console.warn('winWeek 失败:', wk.errors.map((e) => e.message).join(' | '));
    else {
      const mc = (wk.data?.heroStats?.winWeek ?? []).map((r) => r.matchCount).filter(Boolean).sort((a,b)=>a-b);
      console.log('winWeek 英雄数:', mc.length, '| 单英雄周场次中位:', mc[Math.floor(mc.length/2)]);
    }
  }

  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'stratz-probe2.json';
  a.click();
  console.log('✔ 已下载 stratz-probe2.json —— 移到 F:\\code\\dsh\\dota_BP\\tmp\\');
})();

---8<--- end of snippet ---8<--- */
