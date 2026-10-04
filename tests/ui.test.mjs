/**
 * Interaction tests for public/app.js, driven through a hand-rolled DOM.
 *
 * Why hand-rolled: jsdom is not installable in this environment (the npm
 * registry is blocked), and the logic at risk here — pointer/tap handling for
 * the draft board — is exactly the kind of thing that silently breaks. This
 * stub implements only what app.js touches, then drives the REAL module, so a
 * typo or a stale variable in the app surfaces as a test failure.
 *
 * Regression covered: for mouse input the first implementation armed the drag
 * on pointerdown, which set `justDragged` and made the click handler bail —
 * i.e. clicking a hero stopped adding it at all.
 */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';

/* ------------------------------------------------------------------ */
/* minimal DOM                                                         */
/* ------------------------------------------------------------------ */

const registry = [];
const byId = new Map();

function matchesSimple(el, part) {
  const m = part.match(
    /^([a-zA-Z]+)?((?:[.#][\w-]+|\[[^\]]+\])*)$/
  );
  if (!m) return false;
  const [, tag, rest] = m;
  if (tag && el.tagName !== tag.toUpperCase()) return false;

  const tokens = rest.match(/[.#][\w-]+|\[[^\]]+\]/g) ?? [];
  for (const t of tokens) {
    if (t.startsWith('#')) {
      if (el._attrs.id !== t.slice(1)) return false;
    } else if (t.startsWith('.')) {
      if (!el._classes.has(t.slice(1))) return false;
    } else {
      const inner = t.slice(1, -1);
      const eq = inner.indexOf('=');
      if (eq === -1) {
        if (!(inner in el._attrs)) return false;
      } else {
        const k = inner.slice(0, eq);
        const v = inner.slice(eq + 1).replace(/^["']|["']$/g, '');
        if (String(el._attrs[k]) !== v) return false;
      }
    }
  }
  return true;
}

function descendants(root, out = []) {
  for (const c of root.children ?? []) {
    out.push(c);
    descendants(c, out);
  }
  return out;
}

function findAll(sel) {
  const parts = sel.trim().split(/\s+/);
  let pool = registry.slice();
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    let matched = pool.filter((el) => matchesSimple(el, part));
    if (i < parts.length - 1) {
      // Descendant combinator: keep elements that have a later match beneath.
      const descendantSet = new Set();
      for (const m of matched) for (const d of descendants(m)) descendantSet.add(d);
      pool = [...descendantSet];
    } else {
      pool = matched;
    }
  }
  return pool;
}

class El {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parent = null;
    this.dataset = {};
    this.style = {};
    this._attrs = {};
    this._listeners = {};
    this._classes = new Set();
    this._html = '';
    this.hidden = false;
    this.textContent = '';
    this.value = '';
    this.type = '';
    this.src = '';
    this.alt = '';
    this.title = '';
    this.loading = '';

    this.classList = {
      add: (...c) => c.forEach((x) => this._classes.add(x)),
      remove: (...c) => c.forEach((x) => this._classes.delete(x)),
      contains: (c) => this._classes.has(c),
      toggle: (c, force) => {
        const on = force === undefined ? !this._classes.has(c) : force;
        if (on) this._classes.add(c);
        else this._classes.delete(c);
        return on;
      },
    };
    registry.push(this);
  }

  set className(v) {
    this._classes = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get className() {
    return [...this._classes].join(' ');
  }

  set innerHTML(v) {
    this._html = v;
    if (v === '') this.children = [];
  }
  get innerHTML() {
    return this._html;
  }

  setAttribute(k, v) {
    this._attrs[k] = v;
    if (k.startsWith('data-')) this.dataset[k.slice(5)] = v;
  }
  getAttribute(k) {
    return this._attrs[k];
  }

  addEventListener(type, fn) {
    (this._listeners[type] ||= []).push(fn);
  }

  appendChild(c) {
    c.parent = this;
    this.children.push(c);
    return c;
  }
  append(...cs) {
    cs.forEach((c) => this.appendChild(c));
  }
  remove() {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((x) => x !== this);
      this.parent = null;
    }
  }
  querySelector(sel) {
    return findAll(sel)[0] ?? null;
  }
  querySelectorAll(sel) {
    return findAll(sel);
  }
  closest(sel) {
    let n = this;
    while (n) {
      if (matchesSimple(n, sel)) return n;
      n = n.parent;
    }
    return null;
  }

  /** Dispatch an event to this element's own listeners. */
  fire(type, ev = {}) {
    const event = {
      target: this,
      cancelable: true,
      preventDefault() {},
      ...ev,
    };
    for (const fn of this._listeners[type] ?? []) fn(event);
  }
}

const winListeners = {};
const windowStub = {
  addEventListener(type, fn) {
    (winListeners[type] ||= []).push(fn);
  },
};
function fireWindow(type, ev) {
  for (const fn of winListeners[type] ?? []) {
    fn({ cancelable: true, preventDefault() {}, ...ev });
  }
}

let elementFromPointResult = null;

const documentStub = {
  body: new El('body'),
  createElement: (tag) => new El(tag),
  querySelector: (sel) => findAll(sel)[0] ?? null,
  querySelectorAll: (sel) => findAll(sel),
  addEventListener() {},
  elementFromPoint: () => elementFromPointResult,
};

/* Pre-register every element app.js looks up. */
const IDS = [
  'app', 'loading', 'metaBtn', 'metaPanel', 'detail', 'detailBody', 'detailClose',
  'ourSlots', 'enemySlots', 'ourCount', 'enemyCount', 'recs', 'poolPanel',
  'pool', 'search', 'sideToggle', 'resetBtn', 'minGames',
  'wCounter', 'wSynergy', 'wBase', 'wCounterOut', 'wSynergyOut', 'wBaseOut',
];
for (const id of IDS) {
  const el = new El(id === 'pool' ? 'div' : 'section');
  el.setAttribute('id', id);
  byId.set(id, el);
}
byId.get('minGames').value = '30';
// Mirrors index.html: the hero-pool SECTION is the "drop here to remove" zone.
byId.get('poolPanel').setAttribute('data-drop', 'pool');

// Team panels are drop zones.
const teamOur = byId.get('teamOur') ?? new El('div');
teamOur.setAttribute('id', 'teamOur');
teamOur.className = 'team ours';
teamOur.setAttribute('data-drop', 'our');
byId.set('teamOur', teamOur);

const teamEnemy = new El('div');
teamEnemy.setAttribute('id', 'teamEnemy');
teamEnemy.className = 'team theirs';
teamEnemy.setAttribute('data-drop', 'enemy');
byId.set('teamEnemy', teamEnemy);

// Side toggle with two buttons, as in index.html.
const toggle = byId.get('sideToggle');
for (const side of ['our', 'enemy']) {
  const b = new El('button');
  b.setAttribute('data-side', side);
  if (side === 'our') b.className = 'active';
  toggle.appendChild(b);
}

/* ------------------------------------------------------------------ */
/* fake dataset + fetch                                                */
/* ------------------------------------------------------------------ */

function pair(g, w, p) {
  return { g, w, p, lb: p - 0.04, ub: p + 0.04, t: g >= 100 ? 'high' : 'medium' };
}

const HEROES = Array.from({ length: 12 }, (_, i) => {
  const id = i + 1;
  const names = [
    'Alpha', 'Beta', 'Gamma', 'Delta', 'Eps', 'Zeta',
    'Eta', 'Theta', 'Iota', 'Kappa', 'Lam', 'Mu',
  ];
  return {
    id,
    name: `npc_dota_hero_h${id}`,
    n: names[i],
    attr: ['agi', 'str', 'int', 'all'][i % 4],
    atk: i % 2 ? 'Melee' : 'Ranged',
    roles: ['Carry'],
  };
});

const MATCHUPS = {};
for (const a of HEROES) {
  MATCHUPS[a.id] = {};
  for (const b of HEROES) {
    if (a.id !== b.id) MATCHUPS[a.id][b.id] = pair(200, 110, 0.55);
  }
}

const DATASET = {
  meta: {
    builtAt: new Date().toISOString(), source: 'test', patch: '7.41', patchDate: null,
    heroesOk: HEROES.length, heroesTotal: HEROES.length,
    pairs: 30, rankablePairs: 30,
    sampleStats: { p25: 10, median: 20, p75: 30, p90: 40, max: 200 },
    note: 'test',
  },
  heroes: HEROES,
  patches: [],
  matchups: MATCHUPS,
};

globalThis.document = documentStub;
globalThis.window = windowStub;
globalThis.fetch = async () => ({ ok: true, json: async () => DATASET });

// `navigator` exists on Node >= 21 (read-only getter) but NOT on Node 20, which
// is what CI runs. Define it either way so the vibration path is exercised and
// the harness behaves the same on both.
Object.defineProperty(globalThis, 'navigator', {
  value: { vibrate() {} },
  configurable: true,
  writable: true,
});

/* Load the REAL application module. */
const tick = () => new Promise((r) => setTimeout(r, 0));
await import('../public/app.js');
await tick();
await tick();

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const q = (id) => byId.get(id);
const count = (side) => Number(q(side === 'our' ? 'ourCount' : 'enemyCount').textContent);

/** Let pending timers (drag click-suppression, boot) run. */
const settle = () => new Promise((r) => setTimeout(r, 70));

/** Clear the draft so each test starts from a known state. */
async function resetDraft() {
  q('resetBtn').fire('click', {});
  clickToggle('our');
  await settle();
}

/** The pool item button for a hero in the CURRENT render. */
function poolItem(heroId) {
  const pool = q('pool');
  return pool.children.find((c) => c.dataset.hero === String(heroId)) ?? null;
}

function tapPoolItem(heroId) {
  const el = poolItem(heroId);
  assert.ok(el, `pool item for hero ${heroId} exists`);
  el.fire('click', {});
}

function clickToggle(side) {
  const btn = byId.get('sideToggle').children.find((b) => b.dataset.side === side);
  // The handler is delegated on the container.
  q('sideToggle').fire('click', { target: btn });
}

/** The team slot element currently holding `heroId`. */
function slotFor(heroId, side = 'our') {
  const container = q(side === 'our' ? 'ourSlots' : 'enemySlots');
  return container.children.find((c) => c.dataset.hero === String(heroId)) ?? null;
}

/** Simulate a completed pointer drag from `el` onto `zone`. */
function dragTo(el, zone, pointerType = 'mouse') {
  elementFromPointResult = zone;
  const opts = { pointerId: 7, pointerType, button: 0, clientX: 0, clientY: 0 };
  el.fire('pointerdown', opts);
  fireWindow('pointermove', { ...opts, clientX: 40, clientY: 40 });
  fireWindow('pointermove', { ...opts, clientX: 80, clientY: 80 });
  fireWindow('pointerup', { ...opts, clientX: 80, clientY: 80 });
  elementFromPointResult = null;
}

/* ------------------------------------------------------------------ */
/* tests                                                               */
/* ------------------------------------------------------------------ */

test('tapping a pool hero adds it to OUR team', async () => {
  await resetDraft();
  tapPoolItem(1);
  assert.equal(count('our'), 1);
  assert.equal(count('enemy'), 0);
});

test('REGRESSION: with "加入敌方" armed, a tap adds to the ENEMY team', async () => {
  await resetDraft();
  clickToggle('enemy');
  tapPoolItem(2);
  assert.equal(count('enemy'), 1, 'enemy picks must be reachable by tap');
  assert.equal(count('our'), 0, 'our team unchanged');
});

test('REGRESSION: a plain mouse click is not swallowed by the drag handler', async () => {
  await resetDraft();
  // Browser order: pointerdown -> pointerup -> click, with no movement.
  const el = poolItem(3);
  const opts = { pointerId: 9, pointerType: 'mouse', button: 0, clientX: 5, clientY: 5 };
  el.fire('pointerdown', opts);
  fireWindow('pointerup', opts);
  el.fire('click', {});
  assert.equal(count('our'), 1, 'click must still add the hero');
});

test('dragging a pool hero onto the enemy panel adds it to the enemy', async () => {
  await resetDraft();
  dragTo(poolItem(4), teamEnemy);
  assert.equal(count('enemy'), 1);
  assert.equal(count('our'), 0);
});

test('dragging a pool hero onto our panel adds it to our team', async () => {
  await resetDraft();
  dragTo(poolItem(5), teamOur);
  assert.equal(count('our'), 1);
});

test('dragging a slot back onto the hero pool removes it', async () => {
  await resetDraft();
  clickToggle('enemy');
  tapPoolItem(5);
  clickToggle('our');
  assert.equal(count('enemy'), 1, 'setup: hero 5 is on the enemy team');

  const slot = slotFor(5, 'enemy');
  assert.ok(slot, 'slot for hero 5 exists');
  dragTo(slot, q('poolPanel'));
  assert.equal(count('enemy'), 0, 'removed from the enemy team');
});

test('dragging a slot from our team onto the enemy panel moves it across', async () => {
  await resetDraft();
  tapPoolItem(6);
  assert.equal(count('our'), 1);
  const slot = slotFor(6, 'our');
  assert.ok(slot, 'slot for hero 6 exists on our team');

  dragTo(slot, teamEnemy);

  assert.equal(count('enemy'), 1);
  assert.equal(count('our'), 0, 'must not remain on both teams');
});

test('dragging a slot onto the SAME panel is a harmless no-op', async () => {
  await resetDraft();
  tapPoolItem(7);
  const slot = slotFor(7, 'our');
  dragTo(slot, teamOur);
  assert.equal(count('our'), 1, 'still exactly one copy');
  assert.equal(count('enemy'), 0);
});

test('a slow touch press that never moves is treated as a tap', async () => {
  await resetDraft();
  clickToggle('enemy');
  const el = poolItem(8);
  const opts = { pointerId: 11, pointerType: 'touch', button: 0, clientX: 0, clientY: 0 };

  el.fire('pointerdown', opts);
  await new Promise((r) => setTimeout(r, 220)); // let the hold timer fire
  fireWindow('pointerup', opts);
  await settle();
  // Re-fetch: the drag toggles caused re-renders, so the old node is detached.
  tapPoolItem(8);

  assert.equal(count('enemy'), 1, 'slow tap must still select the hero');
});

test('a touch drag below the hold threshold does not steal page scrolling', async () => {
  await resetDraft();
  const el = poolItem(9);
  const opts = { pointerId: 12, pointerType: 'touch', button: 0, clientX: 0, clientY: 0 };
  el.fire('pointerdown', opts);
  // Move before the hold completes: this is a scroll gesture.
  fireWindow('pointermove', { ...opts, clientX: 0, clientY: 60 });
  fireWindow('pointerup', { ...opts, clientX: 0, clientY: 60 });
  await settle();
  assert.equal(count('our'), 0, 'a scroll gesture must not pick a hero');
});

test('the 5-hero cap applies to the enemy team independently', async () => {
  await resetDraft();
  clickToggle('enemy');
  for (const h of HEROES) {
    if (count('enemy') >= 5) break;
    if (poolItem(h.id)) tapPoolItem(h.id);
  }
  assert.equal(count('enemy'), 5, 'enemy team fills to 5');

  const extra = HEROES.find((h) => poolItem(h.id) && !poolItem(h.id)._classes.has('used'));
  assert.ok(extra, 'an unused hero remains');
  tapPoolItem(extra.id);
  assert.equal(count('enemy'), 5, 'cap holds at 5');
  assert.equal(count('our'), 0, 'our team still empty');
});

test('our team can still be filled after the enemy team is full', async () => {
  await resetDraft();
  clickToggle('enemy');
  for (const h of HEROES) {
    if (count('enemy') >= 5) break;
    if (poolItem(h.id)) tapPoolItem(h.id);
  }
  clickToggle('our');
  for (const h of HEROES) {
    if (count('our') >= 5) break;
    const el = poolItem(h.id);
    if (el && !el._classes.has('used')) tapPoolItem(h.id);
  }
  assert.equal(count('our'), 5, 'the cap must not leak across teams');
  assert.equal(count('enemy'), 5);
});

test('the hero pool renders every hero and marks used ones', async () => {
  await resetDraft();
  tapPoolItem(1);
  const pool = q('pool');
  assert.equal(pool.children.length, HEROES.length, 'all heroes listed');
  assert.equal(
    pool.children.filter((c) => c._classes.has('used')).length,
    1,
    'only the committed hero is marked used'
  );
});

test('recommendation cards name the strongest enemy matchup', async () => {
  await resetDraft();
  clickToggle('enemy');
  tapPoolItem(1); // hero 1 becomes the enemy team
  clickToggle('our');

  const card = q('recs').children[0];
  assert.ok(card, 'a recommendation card is rendered');

  const main = card.children.find((c) => c._classes.has('rec-main'));
  const sub = main?.children.find((c) => c._classes.has('rec-sub'));
  assert.ok(sub, 'card has a subtitle');

  // The pooled counter figure is shrunk toward 50%, so the card must spell out
  // the single strongest matchup or that signal is invisible.
  assert.match(
    sub.textContent,
    /最克/,
    `subtitle should name the strongest counter, got: "${sub.textContent}"`
  );
});

test('REGRESSION: dragging works when `navigator` does not exist (Node 20 / CI)', async () => {
  // CI runs Node 20, which has NO global `navigator`. app.js touched
  // `navigator.vibrate` during drag start, so the whole build failed at the
  // test step while passing on Node 24 locally. Reproduce that here: remove the
  // global, drag, and require it to still work.
  await resetDraft();

  const hadNav = 'navigator' in globalThis;
  const saved = hadNav ? globalThis.navigator : undefined;
  let removed = false;
  try {
    removed = delete globalThis.navigator;
  } catch {
    removed = false;
  }

  try {
    dragTo(poolItem(10), teamEnemy);
    assert.equal(count('enemy'), 1, 'drag must work without a navigator global');
    assert.equal(removed, true, 'navigator was actually removed for this test');
  } finally {
    Object.defineProperty(globalThis, 'navigator', {
      value: saved ?? { vibrate() {} },
      configurable: true,
      writable: true,
    });
  }
});
