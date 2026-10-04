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
import { addHero, removeHero, usedHeroes, resolveDrop } from './lib/draft.mjs';
import { mergeDatasets } from './lib/merge.mjs';

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
   * Which team a plain tap on a hero-pool item adds to.
   *
   * Defaults to 'enemy': in a draft you normally enter the picks that already
   * exist on the other side first, and those are the ones the recommendation is
   * conditioned on.
   */
  activeSide: 'enemy',
  weights: { counter: 0.7, synergy: 0.2, base: 0.1 },
  minGames: 30,
};

const $ = (sel) => document.querySelector(sel);

const heroById = (id) => state.data.heroes.find((h) => h.id === id);
const iconUrl = (name) =>
  `${CDN}/${name.replace('npc_dota_hero_', '')}.png`;

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
    const merged = mergeDatasets(base, extra, { label: 'OpenDota+STRATZ' });
    state.datasets.both = merged;
    return merged;
  }

  const path = SOURCE_FILES[source];
  if (!path) throw new Error(`未知数据源 ${source}`);

  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ds = await res.json();
  if (!ds?.matchups || !ds?.heroes) throw new Error('数据文件格式不对');
  state.datasets[source] = ds;
  return ds;
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
    state.our = [];
    state.enemy = [];
    render();
  });

  $('#search').addEventListener('input', renderPool);

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
  renderRecs();
  renderPool();
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
      const d = document.createElement('div');
      d.className = 'slot';
      makeDraggable(d, id, side);

      const img = document.createElement('img');
      img.src = iconUrl(h.name);
      img.alt = h.n;
      img.loading = 'lazy';
      const label = document.createElement('span');
      label.textContent = h.n;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slot-remove';
      btn.textContent = '×';
      btn.setAttribute('aria-label', `移除 ${h.n}`);
      btn.addEventListener('click', () => removeFrom(side, id));
      d.append(img, label, btn);
      el.appendChild(d);
    }
  };
  draw(state.our, '#ourSlots', 'our');
  draw(state.enemy, '#enemySlots', 'enemy');
  $('#ourCount').textContent = state.our.length;
  $('#enemyCount').textContent = state.enemy.length;

  // Show which side a tap will fill.
  $('#teamOur').classList.toggle('active-target', state.activeSide === 'our');
  $('#teamEnemy').classList.toggle('active-target', state.activeSide === 'enemy');
}

function renderRecs() {
  const el = $('#recs');
  el.innerHTML = '';

  const recs = recommend(state.data, {
    ourPicks: state.our,
    enemyPicks: state.enemy,
    weights: state.weights,
    minPairGames: state.minGames,
    limit: 12,
  });

  if (!recs.length) {
    el.innerHTML = '<p class="empty-note">暂无可用推荐（数据不足或英雄已选完）。</p>';
    return;
  }

  const max = recs[0].total || 1;

  recs.forEach((r, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rec';
    btn.addEventListener('click', () => openDetail(r.heroId));

    const img = document.createElement('img');
    img.src = iconUrl(state.data.heroes.find((h) => h.id === r.heroId).name);
    img.alt = r.name;
    img.loading = 'lazy';

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

    btn.append(rank, img, main, score);
    el.appendChild(btn);
  });
}

function setActiveSide(side) {
  state.activeSide = side === 'enemy' ? 'enemy' : 'our';
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
  const list = state.data.heroes.filter((h) => {
    if (!q) return true;
    return h.n.toLowerCase().includes(q) || h.name.toLowerCase().includes(q);
  });

  // Colour-code so it is obvious which team a tap lands in.
  el.classList.toggle('side-enemy', state.activeSide === 'enemy');

  for (const h of list) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pool-item' + (used.has(h.id) ? ' used' : '');
    btn.dataset.hero = String(h.id);
    btn.title = `${h.n} · 加入${state.activeSide === 'enemy' ? '敌方' : '我方'}`;
    // Icon-only tiles: the name and the attribute letters were visual noise in a
    // grid you navigate by recognising portraits. The name stays as the
    // accessible label and the hover tooltip, so it is still discoverable.
    btn.setAttribute('aria-label', btn.title);
    btn.addEventListener('click', () => {
      // Consume the click that the drag gesture itself generated; a later,
      // unrelated click must still work.
      if (DND.justDragged) {
        DND.justDragged = false;
        return;
      }
      if (used.has(h.id)) return; // already committed to a side
      addTo(state.activeSide, h.id);
    });
    makeDraggable(btn, h.id, null);

    const img = document.createElement('img');
    img.src = iconUrl(h.name);
    // Decorative: the button already carries the name.
    img.alt = '';
    img.loading = 'lazy';
    btn.append(img);
    el.appendChild(btn);
  }
}

