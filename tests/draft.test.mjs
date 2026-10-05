import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addHero,
  removeHero,
  usedHeroes,
  sideOf,
  otherSide,
  resolveDrop,
  resolvePoolTap,
  MAX_TEAM,
  SIDES,
  TEAM_SIDES,
} from '../src/draft.mjs';

const empty = () => ({ our: [], enemy: [], ban: [] });

test('REGRESSION: heroes can be added to the enemy team', () => {
  // The original UI only had a contextmenu handler for enemy picks, so on a
  // phone the enemy team could never be filled.
  const r = addHero(empty(), 'enemy', 94);
  assert.equal(r.changed, true);
  assert.deepEqual(r.enemy, [94]);
  assert.deepEqual(r.our, []);
  assert.deepEqual(r.ban, []);
});

test('REGRESSION: the 5-hero cap is enforced per side, not against our team', () => {
  let t = empty();
  for (const id of [1, 2, 3, 4, 5]) t = addHero(t, 'enemy', id).changed ? addHero(t, 'enemy', id) && t : t;
  // Rebuild cleanly to avoid depending on the loop above.
  t = empty();
  for (const id of [1, 2, 3, 4, 5]) {
    const r = addHero(t, 'enemy', id);
    assert.equal(r.changed, true, `enemy slot ${id} should accept`);
    t = { our: r.our, enemy: r.enemy, ban: r.ban };
  }
  assert.equal(t.enemy.length, MAX_TEAM);

  const full = addHero(t, 'enemy', 6);
  assert.equal(full.changed, false);
  assert.equal(full.reason, 'full');
  assert.equal(full.enemy.length, MAX_TEAM);

  // Our team is untouched and still has room — the cap must not leak across.
  const ourOk = addHero(t, 'our', 7);
  assert.equal(ourOk.changed, true);
  assert.equal(ourOk.our.length, 1);
});

test('a hero cannot be on both teams: adding to the other side moves it', () => {
  let t = addHero(empty(), 'our', 94);
  t = { our: t.our, enemy: t.enemy, ban: t.ban };
  assert.deepEqual(t.our, [94]);

  const moved = addHero(t, 'enemy', 94);
  assert.equal(moved.changed, true);
  assert.deepEqual(moved.enemy, [94]);
  assert.deepEqual(moved.our, [], 'must be removed from the previous side');
});

test('adding the same hero twice to one side is a no-op', () => {
  let t = addHero(empty(), 'our', 1);
  t = { our: t.our, enemy: t.enemy, ban: t.ban };
  const again = addHero(t, 'our', 1);
  assert.equal(again.changed, false);
  assert.equal(again.reason, 'already-there');
  assert.deepEqual(again.our, [1], 'no duplicate slot');
});

test('a move into a full team is refused and the hero stays put', () => {
  let t = { our: [9], enemy: [1, 2, 3, 4, 5], ban: [] };
  const r = addHero(t, 'enemy', 9);
  assert.equal(r.changed, false);
  assert.equal(r.reason, 'full');
  assert.deepEqual(r.our, [9], 'the hero must not vanish from our team');
  assert.deepEqual(r.enemy, [1, 2, 3, 4, 5]);
});

test('addHero never mutates the input object', () => {
  const t = { our: [1], enemy: [2], ban: [] };
  const snapshot = JSON.stringify(t);
  addHero(t, 'enemy', 3);
  addHero(t, 'our', 2);
  assert.equal(JSON.stringify(t), snapshot, 'input must be left untouched');
});

test('removeHero removes from the named side only', () => {
  const t = { our: [1, 2], enemy: [3], ban: [] };
  const r = removeHero(t, 'our', 1);
  assert.equal(r.changed, true);
  assert.deepEqual(r.our, [2]);
  assert.deepEqual(r.enemy, [3]);
});

test('removeHero is a no-op for an absent hero or a bad side', () => {
  const t = { our: [1], enemy: [], ban: [] };
  assert.equal(removeHero(t, 'our', 99).changed, false);
  assert.equal(removeHero(t, 'enemy', 1).changed, false);
  assert.equal(removeHero(t, 'bogus', 1).changed, false);
});

test('addHero rejects an unknown side instead of writing to undefined', () => {
  const r = addHero(empty(), 'bogus', 1);
  assert.equal(r.changed, false);
  assert.equal(r.reason, 'bad-side');
  assert.deepEqual(r.our, []);
  assert.deepEqual(r.enemy, []);
});

test('usedHeroes covers both sides', () => {
  const s = usedHeroes({ our: [1, 2], enemy: [3], ban: [4, 5] });
  assert.equal(s.size, 5);
  assert.ok(s.has(1) && s.has(3) && s.has(4) && !s.has(9));
});

test('SIDES covers the three buckets; TEAM_SIDES is only the capped ones', () => {
  assert.deepEqual(SIDES, ['our', 'enemy', 'ban']);
  assert.deepEqual(TEAM_SIDES, ['our', 'enemy']);
  assert.equal(SIDES.includes('ban'), true);
  assert.equal(TEAM_SIDES.includes('ban'), false, 'the 5-cap must not apply to bans');
  assert.equal(otherSide('our'), 'enemy');
  assert.equal(otherSide('enemy'), 'our');
});

/* ---------------- drag-and-drop drop resolution ---------------- */

test('dropping a pool hero on the enemy panel adds it to the enemy', () => {
  const r = resolveDrop({ active: true, zone: 'enemy', fromSide: null });
  assert.deepEqual(r, { type: 'add', side: 'enemy' });
});

test('dropping a pool hero on our panel adds it to our team', () => {
  const r = resolveDrop({ active: true, zone: 'our', fromSide: null });
  assert.deepEqual(r, { type: 'add', side: 'our' });
});

