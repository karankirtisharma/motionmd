import test from 'node:test';
import assert from 'node:assert/strict';
import { createWheelNavigation } from '../src/studio/lib/wheelNavigation.ts';

test('small trackpad events accumulate and momentum cannot skip through multiple films', () => {
  const wheel = createWheelNavigation();
  assert.equal(wheel(12, 0), 0);
  assert.equal(wheel(18, 20), 0);
  assert.equal(wheel(20, 40), 1);
  for (let t = 60; t < 400; t += 20) assert.equal(wheel(20, t), 0);
  assert.equal(wheel(60, 600), 1);
});
test('direction reversals and separate mouse-wheel gestures navigate both ways', () => {
  const wheel = createWheelNavigation();
  assert.equal(wheel(100, 0), 1);
  assert.equal(wheel(-100, 50), -1);
  assert.equal(wheel(-100, 400), -1);
  assert.equal(wheel(NaN, 500), 0);
  assert.equal(wheel(0, 500), 0);
});
