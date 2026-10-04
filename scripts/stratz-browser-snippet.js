/**
 * STRATZ probe — BROWSER CONSOLE version.
 *
 * WHY THIS EXISTS
 * ---------------
 * api.stratz.com sits behind Cloudflare bot protection. Plain HTTP clients
 * (node fetch, curl, python, and GitHub Actions runners) all get a
 * "Just a moment..." challenge page instead of data — verified from two
 * different machines. Real browsers pass it, because they can execute the
 * challenge.
 *
 * So the reliable way to get STRATZ data is to ask a browser to do it.
 *
 * HOW TO USE
 * ----------
 * 1. Open  https://api.stratz.com/graphiql  in your browser and wait for the
 *    page to finish loading. (Any api.stratz.com page works — it must be that
 *    origin so the request is same-origin and carries Cloudflare's clearance
 *    cookie.)
 * 2. Open DevTools -> Console  (F12).
 * 3. Copy everything below the "---8<---" line, paste it into the console,
 *    replace PASTE_YOUR_TOKEN_HERE with your token, press Enter.
 * 4. It downloads  stratz-probe.json  to your Downloads folder.
 * 5. Move that file to  F:\code\dsh\dota_BP\tmp\stratz-probe.json  (tmp/ is
 *    gitignored, so the raw dump never gets committed).
 *
 * The token is deliberately NOT stored in this file — it is committed to the
 * repo, and secrets must not be.
 */

/* ---8<--- everything below this line goes into the browser console ---8<---

(async () => {
  const TOKEN = 'PASTE_YOUR_TOKEN_HERE';

  const q = (query, variables) => fetch('/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + TOKEN,
    },
    body: JSON.stringify(variables ? { query, variables } : { query }),
  }).then((r) => r.json());

  const out = { probedAt: new Date().toISOString(), via: 'browser console' };

  // 1. Smoke test — proves the token works.
  out.smoke = await q('query { constants { gameModes { id name } } }');
  if (out.smoke.errors) {
    console.error('认证失败，检查 token：', out.smoke.errors);
    return;
  }
  console.log('✔ 认证成功，gameModes:', out.smoke.data.constants.gameModes.length, '条');

  // 2. Root query fields — what entry points exist.
  out.rootFields = await q(
    'query { __schema { queryType { fields { name args { name } } } } }'
  );
  const roots = out.rootFields.data.__schema.queryType.fields;
  console.log('root 字段:', roots.map((f) => f.name).join(', '));

  // 3. All object types, so we can find the matchup type by name.
  const types = await q('query { __schema { types { name kind } } }');
  out.types = types.data.__schema.types
    .filter((t) => t.kind === 'OBJECT' && !t.name.startsWith('__'))
    .map((t) => t.name);
  const candidates = out.types.filter((n) => /matchup|versus|vshero|herostat/i.test(n));
  console.log('疑似对位类型:', candidates.join(', ') || '(没找到，见 out.types)');

  // 4. Field lists for the promising types — this is what tells us whether
  //    STRATZ exposes anything OpenDota does not (e.g. bigger samples).
  out.typeDetails = {};
  for (const name of candidates.slice(0, 10)) {
    const d = await q(
      'query($n: String!) { __type(name: $n) { fields { name type { name kind ofType { name } } } } }',
      { n: name }
    );
    out.typeDetails[name] =
      d.data?.__type?.fields?.map((f) => ({
        name: f.name,
        type: f.type?.name ?? f.type?.ofType?.name ?? f.type?.kind,
      })) ?? null;
    console.log(name, '->', (out.typeDetails[name] || []).map((f) => f.name).join(', '));
  }

  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'stratz-probe.json';
  a.click();
  console.log('✔ 已下载 stratz-probe.json —— 移到 F:\\code\\dsh\\dota_BP\\tmp\\ 下');
})();

---8<--- end of snippet ---8<--- */
