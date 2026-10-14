/**
 * Dota 2 BP Simulator — frontend.
 *
 * Pure static: loads public/data/data.json and runs the recommendation engine
 * in the browser. No server, no API key, works offline after first load.
 */

import {
  recommend,
  lookupPair,
  heroBase,
} from './lib/recommend.mjs';
import {
  addHero,
  removeHero,
  usedHeroes,
  resolveDrop,
  resolvePoolTap,
  sideOf,
} from './lib/draft.mjs';
import { mergeDatasets } from './lib/merge.mjs';
import { hydrateDataset } from './lib/dataset.mjs';
import { heroMatchesQuery } from './lib/heroNames.mjs';
import { counterVerdict } from './lib/verdict.mjs';
import { isCursorKey, moveCursor, clampCursor } from './lib/cursor.mjs';

const CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes';

/**
 * Where each selectable data source lives.
 *
 * Both files have the same shape, so the engine, tiers and UI are agnostic.
 * They are loaded lazily: STRATZ is ~1 MB and most sessions never need it.
 */
const SOURCE_FILES = {
  opendota: 'data/data.json',
  stratz: 'data/data-stratz.json',
};

const SOURCE_LABELS = {
  opendota: 'OpenDota',
  stratz: 'STRATZ',
  both: 'OpenDota + STRATZ',
};

/* ------------------------------------------------------------------ */
/* GitHub star button                                                  */
/* ------------------------------------------------------------------ */

/**
 * The star button is a plain LINK. A static site cannot star a repo on someone's
 * behalf — that needs OAuth and a server — so it opens the repository, where the
 * real Star button is. The count is the only dynamic part, and it is entirely
 * optional: if the request fails the button still works.
 */
const REPO_URL = 'https://github.com/lsp013/dota2-bp-sim';
const REPO_API = 'https://api.github.com/repos/lsp013/dota2-bp-sim';
const STAR_CACHE_KEY = 'dota2bp:stars';
/** An hour. GitHub's unauthenticated API allows 60 requests per hour per IP. */
const STAR_TTL_MS = 60 * 60 * 1000;

/** Compact star count: 999 -> "999", 1234 -> "1.2k", 24680 -> "25k". */
export function formatStars(n) {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1000) return String(n);
  const k = n / 1000;
  const rounded = k >= 10 ? Math.round(k) : Number(k.toFixed(1));
  return `${rounded}k`;
}

/** localStorage may be missing (tests) or throw (private mode, quota). */
function readStarCache() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STAR_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Number.isFinite(parsed.n) || typeof parsed.at !== 'number') return null;
    if (Date.now() - parsed.at > STAR_TTL_MS) return null;
    return parsed.n;
  } catch {
    return null;
  }
}

function writeStarCache(n) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STAR_CACHE_KEY, JSON.stringify({ n, at: Date.now() }));
  } catch {
    /* not worth reporting; the count is decorative */
  }
}

function paintStarCount(n) {
  const el = $('#starCount');
  // A brand-new repo shows "0", which reads worse than showing nothing, so the
  // chip only appears once there is a number worth showing.
  if (!Number.isFinite(n) || n < 1) return;
  const text = formatStars(n);
  if (!el || !text) return;
  el.textContent = text;
  el.hidden = false;
}

