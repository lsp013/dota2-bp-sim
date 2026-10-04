/**
 * Dota 2 BP Simulator — frontend.
 *
 * Pure static: loads public/data/data.json and runs the recommendation engine
 * in the browser. No server, no API key, works offline after first load.
 */

import {
  recommend,
  enemyWeaknesses,
  lookupPair,
  heroBase,
} from './lib/recommend.mjs';

const CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes';

const state = {
  data: null,
  our: [],
  enemy: [],
  weights: { counter: 0.5, synergy: 0.3, base: 0.2 },
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

/* ------------------------------------------------------------------ */
/* data load                                                           */
/* ------------------------------------------------------------------ */

async function boot() {
  try {
    const res = await fetch('data/data.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
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
  render();
}

/* ------------------------------------------------------------------ */
/* meta panel                                                          */
/* ------------------------------------------------------------------ */

function renderMeta() {
  const m = state.data.meta;
  const s = m.sampleStats;
  const d = new Date(m.builtAt);
  $('#metaPanel').innerHTML = `
    <div>版本 <b>${m.patch ?? '未知'}</b>
      ${m.patchDate ? `(${new Date(m.patchDate).toLocaleDateString('zh-CN')})` : ''}</div>
    <div>数据源 <b>${m.source}</b> · 抓取于 <b>${d.toLocaleString('zh-CN')}</b></div>
    <div>英雄 <b>${m.heroesOk}/${m.heroesTotal}</b> · 对位组合 <b>${m.pairs.toLocaleString()}</b>
      （可排序 <b>${m.rankablePairs.toLocaleString()}</b>）</div>
    <div>单对位样本量：中位 <b>${s.median}</b> 场 · 75分位 <b>${s.p75}</b> · 90分位 <b>${s.p90}</b> · 最大 <b>${s.max}</b></div>
    <div style="margin-top:6px">${m.note}</div>
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
  renderWeaknesses();
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
      const img = document.createElement('img');
      img.src = iconUrl(h.name);
      img.alt = h.n;
      img.loading = 'lazy';
      const label = document.createElement('span');
      label.textContent = h.n;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '×';
      btn.setAttribute('aria-label', `移除 ${h.n}`);
      btn.addEventListener('click', () => {
        const arr = side === 'our' ? state.our : state.enemy;
        const idx = arr.indexOf(id);
        if (idx >= 0) arr.splice(idx, 1);
        render();
      });
      d.append(img, label, btn);
      el.appendChild(d);
    }
  };
  draw(state.our, '#ourSlots', 'our');
  draw(state.enemy, '#enemySlots', 'enemy');
  $('#ourCount').textContent = state.our.length;
  $('#enemyCount').textContent = state.enemy.length;
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
    if (r.synergy.value !== null) {
      bits.push(`协同 ${pct(r.synergy.value)}`);
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

function renderWeaknesses() {
  const el = $('#weak');
  el.innerHTML = '';
  if (!state.enemy.length) {
    el.innerHTML = '<p class="empty-note">先选出敌方英雄，这里会列出针对他们的英雄。</p>';
    return;
  }

  const list = enemyWeaknesses(state.data, state.enemy, {
    minGames: Math.max(50, state.minGames),
    limit: 10,
  }).filter((x) => !state.our.includes(x.heroId));

  if (!list.length) {
    el.innerHTML = '<p class="empty-note">没有样本量足够的对位数据。</p>';
    return;
  }

  const max = list[0].score || 1;
  list.forEach((w) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rec';
    btn.addEventListener('click', () => openDetail(w.heroId));

    const h = heroById(w.heroId);
    const img = document.createElement('img');
    img.src = iconUrl(h.name);
    img.alt = w.name;
    img.loading = 'lazy';

    const main = document.createElement('div');
    main.className = 'rec-main';
    const nameRow = document.createElement('div');
    nameRow.className = 'rec-name';
    nameRow.textContent = w.name;
    const sub = document.createElement('div');
    sub.className = 'rec-sub';
    const worstName = heroById(w.worst.vs)?.n ?? '?';
    sub.textContent =
      `覆盖 ${w.covers}/${w.total} 敌方英雄 · 最克 ${worstName} ${pct(w.worst.p)} (${w.worst.g} 场)`;

    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('i');
    fill.style.width = `${Math.max(3, (w.score / max) * 100)}%`;
    bar.appendChild(fill);

    main.append(nameRow, sub, bar);

    const score = document.createElement('div');
    score.className = 'rec-score';
    score.textContent = pct(w.score);

    btn.append(img, main, score);
    el.appendChild(btn);
  });
}

function renderPool() {
  const el = $('#pool');
  const q = $('#search').value.trim().toLowerCase();
  el.innerHTML = '';

  const used = new Set([...state.our, ...state.enemy]);
  const list = state.data.heroes.filter((h) => {
    if (!q) return true;
    return h.n.toLowerCase().includes(q) || h.name.toLowerCase().includes(q);
  });

  for (const h of list) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pool-item' + (used.has(h.id) ? ' used' : '');
    btn.addEventListener('click', () => {
      if (state.our.length >= 5) return;
      if (used.has(h.id)) return;
      state.our.push(h.id);
      render();
    });

    const img = document.createElement('img');
    img.src = iconUrl(h.name);
    img.alt = h.n;
    img.loading = 'lazy';
    const span = document.createElement('span');
    span.textContent = h.n;
    const attr = document.createElement('span');
    attr.className = 'attr';
    attr.textContent = h.attr.slice(0, 3).toUpperCase();
    btn.append(img, span, attr);
    el.appendChild(btn);
  }

  // Long-press / right-click adds to the enemy team (mobile-friendly alt:
  // the detail sheet has explicit buttons).
  el.querySelectorAll('.pool-item').forEach((node, i) => {
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const h = list[i];
      if (state.enemy.length >= 5 || used.has(h.id)) return;
      state.enemy.push(h.id);
      render();
    });
  });
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
      「胜率」为观测到的对位胜率，「场次」是样本量。本工具按
      <b>威尔逊 95% 置信下界</b>排序，因此少样本的高胜率不会排到前面。
      样本 &lt; 30 场的组合不参与排序。<br><br>
      <b>重要局限</b>：OpenDota 的对位数据不区分分路，因此「敌法 vs 美杜莎」
      这类样本大多来自两人并未同路对线的对局，反映的是
      <i>选了该英雄的队伍是否获胜</i>，而非严格的对线克制关系。请结合自己的判断使用。
    </div>
  `;

  $('#detail').hidden = false;
}

boot();
