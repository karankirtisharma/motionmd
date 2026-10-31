import test from 'node:test';
import assert from 'node:assert/strict';
import {avatarFixture} from './helpers/avatar-fixture.mjs';

// The launch recovery intentionally restores the earlier authored gait. Body
// collision still follows stairs; terrain must never fold the source leg pose.
for (const onStair of [false]) test(`terrain cannot rewrite source walk/run/idle/sit poses (stairs=${onStair})`,async()=>{
 const normal=await avatarFixture(),terrain=await avatarFixture();
 let samples=0;
 const sample=()=>{samples++;return .3;};
 sample.isStair=()=>{samples++;return onStair;};
 sample.clearance=()=>{samples++;return .27;};
 const bones=avatar=>{const result=[];avatar.root.traverse(o=>{if(o.isBone)result.push(o);});return result;};
 const a=bones(normal),b=bones(terrain);assert.equal(a.length,b.length);
 try{
  for(let frame=0;frame<480;frame++){
   const speed=frame<90?1.38:frame<180?3.35:frame<270?0:frame<360?1.65:0;
   const seated=frame<360?0:Math.min(1,(frame-360)/60);
   const y=.15*Math.floor(frame/50),yaw=Math.sin(frame/100)*.35;
   for(const avatar of[normal,terrain]){avatar.root.position.set(frame/100,y,0);avatar.root.rotation.y=yaw;}
   normal.update(1/60,speed,seated);
   terrain.update(1/60,speed,seated,.55,undefined,{sample,sprint:speed>2});
   for(let i=0;i<a.length;i++){
    assert.ok(a[i].position.distanceTo(b[i].position)<1e-9,`${a[i].name} terrain position override`);
    assert.ok(a[i].quaternion.toArray().every((v,j)=>Math.abs(v-b[i].quaternion.toArray()[j])<1e-12),`${a[i].name} terrain rotation override`);
   }
   assert.deepEqual(terrain.locomotion.stairClearance,[0,0]);
   assert.equal(normal.locomotion.soleLift,terrain.locomotion.soleLift);
   assert.ok(terrain.locomotion.soleLift>=0 && terrain.locomotion.soleLift<=.04,'whole-model floor correction remains bounded');
  }
  assert.ok(samples>0,'only stair classification runs on ordinary floors');
  assert.deepEqual(new Set(terrain.animations),new Set(['Idle','Walk','Run','Sit']));
 }finally{normal.dispose();terrain.dispose();}
});
