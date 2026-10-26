import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchBuffer} from '../src/runtime/rendering/assets.ts';
test('compressed downloads prefer decoded size and report decoded progress', async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response(new Uint8Array([1,2,3,4,5,6]),{headers:{'content-encoding':'br','content-length':'2','x-asset-decoded-length':'6'}}));
  const seen=[];
  const bytes=await fetchBuffer('/compressed.glb',new AbortController().signal,(loaded,total)=>seen.push([loaded,total]),10);
  assert.deepEqual([...new Uint8Array(bytes)],[1,2,3,4,5,6]);assert.deepEqual(seen,[[6,6]]);
});