/** Best-effort star count. Never throws: a failure leaves the link alone. */
export async function showStarCount() {
  const cached = readStarCache();
  if (cached !== null) {
    paintStarCount(cached);
    return;
  }
  try {
    const res = await fetch(REPO_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return; // rate limited, offline, or the repo is private
    const data = await res.json();
    const n = data?.stargazers_count;
    if (!Number.isFinite(n)) return;
    writeStarCache(n);
    paintStarCount(n);
  } catch {
    /* the button is a link; the count is a bonus */
  }
}

/** Display name for each bucket a hero can be filed into. */
const SIDE_LABEL = { our: '我方', enemy: '敌方', ban: 'ban位' };

const state = {
  /** The dataset currently feeding the engine. */
  data: null,
  /**
   * Which source `data` came from. Defaults to the merged view: STRATZ's
   * per-pair samples are 15-50x OpenDota's, and OpenDota's small ones are noisy
   * enough to reorder the top of the list, so the merge is the most trustworthy
   * starting point. It degrades to plain OpenDota if STRATZ was never deployed.
   */
  source: 'both',
  /** Cache of loaded datasets, keyed by source name. */
  datasets: {},
  our: [],
  enemy: [],
  /**
   * Banned heroes — excluded from the recommendation entirely.
   *
   * Deliberately uncapped: a ban says "do not suggest this", which is not a
   * statement about either draft, so any limit would be arbitrary.
   */
  ban: [],
  /**
   * Which bucket a plain tap on a hero-pool item files the hero into:
   * 'our' | 'enemy' | 'ban'.
   *
   * Defaults to 'enemy': in a draft you normally enter the picks that already
   * exist on the other side first, and those are the ones the recommendation is
   * conditioned on.
   */
  activeSide: 'enemy',
  /**
   * Index of the keyboard cursor inside the currently rendered hero pool, or -1
   * for none. Driven by the arrow keys while the search box has focus, so a hero
   * can be picked without touching the mouse.
   */
  cursor: -1,
  weights: { counter: 0.7, synergy: 0.2, base: 0.1 },
  minGames: 30,
};

const $ = (sel) => document.querySelector(sel);

const heroById = (id) => state.data.heroes.find((h) => h.id === id);
const iconUrl = (name) =>
  `${CDN}/${name.replace('npc_dota_hero_', '')}.png`;

/**
 * Build a hero portrait.
 *
 * `draggable = false` is NOT cosmetic — it is a bug fix.
 *
 * An <img> is natively draggable in every browser. Pressing one and moving
 * starts a native HTML5 image drag, and that CANCELS the pointer event stream:
 * no further pointermove, and no pointerup at all. The drag-and-drop here is
 * built on pointer events, so a gesture that begins on a portrait never
 * completes — the drop is never resolved and the hero simply does not move.
 *
 * That is exactly why the hero pool always failed (each tile is icon-only, so
 * every drag starts on an image) while a recommendation card could be dragged by
 * its NAME but not by its FACE (the name lives in a plain <div>).
 *
 * Every portrait goes through here so a new one cannot quietly reintroduce the
 * bug, and styles.css plus the document-level dragstart guard below are the
 * backstops for anything that does not.
 */
function makeIcon(name, { lazy = true } = {}) {
  const img = document.createElement('img');
  img.src = iconUrl(name);
  // Decorative: the surrounding tile carries the name in its aria-label.
  img.alt = '';
  if (lazy) img.loading = 'lazy';
  img.draggable = false;
  img.setAttribute('draggable', 'false');
  return img;
}

function pct(x) {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(1)}%`;
}

/**
 * Load a dataset by source name, caching the result.
 *
 * 'both' is derived in the browser from the other two rather than shipped as a
 * third file: merging is a pure function over the two datasets and we already
 * have it, so a third ~1 MB artifact would buy nothing.
 */
async function loadSource(source) {
  if (state.datasets[source]) return state.datasets[source];

  if (source === 'both') {
    const base = await loadSource('opendota');
    // STRATZ is optional: if it was never deployed the merge degrades to
    // plain OpenDota rather than failing.
    const extra = await loadSource('stratz').catch(() => null);
    // mergeDatasets returns slim rows, so hydrate once at the end.
    const merged = hydrateDataset(mergeDatasets(base, extra, { label: 'OpenDota+STRATZ' }));
    state.datasets.both = merged;
    return merged;
  }

  const path = SOURCE_FILES[source];
  if (!path) throw new Error(`未知数据源 ${source}`);

  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ds = await res.json();
  if (!ds?.matchups || !ds?.heroes) throw new Error('数据文件格式不对');
  // Files store only the observed counts; derive win rate, interval and tier.
  state.datasets[source] = hydrateDataset(ds);
  return state.datasets[source];
}

async function setSource(source) {
  if (source === state.source) return;
  const fab = $('#sourceFab');
  const previous = state.source;

  fab?.classList.add('loading');
  try {
    const ds = await loadSource(source);
    state.data = ds;
    state.source = source;
    updateSourceButtons();
    renderMeta();
    render();
  } catch (err) {
    // Most likely cause: the STRATZ file was never deployed.
    fab?.classList.add('failed');
    setTimeout(() => fab?.classList.remove('failed'), 900);
    const note = $('#sourceNote');
    if (note) {
      note.hidden = false;
      note.textContent =
        source === 'stratz' && !state.datasets.stratz
          ? 'STRATZ 数据未部署（缺少 public/data/data-stratz.json）。运行 scripts/build-stratz.mjs 并推送即可。'
          : `切换失败：${err.message}`;
    }
    state.source = previous;
    updateSourceButtons();
  } finally {
    fab?.classList.remove('loading');
  }
}

function updateSourceButtons() {
  for (const btn of document.querySelectorAll('#sourceFab button[data-source]')) {
    const on = btn.dataset.source === state.source;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  }
}

/* ------------------------------------------------------------------ */
/* data load                                                           */
/* ------------------------------------------------------------------ */

async function boot() {
  try {
    state.data = await loadSource(state.source);
  } catch (err) {
    $('#loading').innerHTML =
      `数据加载失败：${err.message}<br><br>` +
      `请先运行 <code>npm run fetch</code> 生成 public/data/data.json`;
    return;
  }
  $('#loading').hidden = true;
  $('#app').hidden = false;
  renderMeta();
  bindControls();
  installDragAndDrop();
  updateSourceButtons();
  updateSideButtons();
  render();
  // Fire and forget: the star link works whether or not this resolves.
  showStarCount();
}

/* ------------------------------------------------------------------ */
/* meta panel                                                          */
/* ------------------------------------------------------------------ */

function renderMeta() {
  const m = state.data.meta;
  const s = m.sampleStats ?? {};
  // STRATZ cannot be refreshed by CI (its API is behind Cloudflare bot
  // protection, so it is pulled by hand from a browser). Show when the data was
  // actually pulled, not just when this file was built.
  const pulled = m.sourcePulledAt ?? m.builtAt;
  const d = pulled ? new Date(pulled) : null;
  const ageDays = d ? (Date.now() - d.getTime()) / 86400000 : null;
  const stale = ageDays != null && ageDays > 21;
  const merged = m.merged
    ? `<div>合并构成：两边都有 <b>${m.merged.pairsInBoth.toLocaleString()}</b> ·
         仅 OpenDota <b>${m.merged.pairsFromAOnly.toLocaleString()}</b> ·
         仅 STRATZ <b>${m.merged.pairsFromBOnly.toLocaleString()}</b></div>`
    : '';
  $('#metaPanel').innerHTML = `
    <div>当前数据源 <b>${SOURCE_LABELS[state.source] ?? m.source}</b>
      ${m.bracket ? `· 分段 <b>${String(m.bracket).replace(/[\[\]]/g, '').replace(/,\s*/g, ', ')}</b>` : ''}</div>
    <div>版本 <b>${m.patch ?? '未知'}</b>
      ${m.patchDate ? `(${new Date(m.patchDate).toLocaleDateString('zh-CN')})` : ''}</div>
    <div>抓取于 <b>${d ? d.toLocaleString('zh-CN') : '未知'}</b>
      ${ageDays != null ? `<span class="tag ${stale ? 't-low' : 't-high'}">${ageDays < 1 ? '今天' : Math.round(ageDays) + ' 天前'}</span>` : ''}
      ${stale ? '<br><b>数据可能已过期</b>——OpenDota 每周自动刷新，STRATZ 需手动重新抓取' : ''}</div>
    <div>英雄 <b>${m.heroesOk}/${m.heroesTotal}</b> · 对位组合 <b>${(m.pairs ?? 0).toLocaleString()}</b>
      （可排序 <b>${(m.rankablePairs ?? 0).toLocaleString()}</b>）</div>
    <div>单对位样本量：中位 <b>${s.median ?? '—'}</b> 场 ·
      75分位 <b>${s.p75 ?? '—'}</b> · 90分位 <b>${s.p90 ?? '—'}</b> ·
      最大 <b>${(s.max ?? 0).toLocaleString()}</b></div>
    ${merged}
    <div style="margin-top:6px">${m.note ?? ''}</div>
  `;
}

/* ------------------------------------------------------------------ */
/* controls                                                            */
/* ------------------------------------------------------------------ */

function bindControls() {
  $('#metaBtn').addEventListener('click', () => {
    const p = $('#metaPanel');
    p.hidden = !p.hidden;
  });

  const wire = (id, key, outId) => {
    const el = $(id);
    el.addEventListener('input', () => {
      state.weights[key] = Number(el.value) / 100;
      $(outId).textContent = `${el.value}%`;
      render();
    });
  };
  wire('#wCounter', 'counter', '#wCounterOut');
  wire('#wSynergy', 'synergy', '#wSynergyOut');
  wire('#wBase', 'base', '#wBaseOut');

  $('#minGames').addEventListener('change', (e) => {
    state.minGames = Number(e.target.value);
    render();
  });

  $('#resetBtn').addEventListener('click', () => {
    // Clears all three buckets. Forgetting the bans meant a reset left heroes
    // silently excluded from every later recommendation.
    state.our = [];
    state.enemy = [];
    state.ban = [];
    render();
  });

  $('#search').addEventListener('input', () => {
    // A new query means a new list, so the box goes back to the first match —
    // which also makes "type a name, press Enter" pick it.
    state.cursor = 0;
    renderPool();
  });
  // Arrow keys walk a cursor through the pool; Enter picks the hero under it.
  // Handled here because the search box keeps focus while you type.
  $('#search').addEventListener('keydown', onPoolKeydown);

  // Tap target for the hero pool. Without this there was no touch-friendly way
  // to add an ENEMY hero at all.
  $('#sideToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-side]');
    if (!btn) return;
    setActiveSide(btn.dataset.side);
  });

  // Data-source switcher (bottom-right).
  $('#sourceFab')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-source]');
    if (!btn) return;
    setSource(btn.dataset.source);
  });
  $('#sourceNote')?.addEventListener('click', () => {
    const n = $('#sourceNote');
    if (n) n.hidden = true;
  });

  $('#detailClose').addEventListener('click', closeDetail);
  $('#detail').addEventListener('click', (e) => {
    if (e.target.id === 'detail') closeDetail();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDetail();
  });
}

/* ------------------------------------------------------------------ */
/* render                                                              */
/* ------------------------------------------------------------------ */

function render() {
  renderTeams();
  renderBanPanel();
  renderRecs();
  renderPool();
}

/**
 * Draw the ban list.
 *
 * Unlike a team this has no fixed slots — bans are uncapped, so the panel grows
 * and the pool of icons simply wraps. Everything else matches a slot: click to
 * un-ban, drag to move.
 */
function renderBanPanel() {
  const el = $('#banSlots');
  if (!el) return;
  el.innerHTML = '';

  for (const id of state.ban) {
    const h = heroById(id);
    if (!h) continue;
    el.appendChild(buildHeroTile(h, 'ban'));
  }
  $('#banCount').textContent = state.ban.length;
  el.classList.toggle('empty-note', state.ban.length === 0);
  if (!state.ban.length) {
    el.innerHTML = '<span class="ban-empty">还没有禁用任何英雄 · 把上方按钮切到「ban位」后点英雄即可</span>';
  }
}

/**
 * One clickable hero tile (used by both the team slots and the ban list).
 * Click removes the hero from its bucket.
 */
function buildHeroTile(h, side) {
  const d = document.createElement('div');
  d.className = 'slot';
  d.title = `${h.n} · 点击移除`;
  d.setAttribute('role', 'button');
  d.setAttribute('aria-label', `移除 ${h.n}`);
  d.tabIndex = 0;
  makeDraggable(d, h.id, side);

  const img = makeIcon(h.name);

  // A single click removes the hero. The drag gesture generates a click on
  // release, so that one is swallowed first — otherwise moving a hero to
  // another bucket would immediately remove it again.
  d.addEventListener('click', () => {
    if (DND.justDragged) {
      DND.justDragged = false;
      return;
    }
    removeFrom(side, h.id);
  });
  d.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      removeFrom(side, h.id);
    }
  });

  d.append(img);
  return d;
}

function renderTeams() {
  const draw = (ids, containerId, side) => {
    const el = $(containerId);
    el.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const id = ids[i];
      if (id === undefined) {
        const d = document.createElement('div');
        d.className = 'slot empty';
        d.textContent = '空位';
        el.appendChild(d);
        continue;
      }
      const h = heroById(id);
      if (h) el.appendChild(buildHeroTile(h, side));
    }
  };
  draw(state.our, '#ourSlots', 'our');
  draw(state.enemy, '#enemySlots', 'enemy');
  $('#ourCount').textContent = state.our.length;
  $('#enemyCount').textContent = state.enemy.length;

  // Show which bucket a tap will fill.
  $('#teamOur').classList.toggle('active-target', state.activeSide === 'our');
  $('#teamEnemy').classList.toggle('active-target', state.activeSide === 'enemy');
  $('#banPanel')?.classList.toggle('active-target', state.activeSide === 'ban');
}

function renderRecs() {
  const el = $('#recs');
  el.innerHTML = '';

  const recs = recommend(state.data, {
    ourPicks: state.our,
    enemyPicks: state.enemy,
    banned: state.ban,
    weights: state.weights,
    minPairGames: state.minGames,
    limit: 20,
  });

  if (!recs.length) {
    el.innerHTML = '<p class="empty-note">暂无可用推荐（数据不足或英雄已选完）。</p>';
    return;
  }

  const max = recs[0].total || 1;

  recs.forEach((r, i) => {
    // A div rather than a <button>: the card now contains its own "why" button,
    // and a button inside a button is invalid HTML.
    const card = document.createElement('div');
    card.className = 'rec';
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    // Lets the ban logic be asserted from the DOM rather than inferred.
    card.dataset.hero = String(r.heroId);
    card.title = `${r.name} · 加入${SIDE_LABEL[state.activeSide] ?? ''}`;

    // Left click adds the hero to the armed bucket, same as a pool tile. Every
    // card here is by definition unassigned (the engine excludes picks and bans)
    // so a click always means "add" — no toggle needed.
    const add = () => addTo(state.activeSide, r.heroId);
    card.addEventListener('click', () => {
      if (DND.justDragged) {
        DND.justDragged = false;
        return;
      }
      add();
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        add();
      }
    });
    // Draggable into any panel, exactly like a pool tile.
    makeDraggable(card, r.heroId, null);

    const img = makeIcon(state.data.heroes.find((h) => h.id === r.heroId).name);

    const main = document.createElement('div');
    main.className = 'rec-main';

    const nameRow = document.createElement('div');
    nameRow.className = 'rec-name';
    nameRow.textContent = r.name;

    const sub = document.createElement('div');
    sub.className = 'rec-sub';
    const bits = [];
    if (r.counter.value !== null) {
      bits.push(`克制 ${pct(r.counter.value)} (${r.counter.covered}/${r.counter.total} 敌)`);
    }
    // Show the single strongest enemy matchup explicitly. The pooled counter
    // figure above is shrunk toward 50%, so a hero with a genuinely lopsided
    // matchup (e.g. Ancient Apparition at 62.9% over 35 games vs Necrophos)
    // can look mediocre there. Naming the number keeps that signal visible
    // even when the hero's overall win rate drags its rank down.
    const best = (r.threats ?? [])
      .filter((t) => t.g >= state.minGames)
      .sort((a, b) => b.p - a.p)[0];
    if (best) {
      const foe = heroById(best.heroId);
      if (foe) bits.push(`最克 ${foe.n} ${pct(best.p)} (${best.g} 场)`);
    }
    if (r.base) bits.push(`版本 ${pct(r.base.p)}`);
    if (r.coverage !== undefined && r.coverage < 1 && r.counter.total > 0) {
      bits.push(`⚠ 仅覆盖 ${r.counter.covered}/${r.counter.total}`);
    }
    sub.textContent = bits.join(' · ');

    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('i');
    fill.style.width = `${Math.max(3, (r.total / max) * 100)}%`;
    bar.appendChild(fill);

    main.append(nameRow, sub, bar);

    const score = document.createElement('div');
    score.className = 'rec-score';
    score.textContent = pct(r.total);

    const rank = document.createElement('div');
    rank.className = 'rank';
    rank.textContent = `#${i + 1}`;

    // The evidence sheet moved behind this button, since clicking the card now
    // selects the hero.
    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'rec-info';
    info.textContent = 'ⓘ';
    info.title = `${r.name} · 查看对位依据`;
    info.setAttribute('aria-label', `查看 ${r.name} 的对位依据`);
    info.addEventListener('click', (e) => {
      e.stopPropagation();
      openDetail(r.heroId);
    });
    // A press on ⓘ must not start a drag of the card.
    info.addEventListener('pointerdown', (e) => e.stopPropagation());

    card.append(rank, img, main, score, info);
    el.appendChild(card);
  });
}

