import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveCursor, clampCursor, isCursorKey, CURSOR_KEYS } from '../src/cursor.mjs';

test('an empty grid has no cursor', () => {
  assert.equal(moveCursor(-1, 0, 'ArrowRight'), -1);
  assert.equal(moveCursor(0, 0, 'ArrowDown'), -1);
  assert.equal(moveCursor(-1, -5, 'ArrowRight'), -1);
});

test('the first arrow key selects the first tile', () => {
  // The box must appear on the first keypress rather than needing to be found.
  for (const key of CURSOR_KEYS) {
    assert.equal(moveCursor(-1, 10, key), 0, `${key} should start at 0`);
  }
});

test('left and right walk one tile at a time', () => {
  assert.equal(moveCursor(0, 10, 'ArrowRight'), 1);
  assert.equal(moveCursor(5, 10, 'ArrowRight'), 6);
  assert.equal(moveCursor(5, 10, 'ArrowLeft'), 4);
});

test('up and down move by a whole row', () => {
  assert.equal(moveCursor(0, 100, 'ArrowDown', { columns: 8 }), 8);
  assert.equal(moveCursor(20, 100, 'ArrowDown', { columns: 8 }), 28);
  assert.equal(moveCursor(20, 100, 'ArrowUp', { columns: 8 }), 12);
});

test('movement is clamped, never wrapped', () => {
  // Wrapping from the last hero back to the first would silently scroll the grid
  // away from wherever the user was looking.
  assert.equal(moveCursor(9, 10, 'ArrowRight'), 9);
  assert.equal(moveCursor(0, 10, 'ArrowLeft'), 0);
  assert.equal(moveCursor(0, 10, 'ArrowUp', { columns: 8 }), 0);
  assert.equal(moveCursor(95, 100, 'ArrowDown', { columns: 8 }), 99, 'last row is short');
});

test('an unknown key leaves the cursor where it is', () => {
  assert.equal(moveCursor(4, 10, 'Enter'), 4);
  assert.equal(moveCursor(4, 10, 'a'), 4);
});

test('isCursorKey recognises exactly the four arrows', () => {
  for (const key of CURSOR_KEYS) assert.equal(isCursorKey(key), true);
  for (const key of ['Enter', 'a', 'Tab', 'PageDown', 'ArrowUpLeft']) {
    assert.equal(isCursorKey(key), false);
  }
});

test('a malformed column count degrades to single steps', () => {
  // A grid that has not been laid out yet reports nothing useful; Up/Down must
  // then behave like Left/Right instead of jumping to the ends.
  for (const columns of [0, -3, NaN, undefined, null]) {
    assert.equal(moveCursor(5, 100, 'ArrowDown', { columns }), 6);
    assert.equal(moveCursor(5, 100, 'ArrowUp', { columns }), 4);
  }
});

test('a stale index past the end is pulled back in range', () => {
  assert.equal(moveCursor(500, 10, 'ArrowRight'), 9);
  assert.equal(moveCursor(500, 10, 'ArrowUp', { columns: 4 }), 5);
});

test('clampCursor keeps a saved position valid after the list changes', () => {
  assert.equal(clampCursor(3, 10), 3, 'unchanged while in range');
  assert.equal(clampCursor(30, 10), 9, 'pulled back when the list shrank');
  assert.equal(clampCursor(-1, 10), 0, 'defaults to the first tile');
  assert.equal(clampCursor(3, 0), -1, 'empty list');
});

test('walking right then left returns to the start', () => {
  let i = -1;
  for (let step = 0; step < 5; step++) i = moveCursor(i, 20, 'ArrowRight');
  for (let step = 0; step < 5; step++) i = moveCursor(i, 20, 'ArrowLeft');
  assert.equal(i, 0);
});

test('down and up are inverse moves within a full row', () => {
  const opts = { columns: 6 };
  const down = moveCursor(7, 60, 'ArrowDown', opts);
  assert.equal(down, 13);
  assert.equal(moveCursor(down, 60, 'ArrowUp', opts), 7);
});