/* ------------------------------------------------------------------ */
/* draft mutation                                                      */
/* ------------------------------------------------------------------ */

const teams = () => ({ our: state.our, enemy: state.enemy });

function applyTeams(next) {
  state.our = next.our;
  state.enemy = next.enemy;
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
  ghost: null,
  hover: null,
  justDragged: false,
};

const HOLD_MS = 180;
const MOVE_TOLERANCE = 8;

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

  const g = document.createElement('div');
  g.className = 'drag-ghost';
  const img = document.createElement('img');
  img.src = iconUrl(h.name);
  img.alt = '';
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
}

function onPointerDown(e, heroId, fromSide) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  // Let the × button do its own thing.
  if (e.target.closest?.('button.slot-remove')) return;

  DND.heroId = heroId;
  DND.fromSide = fromSide;
  DND.pointerId = e.pointerId;
  DND.pointerType = e.pointerType;
  DND.startX = e.clientX;
  DND.startY = e.clientY;
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
      // Touch moved before the hold completed: this is a scroll, not a drag.
      clearTimeout(DND.pressTimer);
      DND.pressTimer = null;
      DND.pointerId = null;
      DND.heroId = null;
      DND.fromSide = null;
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

  // A long-press arms the drag, but if the finger never actually travelled the
  // user meant a tap (or changed their mind). Only a real move counts as a
  // drag, otherwise the click below would be swallowed and the tap lost.
  const realDrag = DND.active && DND.moved;
  const heroId = DND.heroId;
  const fromSide = DND.fromSide;
  const zone = realDrag ? dropZoneAt(e.clientX, e.clientY) : null;

  endDrag();
  DND.pointerId = null;
  DND.heroId = null;
  DND.fromSide = null;
  DND.moved = false;

  if (!realDrag) return; // plain tap — handled by the click listener

  // Swallow the click that follows a drag so it doesn't double-add.
  DND.justDragged = true;
  setTimeout(() => {
    DND.justDragged = false;
  }, 60);

  // The decision itself lives in src/draft.mjs so it is unit-testable.
  const action = resolveDrop({ active: realDrag, zone, fromSide });
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

  const tbl = (rows, title) => {
    if (!rows.length) return `<p class="empty-note">${title}：无可比对位数据。</p>`;
    const body = rows
      .sort((a, b) => b.row.p - a.row.p)
      .map(({ id, row }) => {
        const o = heroById(id);
        return `<tr>
          <td><span class="who"><img src="${iconUrl(o.name)}" alt="" loading="lazy">${o.n}</span></td>
          <td class="num">${pct(row.p)}</td>
          <td class="num">${row.g}</td>
          <td class="num"><span class="tag t-${row.t}">${row.t === 'high' ? '可靠' : row.t === 'medium' ? '参考' : '样本少'}</span></td>
        </tr>`;
      })
      .join('');
    return `<h4 style="margin:14px 0 6px;font-size:13px">${title}</h4>
      <table class="mu">
        <thead><tr><th>英雄</th><th style="text-align:right">胜率</th>
        <th style="text-align:right">场次</th><th></th></tr></thead>
        <tbody>${body}</tbody>
      </table>`;
  };

  const rec = recommend(state.data, {
    ourPicks: state.our,
    enemyPicks: state.enemy,
    weights: state.weights,
    minPairGames: state.minGames,
    limit: 200,
  }).find((r) => r.heroId === heroId);

  $('#detailBody').innerHTML = `
    <div class="detail-head">
      <img src="${iconUrl(h.name)}" alt="">
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

    ${tbl(vsEnemy, '对阵敌方已选')}
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