function setActiveSide(side) {
  state.activeSide = side === 'enemy' ? 'enemy' : side === 'ban' ? 'ban' : 'our';
  updateSideButtons();
  renderTeams();
  renderPool();
}

/**
 * Sync the 加入我方/加入敌方 buttons with `state.activeSide`.
 *
 * Called at boot as well as on click: without the boot call the buttons only
 * got their state from the static HTML, so a non-default `activeSide` would
 * leave the UI showing the wrong side until the first tap.
 */
function updateSideButtons() {
  for (const btn of document.querySelectorAll('#sideToggle button[data-side]')) {
    const on = btn.dataset.side === state.activeSide;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  }
}

function renderPool() {
  const el = $('#pool');
  const q = $('#search').value.trim().toLowerCase();
  el.innerHTML = '';

  const used = usedHeroes(teams());
  // Matches English, the internal npc_ name, the official Chinese name and
  // community nicknames — see src/heroNames.mjs.
  const list = state.data.heroes.filter((h) => heroMatchesQuery(h, q));

  // Colour-code so it is obvious which bucket a tap lands in.
  el.classList.toggle('side-enemy', state.activeSide === 'enemy');
  el.classList.toggle('side-ban', state.activeSide === 'ban');

  // The list may have shrunk since the cursor was placed (a search narrowed it,
  // or a hero moved), so keep the box inside the new range.
  state.cursor = clampCursor(state.cursor, list.length);

  list.forEach((h, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const isUsed = used.has(h.id);
    btn.className = 'pool-item' + (isUsed ? ' used' : '');
    if (index === state.cursor) btn.classList.add('cursor');
    btn.dataset.hero = String(h.id);
    // The tile doubles as a toggle, so the tooltip says what this tap will do.
    btn.title = isUsed
      ? `${h.n} · 点击取回`
      : `${h.n} · 加入${SIDE_LABEL[state.activeSide] ?? ''}`;
    // Icon-only tiles: the name and the attribute letters were visual noise in a
    // grid you navigate by recognising portraits. The name stays as the
    // accessible label and the hover tooltip, so it is still discoverable.
    btn.setAttribute('aria-label', btn.title);

    // Tap to place, tap again to take back. Deciding which is which lives in
    // src/draft.mjs so it is unit-tested rather than inferred here.
    btn.addEventListener('click', () => {
      // Consume the click that the drag gesture itself generated; a later,
      // unrelated click must still work.
      if (DND.justDragged) {
        DND.justDragged = false;
        return;
      }
      const action = resolvePoolTap(teams(), h.id, state.activeSide);
      if (action.type === 'add') addTo(action.side, h.id);
      else if (action.type === 'remove') removeFrom(action.side, h.id);
    });
    makeDraggable(btn, h.id, null);

    const img = makeIcon(h.name);
    btn.append(img);
    el.appendChild(btn);
  });

  // Keep the cursor visible in a long list. Optional-chained because the test
  // harness has no layout.
  el.querySelector('.pool-item.cursor')?.scrollIntoView?.({ block: 'nearest' });
}

