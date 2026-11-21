import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createMeshoptDecoder } from '../src/runtime/rendering/meshoptDecode.ts';
import { loadProgressively } from '../src/runtime/rendering/progressiveLoad.ts';

test('progressive staging overlaps small fetches but keeps oversized rooms exclusive', async () => {
  const events = [];
  const items = [10,20,200,15].map((bytes,id)=>({bytes,id}));
  let preparing = false;
  await loadProgressively(items,new AbortController().signal,async item=>{
    events.push(['fetch',item.id,preparing]);return item.id;
  },async (item,value)=>{
    assert.equal(value,item.id);preparing=true;
    await new Promise(r=>setTimeout(r,1));
    events.push(['prepared',item.id]);preparing=false;
  },64);
  assert.ok(events.findIndex(x=>x[0]==='fetch'&&x[1]===1)<events.findIndex(x=>x[0]==='prepared'&&x[1]===0));
  assert.ok(events.findIndex(x=>x[0]==='fetch'&&x[1]===2)>events.findIndex(x=>x[0]==='prepared'&&x[1]===1));
  assert.ok(events.findIndex(x=>x[0]==='fetch'&&x[1]===3)>events.findIndex(x=>x[0]==='prepared'&&x[1]===2));
});
test('the next small transfer starts while the first is still pending', async () => {
  const seen = [];
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const run = loadProgressively([{bytes:10,id:0},{bytes:20,id:1}],new AbortController().signal,async item => {
    seen.push(item.id);
    if (item.id === 0) await held;
    return item.id;
  }, async () => {}, 64);
  try { assert.deepEqual(seen, [0,1]); } finally { release(); await run; }
});

test('transfer slots refill during parsing without releasing the current buffer budget', async () => {
  const items = [30, 30, 10, 20, 70].map((bytes, id) => ({ id, bytes }));
  const downloads = [], prepared = [];
  const gates = items.map(() => Promise.withResolvers());
  const firstPrepared = Promise.withResolvers(), holdParse = Promise.withResolvers();
  let active = 0, peak = 0;
  const loaded = loadProgressively(items, new AbortController().signal, async item => {
    downloads.push(item.id);
    peak = Math.max(peak, ++active);
    await gates[item.id].promise;
    active--;
    return item.id;
  }, async (item, id) => {
    assert.equal(item.id, id);
    if (!id) { firstPrepared.resolve(); await holdParse.promise; }
    prepared.push(id);
  }, 90);
  try {
    assert.deepEqual(downloads, [0, 1]);
    gates[0].resolve();
    await firstPrepared.promise;
    assert.deepEqual(downloads, [0, 1, 2]);
    gates[1].resolve();
    gates[2].resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(downloads, [0, 1, 2, 3], '30+30+10+20 fills the budget while the first parse is held');
    assert.equal(peak, 2);
  } finally {
    holdParse.resolve();
    for (const gate of gates) gate.resolve();
    await loaded;
  }
  assert.deepEqual(prepared, [0, 1, 2, 3, 4]);
});

test('failed preparation aborts its outstanding prefetch and never prepares subsequent rooms',async()=>{
  let cancelled=false,prepared=0;
  await assert.rejects(loadProgressively([{bytes:1,id:0},{bytes:1,id:1}],new AbortController().signal,
    async(item,signal)=>item.id===0?0:await new Promise((_,reject)=>signal.addEventListener('abort',()=>{cancelled=true;reject(signal.reason);},{once:true})),
    async()=>{prepared++;throw Error('bad material');}),/bad material/);
  assert.equal(cancelled,true);assert.equal(prepared,1);
});
test('worker adapter preserves actual decoded geometry and terminates all workers',async t=>{
  const buffer=fs.readFileSync(new URL('../public/assets/architecture-v16/gallery.glb',import.meta.url));
  const jsonLength=buffer.readUInt32LE(12),json=JSON.parse(buffer.subarray(20,20+jsonLength));
  const views=json.bufferViews.filter(v=>v.extensions?.EXT_meshopt_compression).slice(0,8);
  let alive=0,active=0,peak=0;
  class WorkerStub {
    constructor(){alive++;}
    terminate(){alive--;}
    postMessage(job){active++;peak=Math.max(peak,active);setTimeout(async()=>{const result=await MeshoptDecoder.decodeGltfBufferAsync(job.count,job.size,job.source,job.mode,job.filter);active--;this.onmessage({data:{result}});},0);}
  }
  const prior=globalThis.Worker;globalThis.Worker=WorkerStub;t.after(()=>{globalThis.Worker=prior;});
  const decoder=createMeshoptDecoder(new AbortController().signal,()=>new WorkerStub());
  try {
    const results=await Promise.all(views.map(async view=>{
      const v=view.extensions.EXT_meshopt_compression,source=buffer.subarray(28+jsonLength+v.byteOffset,28+jsonLength+v.byteOffset+v.byteLength);
      return [await decoder.decodeGltfBufferAsync(v.count,v.byteStride,source,v.mode,v.filter),await MeshoptDecoder.decodeGltfBufferAsync(v.count,v.byteStride,source,v.mode,v.filter)];
    }));
    for(const [actual,expected] of results)assert.deepEqual(actual,expected);
    assert.equal(peak,2);
  } finally {decoder.dispose();}
  assert.equal(alive,0);
});
test('abort rejects queued geometry and terminates active workers',async t=>{
  let stopped=0;
  class WorkerStub {terminate(){stopped++;}postMessage(){}}
  const prior=globalThis.Worker;globalThis.Worker=WorkerStub;t.after(()=>{globalThis.Worker=prior;});
  const abort=new AbortController(),decoder=createMeshoptDecoder(abort.signal,()=>new WorkerStub());
  const jobs=Array.from({length:4},()=>decoder.decodeGltfBufferAsync(1,4,new Uint8Array(4),'ATTRIBUTES'));
  abort.abort();
  const results=await Promise.allSettled(jobs);
  assert.ok(results.every(x=>x.status==='rejected'&&x.reason.name==='AbortError'));
  assert.equal(stopped,2);decoder.dispose();assert.equal(stopped,2);
});
