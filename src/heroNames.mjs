/**
 * Chinese hero names and community nicknames, for the hero-pool search.
 *
 * WHY A STATIC TABLE
 * ------------------
 * Neither OpenDota nor STRATZ returns Chinese names: OpenDota's
 * `localized_name` is always English. Rather than depend on scraping a wiki,
 * the official client names are recorded here and the search falls back to
 * English, so a missing entry degrades to current behaviour instead of breaking
 * search.
 *
 * COVERAGE IS ENFORCED BY A TEST
 * ------------------------------
 * tests/heroNames.test.mjs asserts that every hero in public/data/data.json has
 * an entry here. When Valve ships a hero, that test fails and names the hero,
 * which is the prompt to add it. A silent gap would mean one hero quietly
 * becoming unsearchable in Chinese.
 *
 * NICKNAMES are community usage (外号), not official names. They are
 * intentionally conservative — only terms in wide use. Add your own freely;
 * the search is a substring match over all of them, so extra entries are
 * harmless.
 */

/** Official Dota 2 Simplified-Chinese client names, keyed by Valve hero id. */
/**
 * Official Dota 2 Simplified-Chinese client names, keyed by Valve hero id.
 *
 * GENERATED from https://www.dota2.com/datafeed/herolist?language=schinese
 * rather than typed from memory. The previous hand-written table had several
 * community names where the client uses something else — Juggernaut is 主宰
 * (not 剑圣), Necrophos is 瘟疫法师 (not 死灵法师), Nature's Prophet is 自然先知,
 * Lone Druid is 独行德鲁伊, Underlord is 孽主. Community names are still
 * searchable; they live in HERO_NICKNAMES below.
 *
 * The dataset itself also carries a per-hero `zh` field (filled in CI from the
 * same feed); this table is the fallback for datasets that lack it.
 */
export const HERO_ZH = {
  1: '敌法师',
  2: '斧王',
  3: '祸乱之源',
  4: '血魔',
  5: '水晶室女',
  6: '卓尔游侠',
  7: '撼地者',
  8: '主宰',
  9: '米拉娜',
  10: '变体精灵',
  11: '影魔',
  12: '幻影长矛手',
  13: '帕克',
  14: '帕吉',
  15: '雷泽',
  16: '沙王',
  17: '风暴之灵',
  18: '斯温',
  19: '小小',
  20: '复仇之魂',
  21: '风行者',
  22: '宙斯',
  23: '昆卡',
  25: '莉娜',
  26: '莱恩',
  27: '暗影萨满',
  28: '斯拉达',
  29: '潮汐猎人',
  30: '巫医',
  31: '巫妖',
  32: '力丸',
  33: '谜团',
  34: '修补匠',
  35: '狙击手',
  36: '瘟疫法师',
  37: '术士',
  38: '兽王',
  39: '痛苦女王',
  40: '剧毒术士',
  41: '虚空假面',
  42: '冥魂大帝',
  43: '死亡先知',
  44: '幻影刺客',
  45: '帕格纳',
  46: '圣堂刺客',
  47: '冥界亚龙',
  48: '露娜',
  49: '龙骑士',
  50: '戴泽',
  51: '发条技师',
  52: '拉席克',
  53: '自然先知',
  54: '噬魂鬼',
  55: '黑暗贤者',
  56: '克林克兹',
  57: '全能骑士',
  58: '魅惑魔女',
  59: '哈斯卡',
  60: '暗夜魔王',
  61: '育母蜘蛛',
  62: '赏金猎人',
  63: '编织者',
  64: '杰奇洛',
  65: '蝙蝠骑士',
  66: '陈',
  67: '幽鬼',
  68: '远古冰魄',
  69: '末日使者',
  70: '熊战士',
  71: '裂魂人',
  72: '矮人直升机',
  73: '炼金术士',
  74: '祈求者',
  75: '沉默术士',
  76: '殁境神蚀者',
  77: '狼人',
  78: '酒仙',
  79: '暗影恶魔',
  80: '独行德鲁伊',
  81: '混沌骑士',
  82: '米波',
  83: '树精卫士',
  84: '食人魔魔法师',
  85: '不朽尸王',
  86: '拉比克',
  87: '干扰者',
  88: '司夜刺客',
  89: '娜迦海妖',
  90: '光之守卫',
  91: '艾欧',
  92: '维萨吉',
  93: '斯拉克',
  94: '美杜莎',
  95: '巨魔战将',
  96: '半人马战行者',
  97: '马格纳斯',
  98: '伐木机',
  99: '钢背兽',
  100: '巨牙海民',
  101: '天怒法师',
  102: '亚巴顿',
  103: '上古巨神',
  104: '军团指挥官',
  105: '工程师',
  106: '灰烬之灵',
  107: '大地之灵',
  108: '孽主',
  109: '恐怖利刃',
  110: '凤凰',
  111: '神谕者',
  112: '寒冬飞龙',
  113: '天穹守望者',
  114: '齐天大圣',
  119: '邪影芳灵',
  120: '石鳞剑士',
  121: '天涯墨客',
  123: '森海飞霞',
  126: '虚无之灵',
  128: '电炎绝手',
  129: '玛尔斯',
  131: '百戏大王',
  135: '破晓辰星',
  136: '玛西',
  137: '兽',
  138: '琼英碧灵',
  145: '凯',
  155: '朗戈',
};