/**
 * How many tiles fit on one row, for Up/Down movement.
 *
 * Measured from the layout (tiles sharing the first tile's offset) rather than
 * hard-coded, since the grid is responsive. If the grid has not been laid out —
 * a hidden panel, or the test harness — every tile reports the same offset and
 * the count comes out as the whole list, which is not a row: report 1 so Up/Down
 * degrade to single steps instead of jumping to the ends.
 */
function gridColumns() {
  const tiles = [...($('#pool')?.querySelectorAll('.pool-item') ?? [])];
  if (tiles.length < 2) return 1;
  const top = tiles[0].offsetTop;
  const inFirstRow = tiles.filter((t) => t.offsetTop === top).length;
  return inFirstRow >= tiles.length ? 1 : inFirstRow;
}

/** Move the pool cursor, or select the hero under it. */
function onPoolKeydown(e) {
  const tiles = [...($('#pool')?.querySelectorAll('.pool-item') ?? [])];
  const total = tiles.length;

  if (isCursorKey(e.key)) {
    e.preventDefault();
    const next = moveCursor(state.cursor, total, e.key, { columns: gridColumns() });
    if (next === state.cursor) return;
    state.cursor = next;
    renderPool();
    return;
  }

  if (e.key !== 'Enter') return;
  // Let an IME finish first: while composing Chinese, Enter confirms a candidate
  // and must not also fire a selection.
  if (e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  // The cursor wins; without one (fresh search) act on the first match, which
  // keeps "type a name, press Enter" working.
  const target = tiles[state.cursor] ?? tiles[0];
  if (target) target.click();
}

/* ------------------------------------------------------------------ */
/* draft mutation                                                      */
/* ------------------------------------------------------------------ */

const teams = () => ({ our: state.our, enemy: state.enemy, ban: state.ban });

function applyTeams(next) {
  state.our = next.our;
  state.enemy = next.enemy;
  state.ban = next.ban ?? [];
}

/**
 * Add a hero to a side. Works for BOTH teams — the original UI could only add
 * to `our`, with enemy picks reachable solely via a right-click handler that
 * touch devices never fire.
 */
function addTo(side, heroId) {
  const res = addHero(teams(), side, heroId);
  if (res.changed) {
    applyTeams(res);
    render();
  } else if (res.reason === 'full') {
    flashTeam(side);
  }
  return res.changed;
}

function removeFrom(side, heroId) {
  const res = removeHero(teams(), side, heroId);
  if (res.changed) {
    applyTeams(res);
    render();
  }
  return res.changed;
}

/** Briefly highlight a full team so a refused drop is visible, not silent. */
function flashTeam(side) {
  if (side !== 'our' && side !== 'enemy') return; // the ban list is uncapped
  const el = side === 'our' ? $('#teamOur') : $('#teamEnemy');
  if (!el) return;
  el.classList.add('full-flash');
  setTimeout(() => el.classList.remove('full-flash'), 600);
}

/* ------------------------------------------------------------------ */
/* drag & drop                                                         */
/* ------------------------------------------------------------------ */

/**
 * Pointer-events based drag so it works with mouse AND touch.
 *
 * Touch needs care: a finger drag on the pool is normally a page scroll, so on
 * touch we only begin dragging after a short hold (~180ms). If the finger moves
 * before the timer fires, we treat it as a scroll and cancel — this keeps the
 * hero pool scrollable while still allowing drag-and-drop.
 */
const DND = {
  heroId: null,
  fromSide: null, // null when the drag started in the hero pool
  pointerId: null,
  pointerType: null,
  active: false,
  /** True once the pointer travelled past MOVE_TOLERANCE while a drag was armed. */
  moved: false,
  pressTimer: null,
  startX: 0,
  startY: 0,
  /** Page offset when the gesture began, so a scroll can be told from a drag. */
  startScrollY: 0,
  ghost: null,
  hover: null,
  justDragged: false,
};

const HOLD_MS = 150;
const MOVE_TOLERANCE = 8;
/**
 * A release that travelled further than this counts as a DROP even when the
 * visual drag never armed — a fast touch drag outruns the long-press.
 *
 * Deliberately well above MOVE_TOLERANCE: a finger drifts 10-15px during an
 * ordinary tap, and swallowing those taps would be its own bug.
 */
const LAZY_DROP_PX = 24;

function dropZoneAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const zone = el?.closest?.('[data-drop]');
  return zone ? zone.dataset.drop : null;
}

