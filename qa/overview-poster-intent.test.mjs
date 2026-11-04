import assert from 'node:assert/strict';
import test from 'node:test';
import { FILMS } from '../src/studio/data/catalog.ts';
import { createOverviewIntent, firstOverviewPosters } from '../src/studio/components/overviewPosterIntent.ts';

test('only nine real film URLs are prepared in ripple order for every film and both grid orientations', () => {
  const original = FILMS.map(f => f.id);
  for (const selected of FILMS) {
    const picked = firstOverviewPosters(FILMS, selected.format, selected.industry);
    const distance = f => (f.format - selected.format) ** 2 + (f.industry - selected.industry) ** 2;
    assert.equal(picked[0], selected);
    assert.equal(new Set(picked.map(f => f.poster)).size, 9);
    assert.deepEqual(picked.map(distance), FILMS.map(distance).sort((a, b) => a - b).slice(0, 9));
  }
  assert.deepEqual(FILMS.map(f => f.id), original);
});

test('an incidental pass, immediate click or unmount cancels work; hover and focus share one timer', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let preparations = 0;
  const intent = createOverviewIntent(() => { preparations++; });
  intent.schedule();
  t.mock.timers.tick(80);
  intent.cancel();
  t.mock.timers.tick(100);
  assert.equal(preparations, 0);
  intent.schedule();
  intent.schedule();
  t.mock.timers.tick(90);
  assert.equal(preparations, 1);
  intent.schedule();
  intent.cancel();
  t.mock.timers.tick(500);
  assert.equal(preparations, 1);
});
