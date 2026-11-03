import test from 'node:test';
import assert from 'node:assert/strict';
import { CompressedTexture, LoadingManager } from 'three';
import { SceneKTX2Loader } from '../src/runtime/rendering/SceneKTX2Loader.ts';

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function microtasks() { for (let i = 0; i < 16; i++) await Promise.resolve(); }
function fixture(signal) {
  const manager = new LoadingManager(), calls = { start: [], end: [], error: [] };
  for (const [key, method] of [['start', 'itemStart'], ['end', 'itemEnd'], ['error', 'itemError']]) {
    const original = manager[method]; manager[method] = url => { calls[key].push(url); original.call(manager, url); };
  }
  const loader = new SceneKTX2Loader(manager, signal); loader.workerConfig = {};
  return { manager, loader, calls };
}

test('duplicate KTX2 requests share one transfer and decode with balanced manager events', async t => {
  const { loader, calls } = fixture(), response = deferred(); let fetches = 0, decodes = 0;
  t.mock.method(globalThis, 'fetch', async () => { fetches++; return response.promise; });
  const texture = new CompressedTexture(); loader._createTexture = async () => { decodes++; return texture; };
  const a = loader.loadAsync('/shared.ktx2'), b = loader.loadAsync('/shared.ktx2');
  response.resolve(new Response(new Uint8Array([1, 2, 3])));
  assert.equal(await a, texture); assert.equal(await b, texture);
  assert.equal(fetches, 1); assert.equal(decodes, 1);
  assert.deepEqual(calls, { start: ['/shared.ktx2'], end: ['/shared.ktx2'], error: [] });
  loader.dispose(); texture.dispose();
});

test('KTX2 transient response retries network only and never reports recovered errors to manager', async t => {
  const { loader, calls } = fixture(); let fetches = 0, decodes = 0;
  t.mock.method(globalThis, 'fetch', async () => ++fetches === 1 ? new Response('', { status: 503 }) : new Response(new Uint8Array([7, 8])));
  const texture = new CompressedTexture(); loader._createTexture = async buffer => { decodes++; assert.deepEqual([...new Uint8Array(buffer)], [7, 8]); return texture; };
  assert.equal(await loader.loadAsync('/retry.ktx2'), texture);
  assert.equal(fetches, 2); assert.equal(decodes, 1);
  assert.deepEqual(calls, { start: ['/retry.ktx2'], end: ['/retry.ktx2'], error: [] });
  loader.dispose(); texture.dispose();
});

test('permanent HTTP and decode failures settle once without network/decode retry', async t => {
  for (const decodeFailure of [false, true]) {
    const { loader, calls } = fixture(); let fetches = 0, decodes = 0;
    t.mock.method(globalThis, 'fetch', async () => { fetches++; return decodeFailure ? new Response(new Uint8Array([9])) : new Response('', { status: 404 }); });
    loader._createTexture = async () => { decodes++; throw Error('Invalid KTX2'); };
    await assert.rejects(loader.loadAsync('/broken.ktx2'), decodeFailure ? /Invalid KTX2/ : /HTTP 404/);
    assert.equal(fetches, 1); assert.equal(decodes, Number(decodeFailure));
    assert.deepEqual(calls, { start: ['/broken.ktx2'], end: ['/broken.ktx2'], error: ['/broken.ktx2'] });
    loader.dispose();
  }
});

test('resolved path, URL modifier, headers and credentials are preserved and partition deduplication', async t => {
  const { loader, manager, calls } = fixture(), requests = [];
  manager.setURLModifier(url => 'https://cdn.example/release' + url);
  loader.setPath('/maps/').setRequestHeader({ Authorization: 'fixture-one' }).setWithCredentials(true);
  t.mock.method(globalThis, 'fetch', async (url, options) => { requests.push([url, options.credentials, options.headers.get('authorization')]); return new Response(new Uint8Array([1])); });
  const textures = []; loader._createTexture = async () => { const texture = new CompressedTexture(); textures.push(texture); return texture; };
  const first = loader.loadAsync('wall.ktx2');
  loader.setRequestHeader({ Authorization: 'fixture-two' }).setWithCredentials(false);
  const second = loader.loadAsync('wall.ktx2');
  await Promise.all([first, second]);
  assert.deepEqual(requests, [['https://cdn.example/release/maps/wall.ktx2', 'include', 'fixture-one'], ['https://cdn.example/release/maps/wall.ktx2', 'same-origin', 'fixture-two']]);
  assert.equal(calls.start.length, 2); assert.equal(calls.end.length, 2); assert.equal(calls.error.length, 0);
  loader.dispose(); textures.forEach(texture => texture.dispose());
});

