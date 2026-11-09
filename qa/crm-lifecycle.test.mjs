import test from 'node:test';
import assert from 'node:assert/strict';
import { createCrmLifecycle } from '../src/runtime/presentation/crmLifecycle.ts';
function fixture() {
  const jobs = new Map(), messages = [], pauses = []; let id = 0;
  const lifecycle = createCrmLifecycle({ tour: on => messages.push(on), pause: on => pauses.push(on),
    schedule: (cb, ms) => { jobs.set(++id, {cb,ms}); return id; }, cancel: id => jobs.delete(id) });
  const advance = () => { const values = [...jobs.values()]; jobs.clear(); for (const {cb} of values) cb(); };
  return { lifecycle, jobs, messages, pauses, advance };
}
test('ready and visibility gate the 40 second attract tour; frame updates do not re-arm it', () => {
  const f = fixture(); f.lifecycle.update(false,true,false); assert.equal(f.jobs.size,0);
  f.lifecycle.update(true,true,false); const job = [...f.jobs.values()][0]; assert.equal(job.ms,40000);
  for(let i=0;i<120;i++) f.lifecycle.update(true,true,false);
  assert.equal([...f.jobs.values()][0],job); assert.deepEqual(f.pauses,[false]);
  f.advance(); assert.deepEqual(f.messages,[true]);
  f.lifecycle.update(true,false,false); assert.deepEqual(f.messages,[true,false]);
  assert.deepEqual(f.pauses,[false,true]); f.advance(); assert.equal(f.jobs.size,0);
});
test('seated and hidden states cancel pending tours; stand resumes; dispose releases timers', () => {
  const f = fixture(); f.lifecycle.update(true,true,false); f.lifecycle.update(true,true,true);
  assert.equal(f.jobs.size,0); f.advance(); assert.ok(!f.messages.includes(true));
  f.lifecycle.update(true,true,false); assert.deepEqual(f.messages,[true]);
  f.lifecycle.update(true,false,false); f.lifecycle.update(true,true,false);
  assert.equal(f.jobs.size,1); f.lifecycle.dispose(); assert.equal(f.jobs.size,0);
  f.lifecycle.update(true,true,false); assert.equal(f.jobs.size,0);
});
test('leaving during the initial idle period cannot wake the invisible CRM later', () => {
  const f = fixture(); f.lifecycle.update(true,true,false); f.lifecycle.update(true,false,false);
  f.advance(); assert.deepEqual(f.messages,[]); assert.deepEqual(f.pauses,[false,true]);
});
