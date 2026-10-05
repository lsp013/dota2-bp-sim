import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  HERO_ZH,
  HERO_NICKNAMES,
  heroSearchTerms,
  heroMatchesQuery,
  heroesMissingChineseName,
} from '../src/heroNames.mjs';

const readHeroes = async () =>
  JSON.parse(await readFile(new URL('../public/data/data.json', import.meta.url), 'utf8')).heroes;

test('EVERY hero in the dataset has a Chinese name', async () => {
  // When Valve ships a new hero this fails and names it, which is the prompt to
  // add the entry. A silent gap would mean one hero is unsearchable in Chinese.
  const heroes = await readHeroes();
  const missing = heroesMissingChineseName(heroes);
  assert.deepEqual(
    missing.map((h) => `${h.n}(${h.id})`),
    [],
    `缺少中文名，请补进 src/heroNames.mjs：${missing.map((h) => h.n).join(', ')}`
  );
  assert.equal(Object.keys(HERO_ZH).length >= heroes.length, true);
});

test('no nickname is defined for an unknown hero id', async () => {
  const heroes = await readHeroes();
  const known = new Set(heroes.map((h) => h.id));
  const strays = Object.keys(HERO_NICKNAMES).map(Number).filter((id) => !known.has(id));
  assert.deepEqual(strays, [], `外号表里有不存在的英雄 id: ${strays.join(', ')}`);
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
