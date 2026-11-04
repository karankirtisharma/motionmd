import test from 'node:test';
import assert from 'node:assert/strict';
import { LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RedFormat, UnsignedByteType } from 'three';
import { decodeScalarImage } from '../src/runtime/rendering/scalarImage.ts';

function workerFixture(t) {
  const instances = [];
  class Worker {
    postMessage(blob) { this.blob = blob; }
    terminate() { this.terminated = true; }
  }
  const previous = new Map();
  for (const [name, value] of Object.entries({
    Worker: class extends Worker { constructor() { super(); instances.push(this); } },
    OffscreenCanvas: class {},
    createImageBitmap() {},
  })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  t.after(() => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return instances;
}

test('worker scalar result keeps linear sampling, generated mips, byte precision and stored row orientation', async t => {
  const instances = workerFixture(t), blob = new Blob(['source']);
  const pending = decodeScalarImage(blob);
  assert.equal(instances[0].blob, blob);
  const pixels = new Uint8Array([128, 255, 32, 64]);
  instances[0].onmessage({ data: { width: 2, height: 2, pixels } });
  const texture = await pending;
  assert.equal(texture.format, RedFormat); assert.equal(texture.type, UnsignedByteType);
  assert.equal(texture.colorSpace, NoColorSpace); assert.equal(texture.generateMipmaps, true);
  assert.equal(texture.minFilter, LinearMipmapLinearFilter); assert.equal(texture.magFilter, LinearFilter);
  assert.equal(texture.flipY, false); assert.equal(texture.image.data, pixels);
  assert.equal(instances[0].terminated, true); texture.dispose();
});

test('unsupported, non-scalar and failed decode fall back using the original blob; cancellation releases the worker', async t => {
  const jobs = workerFixture(t), blob = new Blob(['source']);
  const colored = decodeScalarImage(blob); jobs[0].onmessage({ data: null });
  assert.equal(await colored, null); assert.equal(jobs[0].terminated, true);
  const failed = decodeScalarImage(blob); jobs[1].onerror({ preventDefault() {} });
  assert.equal(await failed, null); assert.equal(jobs[1].terminated, true);
  const controller = new AbortController(), aborted = decodeScalarImage(blob, controller.signal);
  controller.abort(); await assert.rejects(aborted, { name: 'AbortError' }); assert.equal(jobs[2].terminated, true);
  globalThis.OffscreenCanvas = undefined;
  assert.equal(await decodeScalarImage(blob), null); assert.equal(jobs.length, 3);
});