function setHover(zone) {
  if (DND.hover === zone) return;
  if (DND.hover) {
    const prev = document.querySelector(`[data-drop="${DND.hover}"]`);
    prev?.classList.remove('drop-hover');
  }
  DND.hover = zone;
  if (zone) {
    const el = document.querySelector(`[data-drop="${zone}"]`);
    el?.classList.add('drop-hover');
  }
}

function moveGhost(x, y) {
  if (!DND.ghost) return;
  DND.ghost.style.left = `${x}px`;
  DND.ghost.style.top = `${y}px`;
  setHover(dropZoneAt(x, y));
}

function startDrag(x, y) {
  if (DND.active || DND.heroId === null) return;
  const h = heroById(DND.heroId);
  if (!h) return;

  DND.active = true;
  document.body.classList.add('dragging');
  // Marks EVERY panel that accepts a drop, so the destination is visibly the
  // panel under the finger rather than whichever button happens to be armed.
  document.body.classList.add('drag-active');

  const g = document.createElement('div');
  g.className = 'drag-ghost';
  const img = makeIcon(h.name, { lazy: false });
  const span = document.createElement('span');
  span.textContent = h.n;
  g.append(img, span);
  document.body.appendChild(g);
  DND.ghost = g;
  moveGhost(x, y);
  // `navigator` always exists in a browser, but not in every JS runtime: Node 20
  // (which CI runs) has NO global navigator, and this file is imported by tests.
  // An unguarded reference threw ReferenceError and broke the CI build.
  if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(8);
}

