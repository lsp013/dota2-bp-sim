import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  HERO_ZH,
  HERO_NICKNAMES,
  heroSearchTerms,
  heroMatchesQuery,
  heroChineseName,
  heroesMissingChineseName,
} from '../src/heroNames.mjs';

const readHeroes = async () =>
  JSON.parse(await readFile(new URL('../public/data/data.json', import.meta.url), 'utf8')).heroes;

test('EVERY hero resolves a Chinese name (dataset field or fallback table)', async () => {
  // When Valve ships a new hero this fails and names it, which is the prompt to
  // regenerate the table (node scripts/patch-hero-names.mjs). A silent gap
  // would mean one hero is unsearchable in Chinese with no visible symptom.
  const heroes = await readHeroes();
  const missing = heroesMissingChineseName(heroes);
  assert.deepEqual(
    missing.map((h) => `${h.n}(${h.id})`),
    [],
    `缺中文名：${missing.map((h) => h.n).join(', ')}`
  );
});

test('the dataset field is populated for all heroes or none', async () => {
  // scripts/fetch-data.mjs fills `zh` from Valve's feed. If that step half
  // worked, some heroes would quietly fall back to the static table while
  // others used live data — invisible in the UI, confusing to debug.
  const heroes = await readHeroes();
  const withZh = heroes.filter((h) => h.zh).length;
  assert.ok(
    withZh === 0 || withZh === heroes.length,
    `zh 只填了 ${withZh}/${heroes.length} 个英雄，抓取步骤可能只成功了一部分`
  );
});

test('the dataset field wins over the fallback table', () => {
  assert.equal(heroChineseName({ id: 36, zh: '自定义名' }), '自定义名');
  assert.equal(heroChineseName({ id: 36 }), HERO_ZH[36], 'falls back to the table');
  assert.equal(heroChineseName({ id: 999999 }), null);
});

test('REGRESSION: names match the official client, not community usage', async () => {
  // These were wrong in the hand-written table. The client names are
  // 主宰/瘟疫法师/自然先知/独行德鲁伊/孽主 — community usage (剑圣/死灵法师/
  // 深渊领主/…) is kept as aliases instead of as the primary name.
  const heroes = await readHeroes();
  const zhOf = (en) => heroes.find((h) => h.n === en)?.zh;

  assert.equal(zhOf('Juggernaut'), '主宰');
  assert.equal(zhOf('Necrophos'), '瘟疫法师');
  assert.equal(zhOf("Nature's Prophet"), '自然先知');
  assert.equal(zhOf('Lone Druid'), '独行德鲁伊');
  assert.equal(zhOf('Underlord'), '孽主');
  assert.equal(zhOf('Kez'), '凯');
  assert.equal(zhOf('Largo'), '朗戈');
});

test('REGRESSION: the community names for those heroes are still searchable', async () => {
  const heroes = await readHeroes();
  const find = (q) => heroes.filter((h) => heroMatchesQuery(h, q)).map((h) => h.n);

  assert.ok(find('剑圣').includes('Juggernaut'), '剑圣 is how players say it');
  assert.ok(find('死灵法师').includes('Necrophos'));
  assert.ok(find('死灵法').includes('Necrophos'));
  assert.ok(find('大屁股').includes('Underlord'));
  assert.ok(find('深渊领主').includes('Underlord'));
  // The user's own spelling for Largo; the client writes 朗戈.
  assert.ok(find('朗格').includes('Largo'), '朗格 alias');
  assert.ok(find('朗戈').includes('Largo'), 'official spelling');
  assert.ok(find('拉戈').includes('Largo'), 'previous wrong spelling, kept working');
  assert.ok(find('凯兹').includes('Kez'));
  assert.ok(find('兽').includes('Primal Beast'), 'simplified glyph');
});

test('no nickname is defined for an unknown hero id', async () => {
  const heroes = await readHeroes();
  const known = new Set(heroes.map((h) => h.id));
  const strays = Object.keys(HERO_NICKNAMES).map(Number).filter((id) => !known.has(id));
  assert.deepEqual(strays, [], `外号表里有不存在的英雄 id: ${strays.join(', ')}`);
});

