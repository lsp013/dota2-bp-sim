/* AUTO-GENERATED from src/ by scripts/sync-lib.mjs — do not edit here. */
/**
 * Draft team state — pure, testable logic for who is on which side.
 *
 * Kept out of app.js (which needs a DOM) so the rules that caused a real bug
 * can be covered by tests:
 *
 *   - There was no way to add an ENEMY hero on a touch device. The only route
 *     was a `contextmenu` (right-click) handler, which phones never fire.
 *   - The 5-hero cap was checked against `state.our` only, so it applied to
 *     the wrong team once enemy picks existed.
 *
 * Both now live here as explicit, side-aware rules.
 */

export const MAX_TEAM = 5;
export const SIDES = ['our', 'enemy'];

/** @returns {'our'|'enemy'} the opposing side. */
export const otherSide = (side) => (side === 'our' ? 'enemy' : 'our');

/**
 * Add `heroId` to `side`.
 *
 * Behaviour:
 *   - Moving a hero that is already on the OTHER side moves it (a hero cannot
 *     be on both teams).
 *   - Re-adding a hero already on the target side is a no-op, so repeated taps
 *     cannot duplicate a slot.
 *   - Respects MAX_TEAM per side, independently.
 *
 * @param {{our:number[], enemy:number[]}} teams
 * @param {'our'|'enemy'} side
 * @param {number} heroId
 * @returns {{our:number[], enemy:number[], changed:boolean, reason:string|null}}
 */
export function addHero(teams, side, heroId) {
  if (!SIDES.includes(side)) {
    return { ...teams, changed: false, reason: 'bad-side' };
  }
  if (teams[side].includes(heroId)) {
    return { ...teams, changed: false, reason: 'already-there' };
  }
  if (teams[side].length >= MAX_TEAM) {
    return { ...teams, changed: false, reason: 'full' };
  }

  // Strip from both sides first so a move never leaves a duplicate behind.
  const our = teams.our.filter((id) => id !== heroId);
  const enemy = teams.enemy.filter((id) => id !== heroId);
  const target = side === 'our' ? our : enemy;
  target.push(heroId);

  return { our, enemy, changed: true, reason: null };
}

/**
 * Remove `heroId` from `side` (no-op if absent).
 * @returns {{our:number[], enemy:number[], changed:boolean, reason:string|null}}
 */
export function removeHero(teams, side, heroId) {
  if (!SIDES.includes(side) || !teams[side].includes(heroId)) {
    return { ...teams, changed: false, reason: 'absent' };
  }
  return {
    our: teams.our,
    enemy: teams.enemy,
    [side]: teams[side].filter((id) => id !== heroId),
    changed: true,
    reason: null,
  };
}

/** Heroes already committed to either side (used to grey out the pool). */
export function usedHeroes(teams) {
  return new Set([...teams.our, ...teams.enemy]);
}

/**
 * Decide what a finished drag should do, given where it was released.
 *
 * Separated from the DOM so the drop rules are testable: the pointer plumbing
 * in app.js is hard to verify without a browser, but "released over the enemy
 * panel => add to enemy" is the part that actually matters and can be proven
 * here.
 *
 * @param {{active:boolean, zone:'our'|'enemy'|'pool'|null, fromSide:'our'|'enemy'|null}} input
 * @returns {{type:'add', side:'our'|'enemy'} | {type:'remove', side:'our'|'enemy'} | {type:'none'}}
 */
export function resolveDrop({ active, zone, fromSide }) {
  if (!active) return { type: 'none' };
  if (zone === 'our' || zone === 'enemy') return { type: 'add', side: zone };
  // Dropping back onto the hero pool un-assigns the hero. Only meaningful when
  // the drag started from a team slot, not from the pool itself.
  if (zone === 'pool' && (fromSide === 'our' || fromSide === 'enemy')) {
    return { type: 'remove', side: fromSide };
  }
  return { type: 'none' };
}