/**
 * Community nicknames (外号), keyed by hero id.
 * Latin-script aliases are matched case-insensitively by the search.
 */
/**
 * Community aliases (外号), keyed by hero id. A hero may have any number.
 *
 * The official client name is NOT repeated here — that comes from the dataset's
 * `zh` field or HERO_ZH above. Everything in this table is what players
 * actually say, including names Valve replaced years ago (骷髅王/冥魂大帝,
 * 流浪剑客/斯温, 恶魔巫师/莱恩), pinyin-ish abbreviations (CM, SF, QOP, NS),
 * and colour shorthand for the four Spirits (蓝猫/火猫/土猫/紫猫).
 *
 * If a hero is easier to reach with the community name than the official one,
 * that is expected — 主宰 is 剑圣 to almost everyone. Both are matched.
 */
export const HERO_NICKNAMES = {
  1: ['敌法', 'AM', '反法师', 'Anti'],
  2: ['斧头', '斧王'],
  3: ['睡魔', '祸乱', 'Bane'],
  4: ['血魔'],
  5: ['冰女', 'CM', '水晶女', 'Maiden'],
  6: ['小黑', '卓尔', 'Drow'],
  7: ['小牛', '神牛', 'ES', '撼地'],
  8: ['剑圣', 'JUGG', '主宰'],
  9: ['白虎', 'POTM', '月女', '米拉'],
  10: ['水人', '变体', 'Morph'],
  11: ['SF', '奈文摩尔', 'Nevermore', '影魔'],
  12: ['猴子', 'PL', '幻矛'],
  13: ['仙女龙', 'Puck'],
  14: ['屠夫', 'Pudge'],
  15: ['电棍', 'Razor'],
  16: ['SK', '沙王'],
  17: ['蓝猫', 'Storm'],
  18: ['流浪', '流浪剑客', 'Sven'],
  19: ['Tiny'],
  20: ['VS', '复仇', 'Venge'],
  21: ['风行', 'WR', '风行者'],
  22: ['Zeus'],
  23: ['船长', 'Kunkka'],
  25: ['火女', 'Lina'],
  26: ['恶魔巫师', '恶魔', 'Lion'],
  27: ['小歪', 'SS', '萨满', '暗影萨满'],
  28: ['大鱼', '大鱼人', 'Slardar'],
  29: ['潮汐', 'Tide'],
  30: ['WD', '巫医'],
  31: ['Lich'],
  32: ['隐刺', 'Riki'],
  33: ['Enigma'],
  34: ['修补', 'Tinker'],
  35: ['火枪', '矮子', 'Sniper'],
  36: ['NEC', 'necro', '死灵法师', '死灵法', '死灵', '瘟疫'],
  37: ['WL', 'Warlock'],
  38: ['BM', 'Beast'],
  39: ['女王', 'QOP', '痛苦'],
  40: ['剧毒', 'VENO', '毒狗', 'Venomancer'],
  41: ['虚空', 'FV', 'Void'],
  42: ['骷髅王', 'WK', '冥魂'],
  43: ['DP', '死亡先知'],
  44: ['幻刺', 'PA'],
  45: ['骨法', 'Pugna'],
  46: ['圣堂', 'TA'],
  47: ['毒龙', 'Viper'],
  48: ['月骑', 'Luna'],
  49: ['龙骑', 'DK'],
  50: ['戴泽', '毒狗', 'Dazzle'],
  51: ['发条', 'Clock'],
  52: ['老鹿', '鹿', 'Lesh'],
  53: ['NP', '先知', 'Furion'],
  54: ['小狗', 'LS', '狗', '食尸鬼', 'Naix'],
  55: ['黑贤', 'DS'],
  56: ['骨弓', 'Clinkz'],
  57: ['全能', 'Omni'],
  58: ['小鹿', 'Ench'],
  59: ['神灵', '神灵武士', 'Huskar'],
  60: ['夜魔', 'NS'],
  61: ['蜘蛛', 'Brood'],
  62: ['赏金', 'BH'],
  63: ['蚂蚁', 'Weaver'],
  64: ['双头龙', 'Jakiro'],
  65: ['蝙蝠', 'Bat'],
  66: ['圣骑士', 'Chen'],
  67: ['鬼', 'Spectre'],
  68: ['冰魂', 'AA'],
  69: ['末日', 'Doom'],
  70: ['拍拍', 'Ursa'],
  71: ['白牛', 'SB'],
  72: ['飞机', 'Gyro'],
  73: ['炼金', 'Alch'],
  74: ['卡尔', 'Invoker'],
  75: ['沉默', 'Silencer'],
  76: ['黑鸟', 'OD', '毁灭者'],
  77: ['Lycan'],
  78: ['熊猫', 'Brew', '酒仙'],
  79: ['SD', '暗影恶魔'],
  80: ['熊德', 'LD', '德鲁伊', 'Druid'],
  81: ['混沌', 'CK'],
  82: ['地卜师', 'Meepo'],
  83: ['大树', 'Treant', '树精'],
  84: ['蓝胖', 'Ogre', '食人魔'],
  85: ['尸王', 'Undying'],
  86: ['Rubick'],
  87: ['Disruptor', '干扰'],
  88: ['小强', 'Nyx'],
  89: ['小娜迦', 'Naga'],
  90: ['光法', 'KOTL'],
  91: ['小精灵', '精灵', 'Io', 'Wisp'],
  92: ['死灵龙', 'Visage'],
  93: ['小鱼', '小鱼人', 'Slark'],
  94: ['一姐', 'Medusa'],
  95: ['巨魔', 'Troll'],
  96: ['人马', '半人马', 'Centaur'],
  97: ['猛犸', 'Magnus'],
  98: ['机器人', 'Timbersaw'],
  99: ['钢背', 'BB'],
  100: ['海民', 'Tusk'],
  101: ['天怒', 'Sky'],
  102: ['死骑', 'Abaddon'],
  103: ['大牛', 'ET'],
  104: ['军团', 'LC'],
  105: ['炸弹人', 'Techies'],
  106: ['火猫', 'Ember'],
  107: ['土猫', 'Earth'],
  108: ['大屁股', 'Underlord', '深渊领主', '深渊'],
  109: ['TB', '魂守', '灵魂守卫'],
  110: ['Phoenix'],
  111: ['神谕', 'Oracle'],
  112: ['冰龙', 'WW'],
  113: ['电狗', 'AW'],
  114: ['大圣', 'MK', '猴子'],
  119: ['花仙子', 'DW'],
  120: ['滚滚', 'Pangolier'],
  121: ['墨客', 'Grimstroke'],
  123: ['松鼠', 'Hoodwink'],
  126: ['紫猫', 'Void'],
  128: ['老奶奶', 'Snap', 'Snapfire'],
  129: ['战神', 'Mars'],
  131: ['小丑', 'Ringmaster'],
  135: ['太阳女', 'Dawn'],
  136: ['Marci'],
  137: ['野兽', 'Primal Beast', '獸'],
  138: ['奶绿', 'Muerta'],
  145: ['Kez', '凯兹', '凯滋'],
  155: ['Largo', '朗格', '拉戈'],
};

