import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoadingProgressPublisher } from '../src/runtime/loadingProgressPublisher.ts';

function fakeClock() {
  let time = 0, next = 0;
  const jobs = new Map();
  return {
    now: () => time,
    schedule(callback, delay) { const id = ++next; jobs.set(id, { callback, at: time + delay }); return id; },
    cancel(id) { jobs.delete(id); },
    get pending() { return jobs.size; },
    advance(milliseconds) {
      const until = time + milliseconds;
      while (true) {
        const due = [...jobs].sort((a, b) => a[1].at - b[1].at).find(([, job]) => job.at <= until);
        if (!due) break;
        const [id, job] = due; time = job.at; jobs.delete(id); job.callback();
      }
      time = until;
    },
  };
}

test('1000 progress callbacks in one second publish at most 11 latest UI values', context => {
  const clock = fakeClock(), output = [];
  const publisher = createLoadingProgressPublisher(value => output.push(value), 100, clock);
  for (let chunk = 0; chunk < 1000; chunk++) {
    publisher.push({ phase: 'Loading architecture', detail: `Chunk ${chunk}`, progress: chunk / 1000 });
    clock.advance(1);
  }
  assert.equal(output.length, 11);
  assert.deepEqual(output.at(-1), { phase: 'Loading architecture', detail: 'Chunk 999', progress: .999 });
  assert.equal(clock.pending, 0);
  context.diagnostic(JSON.stringify({ incomingCallbacks: 1000, publishedUIUpdates: output.length, reductionPercent: 98.9 }));
});

test('synchronous shader bursts retain the last exact detail and fraction', () => {
  const clock = fakeClock(), output = [];
  const publisher = createLoadingProgressPublisher(value => output.push(value), 100, clock);
  for (let compiled = 0; compiled <= 1000; compiled++) {
    publisher.push({ phase: 'Preparing materials', detail: `Compiled ${compiled}`, progress: compiled / 1000 });
  }
  assert.equal(output.length, 1); assert.equal(clock.pending, 1);
  clock.advance(100);
  assert.equal(output.length, 2);
  assert.deepEqual(output.at(-1), { phase: 'Preparing materials', detail: 'Compiled 1000', progress: 1 });
});

test('phase changes and Ready publish immediately and replace an older trailing update', () => {
  const clock = fakeClock(), output = [];
  const publisher = createLoadingProgressPublisher(value => output.push(value), 100, clock);
  publisher.push({ phase: 'Loading architecture', progress: 0 });
  publisher.push({ phase: 'Loading architecture', progress: .9 });
  publisher.push({ phase: 'Preparing materials', progress: 0 });
  assert.equal(output.at(-1).phase, 'Preparing materials'); assert.equal(clock.pending, 0);
  publisher.push({ phase: 'Preparing materials', progress: .5 });
  publisher.push({ phase: 'Ready', progress: 1 });
  assert.deepEqual(output.at(-1), { phase: 'Ready', progress: 1 });
  assert.equal(output.length, 3); assert.equal(clock.pending, 0);
  clock.advance(1000); assert.equal(output.length, 3);
});

test('terminal flush delivers the latest value once and disposal prevents trailing/stale callbacks', () => {
  const clock = fakeClock(), output = [];
  const publisher = createLoadingProgressPublisher(value => output.push(value), 100, clock);
  publisher.push({ phase: 'Preparing reflections', progress: 0 });
  publisher.push({ phase: 'Preparing reflections', progress: 1 });
  publisher.flush(); publisher.dispose();
  assert.deepEqual(output.at(-1), { phase: 'Preparing reflections', progress: 1 });
  assert.equal(output.length, 2); assert.equal(clock.pending, 0);
  publisher.push({ phase: 'Old work after completion', progress: .5 }); publisher.flush();
  clock.advance(1000); assert.equal(output.length, 2);
});

test('error/unmount/retry disposal drops pending work and a new publisher remains independent', () => {
  const clock = fakeClock(), output = [];
  const first = createLoadingProgressPublisher(value => output.push(value), 100, clock);
  first.push({ phase: 'Preparing textures', progress: .1 });
  first.push({ phase: 'Preparing textures', progress: .7 });
  first.dispose(); assert.equal(clock.pending, 0);
  const retry = createLoadingProgressPublisher(value => output.push(value), 100, clock);
  retry.push({ phase: 'Preparing your visit' });
  first.push({ phase: 'Ready', progress: 1 }); first.flush(); clock.advance(1000);
  assert.deepEqual(output, [{ phase: 'Preparing textures', progress: .1 }, { phase: 'Preparing your visit' }]);
  retry.dispose();
});

test('identical reports do not publish repeatedly and stored values are isolated from mutation', () => {
  const clock = fakeClock(), output = [];
  const publisher = createLoadingProgressPublisher(value => output.push(value), 100, clock);
  const first = { phase: 'Loading architecture', progress: .1 };
  publisher.push(first); first.progress = .9;
  assert.equal(output[0].progress, .1);
  publisher.push({ phase: 'Loading architecture', progress: .1 });
  clock.advance(500); publisher.push({ phase: 'Loading architecture', progress: .1 });
  assert.equal(output.length, 1); assert.equal(clock.pending, 0);
});