function endDrag() {
  clearTimeout(DND.pressTimer);
  DND.pressTimer = null;
  setHover(null);
  DND.ghost?.remove();
  DND.ghost = null;
  DND.active = false;
  document.body.classList.remove('dragging');
  document.body.classList.remove('drag-active');
}

/**
 * Swallow the click the browser fires after this gesture, so a gesture that was
 * already handled as a drop (or as a scroll) is not also handled as a tap.
 */
function swallowNextClick() {
  DND.justDragged = true;
  setTimeout(() => {
    DND.justDragged = false;
  }, 60);
}

function onPointerDown(e, heroId, fromSide) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;

  DND.heroId = heroId;
  DND.fromSide = fromSide;
  DND.pointerId = e.pointerId;
  DND.pointerType = e.pointerType;
  DND.startX = e.clientX;
  DND.startY = e.clientY;
  DND.startScrollY = window.scrollY ?? 0;
  DND.moved = false;

  clearTimeout(DND.pressTimer);
  DND.pressTimer = null;

  // Touch: a finger drag on the pool is normally a page scroll, so wait for a
  // short hold before claiming the gesture. Mouse: no timer at all — we start
  // the drag from pointermove instead, otherwise every plain click would
  // register as a drag and the click handler would be suppressed.
  if (e.pointerType !== 'mouse') {
    DND.pressTimer = setTimeout(
      () => startDrag(DND.startX, DND.startY),
      HOLD_MS
    );
  }
}

