import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAssetBuffer } from '../src/runtime/rendering/fetchAsset.ts';
import { loadEXRInWorker } from '../src/runtime/rendering/exrDecode.ts';
import { loadTexture } from '../src/runtime/rendering/assets.ts';
import { Texture, TextureLoader, SRGBColorSpace } from 'three';

const bytes = value => [...new Uint8Array(value)];

test('transient HTTP responses recover without altering bytes, permanent failures do not retry', async t => {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async () => ++requests === 1 ? new Response('temporary', { status }) : new Response(new Uint8Array([1, 3, 5])));
    assert.deepEqual(bytes(await fetchAssetBuffer('/lighting.exr', { retryDelayMs: 0 })), [1, 3, 5]);
    assert.equal(requests, 2);
  }
  for (const status of [400, 401, 403, 404]) {
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async () => { requests++; return new Response('missing', { status }); });
    await assert.rejects(fetchAssetBuffer('/missing.glb', { retryDelayMs: 0 }), new RegExp(`missing.glb: HTTP ${status}`));
    assert.equal(requests, 1);
  }
});

test('connection failures have a bounded attempt count and useful final error', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new TypeError('Failed to fetch'); });
  await assert.rejects(fetchAssetBuffer('/studio.glb', { retryDelayMs: 0 }), /studio.glb: The connection was interrupted after 3 attempts/);
  assert.equal(requests, 3);
});

test('interrupted and truncated bodies restart from byte zero with no retained partial bytes', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    if (requests === 1) {
      let pull = 0;
      return new Response(new ReadableStream({ pull(controller) { if (!pull++) controller.enqueue(new Uint8Array([9, 9])); else controller.error(new TypeError('socket closed')); } }));
    }
    if (requests === 2) return new Response(new Uint8Array([7]), { headers: { 'x-asset-decoded-length': '3' } });
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'x-asset-decoded-length': '3' } });
  });
  assert.deepEqual(bytes(await fetchAssetBuffer('/room.glb', { retryDelayMs: 0 })), [1, 2, 3]);
  assert.equal(requests, 3);
});

test('idle watchdog aborts a stalled body, cancels its reader, and retries', async t => {
  let requests = 0, cancelled = 0, firstSignal;
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    if (++requests > 1) return new Response(new Uint8Array([4, 2]));
    firstSignal = options.signal;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([8])); }, cancel() { cancelled++; } }));
  });
  assert.deepEqual(bytes(await fetchAssetBuffer('/stalled.glb', { stallMs: 20, retryDelayMs: 0 })), [4, 2]);
  assert.equal(requests, 2); assert.equal(cancelled, 1); assert.equal(firstSignal.aborted, true);
});

test('progress resets watchdog: a slow transfer may outlast the idle limit', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    let index = 0;
    return new Response(new ReadableStream({
      async pull(controller) { await new Promise(resolve => setTimeout(resolve, 18)); if (index === 6) controller.close(); else controller.enqueue(new Uint8Array([index++])); },
    }));
  });
  const start = performance.now();
  assert.deepEqual(bytes(await fetchAssetBuffer('/slow.glb', { stallMs: 80, retryDelayMs: 0 })), [0, 1, 2, 3, 4, 5]);
  assert.ok(performance.now() - start > 80); assert.equal(requests, 1);
});

test('caller abort cancels a stalled request immediately and never retries', async t => {
  let requests = 0, cancelled = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; return new Response(new ReadableStream({ cancel() { cancelled++; } })); });
  const controller = new AbortController();
  const pending = fetchAssetBuffer('/cancel.glb', { signal: controller.signal, stallMs: 10000, retryDelayMs: 0 });
  await new Promise(resolve => setTimeout(resolve, 10)); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(requests, 1); assert.equal(cancelled, 1);
});

test('caller abort during backoff prevents replacement download', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; return new Response('', { status: 503 }); });
  const controller = new AbortController();
  const pending = fetchAssetBuffer('/cancel-retry.glb', { signal: controller.signal, retryDelayMs: 10000 });
  await new Promise(resolve => setTimeout(resolve, 10)); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(requests, 1);
});

test('decode errors do not redownload a successfully transferred lighting file', async t => {
  let requests = 0, terminated = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; return new Response(new Uint8Array([1])); });
  const before = globalThis.Worker;
  globalThis.Worker = class { terminate() { terminated++; } postMessage() { queueMicrotask(() => this.onmessage({ data: { error: 'Invalid EXR signature' } })); } };
  t.after(() => { globalThis.Worker = before; });
  await assert.rejects(loadEXRInWorker('/broken.exr'), /Invalid EXR signature/);
  assert.equal(requests, 1); assert.equal(terminated, 1);
});

test('progress callback exceptions are application failures and do not retry the network', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; return new Response(new Uint8Array([1])); });
  await assert.rejects(fetchAssetBuffer('/room.glb', { retryDelayMs: 0, onProgress() { throw Error('callback failed'); } }), /callback failed/);
  assert.equal(requests, 1);
});


test('header timeout aborts a hung request before retrying', async t => {
  let requests = 0, stalledSignal;
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    if (++requests > 1) return new Response(new Uint8Array([6]));
    stalledSignal = options.signal;
    return new Promise(() => {});
  });
  assert.deepEqual(bytes(await fetchAssetBuffer('/headers.glb', { stallMs: 20, retryDelayMs: 0 })), [6]);
  assert.equal(requests, 2); assert.equal(stalledSignal.aborted, true);
});

test('image transfer preserves texture semantics and revokes its temporary URL', async t => {
  const created = [], revoked = [], nativeCreate = URL.createObjectURL, nativeRevoke = URL.revokeObjectURL;
  t.mock.method(URL, 'createObjectURL', blob => { const url = nativeCreate.call(URL, blob); created.push(url); return url; });
  t.mock.method(URL, 'revokeObjectURL', url => { revoked.push(url); nativeRevoke.call(URL, url); });
  t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array([1, 2])));
  const original = new Texture({ width: 64, height: 64 });
  t.mock.method(TextureLoader.prototype, 'load', function(url, onLoad) { assert.match(url, /^blob:/); queueMicrotask(() => onLoad(original)); return original; });
  const texture = await loadTexture('/color.png', 'color');
  assert.equal(texture, original); assert.equal(texture.colorSpace, SRGBColorSpace); assert.equal(texture.flipY, true);
  assert.equal(created.length, 1); assert.deepEqual(revoked, created); texture.dispose();
});

test('cancelling image decode revokes URL and disposes a late texture without retrying', async t => {
  let requests = 0, revoked = 0, loaded, decodeStarted;
  const started = new Promise(resolve => { decodeStarted = resolve; });
  const nativeRevoke = URL.revokeObjectURL;
  t.mock.method(URL, 'revokeObjectURL', url => { revoked++; nativeRevoke.call(URL, url); });
  t.mock.method(globalThis, 'fetch', async () => { requests++; return new Response(new Uint8Array([1])); });
  t.mock.method(TextureLoader.prototype, 'load', function(url, onLoad) { loaded = onLoad; decodeStarted(); return new Texture(); });
  const controller = new AbortController();
  const pending = loadTexture('/large.png', 'data', controller.signal);
  await started; controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(revoked, 1); assert.equal(requests, 1);
  const late = new Texture(); let disposed = 0; late.addEventListener('dispose', () => disposed++); loaded(late);
  assert.equal(disposed, 1);
});
