#!/usr/bin/env node
/**
 * STRATZ connectivity + schema probe.
 *
 * WHY THIS EXISTS
 * ---------------
 * STRATZ's GraphQL schema is not published anywhere reliable, and its own
 * docs warn that field names are camelCase and must match exactly — a wrong
 * field name fails with "Cannot query field". So rather than guess a matchup
 * query, this script introspects the live schema and reports what is actually
 * available.
 *
 * It also separates the two failure modes we hit while building this:
 *   1. missing/invalid token  -> a GraphQL error or 401/403 from Kong
 *   2. Cloudflare bot check   -> an HTML page titled "Just a moment..."
 * These need completely different fixes, so the script tells them apart.
 *
 * USAGE
 * -----
 *   node scripts/stratz-probe.mjs                 # full probe + schema dump
 *   node scripts/stratz-probe.mjs --raw '{ constants { gameModes { name } } }'
 *
 * TOKEN
 * -----
 * Read from, in order:
 *   1. $STRATZ_TOKEN
 *   2. .env.local  ->  STRATZ_TOKEN=eyJ...
 * Get one free at https://stratz.com/api (Steam sign-in).
 * The token is never printed by this script.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ENDPOINT = 'https://api.stratz.com/graphql';
const OUT = resolve(ROOT, 'tmp/stratz-probe.json');

/* ------------------------------------------------------------------ */
/* token                                                               */
/* ------------------------------------------------------------------ */

async function readToken() {
  if (process.env.STRATZ_TOKEN?.trim()) {
    return { token: process.env.STRATZ_TOKEN.trim(), source: 'env STRATZ_TOKEN' };
  }
  try {
    const env = await readFile(resolve(ROOT, '.env.local'), 'utf8');
    const m = env.match(/^\s*STRATZ_TOKEN\s*=\s*(.+?)\s*$/m);
    if (m) return { token: m[1].replace(/^["']|["']$/g, ''), source: '.env.local' };
  } catch {
    /* fall through to the error below */
  }
  return { token: null, source: null };
}

/* ------------------------------------------------------------------ */
/* transport                                                           */
/* ------------------------------------------------------------------ */

/**
 * One GraphQL POST.
 * @returns {Promise<{ok:boolean, status:number, data?:any, errors?:any[], kind:string, raw?:string}>}
 *   kind is one of: 'ok' | 'graphql-error' | 'cloudflare' | 'http-error' | 'network-error'
 */
async function gql(query, variables, token) {
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        // A normal UA; some gateways reject obviously-scripted clients.
        'User-Agent': 'dota2-bp-sim/0.1 (+https://github.com/lsp013/dota2-bp-sim)',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(variables ? { query, variables } : { query }),
    });
  } catch (err) {
    return { ok: false, status: 0, kind: 'network-error', raw: err.message };
  }

  const text = await res.text();

  // Cloudflare's interstitial is HTML, not JSON — detect before parsing.
  if (/Just a moment|cf-challenge|challenges\.cloudflare\.com/i.test(text)) {
    return { ok: false, status: res.status, kind: 'cloudflare', raw: text.slice(0, 200) };
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, status: res.status, kind: 'http-error', raw: text.slice(0, 400) };
  }

  if (json.errors?.length) {
    return { ok: false, status: res.status, kind: 'graphql-error', errors: json.errors };
  }
  return { ok: true, status: res.status, kind: 'ok', data: json.data };
}

/* ------------------------------------------------------------------ */
/* probe                                                               */
/* ------------------------------------------------------------------ */

const die = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
};

function describeFailure(r) {
  if (r.kind === 'cloudflare') {
    return [
      '被 Cloudflare 机器人验证拦住了（返回的是 "Just a moment..." HTML 页面）。',
      '这跟 token 无关 —— 请求根本没到 STRATZ 的应用层。',
      '',
      '常见原因：运行环境的 TLS 被中间人代理拦截、或出口 IP 属于数据中心段。',
      '请在你自己电脑的普通终端里重跑本脚本（不要在带 TLS 代理的环境里跑）。',
    ].join('\n');
  }
  if (r.kind === 'network-error') {
    return `网络层失败：${r.raw}`;
  }
  if (r.status === 401 || r.status === 403) {
    return [
      `认证被拒（HTTP ${r.status}）。token 可能无效或已过期。`,
      '去 https://stratz.com/api 重新申请一个。',
    ].join('\n');
  }
  return `HTTP ${r.status}\n${r.raw ?? JSON.stringify(r.errors)}`;
}

