import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameReadiness } from '../src/runtime/presentation/frameReadiness.ts';
function fixture() {
  let id=0; const jobs=new Map(), loads=[]; let failures=0;
  const controller=createFrameReadiness({load:n=>loads.push(n),exhausted:()=>failures++,
    schedule:(cb,ms)=>{jobs.set(++id,{cb,ms});return id;},cancel:id=>jobs.delete(id)});
  const fire=()=>{const entry=jobs.entries().next().value; if(entry){jobs.delete(entry[0]);entry[1].cb();}};
  return {controller,jobs,loads,fire,get failures(){return failures;}};
}
test('a loaded document without app readiness retries, then successful boot cancels recovery',()=>{
  const f=fixture(); f.controller.start(); f.controller.start(); assert.deepEqual(f.loads,[1]);
  assert.equal([...f.jobs.values()][0].ms,30000);
  f.controller.loaded(); assert.equal([...f.jobs.values()][0].ms,2000); f.fire();
  assert.deepEqual(f.loads,[1,2]); f.controller.ready(); f.controller.loaded(); f.fire();
  assert.equal(f.jobs.size,0); assert.deepEqual(f.loads,[1,2]); assert.equal(f.failures,0);
});
test('offline failures stop after three attempts; teardown cancels pending work',()=>{
  const f=fixture(); f.controller.start(); f.fire(); f.fire(); f.fire();
  assert.deepEqual(f.loads,[1,2,3]);assert.equal(f.failures,1); assert.equal(f.jobs.size,0);
  const g=fixture();g.controller.start();const stale=[...g.jobs.values()][0].cb;g.controller.dispose();stale();
  assert.deepEqual(g.loads,[1]);assert.equal(g.jobs.size,0);
});
