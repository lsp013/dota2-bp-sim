/* AUTO-GENERATED from src/ by scripts/sync-lib.mjs — do not edit here. */
/**
 * Keyboard cursor for the hero-pool grid.
 *
 * The search box keeps focus (you are typing), so the arrow keys and Enter are
 * handled there and drive a visible box that walks the grid. Enter picks the
 * hero under it.
 *
 * Pure and separate from the DOM because the interesting part — where the box
 * lands for a given grid width — is easy to get subtly wrong and easy to test,
 * while measuring the grid is a thin adapter in app.js.
 */

export const CURSOR_KEYS = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'];

export const isCursorKey = (key) => CURSOR_KEYS.includes(key);

/**
 * Where the cursor moves to.
 *
 * Movement is CLAMPED, not wrapped: from the last hero, Right stays put rather
 * than jumping back to the top, which would silently scroll the grid away.
 *
 * @param {number} index current cursor, or -1 when nothing is selected yet
 * @param {number} total number of tiles currently rendered
 * @param {string} key a KeyboardEvent.key value
 * @param {{columns?:number}} [opts] tiles per row, for Up/Down
 * @returns {number} the new index, or -1 when the grid is empty
 */
export function moveCursor(index, total, key, { columns = 1 } = {}) {
  if (!Number.isFinite(total) || total <= 0) return -1;

  const cols = Number.isFinite(columns) && columns >= 1 ? Math.floor(columns) : 1;
  const last = total - 1;
  const from = Number.isFinite(index) && index >= 0 ? Math.min(index, last) : -1;

  // Nothing selected yet: any arrow key starts at the first tile, so the box
  // appears on the first keypress instead of needing to be found first.
  if (from < 0) return 0;

  switch (key) {
    case 'ArrowRight':
      return Math.min(from + 1, last);
    case 'ArrowLeft':
      return Math.max(from - 1, 0);
    case 'ArrowDown':
      return Math.min(from + cols, last);
    case 'ArrowUp':
      return Math.max(from - cols, 0);
    default:
      return from;
  }
}

/**
 * Keep the cursor inside a list that changed size (e.g. the search narrowed it).
 * @returns {number} -1 for an empty list
 */
export function clampCursor(index, total) {
  if (!Number.isFinite(total) || total <= 0) return -1;
  if (!Number.isFinite(index) || index < 0) return 0;
  return Math.min(index, total - 1);
}
