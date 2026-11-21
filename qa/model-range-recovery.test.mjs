import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fetchAssetBuffer } from '../src/runtime/rendering/fetchAsset.ts';

const source = '/assets/studio.glb?v=verified';
const identity = '/asset-delivery/verified.glb';
const all = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8);
const options = { expectedBytes: all.length, retryUrl: identity, resumeSHA256: createHash('sha256').update(all).digest('hex'), retryDelayMs: 0 };

function interrupted() {
  let sent = false;
  return new Response(new ReadableStream({
    pull(controller) {
      if (sent) { controller.error(new TypeError('connection closed')); return; }
      controller.enqueue(all.slice(0, 6));
      sent = true;
    },
  }), { headers: { 'Content-Encoding': 'br' } });
}
function tail(data = all.slice(6), range = 'bytes 6-7/8', encoding = 'identity') {
  return new Response(data, { status: 206, headers: { 'Content-Range': range, 'Content-Encoding': encoding } });
}

test('an interrupted compressed model resumes at the decoded offset on its static identity URL', async t => {
  const requests = [], progress = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push([url, init.headers.get('Range')]);
    return requests.length === 1 ? interrupted() : tail();
  });
  const output = await fetchAssetBuffer(source, { ...options, onProgress: n => progress.push(n) });
  assert.deepEqual(new Uint8Array(output), all);
  assert.deepEqual(requests, [[source, null], [identity, 'bytes=6-']]);
  assert.deepEqual(progress, [6, 8]);
});

test('a server ignoring Range returns the full model without a third request', async t => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () => ++count === 1 ? interrupted() : new Response(all));
  assert.deepEqual(new Uint8Array(await fetchAssetBuffer(source, options)), all);
  assert.equal(count, 2);
});

test('invalid, encoded and incomplete range responses fall back to a complete static download', async t => {
  for (const response of [
    tail(all.slice(6), 'bytes 0-1/8'), tail(all.slice(6), 'bytes 6-7/9'),
    tail(all.slice(6), 'bytes 6-7/8', 'br'), tail(all.slice(6, 7)), tail(Uint8Array.of(8, 7)),
    new Response(null, { status: 416 }),
  ]) {
    const ranges = [];
    const mock = t.mock.method(globalThis, 'fetch', async (url, init) => {
      ranges.push(init.headers.get('range'));
      if (ranges.length === 1) return interrupted();
      assert.equal(url, identity);
      return ranges.length === 2 ? response : new Response(all);
    });
    try {
      assert.deepEqual(new Uint8Array(await fetchAssetBuffer(source, options)), all);
      assert.deepEqual(ranges, [null, 'bytes=6-', null]);
    } finally { mock.mock.restore(); }
  }
});

test('cancelling a pending range releases the reader and never retries', async t => {
  const abort = new AbortController();
  let count = 0, cancelled = false;
  t.mock.method(globalThis, 'fetch', async () => {
    if (++count === 1) return interrupted();
    return tail(new ReadableStream({
      pull() { setTimeout(() => abort.abort(), 0); },
      cancel() { cancelled = true; },
    }));
  });
  await assert.rejects(fetchAssetBuffer(source, { ...options, signal: abort.signal }), { name: 'AbortError' });
  assert.equal(cancelled, true);
  assert.equal(count, 2);
});