function onPointerMove(e) {
  if (e.pointerId !== DND.pointerId) return;

  const dx = e.clientX - DND.startX;
  const dy = e.clientY - DND.startY;
  const dist = Math.hypot(dx, dy);

  if (!DND.active) {
    if (dist <= MOVE_TOLERANCE) return;

    if (DND.pointerType === 'mouse') {
      // Mouse/pen: movement is unambiguous, begin dragging now.
      startDrag(DND.startX, DND.startY);
      if (!DND.active) return; // startDrag bailed (unknown hero)
    } else {
      // Touch moved before the hold completed — which is ALSO what a fast,
      // deliberate drag looks like, not only a scroll.
      //
      // This used to throw the gesture away (pointerId = null), and the release
      // then fell through to the click handler, which files the hero under the
      // ARMED BUTTON rather than the panel it was dropped on. That is why drags
      // appeared to be limited by the 加入我方/ban位/加入敌方 buttons — and why
      // EVERY touch drag that moved before the hold failed, not just fast ones.
      //
      // The gesture is now kept alive so onPointerUp can resolve the drop from
      // where the finger actually landed. It simply gets no floating ghost, and
      // the page is left free to scroll (no preventDefault) since this may still
      // turn out to be a scroll.
      clearTimeout(DND.pressTimer);
      DND.pressTimer = null;
      return;
    }
  }

  // Actively dragging: stop the page from scrolling underneath us.
  if (dist > MOVE_TOLERANCE) DND.moved = true;
  if (e.cancelable) e.preventDefault();
  moveGhost(e.clientX, e.clientY);
}

function onPointerUp(e) {
  if (e.pointerId !== DND.pointerId) return;

  const heroId = DND.heroId;
  const fromSide = DND.fromSide;
  const dist = Math.hypot(e.clientX - DND.startX, e.clientY - DND.startY);
  const scrolled = (window.scrollY ?? 0) !== DND.startScrollY;

  // Two ways a gesture can be a drop:
  //   - the long-press armed a visible drag, or
  //   - it travelled far enough that it was clearly a drag, even though the
  //     finger outran the hold timer.
  // A plain tap is neither, and stays with the click listener.
  const armedDrag = DND.active && DND.moved;
  const lazyDrop = !armedDrag && dist > LAZY_DROP_PX && !scrolled;
  const isDrop = armedDrag || lazyDrop;
  const zone = isDrop ? dropZoneAt(e.clientX, e.clientY) : null;

  endDrag();
  DND.pointerId = null;
  DND.heroId = null;
  DND.fromSide = null;
  DND.moved = false;

  if (!isDrop) {
    // A gesture that scrolled the page must not also count as a tap; otherwise
    // flicking the hero list could silently add whatever was under the finger.
    if (scrolled) swallowNextClick();
    return;
  }

  // Swallow the click that follows a drag so it doesn't double-add.
  swallowNextClick();

  // The decision itself lives in src/draft.mjs so it is unit-testable.
  const action = resolveDrop({ active: true, zone, fromSide });
  if (action.type === 'add') {
    addTo(action.side, heroId);
  } else if (action.type === 'remove') {
    removeFrom(action.side, heroId);
  }
}

function onPointerCancel(e) {
  if (e.pointerId !== DND.pointerId) return;
  endDrag();
  DND.pointerId = null;
  DND.heroId = null;
  DND.fromSide = null;
  DND.moved = false;
}

function installDragAndDrop() {
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);

  // Block the browser's own image dragging outright.
  //
  // An <img> is natively draggable, and starting a native image drag CANCELS the
  // pointer event stream: no further pointermove and no pointerup at all. Since
  // this drag-and-drop runs on pointer events, a gesture that begins on a
  // portrait simply never completes — the drop is never resolved. Hero-pool tiles
  // are icon-only, so the pool could not be dragged at all, while a
  // recommendation card worked when grabbed by its name (a plain <div>) and
  // failed when grabbed by the portrait.
  //
  // Nothing inside a drag surface should ever start a native drag, so those are
  // covered as well — the catch-all for a portrait rendered without
  // draggable="false".
  document.addEventListener('dragstart', (e) => {
    const el = e.target;
    if (el?.tagName === 'IMG' || el?.closest?.('img, .pool-item, .slot, .rec')) {
      e.preventDefault();
    }
  });

  // Non-passive so a touch drag can suppress page scrolling once it starts.
  document.addEventListener(
    'touchmove',
    (e) => {
      if (DND.active && e.cancelable) e.preventDefault();
    },
    { passive: false }
  );
}