async function main() {
  const rawIdx = process.argv.indexOf('--raw');
  const adHoc = rawIdx > -1 ? process.argv[rawIdx + 1] : null;

  const { token, source } = await readToken();
  if (!token) {
    die(
      '找不到 STRATZ token。\n\n' +
        '  方式一：在项目根目录建 .env.local，写入：\n' +
        '      STRATZ_TOKEN=eyJhbGci...\n' +
        '  方式二：设置环境变量 STRATZ_TOKEN\n\n' +
        '  免费申请：https://stratz.com/api （Steam 登录后可见）'
    );
  }
  console.log(`token 来源: ${source}  (长度 ${token.length}，内容不打印)`);

  // Ad-hoc mode: just run one query and dump the result.
  if (adHoc) {
    const r = await gql(adHoc, null, token);
    if (!r.ok) die(describeFailure(r));
    console.log(JSON.stringify(r.data, null, 2));
    return;
  }

  const report = { probedAt: new Date().toISOString() };

  /* --- step 1: prove the token works with a query STRATZ documents --- */
  console.log('\n[1/4] 验证 token …');
  const smoke = await gql('query { constants { gameModes { id name } } }', null, token);
  if (!smoke.ok) die(describeFailure(smoke));
  const modes = smoke.data?.constants?.gameModes ?? [];
  console.log(`      ✔ 认证成功，constants.gameModes 返回 ${modes.length} 条`);
  report.gameModes = modes.slice(0, 6);

  /* --- step 2: what can we query at the root? --- */
  console.log('\n[2/4] 读取 root query 字段 …');
  const roots = await gql(
    `query { __schema { queryType { fields {
       name
       description
       args { name type { kind name ofType { kind name } } }
     } } } }`,
    null,
    token
  );
  if (!roots.ok) die(describeFailure(roots));
  const rootFields = (roots.data?.__schema?.queryType?.fields ?? []).map((f) => ({
    name: f.name,
    args: (f.args ?? []).map((a) => `${a.name}: ${a.type?.name ?? a.type?.ofType?.name ?? a.type?.kind}`),
  }));
  console.log(`      ✔ root 字段 ${rootFields.length} 个`);
  report.rootFields = rootFields;

  const interesting = rootFields.filter((f) =>
    /hero|match|stat|constant/i.test(f.name)
  );
  console.log('      与英雄/对位相关的:');
  for (const f of interesting) {
    console.log(`        - ${f.name}(${f.args.join(', ')})`);
  }

  /* --- step 3: look for a matchup-ish type --- */
  console.log('\n[3/4] 查找对位相关的类型 …');
  const typeNames = await gql(
    `query { __schema { types { name kind } } }`,
    null,
    token
  );
  if (!typeNames.ok) die(describeFailure(typeNames));
  const allTypes = (typeNames.data?.__schema?.types ?? [])
    .filter((t) => t.kind === 'OBJECT' && !t.name.startsWith('__'))
    .map((t) => t.name);
  report.typeCount = allTypes.length;

  const candidates = allTypes.filter((t) =>
    /matchup|versus|vshero|herostat|herovs/i.test(t)
  );
  console.log(`      ✔ 共 ${allTypes.length} 个类型；疑似对位类型 ${candidates.length} 个:`);
  for (const c of candidates) console.log(`        - ${c}`);

  /* --- step 4: field lists for the most promising types --- */
  console.log('\n[4/4] 展开疑似类型的字段 …');
  const details = {};
  for (const t of candidates.slice(0, 8)) {
    const d = await gql(
      `query($n: String!) { __type(name: $n) { name fields { name type { kind name ofType { kind name ofType { name } } } } } }`,
      { n: t },
      token
    );
    if (!d.ok) continue;
    const fields = (d.data?.__type?.fields ?? []).map((f) => {
      const ty = f.type?.name ?? f.type?.ofType?.name ?? f.type?.ofType?.ofType?.name ?? f.type?.kind;
      return `${f.name}: ${ty}`;
    });
    details[t] = fields;
    console.log(`\n      ${t}:`);
    for (const f of fields) console.log(`        ${f}`);
  }
  report.typeDetails = details;

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n✔ 完整结果已写入 ${OUT}`);
  console.log('  把这个文件（或上面与对位相关的输出）发给我，我据此写正式抓取脚本。');
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
