/**
 * Draft state — pure, testable logic for where each hero currently sits.
 *
 * Three buckets, not two:
 *   our   — picked by us (max 5)
 *   enemy — picked by them (max 5)
 *   ban   — removed from consideration entirely, NO cap. Bans only stop a hero
 *           from being recommended; they say nothing about the draft, so a
 *           limit would be arbitrary.
 *
 * A hero lives in exactly one bucket: adding it somewhere strips it from the
 * others, so it can never be both banned and picked.
 *
 * Kept out of app.js (which needs a DOM) so the rules that caused real bugs are
 * covered by tests:
 *
 *   - There was no way to add an ENEMY hero on a touch device. The only route
 *     was a `contextmenu` (right-click) handler, which phones never fire.
 *   - The 5-hero cap was checked against `state.our` only, so it applied to the
 *     wrong team once enemy picks existed.
 */

export const MAX_TEAM = 5;
/** Sides that hold an actual team, i.e. the ones the cap applies to. */
export const TEAM_SIDES = ['our', 'enemy'];
/** Every bucket a hero can be filed under. */
export const SIDES = ['our', 'enemy', 'ban'];

/** @returns {'our'|'enemy'} the opposing team (meaningless for 'ban'). */
export const otherSide = (side) => (side === 'our' ? 'enemy' : 'our');

const emptyTeams = () => ({ our: [], enemy: [], ban: [] });

/** Normalise a teams object that may predate the ban bucket. */
const normalise = (teams) => ({
  our: teams?.our ?? [],
  enemy: teams?.enemy ?? [],
  ban: teams?.ban ?? [],
});

/**
 * Add `heroId` to `side`.
 *
 * Behaviour:
 *   - Moving a hero that sits in another bucket moves it (a hero is in exactly
 *     one bucket).
 *   - Re-adding a hero already in the target bucket is a no-op, so repeated
 *     taps cannot duplicate an entry.
 *   - MAX_TEAM applies to 'our' and 'enemy' independently; 'ban' is uncapped.
 *
 * @param {{our:number[], enemy:number[], ban:number[]}} teams
 * @param {'our'|'enemy'|'ban'} side
 * @param {number} heroId
 * @returns {{our:number[], enemy:number[], ban:number[], changed:boolean, reason:string|null}}
 */
export function addHero(teams, side, heroId) {
  const t = normalise(teams);
  if (!SIDES.includes(side)) {
    return { ...t, changed: false, reason: 'bad-side' };
  }
  if (t[side].includes(heroId)) {
    return { ...t, changed: false, reason: 'already-there' };
  }
  // Bans are unlimited; a full team must not accept another pick.
  if (TEAM_SIDES.includes(side) && t[side].length >= MAX_TEAM) {
    return { ...t, changed: false, reason: 'full' };
  }

  // Strip from every bucket first so a move never leaves a duplicate behind.
  const next = {
    our: t.our.filter((id) => id !== heroId),
    enemy: t.enemy.filter((id) => id !== heroId),
    ban: t.ban.filter((id) => id !== heroId),
  };
  next[side].push(heroId);

  return { ...next, changed: true, reason: null };
}

/**
 * Remove `heroId` from `side` (no-op if absent).
 * @returns {{our:number[], enemy:number[], ban:number[], changed:boolean, reason:string|null}}
 */
export function removeHero(teams, side, heroId) {
  const t = normalise(teams);
  if (!SIDES.includes(side) || !t[side].includes(heroId)) {
    return { ...t, changed: false, reason: 'absent' };
  }
  return {
    ...t,
    [side]: t[side].filter((id) => id !== heroId),
    changed: true,
    reason: null,
  };
}

/**
 * Where a hero currently sits, or null when it is still in the pool.
 * Drives the pool's tap-to-toggle behaviour.
 *
 * @returns {'our'|'enemy'|'ban'|null}
 */
export function sideOf(teams, heroId) {
  const t = normalise(teams);
  return SIDES.find((side) => t[side].includes(heroId)) ?? null;
}

/** Heroes filed anywhere — used to grey out the pool. */
export function usedHeroes(teams) {
  const t = normalise(teams);
  return new Set([...t.our, ...t.enemy, ...t.ban]);
}

/**
 * Decide what a finished drag should do, given where it was released.
 *
 * Separated from the DOM so the drop rules are testable: the pointer plumbing
 * in app.js is hard to verify without a browser, but "released over the enemy
 * panel => add to enemy" is the part that actually matters and can be proven
 * here.
 *
 * @param {{active:boolean, zone:'our'|'enemy'|'ban'|'pool'|null, fromSide:'our'|'enemy'|'ban'|null}} input
 * @returns {{type:'add', side:'our'|'enemy'|'ban'} | {type:'remove', side:'our'|'enemy'|'ban'} | {type:'none'}}
 */
export function resolveDrop({ active, zone, fromSide }) {
  if (!active) return { type: 'none' };
  if (SIDES.includes(zone)) return { type: 'add', side: zone };
  // Dropping back onto the hero pool un-assigns the hero. Only meaningful when
  // the drag started from a slot, not from the pool itself.
  if (zone === 'pool' && SIDES.includes(fromSide)) {
    return { type: 'remove', side: fromSide };
  }
  return { type: 'none' };
}

/**
 * Tap behaviour for a hero-pool tile: unassigned heroes go to `side`, and an
 * already-assigned hero is returned to the pool (from wherever it sits).
 *
 * This is the toggle the UI exposes: tap to place, tap again to take back.
 *
 * @returns {{type:'add'|'remove'|'none', side?:string}}
 */
export function resolvePoolTap(teams, heroId, side) {
  const current = sideOf(teams, heroId);
  if (current) return { type: 'remove', side: current };
  if (!SIDES.includes(side)) return { type: 'none' };
  return { type: 'add', side };
}

export { emptyTeams };
