import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameMeter } from '../src/runtime/rendering/frameMeter.ts';

test('GPU timestamps only wrap one rendered frame, are asynchronous and never overlap', async () => {
  const reads = [], samples = [];
  const renderer = {
    backend: { trackTimestamp: false }, hasFeature: name => name === 'timestamp-query',
    resolveTimestampsAsync() {
      assert.equal(this.backend.trackTimestamp, true);
      return new Promise(resolve => reads.push(resolve));
    },
  };
  const meter = createFrameMeter(renderer, (ms, at) => samples.push([ms, at]));
  meter.beginGPU(10); assert.equal(renderer.backend.trackTimestamp, true);
  meter.endGPU(); assert.equal(renderer.backend.trackTimestamp, false);
  meter.beginGPU(2100); meter.endGPU(); assert.equal(reads.length, 1);
  reads[0](4.5); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(samples, [[4.5, 10]]);
  meter.beginGPU(500); meter.endGPU(); assert.equal(reads.length, 1);
  meter.frame(5); meter.frame(3);
  assert.deepEqual(meter.snapshot(2), { renderedFps: 1, cpuFrameMs: 4, gpuDrawMs: 4.5, gpuTimingAvailable: true });
  assert.equal(meter.snapshot(2).gpuDrawMs, undefined, 'an idle window must not show stale GPU time');
  meter.beginGPU(2210); meter.endGPU(); assert.equal(reads.length, 2);
  meter.dispose(); reads[1](10); await new Promise(resolve => setImmediate(resolve));
  assert.equal(samples.length, 1, 'a late sample cannot publish after disposal');
});

test('unavailable GPU timing leaves CPU and rendered FPS available without issuing queries', () => {
  const renderer = { backend: { trackTimestamp: false }, hasFeature: () => false,
    resolveTimestampsAsync() { assert.fail('unsupported timer queried'); } };
  const meter = createFrameMeter(renderer); meter.beginGPU(0); meter.endGPU(); meter.frame(10);
  assert.deepEqual(meter.snapshot(1), { renderedFps: 1, cpuFrameMs: 10, gpuDrawMs: undefined, gpuTimingAvailable: false });
  meter.dispose();
});
