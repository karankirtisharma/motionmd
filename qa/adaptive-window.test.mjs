import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifiesAdaptiveWindow } from '../src/runtime/rendering/adaptiveWindow.ts';

function qualifies(intervals) {
  let duration = 0, gaps = 0, gapTime = 0;
  for (const interval of intervals) {
    duration += interval;
    if (interval >= .25) { gaps++; gapTime += interval; }
  }
  return qualifiesAdaptiveWindow(intervals.length, duration, gaps, gapTime);
}

test('continuous active25–240Hz windows remain eligible for the existing quality policy', () => {
  for (const fps of [25, 30, 60, 90, 120, 144, 165, 240]) {
    assert.equal(qualifies(Array.from({ length: fps * 2 }, () => 1 / fps)), true, `${fps}Hz`);
  }
  assert.equal(qualifies(Array.from({ length: 20 }, () => .1)), true, 'genuine sustained10Hz may still adapt');
});

test('an ordinary50ms hitch does not prevent normal adaptation', () => {
  const intervals = Array.from({ length: 120 }, () => 1 / 60);
  intervals[60] = .05;
  assert.equal(qualifies(intervals), true);
  intervals[60] = .25;
  assert.equal(qualifies(intervals), true, 'one isolated250ms hitch does not dominate this window');
});

test('1Hz callbacks cannot trigger resolution reduction even when document remains visible', () => {
  assert.equal(qualifies([1, 1, 1]), false);
  assert.equal(qualifies(Array.from({ length: 18 }, () => 1)), false);
});

test('a single inactive gap invalidates a window even when average rate looks active', () => {
  const intervals = [...Array.from({ length: 60 }, () => 1 / 60), 1];
  const apparentFps = intervals.length / intervals.reduce((sum, value) => sum + value, 0);
  assert.ok(apparentFps > 30 && apparentFps < 31);
  assert.equal(qualifies(intervals), false);
  assert.equal(qualifies([...Array.from({ length: 240 }, () => 1 / 120), 20]), false);
});

test('repeated long gaps and invalid samples cannot accumulate adaptive hysteresis', () => {
  assert.equal(qualifies([...Array.from({ length: 90 }, () => 1 / 60), ...Array.from({ length: 10 }, () => .25)]), false);
  for (const sample of [[0, 0, 0, 0], [60, NaN, 0, 0], [60, 2, -1, 0], [60, 2, 61, 1], [60, 2, 1, 3], [60, 2, 1, NaN]]) {
    assert.equal(qualifiesAdaptiveWindow(...sample), false);
  }
});