/** Mark an element as a drag source for `heroId`. */
function makeDraggable(el, heroId, fromSide) {
  el.dataset.hero = String(heroId);
  el.addEventListener('pointerdown', (e) => onPointerDown(e, heroId, fromSide));
}

/* ------------------------------------------------------------------ */
/* detail sheet                                                        */
/* ------------------------------------------------------------------ */

function closeDetail() {
  $('#detail').hidden = true;
}

function openDetail(heroId) {
  const h = heroById(heroId);
  const m = state.data.matchups;
  const base = heroBase(m, heroId);

  const vsEnemy = state.enemy
    .map((id) => ({ id, row: lookupPair(m, heroId, id) }))
    .filter((x) => x.row);

  const vsAlly = state.our
    .map((id) => ({ id, row: lookupPair(m, heroId, id) }))
    .filter((x) => x.row);

  /**
   * One matchup table.
   *
   * `verdict` switches the last column between two different questions:
   *   - against an ENEMY: "does this hero beat them?"  -> 克制 / 非常克制 / 不克制
   *   - against a TEAMMATE: there is nothing to counter, so the confidence tag
   *     (可靠 / 参考 / 样本少) stays, which is what that column used to show.
   *
   * Sample size keeps its own column either way. Folding it into the verdict
   * would hide exactly the distinction this project cares most about — a
   * 40-game 65% and a 5000-game 65% are not the same evidence.
   */
  const tbl = (rows, title, { verdict = false } = {}) => {
    if (!rows.length) return `<p class="empty-note">${title}：无可比对位数据。</p>`;
    const body = rows
      .sort((a, b) => b.row.p - a.row.p)
      .map(({ id, row }) => {
        const o = heroById(id);
        const v = counterVerdict(row.p);
        const thin = row.g < 30 ? ' <span class="tag t-low">样本少</span>' : '';
        const last = verdict
          ? `<span class="tag ${v.cls}">${v.label}</span>`
          : `<span class="tag t-${row.t}">${row.t === 'high' ? '可靠' : row.t === 'medium' ? '参考' : '样本少'}</span>`;
        return `<tr>
          <td><span class="who"><img src="${iconUrl(o.name)}" alt="" loading="lazy" draggable="false">${o.n}</span></td>
          <td class="num">${pct(row.p)}</td>
          <td class="num">${row.g}${thin}</td>
          <td class="num">${last}</td>
        </tr>`;
      })
      .join('');
    const head = verdict ? '克制程度' : '数据可信度';
    return `<h4 style="margin:14px 0 6px;font-size:13px">${title}</h4>
      <table class="mu">
        <thead><tr><th>英雄</th><th style="text-align:right">胜率</th>
        <th style="text-align:right">场次</th><th style="text-align:right">${head}</th></tr></thead>
        <tbody>${body}</tbody>
      </table>`;
  };

  const rec = recommend(state.data, {
    ourPicks: state.our,
    enemyPicks: state.enemy,
    banned: state.ban,
    weights: state.weights,
    minPairGames: state.minGames,
    limit: 200,
  }).find((r) => r.heroId === heroId);

  $('#detailBody').innerHTML = `
    <div class="detail-head">
      <img src="${iconUrl(h.name)}" alt="" draggable="false">
      <div>
        <h3>${h.n}</h3>
        <p>${h.roles.join(' · ')} · ${h.atk} · ${h.attr.toUpperCase()}</p>
      </div>
    </div>

    ${rec ? `<div class="score-grid">
      <div class="score-cell"><div class="k">综合</div><div class="v">${pct(rec.total)}</div></div>
      <div class="score-cell"><div class="k">克制</div><div class="v">${pct(rec.counter.value)}</div></div>
      <div class="score-cell"><div class="k">协同</div><div class="v">${pct(rec.synergy.value)}</div></div>
    </div>` : ''}

    <div class="score-grid" style="grid-template-columns:1fr">
      <div class="score-cell">
        <div class="k">全对位汇总胜率（${base ? base.games.toLocaleString() : 0} 场）</div>
        <div class="v">${base ? pct(base.p) : '—'}</div>
      </div>
    </div>

    ${tbl(vsEnemy, '对阵敌方已选', { verdict: true })}
    ${tbl(vsAlly, '与队友的对位记录')}

    <div class="note">
      「胜率」为观测到的对位胜率，「场次」是样本量。排序用的是
      <b>向 50% 收缩后的估计值</b>：样本越少，估计值被拉得越靠近 50%，
      所以少样本的高胜率不会直接霸榜；样本 &lt; 30 场的组合完全不参与排序。<br><br>
      <b>重要局限</b>：OpenDota 的对位数据不区分分路，因此「敌法 vs 美杜莎」
      这类样本大多来自两人并未同路对线的对局，反映的是
      <i>选了该英雄的队伍是否获胜</i>，而非严格的对线克制关系。
      另外对位样本普遍很小（本数据集单对位中位数约 47 场），请结合自己的判断使用。
    </div>
  `;

  $('#detail').hidden = false;
}

boot();
