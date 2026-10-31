import test from 'node:test';
import assert from 'node:assert/strict';
import { CompressedTexture, FileLoader } from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { SceneKTX2Loader } from '../src/runtime/rendering/SceneKTX2Loader.ts';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function microtasks() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
function controlledInit() {
  const wrapper = deferred(), binary = deferred();
  const originalLoad = FileLoader.prototype.loadAsync;
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const live = new Set();
  FileLoader.prototype.loadAsync = function () { return this.responseType === 'arraybuffer' ? binary.promise : wrapper.promise; };
  URL.createObjectURL = blob => { const url = originalCreate(blob); live.add(url); return url; };
  URL.revokeObjectURL = url => { live.delete(url); originalRevoke(url); };
  return {
    live,
    finish() { wrapper.resolve('/* mocked transcoder wrapper */'); binary.resolve(new ArrayBuffer(8)); },
    restore() {
      FileLoader.prototype.loadAsync = originalLoad;
      for (const url of live) originalRevoke(url);
      URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
    },
  };
}

test('pinned r186 disposal during init otherwise creates a late live blob and allows worker dispatch', async () => {
  const init = controlledInit(), loader = new KTX2Loader();
  let dispatched = 0;
  loader.workerPool.postMessage = async () => { dispatched++; };
  try {
    const work = loader.init().then(() => loader.workerPool.postMessage({ type: 'transcode' }, []));
    loader.dispose(); init.finish(); await work;
    assert.equal(dispatched, 1);
    assert.equal(init.live.size, 1, 'the pinned loader leaves the late URL live after disposal');
  } finally { if (loader.workerSourceURL) URL.revokeObjectURL(loader.workerSourceURL); loader.workerPool.dispose(); init.restore(); }
});

test('scene loader rejects late init, releases its blob/binary, and cannot dispatch after disposal', async () => {
  const init = controlledInit(), abort = new AbortController(), loader = new SceneKTX2Loader(undefined, abort.signal);
  let dispatched = 0;
  loader.workerPool.postMessage = async () => { dispatched++; };
  try {
    const work = loader.init().then(() => loader.workerPool.postMessage({ type: 'transcode' }, []));
    const rejection = assert.rejects(work, { name: 'AbortError' });
    abort.abort(); init.finish(); await rejection; await microtasks();
    assert.equal(dispatched, 0); assert.equal(init.live.size, 0);
    assert.equal(loader.transcoderBinary, null); assert.equal(loader.workerSourceURL, '');
    loader.dispose();
    await assert.rejects(loader.init(), { name: 'AbortError' });
  } finally { loader.dispose(); init.restore(); }
});

test('all active parses settle once on cancellation and discard late textures', async () => {
  const abort = new AbortController(), loader = new SceneKTX2Loader(undefined, abort.signal);
  loader.workerConfig = {};
  const jobs = [deferred(), deferred()]; let next = 0, loaded = 0, disposed = 0;
  loader._createTexture = () => jobs[next++].promise;
  const reasons = [];
  const requests = jobs.map(() => new Promise((resolve, reject) => loader.parse(new ArrayBuffer(1), texture => { loaded++; resolve(texture); }, error => { reasons.push(error); reject(error); })));
  const completed = Promise.allSettled(requests);
  const reason = new DOMException('User retried', 'AbortError'); abort.abort(reason);
  const results = await completed;
  assert.ok(results.every(value => value.status === 'rejected' && value.reason === reason));
  for (const job of jobs) { const texture = new CompressedTexture(); texture.addEventListener('dispose', () => disposed++); job.resolve(texture); }
  await microtasks(); loader.dispose();
  assert.equal(loaded, 0); assert.equal(disposed, 2); assert.equal(reasons.length, 2);
});

test('successful and failed parses preserve the original texture/error and finish once', async () => {
  const loader = new SceneKTX2Loader(); loader.workerConfig = {};
  const texture = new CompressedTexture(); let disposed = 0;
  texture.addEventListener('dispose', () => disposed++);
  loader._createTexture = () => Promise.resolve(texture);
  const loaded = await new Promise((resolve, reject) => loader.parse(new ArrayBuffer(1), resolve, reject));
  assert.equal(loaded, texture); assert.equal(disposed, 0);
  const reason = new Error('Transcode failed'); loader._createTexture = () => Promise.reject(reason);
  await assert.rejects(new Promise((resolve, reject) => loader.parse(new ArrayBuffer(1), resolve, reject)), error => error === reason);
  loader.dispose(); assert.equal(disposed, 0, 'successful texture ownership belongs to the scene');
  texture.dispose();
});

test('already-aborted scenes never initialize or accept more parse work', async () => {
  const abort = new AbortController(); abort.abort();
  const loader = new SceneKTX2Loader(undefined, abort.signal);
  let decoded = false; loader._createTexture = () => { decoded = true; return Promise.resolve(new CompressedTexture()); };
  await assert.rejects(loader.init(), { name: 'AbortError' });
  await assert.rejects(new Promise((resolve, reject) => loader.parse(new ArrayBuffer(1), resolve, reject)), { name: 'AbortError' });
  assert.equal(decoded, false); assert.equal(loader.transcoderPending, null);
  loader.dispose();
});