/**
 * The hero's Simplified-Chinese name.
 *
 * Prefers the `zh` field the data pipeline writes from Valve's feed, because
 * that stays current automatically when a hero is released. Falls back to the
 * generated table so an older dataset, or a test fixture, still searches in
 * Chinese.
 *
 * @param {{id:number, zh?:string}} hero
 * @returns {string|null}
 */
export function heroChineseName(hero) {
  return hero?.zh ?? HERO_ZH[hero?.id] ?? null;
}

/** Any CJK character means the query is Chinese, which has no word separators. */
const HAS_CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

/**
 * Does one alias term satisfy the query?
 *
 * Two rules, because the two scripts need different ones:
 *
 *  - Chinese: plain substring. 「冰」 must find 冰魂 and 远古冰魄, and Chinese is
 *    not written with separators.
 *  - Latin: the query must match the START OF A TOKEN, not merely appear
 *    somewhere. Plain substring matching made the common two-letter aliases
 *    useless, because 'ta' and 'np' both occur inside EVERY internal name
 *    (`npc_dota_hero_…`) — so searching TA returned the whole roster instead of
 *    Templar Assassin.
 *
 * A query containing punctuation or an underscore is matched as a literal
 * fragment, which keeps full internal names (`npc_dota_hero_axe`) and
 * hyphenated names (`anti-mage`) working.
 */