test('scene cancellation stops a shared active transfer and rejects all waiters once', async t => {
  const abort = new AbortController(), { loader, calls } = fixture(abort.signal); let fetches = 0, cancelled = 0, requestSignal;
  t.mock.method(globalThis, 'fetch', async (_, options) => { fetches++; requestSignal = options.signal; return new Response(new ReadableStream({ cancel() { cancelled++; } })); });
  const a = loader.loadAsync('/cancel.ktx2'), b = loader.loadAsync('/cancel.ktx2');
  const complete = Promise.allSettled([a, b]); await microtasks(); abort.abort();
  const results = await complete; await microtasks();
  assert.ok(results.every(result => result.status === 'rejected' && result.reason.name === 'AbortError'));
  assert.equal(fetches, 1); assert.equal(cancelled, 1); assert.equal(requestSignal.aborted, true);
  assert.deepEqual(calls, { start: ['/cancel.ktx2'], end: ['/cancel.ktx2'], error: ['/cancel.ktx2'] });
  loader.dispose();
});

test('manager cancellation during decode settles consumers and disposes the eventual texture', async t => {
  const { loader, manager, calls } = fixture(), decoding = deferred(), started = deferred(); let disposed = 0;
  t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array([1])));
  loader._createTexture = () => { started.resolve(); return decoding.promise; };
  const pending = loader.loadAsync('/decode.ktx2'); const result = assert.rejects(pending, { name: 'AbortError' });
  await started.promise; manager.abort(); await result;
  const texture = new CompressedTexture(); texture.addEventListener('dispose', () => disposed++); decoding.resolve(texture); await microtasks();
  assert.equal(disposed, 1);
  assert.deepEqual(calls, { start: ['/decode.ktx2'], end: ['/decode.ktx2'], error: ['/decode.ktx2'] });
  loader.dispose();
});

test('successful texture ownership survives loader disposal and a new scene never inherits cancelled jobs', async t => {
  const first = fixture(); first.loader.dispose();
  await assert.rejects(first.loader.loadAsync('/shared.ktx2'), { name: 'AbortError' });
  const next = fixture(); let disposed = 0;
  t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array([1])));
  const texture = new CompressedTexture(); texture.addEventListener('dispose', () => disposed++); next.loader._createTexture = async () => texture;
  assert.equal(await next.loader.loadAsync('/shared.ktx2'), texture); next.loader.dispose();
  assert.equal(disposed, 0); assert.equal(first.calls.start.length, 0); texture.dispose();
});


test('shared KTX2 progress reaches each subscriber without changing loaded-byte semantics', async t => {
  const previous = globalThis.ProgressEvent;
  globalThis.ProgressEvent = class extends Event { constructor(type, options) { super(type); Object.assign(this, options); } };
  t.after(() => { if (previous === undefined) delete globalThis.ProgressEvent; else globalThis.ProgressEvent = previous; });
  const { loader } = fixture(), seenA = [], seenB = [], response = deferred();
  t.mock.method(globalThis, 'fetch', async () => response.promise);
  const texture = new CompressedTexture(); loader._createTexture = async () => texture;
  const a = loader.loadAsync('/progress.ktx2', event => seenA.push([event.loaded, event.total, event.lengthComputable]));
  const b = loader.loadAsync('/progress.ktx2', event => seenB.push([event.loaded, event.total, event.lengthComputable]));
  response.resolve(new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); controller.enqueue(new Uint8Array([2, 3])); controller.close(); } }), { headers: { 'Content-Length': '3' } }));
  await Promise.all([a, b]);
  assert.deepEqual(seenA, [[1, 3, true], [3, 3, true]]); assert.deepEqual(seenB, seenA);
  loader.dispose(); texture.dispose();
});
