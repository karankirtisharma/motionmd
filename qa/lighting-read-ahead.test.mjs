import test from 'node:test';
import assert from 'node:assert/strict';
import { createLightingReadAhead } from '../src/runtime/rendering/lightingReadAhead.ts';
import { setImmediate as tick } from 'node:timers/promises';

test('required lightmaps stream ahead within the byte budget and are consumed only once', async () => {
  const calls = [], gates = new Map();
  const fetch = (url) => { calls.push(url); return new Promise(resolve => gates.set(url,resolve)); };
  const ctrl = new AbortController();
  const pool = createLightingReadAhead({ a:4,b:4,c:7,oversize:12 }, fetch, ctrl.signal, 8, 1);
  await tick(); assert.deepEqual(calls,['a']);
  gates.get('a')(Uint8Array.of(1).buffer); await tick(); assert.deepEqual(calls,['a','b']);
  gates.get('b')(Uint8Array.of(2).buffer); await tick();
  assert.deepEqual(calls,['a','b'], 'completed buffers still occupy reservations');
  assert.deepEqual([...new Uint8Array(await pool.read('a'))],[1]);
  assert.deepEqual([...new Uint8Array(await pool.read('b'))],[2]);
  await tick(); assert.deepEqual(calls,['a','b','c']);
  const consumer = pool.read('c'); gates.get('c')(Uint8Array.of(3).buffer);
  assert.deepEqual([...new Uint8Array(await consumer)],[3]); pool.close();
  assert.ok(!calls.includes('oversize'));
});

test('a failed early transfer retries on demand and a closed run releases pending work', async () => {
  const ctrl=new AbortController(), attempts=new Map(); let earlyAborted=false;
  const pool=createLightingReadAhead({ a:2,b:2 }, async(url,signal)=>{
    const n=(attempts.get(url)??0)+1; attempts.set(url,n);
    if(url==='a' && n===1) throw Error('temporary connection failure');
    if(url==='b') return new Promise((_,reject)=>signal.addEventListener('abort',()=>{earlyAborted=true;reject(signal.reason);},{once:true}));
    return Uint8Array.of(7).buffer;
  },ctrl.signal,4,2);
  await tick();
  assert.equal(new Uint8Array(await pool.read('a'))[0],7);
  assert.equal(attempts.get('a'),2);
  ctrl.abort(); await tick(); assert.equal(earlyAborted,true);
  await assert.rejects(pool.read('other'),{name:'AbortError'}); pool.close();
});