function matchesTerm(term, query) {
  const t = String(term).toLowerCase();
  if (!t) return false;
  if (HAS_CJK.test(query)) return t.includes(query);
  if (/[^a-z0-9]/.test(query)) return t.includes(query);
  return t.split(/[^a-z0-9]+/).some((token) => token.startsWith(query));
}

/**
 * Everything a hero can be found by: English name, internal name, official
 * Chinese name, and nicknames.
 * @param {{id:number, n:string, name:string, zh?:string}} hero
 * @returns {string[]}
 */
export function heroSearchTerms(hero) {
  return [
    hero.n,
    hero.name,
    heroChineseName(hero),
    ...(HERO_NICKNAMES[hero.id] ?? []),
  ].filter(Boolean);
}

/**
 * Does a hero match a search box query?
 * Matches across every alias; an empty query matches everything.
 *
 * The internal name is deliberately NOT part of normal matching: every one of
 * them contains the tokens `npc` and `dota`, so including it made short aliases
 * match the entire roster — 'np' hit `npc_…` and 'ta' hit `dota_…`, which is
 * how searching TA once returned all 127 heroes. It is still consulted for
 * literal-fragment queries (anything containing `_` or punctuation), so pasting
 * `npc_dota_hero_axe` works.
 *
 * @param {{id:number, n:string, name:string, zh?:string}} hero
 * @param {string} query
 */
export function heroMatchesQuery(hero, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return true;

  if (/[^a-z0-9]/.test(q) && matchesTerm(hero.name, q)) return true;

  return [hero.n, heroChineseName(hero), ...(HERO_NICKNAMES[hero.id] ?? [])]
    .filter(Boolean)
    .some((term) => matchesTerm(term, q));
}

/**
 * Heroes from `heroes` that have no Chinese name yet.
 * Used by the coverage test so a newly released hero cannot silently become
 * unsearchable in Chinese.
 *
 * @param {Array<{id:number, n:string}>} heroes
 * @returns {Array<{id:number, n:string}>}
 */
export function heroesMissingChineseName(heroes) {
  return (heroes ?? []).filter((h) => !heroChineseName(h));
}