test('dragging a slot onto the other panel moves it', () => {
  // Started on our team, released over the enemy panel.
  const r = resolveDrop({ active: true, zone: 'enemy', fromSide: 'our' });
  assert.deepEqual(r, { type: 'add', side: 'enemy' });
});

test('dropping a slot back on the pool removes it from its side', () => {
  const r = resolveDrop({ active: true, zone: 'pool', fromSide: 'our' });
  assert.deepEqual(r, { type: 'remove', side: 'our' });
});

test('dropping a POOL hero back on the pool does nothing', () => {
  const r = resolveDrop({ active: true, zone: 'pool', fromSide: null });
  assert.deepEqual(r, { type: 'none' }, 'must not try to remove from null');
});

test('releasing over empty space does nothing', () => {
  assert.deepEqual(resolveDrop({ active: true, zone: null, fromSide: null }), { type: 'none' });
  assert.deepEqual(resolveDrop({ active: true, zone: 'elsewhere', fromSide: 'our' }), { type: 'none' });
});

test('a drag that never started is not treated as a drop', () => {
  // A plain tap must not trigger any drop action; the click handler owns it.
  const r = resolveDrop({ active: false, zone: 'enemy', fromSide: null });
  assert.deepEqual(r, { type: 'none' });
});

/* ---------------- ban bucket ---------------- */

test('bans have NO cap, unlike the two teams', () => {
  let t = empty();
  for (let i = 0; i < 40; i++) {
    const r = addHero(t, 'ban', 100 + i);
    assert.equal(r.changed, true, `ban #${i + 1} must be accepted`);
    t = { our: r.our, enemy: r.enemy, ban: r.ban };
  }
  assert.equal(t.ban.length, 40, 'all 40 bans kept');
  // Meanwhile a team is still capped at 5.
  for (let i = 0; i < 5; i++) {
    const r = addHero(t, 'our', 200 + i);
    t = { our: r.our, enemy: r.enemy, ban: r.ban };
  }
  const refused = addHero(t, 'our', 300);
  assert.equal(refused.changed, false);
  assert.equal(refused.reason, 'full');
});

test('banning a picked hero removes it from that team', () => {
  let t = addHero(empty(), 'our', 94);
  t = { our: t.our, enemy: t.enemy, ban: t.ban };
  const r = addHero(t, 'ban', 94);
  assert.deepEqual(r.our, [], 'no longer on our team');
  assert.deepEqual(r.ban, [94]);
});

test('picking a banned hero un-bans it', () => {
  let t = addHero(empty(), 'ban', 94);
  t = { our: t.our, enemy: t.enemy, ban: t.ban };
  const r = addHero(t, 'enemy', 94);
  assert.deepEqual(r.ban, [], 'no longer banned');
  assert.deepEqual(r.enemy, [94]);
});

test('a hero is never in two buckets at once', () => {
  let t = addHero(empty(), 'our', 7);
  t = { our: t.our, enemy: t.enemy, ban: t.ban };
  const r = addHero(t, 'ban', 7);
  t = { our: r.our, enemy: r.enemy, ban: r.ban };
  const memberships = SIDES.filter((s) => t[s].includes(7));
  assert.deepEqual(memberships, ['ban'], 'exactly one bucket');
});

test('resolveDrop understands the ban panel', () => {
  assert.deepEqual(resolveDrop({ active: true, zone: 'ban', fromSide: null }), { type: 'add', side: 'ban' });
  assert.deepEqual(resolveDrop({ active: true, zone: 'ban', fromSide: 'our' }), { type: 'add', side: 'ban' });
  assert.deepEqual(resolveDrop({ active: true, zone: 'pool', fromSide: 'ban' }), { type: 'remove', side: 'ban' });
});

test('sideOf reports where a hero currently sits', () => {
  const t = { our: [1], enemy: [2], ban: [3] };
  assert.equal(sideOf(t, 1), 'our');
  assert.equal(sideOf(t, 2), 'enemy');
  assert.equal(sideOf(t, 3), 'ban');
  assert.equal(sideOf(t, 99), null);
});

/* ---------------- tap to place, tap again to take back ---------------- */

test('tapping an unassigned pool hero places it on the armed side', () => {
  const r = resolvePoolTap(empty(), 5, 'enemy');
  assert.deepEqual(r, { type: 'add', side: 'enemy' });
});

test('tapping an already-assigned hero removes it from wherever it is', () => {
  // The armed side is irrelevant: the tap means "take it back".
  assert.deepEqual(resolvePoolTap({ our: [5], enemy: [], ban: [] }, 5, 'enemy'), { type: 'remove', side: 'our' });
  assert.deepEqual(resolvePoolTap({ our: [], enemy: [5], ban: [] }, 5, 'our'), { type: 'remove', side: 'enemy' });
  assert.deepEqual(resolvePoolTap({ our: [], enemy: [], ban: [5] }, 5, 'our'), { type: 'remove', side: 'ban' });
});

test('the toggle round-trips: place then take back leaves the draft empty', () => {
  const t0 = empty();
  const place = resolvePoolTap(t0, 11, 'ban');
  assert.deepEqual(place, { type: 'add', side: 'ban' });

  let t = addHero(t0, place.side, 11);
  t = { our: t.our, enemy: t.enemy, ban: t.ban };

  const take = resolvePoolTap(t, 11, 'ban');
  assert.deepEqual(take, { type: 'remove', side: 'ban' });
  const after = removeHero(t, take.side, 11);
  assert.deepEqual([after.our, after.enemy, after.ban], [[], [], []]);
});

test('resolvePoolTap on an unknown side does nothing', () => {
  assert.deepEqual(resolvePoolTap(empty(), 5, 'bogus'), { type: 'none' });
});
