import { test } from 'node:test';
import assert from 'node:assert/strict';
import { counterVerdict, STRONG_AT, MILD_AT, VERDICTS } from '../src/verdict.mjs';

test('a win rate over 52% reads as 非常克制', () => {
  assert.equal(counterVerdict(0.521).label, '非常克制');
  assert.equal(counterVerdict(0.60).label, '非常克制');
  assert.equal(counterVerdict(0.99).label, '非常克制');
});

test('the 52% boundary itself is 克制, since "过52" is strictly greater', () => {
  assert.equal(counterVerdict(STRONG_AT).label, '克制');
  assert.equal(counterVerdict(0.5199).label, '克制');
});

test('50% to 52% reads as 克制', () => {
  assert.equal(counterVerdict(0.5).label, '克制');
  assert.equal(counterVerdict(0.51).label, '克制');
  assert.equal(counterVerdict(MILD_AT).label, '克制');
});

test('below 50% reads as 不克制', () => {
  assert.equal(counterVerdict(0.4999).label, '不克制');
  assert.equal(counterVerdict(0.36).label, '不克制');
  assert.equal(counterVerdict(0).label, '不克制');
});

test('each verdict carries a distinct css class', () => {
  const classes = ['strong', 'mild', 'weak'].map((k) => VERDICTS[k].cls);
  assert.equal(new Set(classes).size, 3, 'three visually distinct colours');
  assert.ok(classes.every((c) => c.startsWith('t-')));
});

test('missing or malformed rates degrade to an unknown verdict', () => {
  for (const bad of [null, undefined, NaN, 'x', {}]) {
    assert.equal(counterVerdict(bad).label, '—');
  }
});

test('thresholds are ordered, so the three bands never overlap', () => {
  assert.ok(MILD_AT < STRONG_AT);
  // No gap and no overlap between the three bands.
  assert.equal(counterVerdict(MILD_AT - 1e-9).label, '不克制');
  assert.equal(counterVerdict(MILD_AT).label, '克制');
  assert.equal(counterVerdict(STRONG_AT).label, '克制');
  assert.equal(counterVerdict(STRONG_AT + 1e-9).label, '非常克制');
});

test('the real Necrophos cases produce sensible verdicts', () => {
  // Ancient Apparition beats Necrophos 54.6% over 5208 games (STRATZ).
  assert.equal(counterVerdict(0.546).label, '非常克制');
  // Shadow Demon sits at 47.0% over 1530 games — OpenDota's 65% "top counter"
  // was noise, and the verdict now says so.
  assert.equal(counterVerdict(0.47).label, '不克制');
  // Doom at 49.2% over 5886.
  assert.equal(counterVerdict(0.492).label, '不克制');
});
