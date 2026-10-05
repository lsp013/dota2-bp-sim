/**
 * Valve's official hero-name feed.
 *
 * `https://www.dota2.com/datafeed/herolist?language=schinese` returns every
 * hero as `{ id, name, name_loc, name_english_loc }`, where `name_loc` is the
 * official Simplified-Chinese client name. It is free, needs no key, and is
 * what the game itself uses — so it is the authority here, rather than a table
 * somebody typed from memory (which is how 「剑圣」 and 「死灵法师」 ended up in
 * this repo when the client says 主宰 and 瘟疫法师).
 *
 * Reachable from plain Node and from CI, unlike the STRATZ API.
 */

const FEED = 'https://www.dota2.com/datafeed/herolist?language=schinese';

/**
 * Valve's schinese file is not perfectly simplified: Primal Beast is stored as
 * 獸, the traditional glyph. Storing that verbatim would make the hero
 * unsearchable for anyone typing 兽, so the simplified form is preferred and
 * the raw value is kept as an alias.
 */
const SIMPLIFY = {
  獸: '兽',
};

/**
 * @returns {Promise<Map<number, {zh:string, en:string, npc:string}>>}
 */
export async function fetchChineseHeroNames({ timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let payload;
  try {
    const res = await fetch(FEED, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    payload = await res.json();
  } finally {
    clearTimeout(timer);
  }

  const heroes = payload?.result?.data?.heroes;
  if (!Array.isArray(heroes) || !heroes.length) {
    throw new Error('Valve herolist 返回结构异常');
  }

  const out = new Map();
  for (const h of heroes) {
    if (!Number.isFinite(h?.id) || !h?.name_loc) continue;
    out.set(h.id, {
      zh: SIMPLIFY[h.name_loc] ?? h.name_loc,
      raw: h.name_loc,
      en: h.name_english_loc ?? null,
      npc: h.name ?? null,
    });
  }
  return out;
}