test('every alias actually resolves its own hero', async () => {
  // An alias that does not match its own hero is a typo that would silently do
  // nothing — the user types it and gets an empty pool.
  const heroes = await readHeroes();
  const problems = [];
  for (const [id, aliases] of Object.entries(HERO_NICKNAMES)) {
    const hero = heroes.find((h) => h.id === Number(id));
    if (!hero) continue;
    for (const alias of aliases) {
      if (!heroMatchesQuery(hero, alias)) {
        problems.push(`${hero.n}: 外号「${alias}」匹配不到自己`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('no hero lists the same alias twice', async () => {
  const dupes = [];
  for (const [id, aliases] of Object.entries(HERO_NICKNAMES)) {
    const seen = new Set();
    for (const a of aliases) {
      const k = a.toLowerCase();
      if (seen.has(k)) dupes.push(`${id}: ${a}`);
      seen.add(k);
    }
  }
  assert.deepEqual(dupes, []);
});

test('a hero may carry many aliases', async () => {
  // One hero -> many nicknames is the intended design, not an accident.
  const heroes = await readHeroes();
  const find = (q) => heroes.filter((h) => heroMatchesQuery(h, q)).map((h) => h.n);
  const nec = HERO_NICKNAMES[36];

  assert.ok(nec.length >= 5, `Necrophos should have several aliases, has ${nec.length}`);
  for (const alias of nec) {
    assert.ok(find(alias).includes('Necrophos'), `${alias} -> Necrophos`);
  }
  // The same hero is reachable by the official name too.
  assert.ok(find('瘟疫法师').includes('Necrophos'));
});

test('aliases stay specific enough to be useful', async () => {
  // Substring matching makes very short aliases broad, which is fine, but an
  // alias matching half the roster would be noise rather than a search.
  const heroes = await readHeroes();
  const noisy = [];
  for (const [id, aliases] of Object.entries(HERO_NICKNAMES)) {
    for (const alias of aliases) {
      if (alias.length < 2 && !/^\d+$/.test(alias)) continue;
      const hits = heroes.filter((h) => heroMatchesQuery(h, alias)).length;
      if (hits > 8) noisy.push(`${alias} -> ${hits} 个英雄`);
    }
  }
  assert.deepEqual(noisy, [], `外号过于宽泛: ${noisy.join(', ')}`);
});

test('search finds heroes by official Chinese name', async () => {
  const heroes = await readHeroes();
  const find = (q) => heroes.filter((h) => heroMatchesQuery(h, q)).map((h) => h.n);

  assert.ok(find('敌法师').includes('Anti-Mage'));
  assert.ok(find('水晶室女').includes('Crystal Maiden'));
  assert.ok(find('美杜莎').includes('Medusa'));
});

test('search finds heroes by nickname', async () => {
  const heroes = await readHeroes();
  const find = (q) => heroes.filter((h) => heroMatchesQuery(h, q)).map((h) => h.n);

  // The nicknames that came up in this project's own troubleshooting.
  assert.ok(find('冰魂').includes('Ancient Apparition'), '冰魂 -> AA');
  assert.ok(find('奶绿').includes('Muerta'), '奶绿 -> Muerta');
  assert.ok(find('剧毒').includes('Venomancer'));
  assert.ok(find('小鱼').includes('Slark'));
  assert.ok(find('敌法').includes('Anti-Mage'));
  assert.ok(find('火枪').includes('Sniper'));
  assert.ok(find('nec').includes('Necrophos'), 'lowercase nickname');
  assert.ok(find('NEC').includes('Necrophos'), 'uppercase nickname');
});

test('search still works for English and internal names', async () => {
  const heroes = await readHeroes();
  const find = (q) => heroes.filter((h) => heroMatchesQuery(h, q)).map((h) => h.n);

  assert.ok(find('anti-mage').includes('Anti-Mage'), 'lowercase english');
  assert.ok(find('Anti').includes('Anti-Mage'), 'partial english');
  assert.ok(find('npc_dota_hero_axe').includes('Axe'), 'internal name');
  assert.ok(find('crystal maiden').includes('Crystal Maiden'), 'spaces preserved');
});

test('an empty query matches every hero', async () => {
  const heroes = await readHeroes();
  assert.equal(heroes.filter((h) => heroMatchesQuery(h, '')).length, heroes.length);
  assert.equal(heroes.filter((h) => heroMatchesQuery(h, '   ')).length, heroes.length);
  assert.equal(heroes.filter((h) => heroMatchesQuery(h, null)).length, heroes.length);
});

test('a query with no match returns nothing rather than everything', async () => {
  const heroes = await readHeroes();
  assert.equal(heroes.filter((h) => heroMatchesQuery(h, 'zzzzz')).length, 0);
});

test('search terms include every alias kind', () => {
  const hero = { id: 68, n: 'Ancient Apparition', name: 'npc_dota_hero_ancient_apparition' };
  const terms = heroSearchTerms(hero);
  assert.ok(terms.includes('Ancient Apparition'), 'english');
  assert.ok(terms.includes('npc_dota_hero_ancient_apparition'), 'internal');
  assert.ok(terms.includes('远古冰魄'), 'official chinese');
  assert.ok(terms.includes('冰魂'), 'nickname');
});

test('a hero id with no entry still matches on English', () => {
  const hero = { id: 99999, n: 'Future Hero', name: 'npc_dota_hero_future' };
  assert.equal(heroMatchesQuery(hero, 'future'), true);
  assert.equal(heroMatchesQuery(hero, '未来'), false);
  assert.deepEqual(heroesMissingChineseName([hero]).map((h) => h.n), ['Future Hero']);
});
